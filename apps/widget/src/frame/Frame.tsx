import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Conversation, Message } from "@hzaconnect/shared";
import { FrameSocket } from "./socket.js";
import { t, setLocale, useLocale } from "./i18n.js";
import { PreChat, type IdentifierField } from "./PreChat.js";
import {
  ChatBubbleIcon,
  CheckIcon,
  CloseIcon,
  DoubleCheckIcon,
  PaperclipIcon,
  SendIcon,
} from "./Icons.js";

const HOST_MSG_HANDSHAKE_REQ = "HZA_HANDSHAKE_REQ";
const HOST_MSG_HANDSHAKE_ACK = "HZA_HANDSHAKE_ACK";
const HOST_MSG_UNREAD = "HZA_UNREAD";
const HOST_MSG_CLOSE = "HZA_CLOSE";
const HOST_MSG_SET_CONTEXT = "HZA_SET_CONTEXT";
const HOST_MSG_SET_LOCALE = "HZA_SET_LOCALE";

const origin = location.origin;

let sessionToken: string | null = null;
export function getSessionToken(): string | null {
  return sessionToken;
}

const RECONNECT_GRACE_MS = 10_000;

type IdentifierConfig = {
  identifier_fields: IdentifierField[];
  require_before_chat: boolean;
};

const PRECHAT_DONE_KEY = "hzaconnect_prechat_done";

export function Frame() {
  useLocale();
  const [connected, setConnected] = useState(false);
  const [stale, setStale] = useState(false);
  const [serviceSuspended, setServiceSuspended] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [identifierConfig, setIdentifierConfig] = useState<IdentifierConfig>({
    identifier_fields: [],
    require_before_chat: false,
  });
  const [showPreChat, setShowPreChat] = useState(false);
  const [showEditInfo, setShowEditInfo] = useState(false);
  const [identifierValues, setIdentifierValues] = useState<Record<string, string>>({});
  const [typingActors, setTypingActors] = useState<Record<string, { name: string | null; until: number }>>({});
  const [text, setText] = useState("");
  const [parentOrigin, setParentOrigin] = useState<string | null>(null);
  const [restoredToast, setRestoredToast] = useState<number | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{ attachment_id: string; name: string } | null>(null);
  const [readUpToSeq, setReadUpToSeq] = useState(0);
  const sockRef = useRef<FrameSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const typingSentAt = useRef(0);

  // Fetch the deployment-wide identifier config once.
  useEffect(() => {
    fetch(`${origin}/api/deployment/identifier-config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: IdentifierConfig | null) => {
        if (!cfg) return;
        setIdentifierConfig(cfg);
        const done = localStorage.getItem(PRECHAT_DONE_KEY);
        if (cfg.identifier_fields.length > 0 && !done) {
          setShowPreChat(true);
        }
      })
      .catch(() => {});
  }, []);

  async function submitIdentifiers(
    values: Array<{ kind: IdentifierField["kind"]; custom_label?: string; value: string }>,
  ) {
    const token = getSessionToken();
    if (!token) return;
    const next: Record<string, string> = { ...identifierValues };
    for (const v of values) {
      try {
        await fetch(`${origin}/api/widget/session/identifiers`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            kind: v.kind,
            value: v.value,
            custom_label: v.custom_label,
          }),
        });
        const key = v.kind === "custom" ? `custom:${v.custom_label ?? ""}` : v.kind;
        next[key] = v.value;
      } catch {
        // Identification is optional; failure should not block the chat.
      }
    }
    setIdentifierValues(next);
    localStorage.setItem(PRECHAT_DONE_KEY, "1");
    setShowPreChat(false);
    setShowEditInfo(false);
  }

  // Show "Reconnecting…" only if the WS has been down for > grace period.
  useEffect(() => {
    if (connected) {
      setStale(false);
      return;
    }
    const t = setTimeout(() => setStale(true), RECONNECT_GRACE_MS);
    return () => clearTimeout(t);
  }, [connected]);

  useEffect(() => {
    const handleMsg = (evt: MessageEvent) => {
      const data = evt.data;
      if (!data || typeof data !== "object") return;
      if (data.type === HOST_MSG_HANDSHAKE_ACK) {
        setParentOrigin(evt.origin);
        const token = data.session_token as string;
        sessionToken = token;
        if (typeof data.locale === "string") setLocale(data.locale);
        if (!sockRef.current) {
          sockRef.current = new FrameSocket(origin, {
            onConnectionChange: setConnected,
            onConversation: (c) => setConversation(c),
            onMessage: (m) =>
              setMessages((prev) => {
                if (prev.some((x) => x.seq === m.seq)) return prev;
                return [...prev, m].sort((a, b) => a.seq - b.seq);
              }),
            onTyping: (actor, isTyping) => {
              if (actor.type === "session") return;
              const key = `${actor.type}:${actor.id ?? "?"}`;
              setTypingActors((t) => {
                const next = { ...t };
                if (isTyping) next[key] = { name: actor.name, until: Date.now() + 6000 };
                else delete next[key];
                return next;
              });
            },
            onReadReceipt: (upTo, by) => {
              if (by === "agent") setReadUpToSeq(upTo);
            },
            onRestored: (n) => {
              setRestoredToast(n);
              setTimeout(() => setRestoredToast(null), 4000);
            },
            onServiceSuspended: () => setServiceSuspended(true),
          });
        }
        sockRef.current.connect(token);
      } else if (data.type === HOST_MSG_SET_CONTEXT) {
        // currently unused, reserved for future context routing
      } else if (data.type === HOST_MSG_SET_LOCALE) {
        if (typeof data.locale === "string") setLocale(data.locale);
      }
    };
    window.addEventListener("message", handleMsg);
    window.parent?.postMessage({ type: HOST_MSG_HANDSHAKE_REQ }, "*");
    return () => window.removeEventListener("message", handleMsg);
  }, []);

  // Auto-resize the composer textarea up to ~5 lines.
  useEffect(() => {
    const ta = composerRef.current;
    if (!ta) return;
    ta.style.height = "0";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [text]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    const last = messages.at(-1);
    if (last && last.sender_type !== "session" && sockRef.current) {
      sockRef.current.markRead(last.seq);
    }
    if (parentOrigin) {
      const unread = messages.filter(
        (m) => m.sender_type === "agent" && m.seq > readUpToSeq,
      ).length;
      window.parent.postMessage(
        { type: HOST_MSG_UNREAD, count: unread },
        parentOrigin,
      );
    }
  }, [messages.length, parentOrigin]);

  function send() {
    const body = text.trim();
    if (!body && !pendingUpload) return;
    sockRef.current?.send(body, pendingUpload?.attachment_id);
    setText("");
    setPendingUpload(null);
  }

  function onInput(v: string) {
    setText(v);
    const now = Date.now();
    if (now - typingSentAt.current > 2000) {
      typingSentAt.current = now;
      sockRef.current?.emitTyping(true);
      setTimeout(() => sockRef.current?.emitTyping(false), 3000);
    }
  }

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(f.type)) {
      alert(t("composer.only_images"));
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      alert(t("composer.max_size"));
      return;
    }
    const token = getSessionToken();
    if (!token) {
      alert(t("composer.not_connected"));
      return;
    }
    const res = await fetch(`${origin}/api/attachments/presign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mime_type: f.type,
        byte_size: f.size,
        conversation_id: conversation?.id,
      }),
    });
    if (!res.ok) {
      alert(t("composer.presign_failed"));
      return;
    }
    const pres = await res.json();
    const put = await fetch(pres.upload_url, {
      method: "PUT",
      headers: { "Content-Type": f.type },
      body: f,
    });
    if (!put.ok) {
      alert(t("composer.upload_failed"));
      return;
    }
    setPendingUpload({ attachment_id: pres.attachment_id, name: f.name });
    // Reset the input so picking the same file again still fires onChange.
    input.value = "";
  }

  const activeTyping = useMemo(() => {
    const now = Date.now();
    return Object.values(typingActors)
      .filter((x) => x.until > now)
      .map((x) => x.name ?? t("typing.fallback"));
  }, [typingActors, messages.length]);

  const closed = conversation?.status === "closed";
  const locked = closed || serviceSuspended;
  const canSend = !locked && (text.trim().length > 0 || !!pendingUpload);

  return (
    <>
      <header class="hza-header">
        <div class="hza-header-title">
          <span class="hza-header-title-row">{t("header.title")}</span>
          <span class="hza-header-status">
            <span class={`hza-status-dot${connected ? "" : " warn"}`} />
            {connected
              ? t("header.online")
              : stale
              ? t("header.reconnecting")
              : t("header.online")}
          </span>
        </div>
        <div class="hza-header-actions">
          {identifierConfig.identifier_fields.length > 0 && !showPreChat && (
            <button
              class="hza-edit-info-btn"
              onClick={() => setShowEditInfo((v) => !v)}
            >
              {t("prechat.edit_button")}
            </button>
          )}
          <button
            class="hza-icon-btn hza-icon-btn--ghost"
            onClick={() => window.parent.postMessage({ type: HOST_MSG_CLOSE }, parentOrigin ?? "*")}
            aria-label={t("close_button")}
          >
            <CloseIcon size={18} />
          </button>
        </div>
      </header>

      {(showPreChat || showEditInfo) ? (
        <PreChat
          fields={identifierConfig.identifier_fields}
          mode={showPreChat ? "first" : "edit"}
          initial={identifierValues}
          onSubmit={submitIdentifiers}
          onSkip={
            showPreChat
              ? () => {
                  localStorage.setItem(PRECHAT_DONE_KEY, "1");
                  setShowPreChat(false);
                }
              : undefined
          }
          onCancel={
            showEditInfo ? () => setShowEditInfo(false) : undefined
          }
        />
      ) : (
        <>
          {serviceSuspended && (
            <div role="alert" class="hza-banner hza-banner--danger">
              {t("banner.service_suspended")}
            </div>
          )}
          {!serviceSuspended && stale && (
            <div role="status" class="hza-banner hza-banner--warn">
              {t("banner.reconnecting")}
            </div>
          )}
          {restoredToast !== null && (
            <div role="status" class="hza-banner hza-banner--info">
              {restoredToast === 1
                ? t("banner.restored_one")
                : t("banner.restored_many", { count: restoredToast })}
            </div>
          )}
          <div ref={listRef} class="hza-messages">
            {messages.length === 0 ? (
              <div class="hza-empty">
                <span class="hza-empty-icon">
                  <ChatBubbleIcon size={24} />
                </span>
                <span class="hza-empty-text">{t("composer.empty")}</span>
              </div>
            ) : (
              messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  msg={m}
                  origin={origin}
                  readByAgent={
                    m.sender_type === "session" && m.seq <= readUpToSeq
                  }
                />
              ))
            )}
          </div>
          {activeTyping.length > 0 && (
            <div class="hza-typing">
              <span class="hza-typing-dots" aria-hidden="true">
                <span /><span /><span />
              </span>
              <span>
                {activeTyping.length === 1
                  ? t("typing.one", {
                      name: activeTyping[0] ?? t("typing.fallback"),
                    })
                  : t("typing.other", { name: activeTyping.join(", ") })}
              </span>
            </div>
          )}
          {pendingUpload && (
            <div class="hza-attach-chip" role="status">
              <span aria-hidden="true" style="display:inline-flex;">
                <PaperclipIcon size={14} />
              </span>
              <span class="hza-attach-chip-name" title={pendingUpload.name}>
                {pendingUpload.name}
              </span>
              <button
                type="button"
                class="hza-attach-chip-remove"
                aria-label="Remove attachment"
                onClick={() => setPendingUpload(null)}
              >
                <CloseIcon size={14} />
              </button>
            </div>
          )}
          <form
            class="hza-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label
              class="hza-attach-btn"
              title={t("composer.attach_image")}
              aria-label={t("composer.attach_image")}
            >
              <PaperclipIcon size={18} />
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style="display:none;"
                onChange={onFile}
                disabled={locked}
              />
            </label>
            <textarea
              ref={composerRef}
              class="hza-composer-input"
              value={text}
              onInput={(e) => onInput((e.currentTarget as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                serviceSuspended
                  ? t("banner.service_suspended")
                  : closed
                  ? t("composer.closed")
                  : t("composer.placeholder")
              }
              disabled={locked}
              rows={1}
            />
            <button
              type="submit"
              class="hza-send-btn"
              disabled={!canSend}
              aria-label={t("composer.send")}
            >
              <SendIcon size={18} />
            </button>
          </form>
        </>
      )}
    </>
  );
}

function MessageBubble({
  msg,
  origin,
  readByAgent,
}: {
  msg: Message;
  origin: string;
  readByAgent: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!msg.attachment_id) return;
    const token = getSessionToken();
    if (!token) return;
    fetch(`${origin}/api/attachments/${msg.attachment_id}/url`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUrl(d.url))
      .catch(() => {});
  }, [msg.attachment_id]);

  const senderClass =
    msg.sender_type === "session"
      ? "from-self"
      : msg.sender_type === "system"
      ? "from-system"
      : "from-other";

  const time = new Date(msg.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div class={`hza-msg-row ${senderClass}`}>
      <div class="hza-msg-bubble">
        {msg.body && <span>{msg.body}</span>}
        {msg.attachment_id && url && (
          <img
            class="hza-msg-image"
            src={url}
            alt="attachment"
            onClick={() => window.open(url, "_blank", "noopener")}
          />
        )}
      </div>
      {msg.sender_type !== "system" && (
        <span class="hza-msg-meta">
          <span>{time}</span>
          {msg.sender_type === "session" && (
            readByAgent ? (
              <DoubleCheckIcon size={13} aria-label="read" />
            ) : (
              <CheckIcon size={13} aria-label="sent" />
            )
          )}
        </span>
      )}
    </div>
  );
}
