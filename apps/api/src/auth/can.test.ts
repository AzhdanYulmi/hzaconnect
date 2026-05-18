import { describe, expect, it } from "vitest";
import { canConversation, type Actor } from "./can.js";

const convBase = {
  sessionId: "s1",
  assignedAgentId: null as string | null,
  status: "open" as "open" | "assigned" | "closed",
};

const agent: Actor = { kind: "agent", id: "a1", role: "agent" };
const otherAgent: Actor = { kind: "agent", id: "a2", role: "agent" };
const supervisor: Actor = { kind: "agent", id: "sup", role: "supervisor" };
const admin: Actor = { kind: "agent", id: "adm", role: "admin" };
const session: Actor = { kind: "session", id: "s1" };
const otherSession: Actor = { kind: "session", id: "s2" };

describe("canConversation", () => {
  it("session can read/send only own conversation", () => {
    expect(canConversation(session, "read", convBase)).toBe(true);
    expect(canConversation(session, "send", convBase)).toBe(true);
    expect(canConversation(otherSession, "read", convBase)).toBe(false);
    expect(canConversation(session, "claim", convBase)).toBe(false);
    expect(canConversation(session, "close", convBase)).toBe(false);
  });

  it("agent can claim open conversations", () => {
    expect(canConversation(agent, "claim", convBase)).toBe(true);
    expect(
      canConversation(agent, "claim", { ...convBase, status: "closed" }),
    ).toBe(false);
  });

  it("agent can read open queue items", () => {
    expect(canConversation(agent, "read", convBase)).toBe(true);
  });

  it("agent can send only on their own assigned conversations", () => {
    const mine = { ...convBase, status: "assigned" as const, assignedAgentId: "a1" };
    const theirs = { ...convBase, status: "assigned" as const, assignedAgentId: "a2" };
    expect(canConversation(agent, "send", mine)).toBe(true);
    expect(canConversation(agent, "send", theirs)).toBe(false);
    expect(canConversation(otherAgent, "send", mine)).toBe(false);
  });

  it("supervisor observes/read any but only sends on assigned", () => {
    const theirs = { ...convBase, status: "assigned" as const, assignedAgentId: "a2" };
    expect(canConversation(supervisor, "observe", theirs)).toBe(true);
    expect(canConversation(supervisor, "read", theirs)).toBe(true);
    expect(canConversation(supervisor, "send", theirs)).toBe(false);
    const own = { ...theirs, assignedAgentId: "sup" };
    expect(canConversation(supervisor, "send", own)).toBe(true);
  });

  it("admin has same behavior as supervisor for conversation ops", () => {
    const theirs = { ...convBase, status: "assigned" as const, assignedAgentId: "a2" };
    expect(canConversation(admin, "observe", theirs)).toBe(true);
    expect(canConversation(admin, "send", theirs)).toBe(false);
  });
});
