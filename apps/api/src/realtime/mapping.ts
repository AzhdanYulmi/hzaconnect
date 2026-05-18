import type {
  ConversationRow,
  MessageRow,
  SessionRow,
  AgentRow,
} from "../db/schema.js";
import type { Conversation, Message } from "@hzaconnect/shared";

export function toConversation(
  row: ConversationRow,
  opts: { assignedAgentName?: string | null; sessionDisplayName?: string | null },
): Conversation {
  return {
    id: row.id,
    session_id: row.sessionId,
    status: row.status,
    assigned_agent_id: row.assignedAgentId,
    assigned_agent_name: opts.assignedAgentName ?? null,
    opened_at: row.openedAt.toISOString(),
    assigned_at: row.assignedAt?.toISOString() ?? null,
    closed_at: row.closedAt?.toISOString() ?? null,
    close_reason: row.closeReason ?? null,
    last_message_at: row.lastMessageAt.toISOString(),
    unread_for_agent: row.unreadForAgent,
    unread_for_session: row.unreadForSession,
    session_display_name: opts.sessionDisplayName ?? null,
  };
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    seq: row.seq,
    sender_type: row.senderType,
    sender_id: row.senderId,
    sender_display_name: row.senderDisplayName,
    client_message_id: row.clientMessageId,
    body: row.redactedAt ? "" : row.body,
    attachment_id: row.redactedAt ? null : row.attachmentId,
    created_at: row.createdAt.toISOString(),
    redacted_at: row.redactedAt?.toISOString() ?? null,
  };
}

export function displayNameForSession(s: SessionRow | null | undefined): string | null {
  if (!s) return null;
  if (s.displayName) return s.displayName;
  if (s.externalUserId) return s.externalUserId;
  return null;
}

export function displayNameForAgent(a: AgentRow | null | undefined): string | null {
  return a?.displayName ?? null;
}
