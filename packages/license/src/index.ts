/**
 * Ed25519 license-token signing and verification.
 *
 * Uses Node's built-in `crypto` (no external deps). License tokens are a
 * simple `<base64url(payload)>.<base64url(signature)>` pair (JWT-like but
 * with a fixed Ed25519 algorithm and no header — we don't need the algorithm
 * to be configurable and locking it in source prevents algorithm-confusion
 * downgrade attacks).
 */

import {
  generateKeyPairSync,
  sign,
  verify,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from "node:crypto";

export type LicensePayload = {
  /** Stable customer identifier (UUID). */
  customer_id: string;
  /** Friendly customer name; informational only. */
  customer_name: string;
  /** Stable license identifier — used by the server to revoke a single license without affecting the customer. */
  license_id: string;
  /** Unix seconds when the license was issued. */
  issued_at: number;
  /** Unix seconds when the license expires (hard cap; even the heartbeat says "ok", an expired token won't activate). */
  expires_at: number;
};

const b64uEncode = (b: Buffer): string =>
  b.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const b64uDecode = (s: string): Buffer => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replaceAll("-", "+").replaceAll("_", "/") + pad, "base64");
};

export function generateKeyPair(): { publicPem: string; privatePem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    privatePem: privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
  };
}

export function loadPublicKey(pem: string): KeyObject {
  return createPublicKey({ key: pem, format: "pem", type: "spki" });
}
export function loadPrivateKey(pem: string): KeyObject {
  return createPrivateKey({ key: pem, format: "pem", type: "pkcs8" });
}

export function signLicense(
  payload: LicensePayload,
  privateKey: KeyObject,
): string {
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = sign(null, json, privateKey);
  return `${b64uEncode(json)}.${b64uEncode(sig)}`;
}

export class LicenseInvalidError extends Error {
  constructor(public reason: string) {
    super(`license invalid: ${reason}`);
  }
}

export function verifyLicense(token: string, publicKey: KeyObject): LicensePayload {
  if (!token || !token.includes(".")) {
    throw new LicenseInvalidError("malformed_token");
  }
  const [payloadB64, sigB64, ...rest] = token.split(".");
  if (!payloadB64 || !sigB64 || rest.length > 0) {
    throw new LicenseInvalidError("malformed_token");
  }
  let payloadBuf: Buffer;
  let sigBuf: Buffer;
  try {
    payloadBuf = b64uDecode(payloadB64);
    sigBuf = b64uDecode(sigB64);
  } catch {
    throw new LicenseInvalidError("base64_decode_failed");
  }
  let ok = false;
  try {
    ok = verify(null, payloadBuf, publicKey, sigBuf);
  } catch {
    throw new LicenseInvalidError("signature_verify_threw");
  }
  if (!ok) throw new LicenseInvalidError("signature_invalid");

  let payload: LicensePayload;
  try {
    payload = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    throw new LicenseInvalidError("payload_not_json");
  }
  if (
    typeof payload.customer_id !== "string" ||
    typeof payload.customer_name !== "string" ||
    typeof payload.license_id !== "string" ||
    typeof payload.issued_at !== "number" ||
    typeof payload.expires_at !== "number"
  ) {
    throw new LicenseInvalidError("payload_shape");
  }
  if (payload.expires_at < Math.floor(Date.now() / 1000)) {
    throw new LicenseInvalidError("expired");
  }
  return payload;
}
