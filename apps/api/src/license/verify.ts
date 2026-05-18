import fs from "node:fs";
import path from "node:path";
import {
  loadPublicKey,
  verifyLicense,
  LicenseInvalidError,
  type LicensePayload,
} from "@hzaconnect/license";
import { config } from "../config.js";
import { setLicenseState, type LicenseState } from "./state.js";

function resolvePublicKey(): string {
  // 1. File path (most robust — sidesteps .env multi-line/CRLF issues).
  if (config.LICENSE_PUBLIC_KEY_PATH) {
    return fs
      .readFileSync(config.LICENSE_PUBLIC_KEY_PATH, "utf8")
      // Strip CR characters in case the file was saved with CRLF line endings.
      .replace(/\r/g, "");
  }
  // 2. Inline PEM via env var. Common Windows/.env pitfalls we defuse here:
  //    - \r in line endings (CRLF saved files)
  //    - literal wrapping " or ' that some docker-compose versions don't strip
  //      out of multi-line .env values
  //    - leading/trailing whitespace
  if (config.LICENSE_PUBLIC_KEY_PEM) {
    return config.LICENSE_PUBLIC_KEY_PEM
      .replace(/\r/g, "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
  }
  if (config.NODE_ENV === "production") {
    throw new Error(
      "LICENSE_PUBLIC_KEY_PEM or LICENSE_PUBLIC_KEY_PATH is required in production",
    );
  }
  // Dev fallback: the committed test public key. verify.ts is at
  // apps/api/src/license/verify.ts — repo root is 4 levels up.
  const __filename = new URL(import.meta.url).pathname;
  const repoRoot = path.resolve(path.dirname(__filename), "../../../..");
  const fallback = path.join(
    repoRoot,
    "packages/license/test-keys/public.pem",
  );
  return fs.readFileSync(fallback, "utf8").replace(/\r/g, "");
}

/**
 * Run at server boot. Returns the parsed payload on success, sets the
 * shared license state, and *does not throw* in production-bypass mode.
 *
 * On verification failure: state goes to ok:false, the API will then enter
 * suspended mode (see middleware).
 */
export function verifyAtBoot(logger?: { info?: any; warn?: any; error?: any }):
  | LicensePayload
  | null {
  if (config.LICENSE_ENFORCEMENT === "disabled") {
    logger?.warn?.(
      "LICENSE_ENFORCEMENT is disabled — running without license check",
    );
    setLicenseState({
      ok: true,
      payload: {
        customer_id: "dev",
        customer_name: "Local development",
        license_id: "dev",
        issued_at: 0,
        expires_at: 9_999_999_999,
      },
      lastCheckOk: Date.now(),
      reason: "enforcement_disabled",
    });
    return null;
  }

  if (!config.LICENSE_TOKEN) {
    setLicenseState({ ok: false, reason: "no_token" });
    logger?.error?.("LICENSE_TOKEN is not set; API will refuse all requests");
    return null;
  }

  let pem: string;
  try {
    pem = resolvePublicKey();
  } catch (err) {
    setLicenseState({ ok: false, reason: "no_public_key" });
    logger?.error?.({ err }, "license public key not configured");
    return null;
  }
  let publicKey;
  try {
    publicKey = loadPublicKey(pem);
  } catch (err) {
    setLicenseState({ ok: false, reason: "bad_public_key" });
    logger?.error?.({ err }, "license public key failed to parse");
    return null;
  }

  try {
    const payload = verifyLicense(config.LICENSE_TOKEN, publicKey);
    const next: LicenseState = {
      ok: true,
      payload,
      lastCheckOk: Date.now(),
    };
    setLicenseState(next);
    logger?.info?.(
      { customer: payload.customer_name, expires_at: payload.expires_at },
      "license verified",
    );
    return payload;
  } catch (err) {
    if (err instanceof LicenseInvalidError) {
      setLicenseState({ ok: false, reason: err.reason });
      logger?.error?.({ reason: err.reason }, "license invalid");
    } else {
      setLicenseState({ ok: false, reason: "verify_threw" });
      logger?.error?.({ err }, "license verification threw");
    }
    return null;
  }
}
