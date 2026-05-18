import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "./store.js";
import { AgentClientEvents, type Message } from "@hzaconnect/shared";
import { getSocket } from "./socket.js";
import { api } from "./api.js";
import { PlayerInfo } from "./PlayerInfo.js";
import { ConversationTags } from "./ConversationTags.js";
import { ChatBubbleIcon, CloseIcon, PaperclipIcon, SendIcon } from "./Icons.js";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

const EMPTY_MESSAGES: never[] = [];
const EMPTY_TYPING: Record<string, never> = {};

export function ConversationPane() {
  const { t } = useTranslation();
  const activeId = useStore((s) => s.activeConvId);
  const conv = useStore((s) => (activeId ? s.conversations[activeId] ?? null : null));
  const messages = useStore((s) =>
    activeId ? s.messagesByConv[activeId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES,
  );
  const typing = useStore((s) =>
    activeId ? s.typingByConv[activeId] ?? EMPTY_TYPING : EMPTY_TYPING,
  );
  const me = useStore((s) => s.me);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<null | { attachment_id: string; name: string }>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastTypingSentAt = useRef(0);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length, activeId]);

  // Mark as read whenever messages change and the pane is active.
  useEffect(() => {
    if (!activeId || !conv) return;
    const last = messages.at(-1);
    if (!last) return;
    getSocket().emit(
      AgentClientEvents.MessageRead,
      { conversation_id: activeId, up_to_seq: last.seq },
      () => {},
    );
  }, [activeId, messages.length]);

  if (!activeId || !conv) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">
          <ChatBubbleIcon size={28} />
        </span>
        <span className="empty-state-text">
          {t("conversation.select_prompt")}
        </span>
      </div>
    );
  }

  const canWrite =
    (me?.role === "agent" || me?.role === "supervisor" || me?.role === "admin") &&
    conv.assigned_agent_id === me.id &&
    conv.status !== "closed";

  const canClaim = conv.status === "open";

  const typingActors = Object.values(typing)
    .filter((t) => t.until > Date.now())
    .map((t) => t.name ?? "Someone");

  async function send() {
    if (!text.trim() && !pendingUpload) return;
    setSending(true);
    try {
      const clientId = uuid();
      const payload = {
        conversation_id: activeId,
        client_message_id: clientId,
        body: text.trim(),
        attachment_id: pendingUpload?.attachment_id,
      };
      useStore.getState().addToOutbox(activeId!, {
        client_message_id: clientId,
        body: text.trim(),
        attachment_id: pendingUpload?.attachment_id,
      });
      getSocket().emit(AgentClientEvents.MessageSend, payload, (ack: any) => {
        if (ack?.ok) {
          useStore.getState().removeFromOutbox(activeId!, clientId);
          useStore.getState().appendMessage(activeId!, ack.message);
          useStore.getState().upsertConversation(ack.conversation);
        }
      });
      setText("");
      setPendingUpload(null);
    } finally {
      setSending(false);
    }
  }

  function claim() {
    getSocket().emit(
      AgentClientEvents.ConversationClaim,
      { conversation_id: activeId },
      (ack: any) => {
        if (ack?.ok) useStore.getState().upsertConversation(ack.conversation);
        else alert(t("conversation.claim_failed", { error: ack?.error }));
      },
    );
  }
  function close() {
    const reason = window.prompt(t("conversation.close_prompt")) ?? "";
    getSocket().emit(
      AgentClientEvents.ConversationClose,
      { conversation_id: activeId, reason },
      (ack: any) => {
        if (!ack?.ok) alert(t("conversation.close_failed", { error: ack?.error }));
      },
    );
  }

  function onTyping(v: string) {
    setText(v);
    const now = Date.now();
    if (now - lastTypingSentAt.current > 2000 && canWrite) {
      lastTypingSentAt.current = now;
      getSocket().emit(
        AgentClientEvents.TypingStart,
        { conversation_id: activeId },
        () => {},
      );
      setTimeout(() => {
        getSocket().emit(
          AgentClientEvents.TypingStop,
          { conversation_id: activeId },
          () => {},
        );
      }, 3000);
    }
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(f.type)) {
      alert(t("attachment.only_images"));
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      alert(t("attachment.max_size_5mb"));
      return;
    }
    const presign = await api.presign(f.type, f.size, activeId!);
    const put = await fetch(presign.upload_url, {
      method: "PUT",
      headers: { "Content-Type": f.type },
      body: f,
    });
    if (!put.ok) {
      alert(t("attachment.upload_failed"));
      return;
    }
    setPendingUpload({ attachment_id: presign.attachment_id, name: f.name });
  }

  return (
    <>
      <header>
        <div>
          <strong>{conv.session_display_name ?? `#${conv.session_id.slice(0, 8)}`}</strong>
          <div className="sub-row">
            <span>
              {conv.assigned_agent_name
                ? t("conversation.assigned_to", { name: conv.assigned_agent_name })
                : t("conversation.unassigned")}
            </span>
            <span style={{ color: "var(--c-text-subtle)" }}>·</span>
            <span className={`status-chip ${conv.status}`}>
              {t(`conversation.status.${conv.status}`)}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {canClaim && (
            <button className="toolbar primary" onClick={claim}>
              {t("conversation.claim")}
            </button>
          )}
          {canWrite && (
            <button className="toolbar danger" onClick={close}>
              <CloseIcon size={14} />
              {t("conversation.close")}
            </button>
          )}
        </div>
      </header>
      <PlayerInfo sessionId={conv.session_id} />
      <ConversationTags conversationId={activeId} />
      <div className="messages" ref={listRef}>
        {messages.map((m) => (
          <MessageRow key={m.id} msg={m} />
        ))}
      </div>
      {typingActors.length > 0 && (
        <div className="typing">
          {typingActors.length === 1
            ? t("conversation.is_typing", { name: typingActors[0] })
            : t("conversation.are_typing", { names: typingActors.join(", ") })}
        </div>
      )}
      <div className="composer">
        <textarea
          disabled={!canWrite}
          value={text}
          onChange={(e) => onTyping(e.target.value)}
          placeholder={
            canWrite
              ? t("conversation.composer_placeholder")
              : t("conversation.composer_claim_first")
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <label
          className="dash-attach-btn"
          aria-label={t("attachment.attach_image")}
          title={
            pendingUpload
              ? `${t("attachment.attach_image")}: ${pendingUpload.name}`
              : t("attachment.attach_image")
          }
          data-attached={pendingUpload ? pendingUpload.name : ""}
        >
          <PaperclipIcon size={18} />
          {pendingUpload && (
            <span className="dash-attach-name">{pendingUpload.name}</span>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: "none" }}
            onChange={onFileChange}
            disabled={!canWrite}
          />
        </label>
        <button disabled={!canWrite || sending} onClick={send}>
          <SendIcon size={16} />
          <span>{t("conversation.send")}</span>
        </button>
      </div>
    </>
  );
}

function MessageRow({ msg }: { msg: Message }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (msg.attachment_id && !url) {
      api
        .attachmentUrl(msg.attachment_id)
        .then((r) => setUrl(r.url))
        .catch(() => {});
    }
  }, [msg.attachment_id]);

  const time = new Date(msg.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const senderName = msg.sender_display_name ?? msg.sender_type;

  return (
    <div className={`msg ${msg.sender_type}`}>
      {msg.body && <div>{msg.body}</div>}
      {msg.attachment_id && url && (
        <img
          src={url}
          alt="attachment"
          onClick={() => window.open(url, "_blank", "noopener")}
        />
      )}
      <div className="meta">
        <span style={{ fontWeight: 500 }}>{senderName}</span>
        <span style={{ marginLeft: 6, opacity: 0.85 }}>{time}</span>
      </div>
    </div>
  );
}
