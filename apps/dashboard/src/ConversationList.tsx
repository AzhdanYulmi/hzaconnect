import React from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "./store.js";
import { AgentClientEvents } from "@hzaconnect/shared";
import { getSocket } from "./socket.js";
import { QueueFilter } from "./QueueFilter.js";
import { InboxIcon, UserIcon } from "./Icons.js";

function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

function initialsOf(s: string | null): string | null {
  const v = (s ?? "").trim();
  if (!v) return null;
  const parts = v.split(/[\s_.-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function ConversationList() {
  const { t } = useTranslation();
  const conversations = useStore((s) => s.conversations);
  const order = useStore((s) => s.conversationOrder);
  const active = useStore((s) => s.activeConvId);
  const setActive = useStore((s) => s.setActiveConv);
  const me = useStore((s) => s.me);
  const tagFilter = useStore((s) => s.tagFilter);
  const conversationsForTag = useStore((s) => s.conversationsForTag);

  const visibleOrder = tagFilter
    ? order.filter((id) => conversationsForTag.has(id))
    : order;

  return (
    <div>
      <QueueFilter />
      {visibleOrder.length === 0 && (
        <div className="empty-state" style={{ padding: 32 }}>
          <span className="empty-state-icon">
            <InboxIcon size={24} />
          </span>
          <span className="empty-state-text">
            {tagFilter ? t("queue.no_matches") : t("queue.empty")}
          </span>
        </div>
      )}
      {visibleOrder.map((id) => {
        const c = conversations[id]!;
        const name = c.session_display_name ?? `#${c.session_id.slice(0, 8)}`;
        return (
          <div
            key={id}
            className={`item ${active === id ? "active" : ""}`}
            onClick={() => {
              setActive(id);
              const isSupervisorView =
                (me?.role === "supervisor" || me?.role === "admin") &&
                c.assigned_agent_id !== me?.id;
              if (isSupervisorView) {
                getSocket().emit(
                  AgentClientEvents.ConversationObserve,
                  { conversation_id: id },
                  (ack: any) => {
                    if (ack?.ok) {
                      useStore.getState().upsertConversation(ack.conversation);
                      useStore.getState().upsertMessages(id, ack.recent_messages);
                    }
                  },
                );
              } else {
                getSocket().emit(
                  AgentClientEvents.ConversationResume,
                  {
                    conversation_id: id,
                    last_seen_seq:
                      useStore.getState().lastSeenSeqByConv[id] ?? 0,
                  },
                  (ack: any) => {
                    if (ack?.ok) {
                      useStore.getState().upsertConversation(ack.conversation);
                      useStore
                        .getState()
                        .upsertMessages(id, ack.missed_messages);
                    }
                  },
                );
              }
            }}
          >
            <span
              aria-label={
                c.session_display_name
                  ? `Avatar for ${c.session_display_name}`
                  : "Anonymous player"
              }
              title={
                c.session_display_name
                  ? c.session_display_name
                  : "Anonymous player (no name shared yet)"
              }
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: c.session_display_name
                  ? "var(--c-brand-50)"
                  : "var(--c-surface-2)",
                color: c.session_display_name
                  ? "var(--c-brand-700)"
                  : "var(--c-text-subtle)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {initialsOf(c.session_display_name) ?? <UserIcon size={18} />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="top">
                <strong title={name}>{name}</strong>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--c-text-subtle)",
                    flexShrink: 0,
                  }}
                >
                  {relativeTime(c.last_message_at)}
                </span>
              </div>
              <div className="meta">
                <span className={`status-dot ${c.status}`} />
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.assigned_agent_name
                    ? `→ ${c.assigned_agent_name}`
                    : t("queue.unassigned")}
                </span>
                {c.unread_for_agent > 0 && (
                  <span className="badge">{c.unread_for_agent}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
