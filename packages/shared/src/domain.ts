import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const agentRoleSchema = z.enum(["agent", "supervisor", "admin"]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const conversationStatusSchema = z.enum(["open", "assigned", "closed"]);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const senderTypeSchema = z.enum(["agent", "session", "system"]);
export type SenderType = z.infer<typeof senderTypeSchema>;

export const actorTypeSchema = z.enum(["agent", "session", "system"]);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const attachmentMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export const attachmentMimeSchema = z.enum(attachmentMimeTypes);
export type AttachmentMime = z.infer<typeof attachmentMimeSchema>;

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

export const messageSchema = z.object({
  id: uuidSchema,
  conversation_id: uuidSchema,
  seq: z.number().int().nonnegative(),
  sender_type: senderTypeSchema,
  sender_id: uuidSchema.nullable(),
  sender_display_name: z.string().nullable(),
  client_message_id: uuidSchema,
  body: z.string(),
  attachment_id: uuidSchema.nullable(),
  created_at: z.string(),
  redacted_at: z.string().nullable(),
});
export type Message = z.infer<typeof messageSchema>;

export const conversationSchema = z.object({
  id: uuidSchema,
  session_id: uuidSchema,
  status: conversationStatusSchema,
  assigned_agent_id: uuidSchema.nullable(),
  assigned_agent_name: z.string().nullable(),
  opened_at: z.string(),
  assigned_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  close_reason: z.string().nullable(),
  last_message_at: z.string(),
  unread_for_agent: z.number().int().nonnegative(),
  unread_for_session: z.number().int().nonnegative(),
  session_display_name: z.string().nullable(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const attachmentSchema = z.object({
  id: uuidSchema,
  mime_type: attachmentMimeSchema,
  byte_size: z.number().int().nonnegative(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
