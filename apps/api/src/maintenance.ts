import { sql, and, isNull, lt } from "drizzle-orm";
import { db } from "./db/client.js";
import { conversations, sessions } from "./db/schema.js";

/**
 * Close any non-closed conversation whose last_message_at is older than the
 * threshold. Returns the number of conversations closed.
 */
export async function closeStaleConversations(opts: {
  olderThanHours: number;
  reason?: string;
}): Promise<{ closed: number }> {
  const cutoff = new Date(Date.now() - opts.olderThanHours * 3600_000);
  const result = await db
    .update(conversations)
    .set({
      status: "closed",
      closedAt: new Date(),
      closeReason: opts.reason ?? "auto-closed: stale",
    })
    .where(
      and(
        sql`${conversations.status} <> 'closed'`,
        lt(conversations.lastMessageAt, cutoff),
      ),
    )
    .returning({ id: conversations.id });
  return { closed: result.length };
}

/**
 * Delete anonymous sessions older than the threshold that have no
 * conversation rows referencing them. SSO/upgraded sessions (those with
 * external_user_id) are never pruned automatically — they may have
 * compliance value tied to the casino's user identity.
 */
export async function pruneOrphanSessions(opts: {
  olderThanDays: number;
}): Promise<{ pruned: number }> {
  const cutoff = new Date(Date.now() - opts.olderThanDays * 86400_000);
  const result = await db
    .delete(sessions)
    .where(
      and(
        isNull(sessions.externalUserId),
        lt(sessions.lastActiveAt, cutoff),
        sql`NOT EXISTS (SELECT 1 FROM ${conversations} c WHERE c.session_id = ${sessions.id})`,
      ),
    )
    .returning({ id: sessions.id });
  return { pruned: result.length };
}
