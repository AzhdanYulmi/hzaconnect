import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../db/client.js";
import { agents, agentSessions } from "../db/schema.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { signAgentAccess } from "../auth/tokens.js";
import { audit } from "../audit.js";
import { config } from "../config.js";

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashRefresh(token: string): Buffer {
  return crypto.createHash("sha256").update(token).digest();
}

function cookieOptions() {
  return {
    path: "/api/auth",
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict" as const,
    domain: config.COOKIE_DOMAIN || undefined,
    maxAge: REFRESH_TTL_MS / 1000,
  };
}

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/auth/login", async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(req.body);

    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.email, body.email), eq(agents.status, "active")),
    });
    if (!agent) return reply.code(401).send({ error: "invalid_credentials" });

    const ok = await verifyPassword(agent.passwordHash, body.password);
    if (!ok) return reply.code(401).send({ error: "invalid_credentials" });

    const refreshToken = crypto.randomBytes(32).toString("base64url");
    const [sessionRow] = await db
      .insert(agentSessions)
      .values({
        agentId: agent.id,
        refreshTokenHash: hashRefresh(refreshToken),
        userAgent: req.headers["user-agent"] ?? null,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      })
      .returning({ id: agentSessions.id });

    const access = await signAgentAccess({
      sub: agent.id,
      role: agent.role,
      typ: "agent",
    });

    await audit({
      actorType: "agent",
      actorId: agent.id,
      action: "agent.login",
      subjectType: "agent",
      subjectId: agent.id,
      metadata: { session_id: sessionRow!.id },
    });

    reply.setCookie(
      "hza_refresh",
      `${sessionRow!.id}.${refreshToken}`,
      cookieOptions(),
    );

    return {
      access_token: access,
      agent: {
        id: agent.id,
        email: agent.email,
        display_name: agent.displayName,
        role: agent.role,
      },
    };
  });

  fastify.post("/api/auth/refresh", async (req, reply) => {
    const raw = req.cookies["hza_refresh"];
    if (!raw) return reply.code(401).send({ error: "no_refresh" });
    const [sessionId, token] = raw.split(".");
    if (!sessionId || !token) return reply.code(401).send({ error: "bad_cookie" });

    const session = await db.query.agentSessions.findFirst({
      where: and(eq(agentSessions.id, sessionId), isNull(agentSessions.revokedAt)),
    });
    if (!session) return reply.code(401).send({ error: "unknown_session" });
    if (session.expiresAt < new Date())
      return reply.code(401).send({ error: "expired" });
    if (!crypto.timingSafeEqual(session.refreshTokenHash, hashRefresh(token))) {
      // Token reuse: revoke all sessions for this agent.
      await db
        .update(agentSessions)
        .set({ revokedAt: new Date() })
        .where(eq(agentSessions.agentId, session.agentId));
      return reply.code(401).send({ error: "reuse_detected" });
    }
    const agent = await db.query.agents.findFirst({
      where: and(eq(agents.id, session.agentId), eq(agents.status, "active")),
    });
    if (!agent) return reply.code(401).send({ error: "agent_inactive" });

    // Rotate: revoke old, issue new.
    const newToken = crypto.randomBytes(32).toString("base64url");
    await db
      .update(agentSessions)
      .set({ revokedAt: new Date() })
      .where(eq(agentSessions.id, sessionId));
    const [newSession] = await db
      .insert(agentSessions)
      .values({
        agentId: agent.id,
        refreshTokenHash: hashRefresh(newToken),
        userAgent: req.headers["user-agent"] ?? null,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      })
      .returning({ id: agentSessions.id });

    const access = await signAgentAccess({
      sub: agent.id,
      role: agent.role,
      typ: "agent",
    });
    reply.setCookie(
      "hza_refresh",
      `${newSession!.id}.${newToken}`,
      cookieOptions(),
    );
    return {
      access_token: access,
      agent: {
        id: agent.id,
        email: agent.email,
        display_name: agent.displayName,
        role: agent.role,
      },
    };
  });

  fastify.post("/api/auth/logout", async (req, reply) => {
    const raw = req.cookies["hza_refresh"];
    if (raw) {
      const [sessionId] = raw.split(".");
      if (sessionId) {
        await db
          .update(agentSessions)
          .set({ revokedAt: new Date() })
          .where(eq(agentSessions.id, sessionId));
      }
    }
    reply.clearCookie("hza_refresh", { path: "/api/auth" });
    return { ok: true };
  });

  // Admin-only: create a new agent.
  fastify.post("/api/auth/agents", async (req, reply) => {
    const actor = await fastify.requireAgent(req, reply);
    if (!actor) return;
    if (actor.role !== "admin") return reply.code(403).send({ error: "forbidden" });

    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(12),
        display_name: z.string().min(1).max(120),
        role: z.enum(["agent", "supervisor", "admin"]).default("agent"),
      })
      .parse(req.body);

    const hash = await hashPassword(body.password);
    const [created] = await db
      .insert(agents)
      .values({
        email: body.email,
        passwordHash: hash,
        displayName: body.display_name,
        role: body.role,
      })
      .returning();

    await audit({
      actorType: "agent",
      actorId: actor.id,
      action: "agent.create",
      subjectType: "agent",
      subjectId: created!.id,
      metadata: { role: body.role },
    });

    return {
      id: created!.id,
      email: created!.email,
      display_name: created!.displayName,
      role: created!.role,
    };
  });

  // Admin-only: list all agents.
  fastify.get("/api/auth/agents", async (req, reply) => {
    const actor = await fastify.requireAgent(req, reply);
    if (!actor) return;
    if (actor.role !== "admin") return reply.code(403).send({ error: "forbidden" });

    const rows = await db.query.agents.findMany({
      orderBy: (a, { asc }) => asc(a.createdAt),
    });
    return rows.map((a) => ({
      id: a.id,
      email: a.email,
      display_name: a.displayName,
      role: a.role,
      status: a.status,
      last_seen_at: a.lastSeenAt?.toISOString() ?? null,
      created_at: a.createdAt.toISOString(),
    }));
  });

  // Admin-only: update an agent (display name, role, status).
  // Self-protection: an admin cannot disable themselves or demote themselves
  // away from admin (avoids accidental lockout).
  fastify.patch<{ Params: { id: string } }>(
    "/api/auth/agents/:id",
    async (req, reply) => {
      const actor = await fastify.requireAgent(req, reply);
      if (!actor) return;
      if (actor.role !== "admin")
        return reply.code(403).send({ error: "forbidden" });

      const id = z.string().uuid().parse(req.params.id);
      const body = z
        .object({
          display_name: z.string().min(1).max(120).optional(),
          role: z.enum(["agent", "supervisor", "admin"]).optional(),
          status: z.enum(["active", "disabled"]).optional(),
        })
        .parse(req.body);

      if (id === actor.id) {
        if (body.status === "disabled")
          return reply.code(400).send({ error: "cannot_disable_self" });
        if (body.role && body.role !== "admin")
          return reply.code(400).send({ error: "cannot_demote_self" });
      }

      const updates: Partial<{
        displayName: string;
        role: "agent" | "supervisor" | "admin";
        status: "active" | "disabled";
        updatedAt: Date;
      }> = { updatedAt: new Date() };
      if (body.display_name !== undefined) updates.displayName = body.display_name;
      if (body.role !== undefined) updates.role = body.role;
      if (body.status !== undefined) updates.status = body.status;

      const [updated] = await db
        .update(agents)
        .set(updates)
        .where(eq(agents.id, id))
        .returning();
      if (!updated) return reply.code(404).send({ error: "not_found" });

      // Disabling an agent revokes their active sessions so they can't
      // continue using a stale access token.
      if (body.status === "disabled") {
        await db
          .update(agentSessions)
          .set({ revokedAt: new Date() })
          .where(eq(agentSessions.agentId, id));
      }

      await audit({
        actorType: "agent",
        actorId: actor.id,
        action: "agent.update",
        subjectType: "agent",
        subjectId: id,
        metadata: body,
      });

      return {
        id: updated.id,
        email: updated.email,
        display_name: updated.displayName,
        role: updated.role,
        status: updated.status,
        last_seen_at: updated.lastSeenAt?.toISOString() ?? null,
        created_at: updated.createdAt.toISOString(),
      };
    },
  );

  fastify.get("/api/auth/me", async (req, reply) => {
    const actor = await fastify.requireAgent(req, reply);
    if (!actor) return;
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, actor.id),
    });
    if (!agent) return reply.code(404).send({ error: "not_found" });
    return {
      id: agent.id,
      email: agent.email,
      display_name: agent.displayName,
      role: agent.role,
    };
  });
}
