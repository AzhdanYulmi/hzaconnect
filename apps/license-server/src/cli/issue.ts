/**
 * CLI: issue a license without the admin UI.
 *
 *   pnpm --filter @hzaconnect/license-server issue --name "Acme Casino" --days 30
 *
 * Optionally bind to an existing customer:
 *   pnpm --filter @hzaconnect/license-server issue --customer cus_xxx --days 30
 */
import {
  createCustomer,
  getCustomer,
  issueLicense,
  listCustomers,
} from "../store.js";

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

async function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case "list": {
      const rows = listCustomers();
      for (const r of rows) {
        const status = r.suspended_at ? "suspended" : "active";
        const exp = r.latest_license
          ? new Date(r.latest_license.expires_at * 1000).toISOString().slice(0, 10)
          : "—";
        console.log(`${r.id}  ${status.padEnd(9)}  exp ${exp}  ${r.name}`);
      }
      return;
    }
    case "issue": {
      const days = Number(arg("--days", "30"));
      const customerId = arg("--customer");
      let customer;
      if (customerId) {
        customer = getCustomer(customerId);
        if (!customer) {
          console.error(`No such customer: ${customerId}`);
          process.exit(1);
        }
      } else {
        const name = arg("--name");
        if (!name) {
          console.error("--name required when --customer not provided");
          process.exit(1);
        }
        customer = createCustomer({
          name,
          contact_email: arg("--email"),
          notes: arg("--notes"),
        });
        console.error(`Created customer: ${customer.id}`);
      }
      const issued = issueLicense({
        customer,
        durationDays: days,
        notes: arg("--notes"),
      });
      // Print machine-friendly output to stdout; logs go to stderr.
      console.error(`Issued license ${issued.license.id}`);
      console.error(`Customer:   ${customer.id} ${customer.name}`);
      console.error(`Expires:    ${new Date(issued.license.expires_at * 1000).toISOString()}`);
      console.error("Token (give to casino as LICENSE_TOKEN):");
      console.log(issued.token);
      return;
    }
    default:
      console.error(`Usage:
  issue --name "Casino X" [--days 30] [--email contact@example.com] [--notes ...]
  issue --customer cus_xxx [--days 30]
  list`);
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
