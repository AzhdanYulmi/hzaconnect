import { io, Socket } from "socket.io-client";
import {
  AgentClientEvents,
  ServerEvents,
  type Conversation,
  type Message,
} from "@hzaconnect/shared";
import { authToken, api } from "./api.js";
import { useStore } from "./store.js";
import { notifyNewConversation } from "./notifications.js";
import i18n from "./i18n/index.js";

let socket: Socket | null = null;
let visibilityHandlerInstalled = false;
let lastHiddenAt = 0;

/**
 * Force a fresh `conversation.resume` for the active conversation, regardless
 * of whether socket.io thinks it's connected. Used after the tab becomes
 * visible again or after bfcache restore — Safari (and to a lesser extent
 * other browsers) can leave a WebSocket appearing-connected but stale.
 */
function catchUpActiveConversation(reason: string) {
  if (!socket) return;
  const { activeConvId, lastSeenSeqByConv } = useStore.getState();
  if (!activeConvId) return;
  const seq = lastSeenSeqByConv[activeConvId] ?? 0;
  console.debug("[hzaconnect] catch-up", { reason, seq, activeConvId });
  socket.emit(
    AgentClientEvents.ConversationResume,
    { conversation_id: activeConvId, last_seen_seq: seq },
    (ack: any) => {
      if (ack?.ok) {
        useStore.getState().upsertConversation(ack.conversation);
        useStore
          .getState()
          .upsertMessages(activeConvId, ack.missed_messages);
      }
    },
  );
}

/**
 * Aggressive recovery on tab refocus: Safari can leave a WebSocket appearing
 * "connected" yet not delivering frames. If we've been hidden for more than
 * a second, tear the socket down and reopen — the 'connect' handler then
 * does catch-up automatically.
 */
function recoverOnVisible() {
  if (!socket) return;
  const hiddenMs = Date.now() - lastHiddenAt;
  console.debug("[hzaconnect] visible after", hiddenMs, "ms");
  if (hiddenMs > 1000) {
    // Force a fresh transport — equivalent to a network restart for the WS.
    try {
      socket.disconnect();
    } catch {}
    socket.connect();
  } else {
    catchUpActiveConversation("visibilitychange-short");
  }
}

function installVisibilityHandlers() {
  if (visibilityHandlerInstalled) return;
  visibilityHandlerInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      lastHiddenAt = Date.now();
    } else if (document.visibilityState === "visible") {
      recoverOnVisible();
    }
  });
  window.addEventListener("pageshow", (e: PageTransitionEvent) => {
    // bfcache restore — WebSocket may be in a broken state.
    if (e.persisted) {
      try {
        socket?.disconnect();
      } catch {}
      socket?.connect();
    }
  });
  // Window focus is a safety net for browsers that don't reliably fire
  // visibilitychange on tab switches inside the same window.
  window.addEventListener("focus", () => {
    if (document.visibilityState === "visible") recoverOnVisible();
  });
}

export function connectAgent(): Socket {
  if (socket?.connected) return socket;
  const token = authToken.get();
  if (!token) throw new Error("no_token");
  socket = io("/agent", {
    path: "/ws",
    transports: ["websocket"],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });

  socket.on("connect", () => {
    useStore.getState().setConnected(true);
    catchUpActiveConversation("connect");
    flushOutbox();
  });

  installVisibilityHandlers();

  socket.on("disconnect", () => {
    useStore.getState().setConnected(false);
    // Tell the LicenseBanner to refetch /api/license/status immediately —
    // a suspended-license disconnect would otherwise wait up to 15s.
    window.dispatchEvent(new CustomEvent("hzaconnect:ws-disconnect"));
  });

  socket.on("connect_error", async (err) => {
    if (err.message === "service_suspended") {
      // Don't bother retrying — the namespace middleware will keep refusing.
      // Trigger a license-status refresh so the banner appears.
      window.dispatchEvent(new CustomEvent("hzaconnect:ws-disconnect"));
      return;
    }
    if (err.message === "auth_failed" || err.message === "inactive_agent") {
      const ok = await api.refresh();
      if (ok && socket) {
        socket.auth = { token: authToken.get() };
        socket.connect();
      }
    }
  });

  socket.on("queue.snapshot", (p: { conversations: Conversation[] }) => {
    useStore.getState().setQueueSnapshot(p.conversations);
  });

  socket.on(ServerEvents.ConversationNew, (p: { conversation: Conversation }) => {
    useStore.getState().upsertConversation(p.conversation);
    // Notify the agent if the conversation is unclaimed and they're not
    // actively viewing the chat queue.
    const state = useStore.getState();
    const inAdmin = state.view === "admin";
    const hidden = typeof document !== "undefined" && document.visibilityState !== "visible";
    if (p.conversation.status === "open") {
      notifyNewConversation({
        title: i18n.t("notifications.title", "New conversation"),
        body:
          p.conversation.session_display_name ??
          i18n.t("notifications.body_anonymous", "Anonymous player"),
        shouldNotify: inAdmin || hidden,
        onClick: () => {
          state.setView("chat");
          state.setActiveConv(p.conversation.id);
        },
      });
    }
  });
  socket.on(ServerEvents.ConversationUpdated, (p: { conversation: Conversation }) => {
    useStore.getState().upsertConversation(p.conversation);
  });
  socket.on(
    ServerEvents.MessageNew,
    (p: { conversation_id: string; message: Message }) => {
      useStore.getState().appendMessage(p.conversation_id, p.message);
    },
  );
  socket.on(
    ServerEvents.TypingUpdate,
    (p: {
      conversation_id: string;
      actor_type: "agent" | "session";
      actor_id: string | null;
      actor_name: string | null;
      is_typing: boolean;
    }) => {
      const key = `${p.actor_type}:${p.actor_id ?? "?"}`;
      useStore.getState().setTyping(p.conversation_id, key, p.actor_name, p.is_typing);
    },
  );

  return socket;
}

export function getSocket(): Socket {
  if (!socket) throw new Error("socket not connected");
  return socket;
}

export async function flushOutbox() {
  const s = socket;
  if (!s?.connected) return;
  const { outbox, removeFromOutbox } = useStore.getState();
  for (const [convId, items] of Object.entries(outbox)) {
    for (const item of items) {
      s.emit(
        AgentClientEvents.MessageSend,
        { conversation_id: convId, ...item },
        (ack: any) => {
          if (ack?.ok) removeFromOutbox(convId, item.client_message_id);
        },
      );
    }
  }
}

export function disconnect() {
  socket?.disconnect();
  socket = null;
}
