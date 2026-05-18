import "dotenv/config";
import { db, pool } from "./client.js";
import { agents, deploymentSettings } from "./schema.js";
import { hashPassword } from "../auth/passwords.js";
import { eq } from "drizzle-orm";

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME ?? "Admin";

  if (!email || !password) {
    console.error("BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD must be set");
    process.exit(1);
  }

  const existing = await db.query.agents.findFirst({
    where: eq(agents.email, email),
  });
  if (existing) {
    console.log(`admin already exists: ${email}`);
    await pool.end();
    return;
  }
  const hash = await hashPassword(password);
  await db.insert(agents).values({
    email,
    passwordHash: hash,
    displayName: name,
    role: "admin",
  });
  console.log(`seeded admin: ${email}`);

  // Idempotent default deployment settings: player_id + email, both optional.
  const settingsExists = await db.query.deploymentSettings.findFirst({
    where: eq(deploymentSettings.id, 1),
  });
  if (!settingsExists) {
    // Default: no fields — purely anonymous, no pre-chat card. Casino admins
    // turn identification on via Admin → Identification when they want it.
    await db.insert(deploymentSettings).values({
      id: 1,
      identifierFields: [],
      requireBeforeChat: "false",
    });
    console.log("seeded default deployment_settings");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
