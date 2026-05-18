import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  conversations,
  conversationTags,
  tagDefinitions,
} from "../db/schema.js";
import { audit } from "../audit.js";
import { canConversation } from "../auth/can.js";

const slugRe = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export async function tagRoutes(fastify: FastifyInstance) {
  // ---- Public-to-agents: list tags (used in chips and queue filter) ----
  fastify.get("/api/tags", async (req, reply) => {
    const actor = await fastify.requireAgent(req, reply);
    if (!actor) return;
    const rows = await db.query.tagDefinitions.findMany({
      where: isNull(tagDefinitions.archivedAt),
      orderBy: asc(tagDefinitions.labelEn),
    });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      label_en: r.labelEn,
      label_tr: r.labelTr,
      color: r.color,
    }));
  });

  // ---- Admin: full CRUD on tag definitions ----
  fastify.get("/api/admin/tags", async (req, reply) => {
    const actor = await fastify.requireAgent(req, reply);
    if (!actor) return;
    if (actor.role !== "admin")
      return reply.code(403).send({ error: "forbidden" });
    const rows = await db.query.tagDefinitions.findMany({
      orderBy: asc(tagDefinitions.labelEn),
    });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      label_en: r.labelEn,
      label_tr: r.labelTr,
      color: r.color,
      archived_at: r.archivedAt?.toISOString() ?? null,
    }));
  });

  fastify.post("/api/admin/tags", async (req, reply) => {
    const actor = await fastify.requireAgent(req, reply);
    if (!actor) return;
    if (actor.role !== "admin")
      return reply.code(403).send({ error: "forbidden" });

    const body = z
      .object({
        slug: z.string().regex(slugRe),
        label_en: z.string().min(1).max(60),
        label_tr: z.string().max(60).optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#374151"),
      })
      .parse(req.body);

    try {
      const [row] = await db
        .insert(tagDefinitions)
        .values({
          slug: body.slug,
          labelEn: body.label_en,
          labelTr: body.label_tr ?? null,
          color: body.color,
        })
        .returning();
      await audit({
        actorType: "agent",
        actorId: actor.id,
        action: "tag.create",
        subjectType: "tag",
        subjectId: row!.id,
        metadata: { slug: body.slug },
      });
      return rowToTagDto(row!);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("unique")) {
        return reply.code(409).send({ error: "slug_taken" });
      }
      throw e;
    }
  });

  fastify.patch<{ Params: { id: string } }>(
    "/api/admin/tags/:id",
    async (req, reply) => {
      const actor = await fastify.requireAgent(req, reply);
      if (!actor) return;
      if (actor.role !== "admin")
        return reply.code(403).send({ error: "forbidden" });
      const id = z.string().uuid().parse(req.params.id);
      const body = z
        .object({
          label_en: z.string().min(1).max(60).optional(),
          label_tr: z.string().max(60).optional(),
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
          archived: z.boolean().optional(),
        })
        .parse(req.body);
      const updates: Record<string, unknown> = {};
      if (body.label_en !== undefined) updates.labelEn = body.label_en;
      if (body.label_tr !== undefined) updates.labelTr = body.label_tr;
      if (body.color !== undefined) updates.color = body.color;
      if (body.archived !== undefined)
        updates.archivedAt = body.archived ? new Date() : null;
      const [row] = await db
        .update(tagDefinitions)
        .set(updates)
        .where(eq(tagDefinitions.id, id))
        .returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      await audit({
        actorType: "agent",
        actorId: actor.id,
        action: "tag.update",
        subjectType: "tag",
        subjectId: id,
        metadata: body,
      });
      return rowToTagDto(row);
    },
  );

  // ---- Apply / remove on a conversation ----
  fastify.get<{ Params: { id: string } }>(
    "/api/conversations/:id/tags",
    async (req, reply) => {
      const actor = await fastify.requireAgent(req, reply);
      if (!actor) return;
      const conversationId = z.string().uuid().parse(req.params.id);
      const rows = await db
        .select({
          tag_id: conversationTags.tagId,
          slug: tagDefinitions.slug,
          label_en: tagDefinitions.labelEn,
          label_tr: tagDefinitions.labelTr,
          color: tagDefinitions.color,
          applied_at: conversationTags.appliedAt,
        })
        .from(conversationTags)
        .innerJoin(tagDefinitions, eq(tagDefinitions.id, conversationTags.tagId))
        .where(
          and(
            eq(conversationTags.conversationId, conversationId),
            isNull(conversationTags.removedAt),
          ),
        );
      return rows;
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/conversations/:id/tags",
    async (req, reply) => {
      const actor = await fastify.requireAgent(req, reply);
      if (!actor) return;
      const conversationId = z.string().uuid().parse(req.params.id);
      const conv = await db.query.conversations.findFirst({
        where: eq(conversations.id, conversationId),
      });
      if (!conv) return reply.code(404).send({ error: "unknown_conversation" });
      if (!canConversation(actor, "read", conv))
        return reply.code(403).send({ error: "forbidden" });
      const body = z.object({ tag_id: z.string().uuid() }).parse(req.body);
      // Use INSERT…ON CONFLICT to make the apply idempotent. The partial
      // unique index covers active rows, so re-applying after a remove will
      // create a fresh row.
      try {
        await db.insert(conversationTags).values({
          conversationId,
          tagId: body.tag_id,
          appliedByAgentId: actor.id,
        });
      } catch {
        // unique violation = already applied, treat as success
      }
      await audit({
        actorType: "agent",
        actorId: actor.id,
        action: "tag.apply",
        subjectType: "conversation",
        subjectId: conversationId,
        metadata: { tag_id: body.tag_id },
      });
      return { ok: true };
    },
  );

  fastify.delete<{ Params: { id: string; tagId: string } }>(
    "/api/conversations/:id/tags/:tagId",
    async (req, reply) => {
      const actor = await fastify.requireAgent(req, reply);
      if (!actor) return;
      const conversationId = z.string().uuid().parse(req.params.id);
      const tagId = z.string().uuid().parse(req.params.tagId);
      const conv = await db.query.conversations.findFirst({
        where: eq(conversations.id, conversationId),
      });
      if (!conv) return reply.code(404).send({ error: "unknown_conversation" });
      if (!canConversation(actor, "read", conv))
        return reply.code(403).send({ error: "forbidden" });
      await db
        .update(conversationTags)
        .set({ removedAt: new Date() })
        .where(
          and(
            eq(conversationTags.conversationId, conversationId),
            eq(conversationTags.tagId, tagId),
            isNull(conversationTags.removedAt),
          ),
        );
      await audit({
        actorType: "agent",
        actorId: actor.id,
        action: "tag.remove",
        subjectType: "conversation",
        subjectId: conversationId,
        metadata: { tag_id: tagId },
      });
      return { ok: true };
    },
  );

  // ---- Search: return conversation IDs that currently bear a tag (for queue filter) ----
  fastify.get<{ Querystring: { tag_id?: string } }>(
    "/api/conversations/by-tag",
    async (req, reply) => {
      const actor = await fastify.requireAgent(req, reply);
      if (!actor) return;
      const tagId = z.string().uuid().parse(req.query.tag_id);
      const rows = await db
        .select({ id: conversationTags.conversationId })
        .from(conversationTags)
        .where(
          and(
            eq(conversationTags.tagId, tagId),
            isNull(conversationTags.removedAt),
          ),
        );
      return rows.map((r) => r.id);
    },
  );
}

function rowToTagDto(r: {
  id: string;
  slug: string;
  labelEn: string;
  labelTr: string | null;
  color: string;
  archivedAt: Date | null;
}) {
  return {
    id: r.id,
    slug: r.slug,
    label_en: r.labelEn,
    label_tr: r.labelTr,
    color: r.color,
    archived_at: r.archivedAt?.toISOString() ?? null,
  };
}
