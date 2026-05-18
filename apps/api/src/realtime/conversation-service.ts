import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import {
  agents,
  attachments,
  conversations,
  messages,
  sessions,
  type ConversationRow,
  type MessageRow,
} from "../db/schema.js";
import { audit } from "../audit.js";
import { verifyAttachmentUploaded } from "../routes/attachments.js";

export type SendResult =
  | {
      ok: true;
      created: true;
      conversation: ConversationRow;
      message: MessageRow;
      assignedAgentName: string | null;
      sessionDisplayName: string | null;
    }
  | {
      ok: true;
      created: false; // idempotent hit
      conversation: ConversationRow;
      message: MessageRow;
      assignedAgentName: string | null;
      sessionDisplayName: string | null;
    }
  | { ok: false; error: string };

export async function getOrCreateActiveConversation(
  sessionId: string,
): Promise<ConversationRow> {
  const existing = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.sessionId, sessionId),
      sql`${conversations.status} <> 'closed'`,
    ),
    orderBy: desc(conversations.lastMessageAt),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(conversations)
    .values({ sessionId })
    .returning();
  return created!;
}

export async function sendMessage(input: {
  conversationId: string | null;
  sessionId: string | null;
  senderType: "agent" | "session" | "system";
  senderId: string | null;
  senderDisplayName: string | null;
  clientMessageId: string;
  body: string;
  attachmentId: string | null;
}): Promise<SendResult> {
  // If attachment referenced, confirm it exists in object storage.
  if (input.attachmentId) {
    const ok = await verifyAttachmentUploaded(input.attachmentId);
    if (!ok) return { ok: false, error: "attachment_missing" };
  }

  if (!input.body && !input.attachmentId) {
    return { ok: false, error: "empty_message" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Resolve conversation within the tx so the lock prevents seq race.
    let conversationId = input.conversationId;
    if (!conversationId) {
      if (input.senderType !== "session" || !input.sessionId) {
        await client.query("ROLLBACK");
        return { ok: false, error: "no_conversation" };
      }
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM conversations
         WHERE session_id = $1 AND status <> 'closed'
         ORDER BY last_message_at DESC
         LIMIT 1
         FOR UPDATE`,
        [input.sessionId],
      );
      if (rows.length > 0) {
        conversationId = rows[0]!.id;
      } else {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO conversations (session_id) VALUES ($1) RETURNING id`,
          [input.sessionId],
        );
        conversationId = ins.rows[0]!.id;
      }
    }

    // Lock conversation, assign seq, insert message with idempotency check.
    const locked = await client.query<{ last_seq: number; status: string; assigned_agent_id: string | null; session_id: string }>(
      `SELECT last_seq, status, assigned_agent_id, session_id
       FROM conversations WHERE id = $1 FOR UPDATE`,
      [conversationId],
    );
    if (locked.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "no_conversation" };
    }
    const conv = locked.rows[0]!;

    // Idempotency: if client_message_id already exists, return it.
    const dup = await client.query(
      `SELECT * FROM messages WHERE conversation_id = $1 AND client_message_id = $2`,
      [conversationId, input.clientMessageId],
    );
    if (dup.rows.length > 0) {
      const existing = dup.rows[0]!;
      const convRow = (
        await client.query(`SELECT * FROM conversations WHERE id = $1`, [
          conversationId,
        ])
      ).rows[0]!;
      await client.query("COMMIT");
      return {
        ok: true,
        created: false,
        conversation: rowToConversation(convRow),
        message: rowToMessage(existing),
        assignedAgentName: await resolveAgentName(convRow.assigned_agent_id),
        sessionDisplayName: await resolveSessionName(convRow.session_id),
      };
    }

    const nextSeq = Number(conv.last_seq) + 1;
    const ins = await client.query(
      `INSERT INTO messages
         (conversation_id, seq, sender_type, sender_id, sender_display_name,
          client_message_id, body, attachment_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        conversationId,
        nextSeq,
        input.senderType,
        input.senderId,
        input.senderDisplayName,
        input.clientMessageId,
        input.body,
        input.attachmentId,
      ],
    );
    const msgRow = ins.rows[0]!;

    // Update counters + last_message_at + last_seq.
    const unreadAgentDelta = input.senderType === "session" ? 1 : 0;
    const unreadSessionDelta = input.senderType === "agent" ? 1 : 0;
    const updatedConv = await client.query(
      `UPDATE conversations
       SET last_seq = $2,
           last_message_at = NOW(),
           unread_for_agent = unread_for_agent + $3,
           unread_for_session = unread_for_session + $4
       WHERE id = $1
       RETURNING *`,
      [conversationId, nextSeq, unreadAgentDelta, unreadSessionDelta],
    );
    const convRow = updatedConv.rows[0]!;

    await client.query("COMMIT");

    const assignedAgentName = await resolveAgentName(convRow.assigned_agent_id);
    const sessionDisplayName = await resolveSessionName(convRow.session_id);

    return {
      ok: true,
      created: true,
      conversation: rowToConversation(convRow),
      message: rowToMessage(msgRow),
      assignedAgentName,
      sessionDisplayName,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function claimConversation(
  conversationId: string,
  agentId: string,
): Promise<
  | { ok: true; conversation: ConversationRow }
  | { ok: false; error: "already_claimed" | "not_found" | "closed" }
> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT * FROM conversations WHERE id = $1 FOR UPDATE`,
      [conversationId],
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_found" };
    }
    const conv = rows[0]!;
    if (conv.status === "closed") {
      await client.query("ROLLBACK");
      return { ok: false, error: "closed" };
    }
    if (conv.assigned_agent_id && conv.assigned_agent_id !== agentId) {
      await client.query("ROLLBACK");
      return { ok: false, error: "already_claimed" };
    }
    const upd = await client.query(
      `UPDATE conversations
         SET assigned_agent_id = $2, status = 'assigned', assigned_at = COALESCE(assigned_at, NOW())
         WHERE id = $1
         RETURNING *`,
      [conversationId, agentId],
    );
    await client.query("COMMIT");
    await audit({
      actorType: "agent",
      actorId: agentId,
      action: "conversation.claim",
      subjectType: "conversation",
      subjectId: conversationId,
    });
    return { ok: true, conversation: rowToConversation(upd.rows[0]!) };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closeConversation(
  conversationId: string,
  agentId: string,
  reason: string | null,
): Promise<ConversationRow | null> {
  const [row] = await db
    .update(conversations)
    .set({
      status: "closed",
      closedAt: new Date(),
      closeReason: reason,
    })
    .where(eq(conversations.id, conversationId))
    .returning();
  if (!row) return null;
  await audit({
    actorType: "agent",
    actorId: agentId,
    action: "conversation.close",
    subjectType: "conversation",
    subjectId: conversationId,
    metadata: reason ? { reason } : undefined,
  });
  return row;
}

export async function missedSince(
  conversationId: string,
  lastSeenSeq: number,
): Promise<MessageRow[]> {
  return await db.query.messages.findMany({
    where: and(
      eq(messages.conversationId, conversationId),
      gt(messages.seq, lastSeenSeq),
    ),
    orderBy: messages.seq,
    limit: 1000,
  });
}

export async function recentMessages(
  conversationId: string,
  limit = 50,
): Promise<MessageRow[]> {
  const rows = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: desc(messages.seq),
    limit,
  });
  return rows.reverse();
}

export async function markRead(
  conversationId: string,
  upToSeq: number,
  readerType: "agent" | "session",
): Promise<void> {
  if (readerType === "agent") {
    await db
      .update(conversations)
      .set({ unreadForAgent: 0 })
      .where(eq(conversations.id, conversationId));
  } else {
    await db
      .update(conversations)
      .set({ unreadForSession: 0 })
      .where(eq(conversations.id, conversationId));
  }
}

export async function resolveAgentName(
  agentId: string | null | undefined,
): Promise<string | null> {
  if (!agentId) return null;
  const a = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  return a?.displayName ?? null;
}
export async function resolveSessionName(
  sessionId: string | null | undefined,
): Promise<string | null> {
  if (!sessionId) return null;
  const s = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  return s?.displayName ?? s?.externalUserId ?? null;
}

// --- raw row → typed row helpers (for native pg Client rows) ---

function rowToConversation(r: Record<string, unknown>): ConversationRow {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    status: r.status as ConversationRow["status"],
    assignedAgentId: (r.assigned_agent_id as string | null) ?? null,
    openedAt: new Date(r.opened_at as string),
    assignedAt: r.assigned_at ? new Date(r.assigned_at as string) : null,
    closedAt: r.closed_at ? new Date(r.closed_at as string) : null,
    closeReason: (r.close_reason as string | null) ?? null,
    lastMessageAt: new Date(r.last_message_at as string),
    unreadForAgent: Number(r.unread_for_agent),
    unreadForSession: Number(r.unread_for_session),
    lastSeq: Number(r.last_seq),
  };
}
function rowToMessage(r: Record<string, unknown>): MessageRow {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    seq: Number(r.seq),
    senderType: r.sender_type as MessageRow["senderType"],
    senderId: (r.sender_id as string | null) ?? null,
    senderDisplayName: (r.sender_display_name as string | null) ?? null,
    clientMessageId: r.client_message_id as string,
    body: r.body as string,
    attachmentId: (r.attachment_id as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    editedAt: r.edited_at ? new Date(r.edited_at as string) : null,
    redactedAt: r.redacted_at ? new Date(r.redacted_at as string) : null,
  };
}

export async function fetchConversation(
  id: string,
): Promise<ConversationRow | null> {
  const row = await db.query.conversations.findFirst({
    where: eq(conversations.id, id),
  });
  return row ?? null;
}

export async function listQueue(): Promise<
  Array<{
    row: ConversationRow;
    assignedAgentName: string | null;
    sessionDisplayName: string | null;
  }>
> {
  const rows = await db
    .select({
      conv: conversations,
      agentName: agents.displayName,
      sessionName: sessions.displayName,
      sessionExt: sessions.externalUserId,
    })
    .from(conversations)
    .leftJoin(agents, eq(conversations.assignedAgentId, agents.id))
    .leftJoin(sessions, eq(conversations.sessionId, sessions.id))
    .where(sql`${conversations.status} <> 'closed'`)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(200);
  return rows.map((r) => ({
    row: r.conv,
    assignedAgentName: r.agentName ?? null,
    sessionDisplayName: r.sessionName ?? r.sessionExt ?? null,
  }));
}
