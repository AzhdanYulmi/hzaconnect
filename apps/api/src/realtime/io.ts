import { Server, type Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  WidgetClientEvents,
  AgentClientEvents,
  ServerEvents,
  sessionHelloReq,
  messageSendReq,
  messageReadReq,
  typingReq,
  conversationClaimReq,
  conversationCloseReq,
  conversationResumeReq,
  conversationObserveReq,
  type Conversation,
  type Message,
} from "@hzaconnect/shared";
import { verifyAgentAccess, verifyWidgetSession } from "../auth/tokens.js";
import { getLicenseState, onLicenseStateChange } from "../license/state.js";
import { db } from "../db/client.js";
import { agents, sessions } from "../db/schema.js";
import { redis } from "../redis.js";
import {
  claimConversation,
  closeConversation,
  fetchConversation,
  getOrCreateActiveConversation,
  listQueue,
  markRead,
  missedSince,
  recentMessages,
  resolveAgentName,
  resolveSessionName,
  sendMessage,
} from "./conversation-service.js";
import { toConversation, toMessage } from "./mapping.js";
import { canConversation, type Actor } from "../auth/can.js";

type WidgetSocketData = {
  sessionId: string;
  actor: Extract<Actor, { kind: "session" }>;
};
type AgentSocketData = {
  agentId: string;
  role: "agent" | "supervisor" | "admin";
  displayName: string;
  actor: Extract<Actor, { kind: "agent" }>;
};

export function createIoServer(fastify: FastifyInstance): Server {
  const io = new Server({
    cors: { origin: true, credentials: true },
    path: "/ws",
    serveClient: false,
  });

  const widgetNs = io.of("/widget");
  const agentNs = io.of("/agent");

  // -------- /widget auth + handlers --------
  widgetNs.use(async (socket, next) => {
    if (!getLicenseState().ok) return next(new Error("service_suspended"));
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.query?.token as string | undefined);
      if (!token) return next(new Error("no_token"));
      const claims = await verifyWidgetSession(token);
      const session = await db.query.sessions.findFirst({
        where: eq(sessions.id, claims.sub),
      });
      if (!session) return next(new Error("unknown_session"));
      (socket.data as WidgetSocketData) = {
        sessionId: session.id,
        actor: { kind: "session", id: session.id },
      };
      next();
    } catch (err) {
      next(new Error("auth_failed"));
    }
  });

  widgetNs.on("connection", (socket) => {
    const { sessionId, actor } = socket.data as WidgetSocketData;
    socket.join(`session:${sessionId}`);

    socket.on(WidgetClientEvents.SessionHello, async (raw, ack) => {
      try {
        sessionHelloReq.parse(raw ?? {});
        const conv = await getOrCreateActiveConversation(sessionId);
        socket.join(`conversation:${conv.id}`);
        const msgs = await recentMessages(conv.id, 50);
        const convDto: Conversation = toConversation(conv, {
          assignedAgentName: await resolveAgentName(conv.assignedAgentId),
          sessionDisplayName: await resolveSessionName(conv.sessionId),
        });
        const msgDtos: Message[] = msgs.map(toMessage);
        ack({
          ok: true,
          session_id: sessionId,
          active_conversation: convDto,
          recent_messages: msgDtos,
        });
      } catch (err) {
        ack({ ok: false, error: (err as Error).message });
      }
    });

    socket.on(WidgetClientEvents.MessageSend, async (raw, ack) => {
      try {
        const body = messageSendReq.parse(raw);
        const conv = body.conversation_id
          ? await fetchConversation(body.conversation_id)
          : await getOrCreateActiveConversation(sessionId);
        if (!conv) return ack({ ok: false, error: "unknown_conversation" });
        if (!canConversation(actor, "send", conv))
          return ack({ ok: false, error: "forbidden" });
        socket.join(`conversation:${conv.id}`);
        const sDisplay = await resolveSessionName(sessionId);
        const result = await sendMessage({
          conversationId: conv.id,
          sessionId,
          senderType: "session",
          senderId: sessionId,
          senderDisplayName: sDisplay,
          clientMessageId: body.client_message_id,
          body: body.body ?? "",
          attachmentId: body.attachment_id ?? null,
        });
        if (!result.ok) return ack({ ok: false, error: result.error });
        const convDto = toConversation(result.conversation, {
          assignedAgentName: result.assignedAgentName,
          sessionDisplayName: result.sessionDisplayName,
        });
        const msgDto = toMessage(result.message);
        if (result.created) {
          widgetNs
            .to(`conversation:${conv.id}`)
            .emit(ServerEvents.MessageNew, { conversation_id: conv.id, message: msgDto });
          agentNs
            .to(`conversation:${conv.id}`)
            .emit(ServerEvents.MessageNew, { conversation_id: conv.id, message: msgDto });
          // First-message-of-conversation = brand new entry for the queue.
          const isNewConversation = result.message.seq === 1;
          broadcastConversationUpdate(agentNs, convDto, { isNew: isNewConversation });
        }
        ack({ ok: true, conversation: convDto, message: msgDto });
      } catch (err) {
        ack({ ok: false, error: (err as Error).message });
      }
    });

    socket.on(WidgetClientEvents.MessageRead, async (raw, ack) => {
      try {
        const body = messageReadReq.parse(raw);
        const conv = await fetchConversation(body.conversation_id);
        if (!conv) return ack({ ok: false, error: "unknown_conversation" });
        if (!canConversation(actor, "read", conv))
          return ack({ ok: false, error: "forbidden" });
        await markRead(conv.id, body.up_to_seq, "session");
        widgetNs.to(`conversation:${conv.id}`).emit(ServerEvents.MessageReadReceipt, {
          conversation_id: conv.id,
          reader_type: "session",
          reader_id: sessionId,
          up_to_seq: body.up_to_seq,
        });
        agentNs.to(`conversation:${conv.id}`).emit(ServerEvents.MessageReadReceipt, {
          conversation_id: conv.id,
          reader_type: "session",
          reader_id: sessionId,
          up_to_seq: body.up_to_seq,
        });
        ack({ ok: true });
      } catch (err) {
        ack({ ok: false, error: (err as Error).message });
      }
    });

    const emitTyping = async (convId: string, isTyping: boolean) => {
      const conv = await fetchConversation(convId);
      if (!conv) return;
      if (!canConversation(actor, "send", conv)) return;
      const key = `typing:${convId}`;
      const field = `session:${sessionId}`;
      if (isTyping) {
        await redis.hset(key, field, Date.now().toString());
        await redis.expire(key, 10);
      } else {
        await redis.hdel(key, field);
      }
      const sName = await resolveSessionName(sessionId);
      const payload = {
        conversation_id: convId,
        actor_type: "session" as const,
        actor_id: sessionId,
        actor_name: sName,
        is_typing: isTyping,
      };
      widgetNs.to(`conversation:${convId}`).except(socket.id).emit(
        ServerEvents.TypingUpdate,
        payload,
      );
      agentNs.to(`conversation:${convId}`).emit(ServerEvents.TypingUpdate, payload);
    };

    socket.on(WidgetClientEvents.TypingStart, async (raw, ack) => {
      try {
        const body = typingReq.parse(raw);
        await emitTyping(body.conversation_id, true);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: (err as Error).message });
      }
    });
    socket.on(WidgetClientEvents.TypingStop, async (raw, ack) => {
      try {
        const body = typingReq.parse(raw);
        await emitTyping(body.conversation_id, false);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: (err as Error).message });
      }
    });

    socket.on(WidgetClientEvents.ConversationResume, async (raw, ack) => {
      try {
        const body = conversationResumeReq.parse(raw);
        const conv = await fetchConversation(body.conversation_id);
        if (!conv) return ack({ ok: false, error: "unknown_conversation" });
        if (!canConversation(actor, "read", conv))
          return ack({ ok: false, error: "forbidden" });
        socket.join(`conversation:${conv.id}`);
        const missed = await missedSince(conv.id, body.last_seen_seq);
        const convDto = toConversation(conv, {
          assignedAgentName: await resolveAgentName(conv.assignedAgentId),
          sessionDisplayName: await resolveSessionName(conv.sessionId),
        });
        ack({
          ok: true,
          conversation: convDto,
          missed_messages: missed.map(toMessage),
        });
      } catch (err) {
        ack({ ok: false, error: (err as Error).message });
      }
    });
  });

  // -------- /agent auth + handlers --------
  agentNs.use(async (socket, next) => {
    if (!getLicenseState().ok) return next(new Error("service_suspended"));
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.query?.token as string | undefined);
      if (!token) return next(new Error("no_token"));
      const claims = await verifyAgentAccess(token);
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, claims.sub),
      });
      if (!agent || agent.status !== "active")
        return next(new Error("inactive_agent"));
      (socket.data as AgentSocketData) = {
        agentId: agent.id,
        role: agent.role,
        displayName: agent.displayName,
        actor: { kind: "agent", id: agent.id, role: agent.role },
      };
      next();
    } catch (err) {
      next(new Error("auth_failed"));
    }
  });

  agentNs.on("connection", (socket) => {
    const { agentId, role, displayName, actor } = socket.data as AgentSocketData;
    socket.join(`agent:${agentId}`);
    socket.join("queue");
    if (role === "supervisor" || role === "admin") socket.join("supervisor");

    // Push initial queue snapshot.
    (async () => {
      const rows = await listQueue();
      socket.emit("queue.snapshot", {
        conversations: rows.map((r) =>
          toConversation(r.row, {
            assignedAgentName: r.assignedAgentName,
            sessionDisplayName: r.sessionDisplayName,
          }),
        ),
      });
    })();

    socket.on(AgentClientEvents.ConversationObserve, async (raw, ack) => {
      try {
        const body = conversationObserveReq.parse(raw);
        const conv = await fetchConversation(body.conversation_id);
        if (!conv) return ack({ ok: false, error: "unknown_conversation" });
        if (!canConversation(actor, "observe", conv) && !canConversation(actor, "read", conv))
          return ack({ ok: false, error: "forbidden" });
        socket.join(`conversation:${conv.id}`);
        const msgs = await recentMessages(conv.id, 100);
        ack({
          ok: true,
          conversation: toConversation(conv, {
            assignedAgentName: await resolveAgentName(conv.assignedAgentId),
            sessionDisplayName: await resolveSessionName(conv.sessionId),
          }),
          recent_messages: msgs.map(toMessage),
        });
      } catch (err) {
        ack({ ok: false, error: (err as Error).message });
      }
    });

    socket.on(AgentClientEvents.ConversationClaim, async (raw, ack) => {
      try {
        const body = conversationClaimReq.parse(raw);
        const res = await claimConversation(body.conversation_id, agentId);
        if (!res.ok) return ack({ ok: false, error: res.error });
        socket.join(`conversation:${res.conversation.id}`);
        const convDto = toConversation(res.conversation, {
          assignedAgentName: displayName,
          sessionDisplayName: await resolveSessionName(res.conversation.sessionId),
        });
        broadcastConversationUpdate(agentNs, convDto, { isNew: false });
        widgetNs
          .to(`conversation:${res.conversation.id}`)
          .emit(ServerEvents.ConversationUpdated, { conversation: convDto });
        ack({ ok: true, conversation: convDto });
      } catch (err) {
        ack({ ok: false, error: (err as Error).message });
      }
    });

    socket.on(AgentClientEvents.ConversationClose, async (raw, ack) => {
      try {
        const body = conversationCloseReq.parse(raw);
        const conv = await fetchConversation(body.conversation_id);
        if (!conv) return ack({ ok: false, error: "unknown_conversation" });
        if (!canConversation(actor, "close", conv))
          return ack({ ok: false, error: "forbidden" });
        const updated = await closeConversation(conv.id, agentId, body.reason ?? null);
        if (!updated) return ack({ ok: false, error: "close_failed" });
        const convDto = toConversation(updated, {
          assignedAgentName: await resolveAgentName(updated.assignedAgentId),
          sessionDisplayName: await resolveSessionName(updated.sessionId),
        });
        broadcastConversationUpdate(agentNs, convDto, { isNew: false });
        widgetNs
          .to(`conversation:${conv.id}`)
          .emit(ServerEvents.ConversationUpdated, { conversation: convDto });
        ack({ ok: true });
      } catch (err) {
        ack({ ok: false, error: (err as Error).message });
      }
    });

    socket.on(AgentClientEvents.MessageSend, async (raw, ack) => {
      try {
        const body = messageSendReq.parse(raw);
        if (!body.conversation_id)
          return ack({ ok: false, error: "conversation_id_required" });
        const conv = await fetchConversation(body.conversation_id);
        if (!conv) return ack({ ok: false, error: "unknown_conversation" });
        if (!canConversation(actor, "send", conv))
          return ack({ ok: false, error: "forbidden" });
        const result = await sendMessage({
          conversationId: conv.id,
          sessionId: null,
          senderType: "agent",
          senderId: agentId,
          senderDisplayName: displayName,
          clientMessageId: body.client_message_id,
          body: body.body ?? "",
          attachmentId: body.attachment_id ?? null,
        });
        if (!result.ok) return ack({ ok: false, error: result.error });
        const convDto = toConversation(result.conversation, {
          assignedAgentName: result.assignedAgentName,
          sessionDisplayName: result.sessionDisplayName,
        });
        const msgDto = toMessage(result.message);
        if (result.created) {
          agentNs
            .to(`conversation:${conv.id}`)
            .emit(ServerEvents.MessageNew, { conversation_id: conv.id, message: msgDto });
          widgetNs
            .to(`conversation:${conv.id}`)
            .emit(ServerEvents.MessageNew, { conversation_id: conv.id, message: msgDto });
          broadcastConversationUpdate(agentNs, convDto, { isNew: false });
        }
        ack({ ok: true, conversation: convDto, message: msgDto });
      } catch (err) {
        ack({ ok: false, error: (err as Error).message });
      }
    });

    socket.on(AgentClientEvents.MessageRead, async (raw, ack) => {
      try {
        const body = messageReadReq.parse(raw);
        const conv = await fetchConversation(body.conversation_id);
        if (!conv) return ack({ ok: false, error: "unknown_conversation" });
        if (!canConversation(actor, "read", conv))
          return ack({ ok: false, error: "forbidden" });
        await markRead(conv.id, body.up_to_seq, "agent");
        widgetNs.to(`conversation:${conv.id}`).emit(ServerEvents.MessageReadReceipt, {
          conversation_id: conv.id,
          reader_type: "agent",
          reader_id: agentId,
          up_to_seq: body.up_to_seq,
        });
        agentNs.to(`conversation:${conv.id}`).emit(ServerEvents.MessageReadReceipt, {
          conversation_id: conv.id,
          reader_type: "agent",
          reader_id: agentId,
          up_to_seq: body.up_to_seq,
        });
        ack({ ok: true });
      } catch (err) {
        ack({ ok: false, error: (err as Error).message });
      }
    });

    const emitTyping = async (convId: string, isTyping: boolean) => {
      const conv = await fetchConversation(convId);
      if (!conv) return;
      if (!canConversation(actor, "send", conv)) return;
      const key = `typing:${convId}`;
      const field = `agent:${agentId}`;
      if (isTyping) {
        await redis.hset(key, field, Date.now().toString());
        await redis.expire(key, 10);
      } else {
        await redis.hdel(key, field);
      }
      const payload = {
        conversation_id: convId,
        actor_type: "agent" as const,
        actor_id: agentId,
        actor_name: displayName,
        is_typing: isTyping,
      };
      agentNs.to(`conversation:${convId}`).except(socket.id).emit(
        ServerEvents.TypingUpdate,
        payload,
      );
      widgetNs.to(`conversation:${convId}`).emit(ServerEvents.TypingUpdate, payload);
    };
    socket.on(AgentClientEvents.TypingStart, async (raw, ack) => {
      try {
        const body = typingReq.parse(raw);
        await emitTyping(body.conversation_id, true);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: (err as Error).message });
      }
    });
    socket.on(AgentClientEvents.TypingStop, async (raw, ack) => {
      try {
        const body = typingReq.parse(raw);
        await emitTyping(body.conversation_id, false);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: (err as Error).message });
      }
    });

    socket.on(AgentClientEvents.ConversationResume, async (raw, ack) => {
      try {
        const body = conversationResumeReq.parse(raw);
        const conv = await fetchConversation(body.conversation_id);
        if (!conv) return ack({ ok: false, error: "unknown_conversation" });
        if (!canConversation(actor, "read", conv))
          return ack({ ok: false, error: "forbidden" });
        socket.join(`conversation:${conv.id}`);
        const missed = await missedSince(conv.id, body.last_seen_seq);
        ack({
          ok: true,
          conversation: toConversation(conv, {
            assignedAgentName: await resolveAgentName(conv.assignedAgentId),
            sessionDisplayName: await resolveSessionName(conv.sessionId),
          }),
          missed_messages: missed.map(toMessage),
        });
      } catch (err) {
        ack({ ok: false, error: (err as Error).message });
      }
    });
  });

  // ---- Live license enforcement ----
  // When the license state turns not-ok (suspended / revoked / expired),
  // we don't want existing WebSocket connections to keep delivering chat.
  // Notify each connected socket and force-close it. Subsequent reconnects
  // are blocked at the namespace middleware (which already checks license
  // state on every handshake).
  let lastOk = getLicenseState().ok;
  onLicenseStateChange((state) => {
    const nowOk = state.ok;
    if (lastOk && !nowOk) {
      const reason = state.ok ? null : state.reason;
      const payload = {
        code: "service_suspended",
        message: "Service suspended.",
        reason,
      };
      try {
        widgetNs.emit(ServerEvents.Error, payload);
        agentNs.emit(ServerEvents.Error, payload);
      } catch {}
      // Disconnect with `close=true` so the underlying transport is closed.
      try {
        widgetNs.disconnectSockets(true);
        agentNs.disconnectSockets(true);
      } catch {}
    }
    lastOk = nowOk;
  });

  return io;
}

function broadcastConversationUpdate(
  ns: ReturnType<Server["of"]>,
  conversation: Conversation,
  opts: { isNew: boolean },
) {
  const payload = { conversation };
  if (opts.isNew) {
    ns.to("queue").emit(ServerEvents.ConversationNew, payload);
    ns.to("supervisor").emit(ServerEvents.ConversationNew, payload);
  } else {
    ns.to("queue").emit(ServerEvents.ConversationUpdated, payload);
    ns.to("supervisor").emit(ServerEvents.ConversationUpdated, payload);
    ns.to(`conversation:${conversation.id}`).emit(
      ServerEvents.ConversationUpdated,
      payload,
    );
  }
}

function broadcastQueueUpdate(
  ns: ReturnType<Server["of"]>,
  conversation: Conversation,
) {
  ns.to("queue").emit(ServerEvents.ConversationUpdated, { conversation });
}
