import type { FastifyInstance } from "fastify";
import { getLicenseState } from "./state.js";

/**
 * Routes that remain accessible even when the license is suspended:
 *  - /health — needed by orchestrators / nginx
 *  - /api/license/status — so the dashboard can render a useful banner
 *  - /api/auth/* — agents can still sign in to read past transcripts
 */
const ALLOW_WHEN_SUSPENDED = [
  "/health",
  "/ready",
  "/api/license/status",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/me",
];

export function registerLicenseMiddleware(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0] ?? "";
    if (ALLOW_WHEN_SUSPENDED.some((p) => url === p || url.startsWith(p + "/"))) {
      return;
    }
    const state = getLicenseState();
    if (!state.ok) {
      reply.code(503).send({
        error: "service_suspended",
        message: "Service suspended.",
      });
    }
  });
}

export function registerLicenseStatusRoute(app: FastifyInstance) {
  app.get("/api/license/status", async () => {
    const state = getLicenseState();
    if (state.ok) {
      return {
        ok: true,
        customer_name: state.payload.customer_name,
        expires_at: state.payload.expires_at,
      };
    }
    return {
      ok: false,
      reason: state.reason,
      customer_name: state.payload?.customer_name ?? null,
    };
  });
}
