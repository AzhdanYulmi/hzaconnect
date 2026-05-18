import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { sessions } from "../db/schema.js";
import { signWidgetSession, verifyWidgetSession } from "../auth/tokens.js";
import { audit } from "../audit.js";

function hashIp(ip: string | undefined): Buffer | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest();
}

export async function widgetSessionRoutes(fastify: FastifyInstance) {
  fastify.post("/api/widget/session", async (req) => {
    const body = z
      .object({
        casino_context: z.record(z.unknown()).optional(),
      })
      .parse(req.body ?? {});

    const [row] = await db
      .insert(sessions)
      .values({
        casinoContext: body.casino_context ?? {},
        userAgent: req.headers["user-agent"] ?? null,
        ipHash: hashIp(req.ip),
      })
      .returning();

    const token = await signWidgetSession({ sub: row!.id, typ: "anon" });

    await audit({
      actorType: "session",
      actorId: row!.id,
      action: "session.create",
      subjectType: "session",
      subjectId: row!.id,
    });

    return { session_id: row!.id, session_token: token };
  });

  fastify.post("/api/widget/session/refresh", async (req, reply) => {
    const body = z.object({ session_token: z.string() }).parse(req.body);
    let claims;
    try {
      claims = await verifyWidgetSession(body.session_token);
    } catch {
      return reply.code(401).send({ error: "invalid_token" });
    }
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, claims.sub),
    });
    if (!session) return reply.code(404).send({ error: "unknown_session" });

    await db
      .update(sessions)
      .set({ lastActiveAt: new Date() })
      .where(eq(sessions.id, session.id));

    const token = await signWidgetSession({
      sub: session.id,
      typ: claims.typ,
      euid: claims.euid,
    });
    return { session_id: session.id, session_token: token };
  });
}
