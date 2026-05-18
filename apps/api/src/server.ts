import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { ZodError } from "zod";
import { config, widgetAllowedOrigins } from "./config.js";
import { verifyAtBoot } from "./license/verify.js";
import { startHeartbeat } from "./license/heartbeat.js";
import {
  registerLicenseMiddleware,
  registerLicenseStatusRoute,
} from "./license/middleware.js";
import { authRoutes } from "./routes/auth.js";
import { widgetSessionRoutes } from "./routes/widget-session.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { verifyAgentAccess, verifyWidgetSession } from "./auth/tokens.js";
import { db } from "./db/client.js";
import { agents, sessions } from "./db/schema.js";
import { eq } from "drizzle-orm";
import type { Actor } from "./auth/can.js";
import { createIoServer } from "./realtime/io.js";
import { ensureBucket } from "./storage.js";
import { redis } from "./redis.js";

declare module "fastify" {
  interface FastifyInstance {
    requireAgent(
      req: FastifyRequest,
      reply: FastifyReply,
    ): Promise<Extract<Actor, { kind: "agent" }> | null>;
    resolveActor(req: FastifyRequest): Promise<Actor | null>;
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.API_LOG_LEVEL,
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty" }
          : undefined,
    },
    trustProxy: true,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (widgetAllowedOrigins === "*") return cb(null, true);
      if (widgetAllowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    redis,
    keyGenerator: (req) => `${req.ip}:${req.routeOptions.url ?? ""}`,
  });

  app.decorate(
    "requireAgent",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const h = req.headers.authorization;
      if (!h?.startsWith("Bearer ")) {
        reply.code(401).send({ error: "no_token" });
        return null;
      }
      try {
        const claims = await verifyAgentAccess(h.slice(7));
        const agent = await db.query.agents.findFirst({
          where: eq(agents.id, claims.sub),
        });
        if (!agent || agent.status !== "active") {
          reply.code(401).send({ error: "inactive" });
          return null;
        }
        return { kind: "agent" as const, id: agent.id, role: agent.role };
      } catch {
        reply.code(401).send({ error: "invalid_token" });
        return null;
      }
    },
  );

  app.decorate("resolveActor", async (req: FastifyRequest): Promise<Actor | null> => {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) return null;
    const token = h.slice(7);
    try {
      const ac = await verifyAgentAccess(token);
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, ac.sub),
      });
      if (!agent || agent.status !== "active") return null;
      return { kind: "agent", id: agent.id, role: agent.role };
    } catch {
      // not agent, try widget
    }
    try {
      const wc = await verifyWidgetSession(token);
      const s = await db.query.sessions.findFirst({ where: eq(sessions.id, wc.sub) });
      if (!s) return null;
      return { kind: "session", id: s.id };
    } catch {
      return null;
    }
  });

  // Dev convenience: serve the widget bundle and fixture host page from the
  // API itself when the build outputs exist on disk. In production these are
  // served by nginx, so this is a no-op there.
  if (config.NODE_ENV === "development") {
    const __filename = fileURLToPath(import.meta.url);
    // server.ts lives at apps/api/src/server.ts → repo root is three levels up.
    const repoRoot = path.resolve(path.dirname(__filename), "../../..");
    const widgetDist = path.join(repoRoot, "apps/widget/dist");
    const fixtures = path.join(repoRoot, "fixtures");
    app.log.info({ widgetDist, fixtures }, "dev static roots");

    if (existsSync(widgetDist)) {
      // Decorate reply once with `sendFile`, scoped to the widget dist dir.
      // In dev we always serve the freshest build — disable fastify-static's
      // own Cache-Control so we can force no-store ourselves.
      await app.register(fastifyStatic, {
        root: widgetDist,
        prefix: "/__widget_assets__/", // unused; we use sendFile manually
        cacheControl: false,
        setHeaders: (res) => {
          res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
        },
      });
      app.get("/widget.js", async (_req, reply) => reply.sendFile("widget.js"));
      app.get("/widget/frame.html", async (_req, reply) =>
        reply.sendFile("frame.html"),
      );
      app.get<{ Params: { "*": string } }>(
        "/widget/*",
        async (req, reply) => reply.sendFile(`widget/${req.params["*"]}`),
      );
    }
    if (existsSync(path.join(fixtures, "host.html"))) {
      const { readFile } = await import("node:fs/promises");
      app.get("/dev/host.html", async (_req, reply) => {
        const html = await readFile(path.join(fixtures, "host.html"), "utf8");
        return reply.type("text/html").send(html);
      });
    }
  }

  // Licensing must run before any business route so suspended deployments
  // return 503 immediately. /health, /api/license/status, and /api/auth/*
  // are explicitly allowed through (see middleware).
  registerLicenseMiddleware(app);
  registerLicenseStatusRoute(app);

  app.get("/health", async () => ({ ok: true }));
  app.get("/ready", async () => {
    // Light DB check
    await db.execute({ sql: "SELECT 1", args: [] } as any).catch(() => {});
    return { ok: true };
  });

  // Map Zod validation failures to 400 responses (default would be 500).
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.code(400).send({
        error: "validation_failed",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }
    reply.send(err);
  });

  await app.register(authRoutes);
  await app.register(widgetSessionRoutes);
  await app.register(attachmentRoutes);
  const { adminRoutes } = await import("./routes/admin.js");
  await app.register(adminRoutes);
  const { identifierRoutes } = await import("./routes/identifiers.js");
  await app.register(identifierRoutes);
  const { tagRoutes } = await import("./routes/tags.js");
  await app.register(tagRoutes);

  return app;
}

export async function start() {
  const app = await buildServer();
  const io = createIoServer(app);

  // Verify license token before serving traffic. We do not exit on failure —
  // the API stays up so the dashboard can fetch /api/license/status and
  // render the suspended banner. All business routes return 503 via the
  // license middleware until the state turns ok:true.
  verifyAtBoot(app.log);

  // Begin periodic heartbeats (no-op when LICENSE_ENFORCEMENT=disabled).
  // Register onClose *before* listen — Fastify forbids hook registration
  // once the server is listening.
  const hb = startHeartbeat({ logger: app.log });
  app.addHook("onClose", async () => hb.stop());

  // Attach Socket.IO to the underlying HTTP server after Fastify listens.
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  io.attach(app.server, { path: "/ws" });
  app.log.info({ port: config.API_PORT }, "api listening");

  await ensureBucket().catch((e) =>
    app.log.warn({ err: e }, "MinIO bucket ensure failed; will retry lazily"),
  );

  return { app, io };
}
