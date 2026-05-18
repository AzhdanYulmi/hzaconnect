import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";

// Load env from repo root regardless of CWD (so `pnpm --filter ... db:migrate`
// from anywhere works the same).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadEnv(); // also try CWD as fallback (no-ops if absent)

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().default(3000),
  API_HOST: z.string().default("0.0.0.0"),
  API_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  S3_ENDPOINT: z.string().url(),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .union([z.boolean(), z.string()])
    .default(true)
    .transform((v) => (typeof v === "string" ? v === "true" : v)),

  AUTH_JWT_SECRET: z.string().min(32),
  WIDGET_JWT_SECRET: z.string().min(32),

  PUBLIC_ORIGIN: z.string().url(),
  WIDGET_ALLOWED_ORIGINS: z.string().default("*"),
  COOKIE_DOMAIN: z.string().default(""),

  // --- Licensing ---
  /**
   * Master switch. Set to "disabled" only for local dev where you don't want
   * to set up a license server. Production must run with "enabled".
   */
  LICENSE_ENFORCEMENT: z.enum(["enabled", "disabled"]).default("enabled"),
  /** Signed license token. Required when LICENSE_ENFORCEMENT=enabled. */
  LICENSE_TOKEN: z.string().optional(),
  /**
   * Public key (PEM) used to verify license tokens. Falls back to the test
   * key in non-production environments.
   *
   * For multi-line PEM strings that don't survive .env parsing reliably,
   * use LICENSE_PUBLIC_KEY_PATH instead — point it at a mounted file.
   */
  LICENSE_PUBLIC_KEY_PEM: z.string().optional(),
  LICENSE_PUBLIC_KEY_PATH: z.string().optional(),
  /** URL of the license server's `/heartbeat` endpoint. */
  LICENSE_SERVER_URL: z
    .string()
    .url()
    .default("http://localhost:4400"),
  /** Heartbeat interval in seconds. */
  LICENSE_HEARTBEAT_SECONDS: z.coerce.number().int().min(30).default(1800),
  /** How long a heartbeat outage is tolerated before the API hard-blocks (seconds). */
  LICENSE_HEARTBEAT_GRACE_SECONDS: z.coerce.number().int().min(60).default(86400),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment config:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

export const widgetAllowedOrigins =
  config.WIDGET_ALLOWED_ORIGINS === "*"
    ? "*"
    : config.WIDGET_ALLOWED_ORIGINS.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
