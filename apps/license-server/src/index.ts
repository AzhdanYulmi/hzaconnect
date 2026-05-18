import Fastify from "fastify";
import basicAuth from "@fastify/basic-auth";
import formbody from "@fastify/formbody";
import { z } from "zod";
import { config, loadKeys } from "./config.js";
import {
  createCustomer,
  evaluateHeartbeat,
  getCustomer,
  issueLicense,
  listCustomers,
  publicKeyPem,
  recordHeartbeat,
  revokeLicense,
  setCustomerSuspended,
} from "./store.js";
import { db } from "./db.js";
import { customerPage, indexPage } from "./admin-html.js";

const app = Fastify({
  logger: {
    level: "info",
    transport:
      config.NODE_ENV === "development"
        ? { target: "pino-pretty" }
        : undefined,
  },
  trustProxy: true,
});

await app.register(formbody);
await app.register(basicAuth, {
  authenticate: { realm: "hzaconnect-licenses" },
  validate: async (username, password) => {
    if (
      username !== config.ADMIN_USERNAME ||
      password !== config.ADMIN_PASSWORD
    ) {
      throw new Error("invalid_credentials");
    }
  },
});

// Public health.
app.get("/health", async () => ({ ok: true }));

// Public: server's public key (so casino ops can verify they have the right one).
app.get("/public-key", async (_req, reply) => {
  reply.type("text/plain").send(publicKeyPem);
});

// ---- Heartbeat (public; authenticated by signed token possession) ----
app.post("/heartbeat", async (req, reply) => {
  const body = z
    .object({
      license_id: z.string(),
      customer_id: z.string(),
      origin: z.string().optional(),
    })
    .safeParse(req.body);
  if (!body.success) {
    return reply.code(400).send({ error: "bad_request" });
  }

  const { license_id, customer_id } = body.data;
  const evaluation = evaluateHeartbeat(license_id);

  // Only update last_heartbeat for known customers — protects against fake IDs.
  if (
    evaluation.status === "ok" ||
    evaluation.status === "suspended" ||
    evaluation.status === "expired" ||
    evaluation.status === "revoked"
  ) {
    if (getCustomer(customer_id)) {
      recordHeartbeat({
        customerId: customer_id,
        ip: req.ip,
        origin: body.data.origin ?? null,
      });
    }
  }

  const message = (() => {
    switch (evaluation.status) {
      case "ok":
        return null;
      case "suspended":
        return "Service suspended.";
      case "expired":
        return "Service suspended.";
      case "revoked":
        return "Service suspended.";
      case "unknown_license":
        return "Service suspended.";
    }
  })();
  return { status: evaluation.status, message };
});

// ---- Admin UI ----

const requireAdmin = { onRequest: app.basicAuth };

app.get("/", async (_req, reply) => {
  reply.redirect("/admin");
});

app.get("/admin", requireAdmin, async (req, reply) => {
  const flash =
    typeof req.query === "object" && req.query !== null
      ? (req.query as Record<string, string>).flash
      : undefined;
  const rows = listCustomers();
  reply.type("text/html").send(indexPage({ rows, flash: flash ?? null }));
});

app.post("/admin/customers", requireAdmin, async (req, reply) => {
  const body = z
    .object({
      name: z.string().min(1).max(120),
      contact_email: z.string().optional(),
      notes: z.string().optional(),
      duration_days: z.coerce.number().int().min(1).max(3650).default(30),
    })
    .parse(req.body);
  const customer = createCustomer({
    name: body.name,
    contact_email: body.contact_email || undefined,
    notes: body.notes || undefined,
  });
  const issued = issueLicense({
    customer,
    durationDays: body.duration_days,
    notes: "initial",
  });
  const licenses = db
    .prepare("SELECT * FROM licenses WHERE customer_id = ? ORDER BY issued_at DESC")
    .all(customer.id) as any[];
  reply
    .type("text/html")
    .send(
      customerPage({
        customer,
        licenses,
        newToken: issued.token,
        flash: "Customer created and license issued.",
      }),
    );
});

app.get<{ Params: { id: string } }>(
  "/admin/customers/:id",
  requireAdmin,
  async (req, reply) => {
    const customer = getCustomer(req.params.id);
    if (!customer) return reply.code(404).send("not found");
    const licenses = db
      .prepare("SELECT * FROM licenses WHERE customer_id = ? ORDER BY issued_at DESC")
      .all(req.params.id) as any[];
    reply.type("text/html").send(customerPage({ customer, licenses }));
  },
);

app.post<{ Params: { id: string } }>(
  "/admin/customers/:id/suspend",
  requireAdmin,
  async (req, reply) => {
    setCustomerSuspended(req.params.id, true, "manual");
    reply.redirect(`/admin/customers/${req.params.id}`);
  },
);

app.post<{ Params: { id: string } }>(
  "/admin/customers/:id/resume",
  requireAdmin,
  async (req, reply) => {
    setCustomerSuspended(req.params.id, false);
    reply.redirect(`/admin/customers/${req.params.id}`);
  },
);

app.post<{ Params: { id: string } }>(
  "/admin/customers/:id/licenses",
  requireAdmin,
  async (req, reply) => {
    const customer = getCustomer(req.params.id);
    if (!customer) return reply.code(404).send("not found");
    const body = z
      .object({
        duration_days: z.coerce.number().int().min(1).max(3650).default(30),
      })
      .parse(req.body);
    const issued = issueLicense({
      customer,
      durationDays: body.duration_days,
      notes: "renewal",
    });
    const licenses = db
      .prepare("SELECT * FROM licenses WHERE customer_id = ? ORDER BY issued_at DESC")
      .all(customer.id) as any[];
    reply
      .type("text/html")
      .send(
        customerPage({
          customer,
          licenses,
          newToken: issued.token,
          flash: "New license issued.",
        }),
      );
  },
);

app.post<{ Params: { id: string; licId: string } }>(
  "/admin/customers/:id/licenses/:licId/revoke",
  requireAdmin,
  async (req, reply) => {
    revokeLicense(req.params.licId);
    reply.redirect(`/admin/customers/${req.params.id}`);
  },
);

const start = async () => {
  // Touch the keys at boot so we fail fast if they're missing.
  loadKeys();
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info({ port: config.PORT }, "license server listening");
};

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
