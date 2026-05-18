import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  closeStaleConversations,
  pruneOrphanSessions,
} from "../maintenance.js";
import { audit } from "../audit.js";

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.post("/api/admin/close-stale", async (req, reply) => {
    const actor = await fastify.requireAgent(req, reply);
    if (!actor) return;
    if (actor.role !== "admin")
      return reply.code(403).send({ error: "forbidden" });

    const { hours } = z
      .object({ hours: z.number().int().min(1).max(24 * 30).default(24) })
      .parse(req.body ?? {});
    const result = await closeStaleConversations({ olderThanHours: hours });
    await audit({
      actorType: "agent",
      actorId: actor.id,
      action: "maintenance.close_stale",
      subjectType: "system",
      subjectId: null,
      metadata: { hours, ...result },
    });
    return result;
  });

  fastify.post("/api/admin/prune-sessions", async (req, reply) => {
    const actor = await fastify.requireAgent(req, reply);
    if (!actor) return;
    if (actor.role !== "admin")
      return reply.code(403).send({ error: "forbidden" });

    const { days } = z
      .object({ days: z.number().int().min(1).max(365).default(30) })
      .parse(req.body ?? {});
    const result = await pruneOrphanSessions({ olderThanDays: days });
    await audit({
      actorType: "agent",
      actorId: actor.id,
      action: "maintenance.prune_sessions",
      subjectType: "system",
      subjectId: null,
      metadata: { days, ...result },
    });
    return result;
  });
}
