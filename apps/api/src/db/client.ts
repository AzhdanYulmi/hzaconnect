import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { config } from "../config.js";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
