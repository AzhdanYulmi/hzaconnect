import crypto from "node:crypto";
import {
  loadPrivateKey,
  loadPublicKey,
  signLicense,
  type LicensePayload,
} from "@hzaconnect/license";
import { db, type CustomerRow, type LicenseRow } from "./db.js";
import { config, loadKeys } from "./config.js";

const keys = loadKeys();
export const privateKey = loadPrivateKey(keys.privatePem);
export const publicKey = loadPublicKey(keys.publicPem);
export const publicKeyPem = keys.publicPem;

export function listCustomers(): Array<CustomerRow & { latest_license: LicenseRow | null }> {
  const customers = db
    .prepare("SELECT * FROM customers ORDER BY created_at DESC")
    .all() as CustomerRow[];
  const stmt = db.prepare(
    "SELECT * FROM licenses WHERE customer_id = ? ORDER BY issued_at DESC LIMIT 1",
  );
  return customers.map((c) => ({
    ...c,
    latest_license: (stmt.get(c.id) as LicenseRow | undefined) ?? null,
  }));
}

export function getCustomer(id: string): CustomerRow | null {
  return (db
    .prepare("SELECT * FROM customers WHERE id = ?")
    .get(id) as CustomerRow | undefined) ?? null;
}

export function getLicense(id: string): LicenseRow | null {
  return (db
    .prepare("SELECT * FROM licenses WHERE id = ?")
    .get(id) as LicenseRow | undefined) ?? null;
}

export function createCustomer(input: {
  name: string;
  contact_email?: string;
  notes?: string;
}): CustomerRow {
  const id = "cus_" + crypto.randomBytes(8).toString("hex");
  db.prepare(
    `INSERT INTO customers (id, name, contact_email, notes, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.name, input.contact_email ?? null, input.notes ?? null, Date.now());
  return getCustomer(id)!;
}

export function setCustomerSuspended(
  id: string,
  suspended: boolean,
  reason?: string,
): CustomerRow | null {
  if (suspended) {
    db.prepare(
      `UPDATE customers
       SET suspended_at = ?, suspended_reason = ?
       WHERE id = ?`,
    ).run(Date.now(), reason ?? "manual", id);
  } else {
    db.prepare(
      `UPDATE customers SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?`,
    ).run(id);
  }
  return getCustomer(id);
}

export function recordHeartbeat(opts: {
  customerId: string;
  ip: string;
  origin: string | null;
}): void {
  db.prepare(
    `UPDATE customers
     SET last_heartbeat_at = ?, last_heartbeat_ip = ?, last_heartbeat_origin = ?
     WHERE id = ?`,
  ).run(Date.now(), opts.ip, opts.origin, opts.customerId);
}

/**
 * Mint a new license for an existing customer. Returns the signed token plus
 * the license row metadata.
 */
export function issueLicense(opts: {
  customer: CustomerRow;
  durationDays?: number;
  notes?: string;
}): { token: string; license: LicenseRow; payload: LicensePayload } {
  const days = opts.durationDays ?? config.DEFAULT_LICENSE_DAYS;
  const id = "lic_" + crypto.randomBytes(8).toString("hex");
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + days * 86400;
  db.prepare(
    `INSERT INTO licenses (id, customer_id, issued_at, expires_at, notes)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, opts.customer.id, issuedAt, expiresAt, opts.notes ?? null);
  const payload: LicensePayload = {
    customer_id: opts.customer.id,
    customer_name: opts.customer.name,
    license_id: id,
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
  const token = signLicense(payload, privateKey);
  return {
    token,
    license: db
      .prepare("SELECT * FROM licenses WHERE id = ?")
      .get(id) as LicenseRow,
    payload,
  };
}

export function revokeLicense(id: string): void {
  db.prepare(`UPDATE licenses SET revoked_at = ? WHERE id = ?`).run(Date.now(), id);
}

export type HeartbeatStatus =
  | { status: "ok"; expires_at: number }
  | { status: "suspended"; reason: string }
  | { status: "revoked" }
  | { status: "expired" }
  | { status: "unknown_license" };

export function evaluateHeartbeat(licenseId: string): HeartbeatStatus {
  const lic = getLicense(licenseId);
  if (!lic) return { status: "unknown_license" };
  if (lic.revoked_at) return { status: "revoked" };
  if (lic.expires_at < Math.floor(Date.now() / 1000))
    return { status: "expired" };
  const cust = getCustomer(lic.customer_id);
  if (!cust) return { status: "unknown_license" };
  if (cust.suspended_at)
    return { status: "suspended", reason: cust.suspended_reason ?? "manual" };
  return { status: "ok", expires_at: lic.expires_at };
}
