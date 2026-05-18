import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";

const enc = new TextEncoder();
const agentKey = enc.encode(config.AUTH_JWT_SECRET);
const widgetKey = enc.encode(config.WIDGET_JWT_SECRET);

export type AgentAccessClaims = {
  sub: string;
  role: "agent" | "supervisor" | "admin";
  typ: "agent";
};
export type WidgetSessionClaims = {
  sub: string; // session_id
  typ: "anon" | "sso";
  euid?: string;
};

const AGENT_ACCESS_TTL = 60 * 15; // 15m
const WIDGET_TOKEN_TTL = 60 * 60 * 24; // 24h

export async function signAgentAccess(claims: AgentAccessClaims): Promise<string> {
  return await new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${AGENT_ACCESS_TTL}s`)
    .sign(agentKey);
}

export async function verifyAgentAccess(token: string): Promise<AgentAccessClaims> {
  const { payload } = await jwtVerify(token, agentKey);
  if (payload.typ !== "agent") throw new Error("wrong_token_type");
  return payload as unknown as AgentAccessClaims;
}

export async function signWidgetSession(claims: WidgetSessionClaims): Promise<string> {
  return await new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${WIDGET_TOKEN_TTL}s`)
    .sign(widgetKey);
}

export async function verifyWidgetSession(token: string): Promise<WidgetSessionClaims> {
  const { payload } = await jwtVerify(token, widgetKey);
  if (payload.typ !== "anon" && payload.typ !== "sso") throw new Error("wrong_token_type");
  return payload as unknown as WidgetSessionClaims;
}
