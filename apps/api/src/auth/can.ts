import type { AgentRole } from "@hzaconnect/shared";
import type { ConversationRow } from "../db/schema.js";

export type AgentActor = {
  kind: "agent";
  id: string;
  role: AgentRole;
};
export type SessionActor = {
  kind: "session";
  id: string;
};
export type Actor = AgentActor | SessionActor;

export type ConversationAction =
  | "read"
  | "send"
  | "claim"
  | "close"
  | "observe";

export function canConversation(
  actor: Actor,
  action: ConversationAction,
  conversation: Pick<
    ConversationRow,
    "sessionId" | "assignedAgentId" | "status"
  >,
): boolean {
  if (actor.kind === "session") {
    if (conversation.sessionId !== actor.id) return false;
    return action === "read" || action === "send";
  }
  // Agent actor
  if (actor.role === "supervisor" || actor.role === "admin") {
    // Supervisors: full read/observe. May only send/claim/close on their own.
    if (action === "read" || action === "observe") return true;
    if (action === "claim") return conversation.status === "open";
    if (action === "send" || action === "close") {
      return conversation.assignedAgentId === actor.id;
    }
  }
  if (actor.role === "agent") {
    if (action === "observe") return false;
    if (action === "claim") return conversation.status === "open";
    // Any assigned conversation they own
    if (conversation.assignedAgentId === actor.id) return true;
    // Or read any open queue item (so they can click in before claim)
    if (action === "read" && conversation.status === "open") return true;
    return false;
  }
  return false;
}

export function canClaim(actor: Actor): actor is AgentActor {
  return (
    actor.kind === "agent" &&
    (actor.role === "agent" ||
      actor.role === "supervisor" ||
      actor.role === "admin")
  );
}
