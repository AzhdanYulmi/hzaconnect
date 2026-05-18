import { create } from "zustand";
import type { Conversation, Message } from "@hzaconnect/shared";
import type { AgentMe } from "./api.js";

type ConvKey = string; // conversation_id

type State = {
  me: AgentMe | null;
  setMe: (m: AgentMe | null) => void;

  conversations: Record<ConvKey, Conversation>;
  conversationOrder: string[];
  setQueueSnapshot: (convs: Conversation[]) => void;
  upsertConversation: (c: Conversation) => void;

  messagesByConv: Record<ConvKey, Message[]>;
  lastSeenSeqByConv: Record<ConvKey, number>;
  upsertMessages: (convId: string, msgs: Message[]) => void;
  appendMessage: (convId: string, msg: Message) => void;
  setLastSeenSeq: (convId: string, seq: number) => void;

  typingByConv: Record<ConvKey, Record<string, { name: string | null; until: number }>>;
  setTyping: (convId: string, key: string, name: string | null, isTyping: boolean) => void;

  activeConvId: string | null;
  setActiveConv: (id: string | null) => void;

  view: "chat" | "admin";
  setView: (v: "chat" | "admin") => void;

  tagFilter: string | null; // tag_id, or null = all
  setTagFilter: (id: string | null) => void;
  conversationsForTag: Set<string>; // conversation_ids matching current filter
  setConversationsForTag: (ids: Set<string>) => void;
  adminTab: "agents" | "embed" | "maintenance" | "identification" | "tags";
  setAdminTab: (
    t: "agents" | "embed" | "maintenance" | "identification" | "tags",
  ) => void;

  connected: boolean;
  setConnected: (b: boolean) => void;

  outbox: Record<ConvKey, Array<{ client_message_id: string; body: string; attachment_id?: string }>>;
  addToOutbox: (convId: string, item: { client_message_id: string; body: string; attachment_id?: string }) => void;
  removeFromOutbox: (convId: string, clientId: string) => void;
};

export const useStore = create<State>((set) => ({
  me: null,
  setMe: (m) => set({ me: m }),

  conversations: {},
  conversationOrder: [],
  setQueueSnapshot: (convs) =>
    set(() => {
      const dict: Record<ConvKey, Conversation> = {};
      const order: string[] = [];
      for (const c of convs) {
        dict[c.id] = c;
        order.push(c.id);
      }
      order.sort((a, b) =>
        dict[b]!.last_message_at.localeCompare(dict[a]!.last_message_at),
      );
      return { conversations: dict, conversationOrder: order };
    }),
  upsertConversation: (c) =>
    set((s) => {
      const next = { ...s.conversations, [c.id]: c };
      const orderSet = new Set(s.conversationOrder);
      orderSet.add(c.id);
      const order = Array.from(orderSet).sort((a, b) =>
        next[b]!.last_message_at.localeCompare(next[a]!.last_message_at),
      );
      return { conversations: next, conversationOrder: order };
    }),

  messagesByConv: {},
  lastSeenSeqByConv: {},
  upsertMessages: (convId, msgs) =>
    set((s) => {
      const existing = s.messagesByConv[convId] ?? [];
      const bySeq = new Map<number, Message>();
      for (const m of existing) bySeq.set(m.seq, m);
      for (const m of msgs) bySeq.set(m.seq, m);
      const merged = Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
      const maxSeq = merged.at(-1)?.seq ?? s.lastSeenSeqByConv[convId] ?? 0;
      return {
        messagesByConv: { ...s.messagesByConv, [convId]: merged },
        lastSeenSeqByConv: {
          ...s.lastSeenSeqByConv,
          [convId]: Math.max(s.lastSeenSeqByConv[convId] ?? 0, maxSeq),
        },
      };
    }),
  appendMessage: (convId, msg) =>
    set((s) => {
      const existing = s.messagesByConv[convId] ?? [];
      if (existing.some((m) => m.seq === msg.seq)) return s;
      const merged = [...existing, msg].sort((a, b) => a.seq - b.seq);
      return {
        messagesByConv: { ...s.messagesByConv, [convId]: merged },
        lastSeenSeqByConv: {
          ...s.lastSeenSeqByConv,
          [convId]: Math.max(s.lastSeenSeqByConv[convId] ?? 0, msg.seq),
        },
      };
    }),
  setLastSeenSeq: (convId, seq) =>
    set((s) => ({
      lastSeenSeqByConv: {
        ...s.lastSeenSeqByConv,
        [convId]: Math.max(s.lastSeenSeqByConv[convId] ?? 0, seq),
      },
    })),

  typingByConv: {},
  setTyping: (convId, key, name, isTyping) =>
    set((s) => {
      const cur = { ...(s.typingByConv[convId] ?? {}) };
      if (isTyping) cur[key] = { name, until: Date.now() + 6000 };
      else delete cur[key];
      return { typingByConv: { ...s.typingByConv, [convId]: cur } };
    }),

  activeConvId: null,
  setActiveConv: (id) => set({ activeConvId: id }),

  view: "chat",
  setView: (v) => set({ view: v }),

  tagFilter: null,
  setTagFilter: (id) => set({ tagFilter: id }),
  conversationsForTag: new Set<string>(),
  setConversationsForTag: (ids) => set({ conversationsForTag: ids }),
  adminTab: "agents",
  setAdminTab: (t) => set({ adminTab: t }),

  connected: false,
  setConnected: (b) => set({ connected: b }),

  outbox: {},
  addToOutbox: (convId, item) =>
    set((s) => ({
      outbox: {
        ...s.outbox,
        [convId]: [...(s.outbox[convId] ?? []), item],
      },
    })),
  removeFromOutbox: (convId, clientId) =>
    set((s) => ({
      outbox: {
        ...s.outbox,
        [convId]: (s.outbox[convId] ?? []).filter(
          (i) => i.client_message_id !== clientId,
        ),
      },
    })),
}));
