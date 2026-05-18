import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import {
  conversations,
  deploymentSettings,
  sessionIdentifiers,
  sessions,
  type SessionIdentifierRow,
} from "../db/schema.js";
import { audit } from "../audit.js";

// --- Schema for the public identifier kinds ---
const identifierKind = z.enum([
  "player_id",
  "email",
  "phone",
  "username",
  "custom",
]);

function rowToDto(r: SessionIdentifierRow) {
  return {
    id: r.id,
    session_id: r.sessionId,
    kind: r.kind,
    custom_label: r.customLabel,
    value: r.value,
    source: r.source,
    created_by_agent_id: r.createdByAgentId,
    superseded_at: r.supersededAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
  };
}

/**
 * Append a new identifier row, marking any current identifier of the same
 * kind (and same custom_label, if `custom`) as superseded. Atomic.
 */
async function recordIdentifier(opts: {
  sessionId: string;
  kind: "player_id" | "email" | "phone" | "username" | "custom";
  customLabel: string | null;
  value: string;
  source: "self" | "agent" | "sso";
  createdByAgentId: string | null;
}): Promise<SessionIdentifierRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Mark prior identifier of same kind+label as superseded.
    await client.query(
      `UPDATE session_identifiers
       SET superseded_at = NOW()
       WHERE session_id = $1 AND kind = $2
         AND ($3::text IS NULL OR custom_label = $3)
         AND superseded_at IS NULL`,
      [opts.sessionId, opts.kind, opts.customLabel],
    );
    const ins = await client.query(
      `INSERT INTO session_identifiers
         (session_id, kind, custom_label, value, source, created_by_agent_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        opts.sessionId,
        opts.kind,
        opts.customLabel,
        opts.value,
        opts.source,
        opts.createdByAgentId,
      ],
    );
    await client.query("COMMIT");
    const r = ins.rows[0]!;
    return {
      id: r.id,
      sessionId: r.session_id,
      kind: r.kind,
      customLabel: r.custom_label,
      value: r.value,
      source: r.source,
      createdByAgentId: r.created_by_agent_id,
      supersededAt: r.superseded_at ? new Date(r.superseded_at) : null,
      createdAt: new Date(r.created_at),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function identifierRoutes(fastify: FastifyInstance) {
  // ---- Public: deployment-wide identifier configuration ----
  // The widget fetches this on first load to know which fields to show.
  fastify.get("/api/deployment/identifier-config", async () => {
    const settings = await db.query.deploymentSettings.findFirst({
      where: eq(deploymentSettings.id, 1),
    });
    return {
      identifier_fields: settings?.identifierFields ?? [],
      require_before_chat: settings?.requireBeforeChat === "true",
    };
  });

  // ---- Widget: declare/update an identifier on the current session ----
  fastify.post("/api/widget/session/identifiers", async (req, reply) => {
    const actor = await fastify.resolveActor(req);
    if (!actor || actor.kind !== "session")
      return reply.code(401).send({ error: "session_required" });

    const body = z
      .object({
        kind: identifierKind,
        value: z.string().min(1).max(500),
        custom_label: z.string().max(60).optional(),
      })
      .parse(req.body);
    if (body.kind === "custom" && !body.custom_label)
      return reply.code(400).send({ error: "custom_label_required" });

    const row = await recordIdentifier({
      sessionId: actor.id,
      kind: body.kind,
      customLabel: body.custom_label ?? null,
      value: body.value.trim(),
      source: "self",
      createdByAgentId: null,
    });
    await audit({
      actorType: "session",
      actorId: actor.id,
      action: "identifier.declare",
      subjectType: "session",
      subjectId: actor.id,
      metadata: { kind: body.kind, custom_label: body.custom_label ?? null },
    });
    return rowToDto(row);
  });

  // ---- Widget or agent: list identifiers for a session ----
  fastify.get<{ Params: { id: string } }>(
    "/api/sessions/:id/identifiers",
    async (req, reply) => {
      const actor = await fastify.resolveActor(req);
      if (!actor) return reply.code(401).send({ error: "unauthorized" });

      const sessionId = z.string().uuid().parse(req.params.id);
      // Authorization: session can only read its own; agents can read any
      // session that they have or could have a conversation with.
      if (actor.kind === "session" && actor.id !== sessionId)
        return reply.code(403).send({ error: "forbidden" });

      const rows = await db.query.sessionIdentifiers.findMany({
        where: eq(sessionIdentifiers.sessionId, sessionId),
        orderBy: desc(sessionIdentifiers.createdAt),
      });
      return rows.map(rowToDto);
    },
  );

  // ---- Agent: record/correct an identifier for a player ----
  fastify.post<{ Params: { id: string } }>(
    "/api/sessions/:id/identifiers",
    async (req, reply) => {
      const actor = await fastify.requireAgent(req, reply);
      if (!actor) return;

      const sessionId = z.string().uuid().parse(req.params.id);
      const session = await db.query.sessions.findFirst({
        where: eq(sessions.id, sessionId),
      });
      if (!session) return reply.code(404).send({ error: "unknown_session" });

      const body = z
        .object({
          kind: identifierKind,
          value: z.string().min(1).max(500),
          custom_label: z.string().max(60).optional(),
        })
        .parse(req.body);

      const row = await recordIdentifier({
        sessionId,
        kind: body.kind,
        customLabel: body.custom_label ?? null,
        value: body.value.trim(),
        source: "agent",
        createdByAgentId: actor.id,
      });
      await audit({
        actorType: "agent",
        actorId: actor.id,
        action: "identifier.record",
        subjectType: "session",
        subjectId: sessionId,
        metadata: { kind: body.kind, custom_label: body.custom_label ?? null },
      });
      return rowToDto(row);
    },
  );

  // ---- Agent: returning-player lookup by identifier value ----
  // Returns the list of OTHER sessions (not the current one) that share a
  // current identifier of the same kind+value. Includes a count of
  // conversations on each such session so agents can see prior history.
  fastify.get<{
    Querystring: { kind?: string; value?: string; exclude_session?: string };
  }>("/api/identifiers/match", async (req, reply) => {
    const actor = await fastify.requireAgent(req, reply);
    if (!actor) return;

    const q = z
      .object({
        kind: identifierKind,
        value: z.string().min(1),
        exclude_session: z.string().uuid().optional(),
      })
      .parse(req.query);

    const result = await db
      .select({
        session_id: sessionIdentifiers.sessionId,
        kind: sessionIdentifiers.kind,
        value: sessionIdentifiers.value,
        created_at: sessionIdentifiers.createdAt,
        conversations_count: sql<number>`(
          SELECT COUNT(*) FROM ${conversations}
          WHERE ${conversations.sessionId} = ${sessionIdentifiers.sessionId}
        )`.as("conversations_count"),
      })
      .from(sessionIdentifiers)
      .where(
        and(
          eq(sessionIdentifiers.kind, q.kind),
          sql`lower(${sessionIdentifiers.value}) = lower(${q.value})`,
          isNull(sessionIdentifiers.supersededAt),
          q.exclude_session
            ? sql`${sessionIdentifiers.sessionId} <> ${q.exclude_session}`
            : sql`true`,
        ),
      )
      .orderBy(desc(sessionIdentifiers.createdAt))
      .limit(50);

    return result.map((r) => ({
      session_id: r.session_id,
      kind: r.kind,
      value: r.value,
      conversations_count: Number(r.conversations_count),
      created_at: r.created_at.toISOString(),
    }));
  });

  // ---- Admin: read/write deployment-level settings ----
  fastify.get("/api/admin/deployment-settings", async (req, reply) => {
    const actor = await fastify.requireAgent(req, reply);
    if (!actor) return;
    if (actor.role !== "admin") return reply.code(403).send({ error: "forbidden" });
    const s = await db.query.deploymentSettings.findFirst({
      where: eq(deploymentSettings.id, 1),
    });
    return {
      identifier_fields: s?.identifierFields ?? [],
      require_before_chat: s?.requireBeforeChat === "true",
    };
  });
  fastify.put("/api/admin/deployment-settings", async (req, reply) => {
    const actor = await fastify.requireAgent(req, reply);
    if (!actor) return;
    if (actor.role !== "admin") return reply.code(403).send({ error: "forbidden" });
    const body = z
      .object({
        identifier_fields: z.array(
          z.object({
            kind: identifierKind,
            custom_label: z.string().max(60).optional(),
            required: z.boolean().optional(),
            regex: z.string().max(200).optional(),
            label_en: z.string().max(60).optional(),
            label_tr: z.string().max(60).optional(),
          }),
        ),
        require_before_chat: z.boolean().default(false),
      })
      .parse(req.body);
    await db
      .insert(deploymentSettings)
      .values({
        id: 1,
        identifierFields: body.identifier_fields,
        requireBeforeChat: body.require_before_chat ? "true" : "false",
      })
      .onConflictDoUpdate({
        target: deploymentSettings.id,
        set: {
          identifierFields: body.identifier_fields,
          requireBeforeChat: body.require_before_chat ? "true" : "false",
          updatedAt: new Date(),
        },
      });
    await audit({
      actorType: "agent",
      actorId: actor.id,
      action: "deployment_settings.update",
      subjectType: "system",
      subjectId: null,
      metadata: body,
    });
    return { ok: true };
  });
}
