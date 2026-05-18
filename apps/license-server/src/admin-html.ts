/**
 * Server-rendered admin UI. Plain HTML with inline CSS — keeps the license
 * server a single Node process with no frontend build step.
 */
import type { CustomerRow, LicenseRow } from "./db.js";

const escape = (s: unknown): string =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function layout(title: string, body: string, flash?: string | null): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · hzaconnect licenses</title>
<style>
  body { font: 14px system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; background: #0f1115; color: #e5e7eb; }
  header { background: #111827; padding: 12px 24px; border-bottom: 1px solid #1f2937; display:flex; justify-content:space-between; align-items:center; }
  header h1 { font-size: 16px; margin: 0; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #1f2937; vertical-align: top; }
  th { color: #9ca3af; font-weight: 500; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
  .pill.ok { background: #16a34a; color: #fff; }
  .pill.warn { background: #f59e0b; color: #1f2937; }
  .pill.bad { background: #dc2626; color: #fff; }
  .pill.muted { background: #374151; color: #d1d5db; }
  form.inline { display: inline; }
  button, input[type=submit] { background: #2563eb; color: white; border: 0; border-radius: 4px; padding: 6px 12px; font: inherit; cursor: pointer; }
  button.danger, input.danger { background: #dc2626; }
  button.muted, input.muted { background: #374151; }
  input[type=text], input[type=email], input[type=number], textarea { background: #0f1115; color: #e5e7eb; border: 1px solid #1f2937; border-radius: 4px; padding: 6px 8px; font: inherit; }
  textarea { width: 100%; min-height: 60px; }
  .grid { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; max-width: 600px; }
  .grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #9ca3af; }
  .flash { background: #1e3a8a; color: #dbeafe; padding: 8px 12px; border-radius: 4px; margin-bottom: 16px; }
  code { background: #1f2937; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
  pre { background: #0c1018; color: #d1d5db; border: 1px solid #1f2937; padding: 12px; border-radius: 4px; font-size: 12px; overflow:auto; }
  a { color: #93c5fd; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  details summary { cursor: pointer; }
</style>
</head>
<body>
<header>
  <h1>hzaconnect licenses</h1>
  <a href="/admin">customers</a>
</header>
<main>
${flash ? `<div class="flash">${escape(flash)}</div>` : ""}
${body}
</main>
</body>
</html>`;
}

export type CustomerWithLicense = CustomerRow & {
  latest_license: LicenseRow | null;
};

export function indexPage(opts: {
  rows: CustomerWithLicense[];
  flash?: string | null;
}): string {
  const rowsHtml = opts.rows
    .map((r) => {
      const lic = r.latest_license;
      const now = Math.floor(Date.now() / 1000);
      let licenseChip = '<span class="pill muted">no license</span>';
      if (lic) {
        if (lic.revoked_at) licenseChip = '<span class="pill bad">revoked</span>';
        else if (lic.expires_at < now)
          licenseChip = '<span class="pill bad">expired</span>';
        else if (lic.expires_at - now < 7 * 86400)
          licenseChip = `<span class="pill warn">expiring</span>`;
        else licenseChip = '<span class="pill ok">active</span>';
      }
      const suspendedChip = r.suspended_at
        ? '<span class="pill bad">suspended</span>'
        : "";
      const lastBeat = r.last_heartbeat_at
        ? new Date(r.last_heartbeat_at).toISOString().slice(0, 19).replace("T", " ")
        : "never";
      const expiry = lic
        ? new Date(lic.expires_at * 1000).toISOString().slice(0, 10)
        : "—";
      return `
        <tr>
          <td>
            <strong>${escape(r.name)}</strong>${
        r.contact_email
          ? `<br><small style="color:#9ca3af">${escape(r.contact_email)}</small>`
          : ""
      }
          </td>
          <td>${licenseChip} ${suspendedChip}</td>
          <td>${expiry}</td>
          <td><small>${escape(lastBeat)}</small></td>
          <td class="actions">
            <a href="/admin/customers/${escape(r.id)}">open</a>
            ${
              r.suspended_at
                ? `<form class="inline" method="post" action="/admin/customers/${escape(
                    r.id,
                  )}/resume"><input type="submit" value="resume"></form>`
                : `<form class="inline" method="post" action="/admin/customers/${escape(
                    r.id,
                  )}/suspend"><input type="submit" class="danger" value="suspend"></form>`
            }
          </td>
        </tr>`;
    })
    .join("");

  const body = `
<h2 style="margin-top:0;">Customers</h2>
<form method="post" action="/admin/customers" class="grid">
  <label>Name <input type="text" name="name" required></label>
  <label>Contact email <input type="email" name="contact_email"></label>
  <label style="grid-column: span 2;">Notes <textarea name="notes"></textarea></label>
  <label>Initial license duration (days) <input type="number" name="duration_days" value="30" min="1" max="3650"></label>
  <div style="align-self:end;"><input type="submit" value="Create + issue license"></div>
</form>

<table>
  <thead><tr><th>Customer</th><th>State</th><th>Expires</th><th>Last heartbeat</th><th></th></tr></thead>
  <tbody>${rowsHtml || `<tr><td colspan=5 style="color:#9ca3af; padding:24px; text-align:center;">No customers yet.</td></tr>`}</tbody>
</table>`;
  return layout("Customers", body, opts.flash);
}

export function customerPage(opts: {
  customer: CustomerRow;
  licenses: LicenseRow[];
  flash?: string | null;
  newToken?: string;
}): string {
  const licenseRows = opts.licenses
    .map((l) => {
      const now = Math.floor(Date.now() / 1000);
      let state = '<span class="pill ok">active</span>';
      if (l.revoked_at) state = '<span class="pill bad">revoked</span>';
      else if (l.expires_at < now) state = '<span class="pill muted">expired</span>';
      const issued = new Date(l.issued_at * 1000).toISOString().slice(0, 10);
      const expires = new Date(l.expires_at * 1000).toISOString().slice(0, 10);
      return `
        <tr>
          <td><code>${escape(l.id)}</code></td>
          <td>${state}</td>
          <td>${issued}</td>
          <td>${expires}</td>
          <td>${
            l.revoked_at
              ? "<small>revoked</small>"
              : `<form class="inline" method="post" action="/admin/customers/${escape(
                  opts.customer.id,
                )}/licenses/${escape(l.id)}/revoke">
            <input type="submit" class="danger" value="revoke">
          </form>`
          }</td>
        </tr>`;
    })
    .join("");

  const body = `
<p><a href="/admin">← all customers</a></p>
<h2 style="margin-top:0;">${escape(opts.customer.name)}</h2>
<p style="color:#9ca3af;">
  <code>${escape(opts.customer.id)}</code>
  ${
    opts.customer.suspended_at
      ? '<span class="pill bad">suspended</span>'
      : '<span class="pill ok">active</span>'
  }
  ${
    opts.customer.contact_email
      ? `· ${escape(opts.customer.contact_email)}`
      : ""
  }
</p>
<p>${escape(opts.customer.notes ?? "")}</p>

${
  opts.newToken
    ? `<details open>
        <summary><strong>New license token issued</strong> — copy now (you will not see it again):</summary>
        <pre>${escape(opts.newToken)}</pre>
       </details>`
    : ""
}

<div class="actions" style="margin: 16px 0;">
  ${
    opts.customer.suspended_at
      ? `<form class="inline" method="post" action="/admin/customers/${escape(
          opts.customer.id,
        )}/resume"><input type="submit" value="resume"></form>`
      : `<form class="inline" method="post" action="/admin/customers/${escape(
          opts.customer.id,
        )}/suspend"><input type="submit" class="danger" value="suspend"></form>`
  }

  <form class="inline" method="post" action="/admin/customers/${escape(
    opts.customer.id,
  )}/licenses">
    <input type="number" name="duration_days" value="30" min="1" max="3650" style="width:80px;">
    <input type="submit" value="Issue new license">
  </form>
</div>

<h3>License history</h3>
<table>
  <thead><tr><th>License ID</th><th>State</th><th>Issued</th><th>Expires</th><th></th></tr></thead>
  <tbody>${licenseRows || '<tr><td colspan=5 style="color:#9ca3af; padding:16px; text-align:center;">No licenses issued yet.</td></tr>'}</tbody>
</table>`;
  return layout(opts.customer.name, body, opts.flash);
}
