/**
 * Maintenance CLI. Designed to be run from cron or one-off:
 *   node apps/api/dist/maintenance-cli.js close-stale --hours 24
 *   node apps/api/dist/maintenance-cli.js prune-sessions --days 30
 */
import { closeStaleConversations, pruneOrphanSessions } from "./maintenance.js";
import { pool } from "./db/client.js";

function parseArg(argv: string[], name: string, fallback: number): number {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v)) {
    throw new Error(`--${name} must be a number`);
  }
  return v;
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case "close-stale": {
      const hours = parseArg(rest, "hours", 24);
      const result = await closeStaleConversations({ olderThanHours: hours });
      console.log(JSON.stringify({ cmd, hours, ...result }));
      break;
    }
    case "prune-sessions": {
      const days = parseArg(rest, "days", 30);
      const result = await pruneOrphanSessions({ olderThanDays: days });
      console.log(JSON.stringify({ cmd, days, ...result }));
      break;
    }
    default:
      console.error(
        "usage:\n  maintenance-cli close-stale [--hours 24]\n  maintenance-cli prune-sessions [--days 30]",
      );
      process.exit(2);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
