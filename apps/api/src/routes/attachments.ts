import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../db/client.js";
import { attachments, conversations } from "../db/schema.js";
import { presignPut, presignGet, headObject } from "../storage.js";
import {
  attachmentMimeSchema,
  MAX_ATTACHMENT_BYTES,
} from "@hzaconnect/shared";
import { canConversation, type Actor } from "../auth/can.js";

export async function attachmentRoutes(fastify: FastifyInstance) {
  fastify.post("/api/attachments/presign", async (req, reply) => {
    const actor = await fastify.resolveActor(req);
    if (!actor) return reply.code(401).send({ error: "unauthorized" });

    const body = z
      .object({
        mime_type: attachmentMimeSchema,
        byte_size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
        conversation_id: z.string().uuid().optional(),
      })
      .parse(req.body);

    if (body.conversation_id) {
      const conv = await db.query.conversations.findFirst({
        where: eq(conversations.id, body.conversation_id),
      });
      if (!conv) return reply.code(404).send({ error: "unknown_conversation" });
      if (!canConversation(actor, "send", conv))
        return reply.code(403).send({ error: "forbidden" });
    }

    const id = crypto.randomUUID();
    const ext = body.mime_type.split("/")[1] ?? "bin";
    const objectKey = `att/${id.slice(0, 2)}/${id}.${ext}`;

    const [row] = await db
      .insert(attachments)
      .values({
        id,
        conversationId: body.conversation_id ?? null,
        uploadedByType: actor.kind,
        uploadedById: actor.kind === "agent" ? actor.id : actor.id,
        objectKey,
        mimeType: body.mime_type,
        byteSize: body.byte_size,
        scanStatus: "clean",
      })
      .returning();

    const upload_url = await presignPut(objectKey, body.mime_type);

    return {
      attachment_id: row!.id,
      upload_url,
      object_key: objectKey,
      max_bytes: MAX_ATTACHMENT_BYTES,
    };
  });

  fastify.get<{ Params: { id: string } }>(
    "/api/attachments/:id/url",
    async (req, reply) => {
      const actor = await fastify.resolveActor(req);
      if (!actor) return reply.code(401).send({ error: "unauthorized" });

      const id = z.string().uuid().parse(req.params.id);
      const att = await db.query.attachments.findFirst({
        where: eq(attachments.id, id),
      });
      if (!att) return reply.code(404).send({ error: "not_found" });
      if (att.conversationId) {
        const conv = await db.query.conversations.findFirst({
          where: eq(conversations.id, att.conversationId),
        });
        if (!conv) return reply.code(404).send({ error: "conversation_gone" });
        if (!canConversation(actor as Actor, "read", conv))
          return reply.code(403).send({ error: "forbidden" });
      }
      const url = await presignGet(att.objectKey);
      return {
        url,
        mime_type: att.mimeType,
        byte_size: att.byteSize,
        width: att.width,
        height: att.height,
      };
    },
  );
}

export async function verifyAttachmentUploaded(
  attachmentId: string,
): Promise<boolean> {
  const att = await db.query.attachments.findFirst({
    where: eq(attachments.id, attachmentId),
  });
  if (!att) return false;
  try {
    await headObject(att.objectKey);
    return true;
  } catch {
    return false;
  }
}
