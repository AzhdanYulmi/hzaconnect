/**
 * Generate a customer onboarding packet:
 *   - <out>.pdf      polished one-pager you email
 *   - <out>.env      drop-in .env snippet for the casino's IT team
 *   - <out>.txt      plain-text values for copy/paste
 *
 * Usage:
 *   pnpm --filter @hzaconnect/license-server onboard onboard \
 *     --name "Acme Casino" \
 *     --email ops@acme.example \
 *     --days 30 \
 *     --server https://licenses.yourbrand.com \
 *     --out ./onboarding-acme
 *
 * Or onboard an existing customer (issues a fresh license):
 *   pnpm --filter @hzaconnect/license-server onboard onboard \
 *     --customer cus_xxx \
 *     --server https://licenses.yourbrand.com \
 *     --out ./renewal-acme
 */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import {
  createCustomer,
  getCustomer,
  issueLicense,
  publicKeyPem,
} from "../store.js";
import type { CustomerRow } from "../db.js";

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

async function main() {
  const cmd = process.argv[2];
  if (cmd !== "onboard") {
    console.error("Usage: onboard --name <name> | --customer <id>  --server <url>  [--days 30]  [--out <basepath>]");
    process.exit(2);
  }

  const server = arg("--server");
  if (!server) {
    console.error("--server <license-server-url> is required (e.g. https://licenses.yourbrand.com)");
    process.exit(2);
  }
  const days = Number(arg("--days", "30"));
  const outBase = arg("--out") ?? `./onboarding-${Date.now()}`;

  let customer: CustomerRow;
  const customerId = arg("--customer");
  if (customerId) {
    const found = getCustomer(customerId);
    if (!found) {
      console.error(`No such customer: ${customerId}`);
      process.exit(1);
    }
    customer = found;
  } else {
    const name = arg("--name");
    if (!name) {
      console.error("Provide either --customer <id> or --name <new-customer-name>");
      process.exit(2);
    }
    customer = createCustomer({
      name,
      contact_email: arg("--email"),
      notes: arg("--notes"),
    });
  }

  const issued = issueLicense({
    customer,
    durationDays: days,
    notes: arg("--notes"),
  });

  const baseAbs = path.resolve(outBase);
  const outDir = path.dirname(baseAbs);
  fs.mkdirSync(outDir, { recursive: true });

  const expiresIso = new Date(issued.license.expires_at * 1000).toISOString();

  // -------- .env snippet --------
  const envSnippet = `# hzaconnect license — issued for ${customer.name}
# Issued: ${new Date(issued.license.issued_at * 1000).toISOString()}
# Expires: ${expiresIso}
# Customer ID: ${customer.id}
# License ID:  ${issued.license.id}

LICENSE_ENFORCEMENT=enabled
LICENSE_TOKEN=${issued.token}
LICENSE_SERVER_URL=${server.replace(/\/+$/, "")}
LICENSE_PUBLIC_KEY_PEM="${publicKeyPem.trim().replaceAll("\n", "\\n")}"
`;
  fs.writeFileSync(`${baseAbs}.env`, envSnippet);

  // -------- .txt summary --------
  const txt = `hzaconnect onboarding — ${customer.name}

Customer ID:   ${customer.id}
License ID:    ${issued.license.id}
Expires:       ${expiresIso}
Server URL:    ${server.replace(/\/+$/, "")}

LICENSE_TOKEN
${issued.token}

LICENSE_PUBLIC_KEY_PEM
${publicKeyPem.trim()}

Add the following to your .env, then 'docker compose up -d' the API.
A pre-formatted .env snippet is in ${path.basename(baseAbs)}.env.
`;
  fs.writeFileSync(`${baseAbs}.txt`, txt);

  // -------- .pdf one-pager --------
  await renderPdf({
    outPath: `${baseAbs}.pdf`,
    customerName: customer.name,
    customerId: customer.id,
    licenseId: issued.license.id,
    expiresIso,
    serverUrl: server.replace(/\/+$/, ""),
    licenseToken: issued.token,
    publicKeyPem: publicKeyPem.trim(),
  });

  // -------- summary --------
  console.error(`Generated:
  ${baseAbs}.pdf   one-pager (email this)
  ${baseAbs}.env   drop-in env snippet (give to their IT)
  ${baseAbs}.txt   plain-text fallback`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

function renderPdf(opts: {
  outPath: string;
  customerName: string;
  customerId: string;
  licenseId: string;
  expiresIso: string;
  serverUrl: string;
  licenseToken: string;
  publicKeyPem: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 56,
      info: {
        Title: `hzaconnect license — ${opts.customerName}`,
        Author: "hzaconnect",
      },
    });
    const stream = fs.createWriteStream(opts.outPath);
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    doc.pipe(stream);

    // Title
    doc
      .fontSize(20)
      .fillColor("#111")
      .text("hzaconnect", { continued: true })
      .fillColor("#666")
      .fontSize(14)
      .text("  ·  license onboarding")
      .moveDown(0.4);

    doc.fillColor("#111").fontSize(11);
    doc.text(`Customer: `, { continued: true }).font("Helvetica-Bold").text(opts.customerName);
    doc.font("Helvetica").text(`Issued: ${new Date().toISOString()}`);
    doc.text(`Expires: ${opts.expiresIso}`);
    doc.text(`Customer ID: ${opts.customerId}`);
    doc.text(`License ID:  ${opts.licenseId}`);
    doc.moveDown(1);

    // Step instructions
    doc
      .fontSize(12)
      .fillColor("#111")
      .font("Helvetica-Bold")
      .text("How to install");
    doc.font("Helvetica").fontSize(10).fillColor("#333");
    doc.moveDown(0.3);
    [
      "1. Add the values on the next page to your hzaconnect deployment's .env file.",
      "2. Restart the API container:  docker compose up -d api",
      "3. The chat dashboard at /dashboard/ will show no license banner — you're live.",
      "4. The API phones home every 30 minutes to keep the license active.",
    ].forEach((line) => doc.text(line));
    doc.moveDown(1);

    doc
      .fontSize(12)
      .fillColor("#111")
      .font("Helvetica-Bold")
      .text("Server URL");
    doc.font("Courier").fontSize(10).fillColor("#000").text(opts.serverUrl);
    doc.moveDown(0.8);

    // License token
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#111")
      .text("LICENSE_TOKEN");
    doc.font("Helvetica").fontSize(9).fillColor("#666");
    doc.text("Paste this into LICENSE_TOKEN in your .env. Wraps across lines for readability — copy it as one continuous string with no spaces or newlines.");
    doc.moveDown(0.3);
    doc.font("Courier").fontSize(8).fillColor("#000");
    drawWrappedMonospace(doc, opts.licenseToken);
    doc.moveDown(0.8);

    // Public key
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#111")
      .text("LICENSE_PUBLIC_KEY_PEM");
    doc.font("Helvetica").fontSize(9).fillColor("#666");
    doc.text("Paste the full block, including the BEGIN and END lines, into LICENSE_PUBLIC_KEY_PEM in your .env.");
    doc.moveDown(0.3);
    doc.font("Courier").fontSize(9).fillColor("#000");
    doc.text(opts.publicKeyPem);
    doc.moveDown(0.8);

    // Footer
    doc
      .moveDown(2)
      .fontSize(8)
      .fillColor("#888")
      .font("Helvetica-Oblique")
      .text(
        "Keep this packet confidential. The token grants service activation only — it cannot be used to access player data or authenticate as an agent.",
        { align: "center" },
      );

    doc.end();
  });
}

function drawWrappedMonospace(doc: PDFKit.PDFDocument, s: string): void {
  // pdfkit's default text wrapping handles long strings, but for a long
  // unbroken token we pre-wrap to ~76 chars so the visual wrapping is
  // controlled and predictable.
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += 76) lines.push(s.slice(i, i + 76));
  doc.text(lines.join("\n"));
}
