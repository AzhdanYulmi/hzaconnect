import "dotenv/config";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(4400),
    HOST: z.string().default("0.0.0.0"),
    DB_PATH: z.string().default("./data/license-server.db"),
    ADMIN_USERNAME: z.string().default("admin"),
    ADMIN_PASSWORD: z.string().min(8).default("change-me-in-production"),
    /**
     * Path to your Ed25519 private key (PEM, PKCS8). The server signs
     * issued license tokens with this key.
     */
    LICENSE_PRIVATE_KEY_PATH: z.string().optional(),
    /**
     * Path to the matching public key. Sent to the casino's deployment so
     * its API can verify license tokens.
     */
    LICENSE_PUBLIC_KEY_PATH: z.string().optional(),
    /** Default expiry for newly-issued licenses, in days. */
    DEFAULT_LICENSE_DAYS: z.coerce.number().default(30),
    /** Cookie secret for the admin session. */
    COOKIE_SECRET: z
      .string()
      .min(16)
      .default("change-me-cookie-secret-please"),
  })
  .parse(process.env);

// Resolve from this file (apps/license-server/src/config.ts) up to repo root.
const repoRoot = path.resolve(new URL("../../..", import.meta.url).pathname);

export function loadKeys(): { privatePem: string; publicPem: string } {
  // Resolve key paths: explicit env var takes precedence; otherwise fall back
  // to the test keys committed to the repo (NODE_ENV !== production only).
  const candidatePriv =
    env.LICENSE_PRIVATE_KEY_PATH ??
    (env.NODE_ENV === "production"
      ? null
      : path.join(repoRoot, "packages/license/test-keys/private.pem"));
  const candidatePub =
    env.LICENSE_PUBLIC_KEY_PATH ??
    (env.NODE_ENV === "production"
      ? null
      : path.join(repoRoot, "packages/license/test-keys/public.pem"));
  if (!candidatePriv || !candidatePub) {
    throw new Error(
      "LICENSE_PRIVATE_KEY_PATH and LICENSE_PUBLIC_KEY_PATH must be set in production",
    );
  }
  return {
    privatePem: fs.readFileSync(candidatePriv, "utf8"),
    publicPem: fs.readFileSync(candidatePub, "utf8"),
  };
}

export const config = env;
