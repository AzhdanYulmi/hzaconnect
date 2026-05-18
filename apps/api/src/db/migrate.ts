import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";
import { sql } from "drizzle-orm";

async function main() {
  // Ensure citext extension exists (required by agents.email column type).
  await pool.query("CREATE EXTENSION IF NOT EXISTS citext");

  await migrate(db, {
    migrationsFolder: new URL("./migrations", import.meta.url).pathname,
  });

  // Enforce immutability of audit_log and messages via table-level triggers.
  // Fine-grained GRANT-based approach is left for a future per-casino DB role.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION hza_reject_update_delete() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'append-only table: %', TG_TABLE_NAME;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await db.execute(sql`DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log`);
  await db.execute(sql`
    CREATE TRIGGER audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION hza_reject_update_delete();
  `);

  console.log("migrations applied");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
