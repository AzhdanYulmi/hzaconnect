import { io, Socket } from "socket.io-client";
import {
  WidgetClientEvents,
  ServerEvents,
  type Conversation,
  type Message,
} from "@hzaconnect/shared";

export type FrameEvents = {
  onConversation: (c: Conversation) => void;
  onMessage: (m: Message) => void;
  onTyping: (actor: { type: "agent" | "session"; id: string | null; name: string | null }, isTyping: boolean) => void;
  onReadReceipt: (upToSeq: number, by: "agent" | "session") => void;
  onConnectionChange: (connected: boolean) => void;
  onRestored: (count: number) => void;
  /** Fired when the server tells us this deployment has been suspended. */
  onServiceSuspended?: () => void;
};

export class FrameSocket {
  sock: Socket | null = null;
  token: string | null = null;
  activeConvId: string | null = null;
  lastSeenSeq = 0;
  outbox: Array<{ client_message_id: string; body: string; attachment_id?: string }> = [];

  constructor(public origin: string, public events: FrameEvents) {
    this.restoreOutbox();
    this.installVisibilityHandlers();
  }

  private lastHiddenAt = 0;

  /**
   * Force a `conversation.resume` whenever the page regains focus, and a
   * full reconnect on bfcache restore. Safari (and to a lesser extent other
   * browsers) can leave a WebSocket appearing-connected but stale after
   * tab/page suspension.
   */
  private installVisibilityHandlers() {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.lastHiddenAt = Date.now();
      } else if (document.visibilityState === "visible") {
        this.recoverOnVisible();
      }
    });
    window.addEventListener("pageshow", (e: PageTransitionEvent) => {
      if (e.persisted) {
        try {
          this.sock?.disconnect();
        } catch {}
        this.sock?.connect();
      }
    });
    window.addEventListener("focus", () => {
      if (document.visibilityState === "visible") this.recoverOnVisible();
    });
  }

  private recoverOnVisible() {
    if (!this.sock) return;
    const hiddenMs = Date.now() - this.lastHiddenAt;
    console.debug("[hzaconnect-widget] visible after", hiddenMs, "ms");
    if (hiddenMs > 1000) {
      try {
        this.sock.disconnect();
      } catch {}
      this.sock.connect();
    } else {
      this.catchUp();
    }
  }

  private catchUp() {
    if (!this.sock || !this.activeConvId) return;
    console.debug("[hzaconnect-widget] catch-up", {
      conv: this.activeConvId,
      seq: this.lastSeenSeq,
    });
    this.sock.emit(
      WidgetClientEvents.ConversationResume,
      { conversation_id: this.activeConvId, last_seen_seq: this.lastSeenSeq },
      (ack: any) => {
        if (ack?.ok) {
          this.events.onConversation(ack.conversation);
          for (const m of ack.missed_messages) this.events.onMessage(m);
          if (ack.missed_messages.length > 0)
            this.events.onRestored(ack.missed_messages.length);
          this.lastSeenSeq = Math.max(
            this.lastSeenSeq,
            ack.missed_messages.at(-1)?.seq ?? this.lastSeenSeq,
          );
        }
      },
    );
    if (!this.sock.connected) this.sock.connect();
  }

  connect(token: string) {
    this.token = token;
    if (this.sock) this.sock.disconnect();
    this.sock = io(`${this.origin}/widget`, {
      path: "/ws",
      transports: ["websocket"],
      auth: { token },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
    this.sock.on("connect", () => {
      this.events.onConnectionChange(true);
      if (this.activeConvId) {
        this.sock!.emit(
          WidgetClientEvents.ConversationResume,
          { conversation_id: this.activeConvId, last_seen_seq: this.lastSeenSeq },
          (ack: any) => {
            if (ack?.ok) {
              this.events.onConversation(ack.conversation);
              for (const m of ack.missed_messages) this.events.onMessage(m);
              if (ack.missed_messages.length > 0)
                this.events.onRestored(ack.missed_messages.length);
              this.lastSeenSeq = Math.max(
                this.lastSeenSeq,
                ack.missed_messages.at(-1)?.seq ?? this.lastSeenSeq,
              );
            }
          },
        );
      } else {
        this.sock!.emit(WidgetClientEvents.SessionHello, {}, (ack: any) => {
          if (ack?.ok) {
            if (ack.active_conversation) {
              this.activeConvId = ack.active_conversation.id;
              this.events.onConversation(ack.active_conversation);
            }
            for (const m of ack.recent_messages as Message[]) {
              this.events.onMessage(m);
              this.lastSeenSeq = Math.max(this.lastSeenSeq, m.seq);
            }
          }
        });
      }
      this.flushOutbox();
    });
    this.sock.on("disconnect", () => this.events.onConnectionChange(false));
    this.sock.on("connect_error", (err: Error) => {
      if (err.message === "service_suspended") {
        this.events.onServiceSuspended?.();
        // Stop the auto-reconnect loop — it would just keep being refused.
        try {
          this.sock?.disconnect();
        } catch {}
      }
    });
    this.sock.on(ServerEvents.Error, (p: { code?: string }) => {
      if (p?.code === "service_suspended") {
        this.events.onServiceSuspended?.();
      }
    });
    this.sock.on(ServerEvents.MessageNew, (p: { message: Message }) => {
      this.events.onMessage(p.message);
      this.lastSeenSeq = Math.max(this.lastSeenSeq, p.message.seq);
    });
    this.sock.on(ServerEvents.ConversationUpdated, (p: { conversation: Conversation }) => {
      this.events.onConversation(p.conversation);
    });
    this.sock.on(ServerEvents.TypingUpdate, (p: any) => {
      this.events.onTyping(
        { type: p.actor_type, id: p.actor_id, name: p.actor_name },
        p.is_typing,
      );
    });
    this.sock.on(
      ServerEvents.MessageReadReceipt,
      (p: { up_to_seq: number; reader_type: "agent" | "session" }) => {
        this.events.onReadReceipt(p.up_to_seq, p.reader_type);
      },
    );
  }

  send(body: string, attachmentId?: string): string {
    const clientId = uuid();
    const item = { client_message_id: clientId, body, attachment_id: attachmentId };
    this.outbox.push(item);
    this.persistOutbox();
    this.flushOutbox();
    return clientId;
  }

  private flushOutbox() {
    if (!this.sock?.connected) return;
    for (const item of [...this.outbox]) {
      this.sock.emit(
        WidgetClientEvents.MessageSend,
        {
          conversation_id: this.activeConvId ?? undefined,
          client_message_id: item.client_message_id,
          body: item.body,
          attachment_id: item.attachment_id,
        },
        (ack: any) => {
          if (ack?.ok) {
            this.activeConvId = ack.conversation.id;
            this.events.onConversation(ack.conversation);
            this.events.onMessage(ack.message);
            this.lastSeenSeq = Math.max(this.lastSeenSeq, ack.message.seq);
            this.outbox = this.outbox.filter(
              (i) => i.client_message_id !== item.client_message_id,
            );
            this.persistOutbox();
          }
        },
      );
    }
  }

  emitTyping(isTyping: boolean) {
    if (!this.sock?.connected || !this.activeConvId) return;
    this.sock.emit(
      isTyping ? WidgetClientEvents.TypingStart : WidgetClientEvents.TypingStop,
      { conversation_id: this.activeConvId },
      () => {},
    );
  }

  markRead(upToSeq: number) {
    if (!this.sock?.connected || !this.activeConvId) return;
    this.sock.emit(
      WidgetClientEvents.MessageRead,
      { conversation_id: this.activeConvId, up_to_seq: upToSeq },
      () => {},
    );
  }

  private persistOutbox() {
    try {
      localStorage.setItem("hzaconnect_outbox", JSON.stringify(this.outbox));
    } catch {}
  }
  private restoreOutbox() {
    try {
      const raw = localStorage.getItem("hzaconnect_outbox");
      if (raw) this.outbox = JSON.parse(raw);
    } catch {}
  }
}

function uuid(): string {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}
