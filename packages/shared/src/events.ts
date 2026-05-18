import { z } from "zod";
import {
  actorTypeSchema,
  conversationSchema,
  conversationStatusSchema,
  messageSchema,
  uuidSchema,
} from "./domain.js";

// ---------- Client -> Server ----------

export const sessionHelloReq = z.object({
  // session_token already travels in the handshake auth; this event
  // signals the widget is ready and asks for current state.
  active_conversation_id: uuidSchema.optional(),
});
export const sessionHelloAck = z.object({
  ok: z.literal(true),
  session_id: uuidSchema,
  active_conversation: conversationSchema.nullable(),
  recent_messages: z.array(messageSchema),
});

export const messageSendReq = z.object({
  conversation_id: uuidSchema.optional(),
  client_message_id: uuidSchema,
  body: z.string().max(10_000).optional(),
  attachment_id: uuidSchema.optional(),
});
export const messageSendAck = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    conversation: conversationSchema,
    message: messageSchema,
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export const messageReadReq = z.object({
  conversation_id: uuidSchema,
  up_to_seq: z.number().int().nonnegative(),
});
export const okAck = z.object({ ok: z.literal(true) });
export const failAck = z.object({ ok: z.literal(false), error: z.string() });
export const genericAck = z.union([okAck, failAck]);

export const typingReq = z.object({ conversation_id: uuidSchema });

export const conversationClaimReq = z.object({ conversation_id: uuidSchema });
export const conversationClaimAck = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), conversation: conversationSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export const conversationCloseReq = z.object({
  conversation_id: uuidSchema,
  reason: z.string().max(500).optional(),
});

export const conversationResumeReq = z.object({
  conversation_id: uuidSchema,
  last_seen_seq: z.number().int().nonnegative(),
});
export const conversationResumeAck = z.object({
  ok: z.literal(true),
  conversation: conversationSchema,
  missed_messages: z.array(messageSchema),
});

export const conversationObserveReq = z.object({
  conversation_id: uuidSchema,
});
export const conversationObserveAck = z.object({
  ok: z.literal(true),
  conversation: conversationSchema,
  recent_messages: z.array(messageSchema),
});

// ---------- Server -> Client ----------

export const messageNewEvent = z.object({
  conversation_id: uuidSchema,
  message: messageSchema,
});

export const messageReadReceiptEvent = z.object({
  conversation_id: uuidSchema,
  reader_type: actorTypeSchema,
  reader_id: uuidSchema.nullable(),
  up_to_seq: z.number().int().nonnegative(),
});

export const typingUpdateEvent = z.object({
  conversation_id: uuidSchema,
  actor_type: actorTypeSchema,
  actor_id: uuidSchema.nullable(),
  actor_name: z.string().nullable(),
  is_typing: z.boolean(),
});

export const conversationUpdatedEvent = z.object({
  conversation: conversationSchema,
});

export const conversationNewEvent = z.object({
  conversation: conversationSchema,
});

export const conversationStatusChangedEvent = z.object({
  conversation_id: uuidSchema,
  status: conversationStatusSchema,
});

export const errorEvent = z.object({
  code: z.string(),
  message: z.string(),
});

// ---------- Event name registry ----------

export const WidgetClientEvents = {
  SessionHello: "session.hello",
  MessageSend: "message.send",
  MessageRead: "message.read",
  TypingStart: "typing.start",
  TypingStop: "typing.stop",
  ConversationResume: "conversation.resume",
} as const;

export const AgentClientEvents = {
  MessageSend: "message.send",
  MessageRead: "message.read",
  TypingStart: "typing.start",
  TypingStop: "typing.stop",
  ConversationClaim: "conversation.claim",
  ConversationClose: "conversation.close",
  ConversationResume: "conversation.resume",
  ConversationObserve: "conversation.observe",
} as const;

export const ServerEvents = {
  MessageNew: "message.new",
  MessageReadReceipt: "message.read_receipt",
  TypingUpdate: "typing.update",
  ConversationUpdated: "conversation.updated",
  ConversationNew: "conversation.new",
  ConversationStatusChanged: "conversation.status_changed",
  Error: "error",
} as const;

export type WidgetClientEventName =
  (typeof WidgetClientEvents)[keyof typeof WidgetClientEvents];
export type AgentClientEventName =
  (typeof AgentClientEvents)[keyof typeof AgentClientEvents];
export type ServerEventName = (typeof ServerEvents)[keyof typeof ServerEvents];
