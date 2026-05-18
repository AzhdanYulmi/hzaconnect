import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";

const dbDir = path.dirname(config.DB_PATH);
fs.mkdirSync(dbDir, { recursive: true });

export const db = new Database(config.DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_email TEXT,
    notes TEXT,
    suspended_at INTEGER,
    suspended_reason TEXT,
    last_heartbeat_at INTEGER,
    last_heartbeat_ip TEXT,
    last_heartbeat_origin TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    notes TEXT
  );

  CREATE INDEX IF NOT EXISTS licenses_customer_idx ON licenses(customer_id);
`);

export type CustomerRow = {
  id: string;
  name: string;
  contact_email: string | null;
  notes: string | null;
  suspended_at: number | null;
  suspended_reason: string | null;
  last_heartbeat_at: number | null;
  last_heartbeat_ip: string | null;
  last_heartbeat_origin: string | null;
  created_at: number;
};

export type LicenseRow = {
  id: string;
  customer_id: string;
  issued_at: number;
  expires_at: number;
  revoked_at: number | null;
  notes: string | null;
};
