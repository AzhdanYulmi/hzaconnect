import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Page shown to admins so they can hand the casino's tech team a ready-made
 * embed snippet. The snippet is anchored at the dashboard's own origin —
 * whatever domain serves the dashboard also serves /widget.js.
 */
export function EmbedSnippet() {
  const { t } = useTranslation();
  const [position, setPosition] = useState<"right" | "left">("right");
  const [deployment, setDeployment] = useState("default");
  const [copied, setCopied] = useState(false);

  const origin = useMemo(() => window.location.origin, []);
  const snippet = useMemo(
    () =>
      `<!-- hzaconnect support widget -->
<script
  src="${origin}/widget.js"
  data-deployment="${escapeHtml(deployment)}"
  data-position="${position}"
  async
></script>`,
    [origin, deployment, position],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — user can still copy manually
    }
  }

  return (
    <div className="admin">
      <header>
        <strong>{t("admin.embed.heading")}</strong>
      </header>
      <div style={{ padding: 16, overflow: "auto" }}>
        <p style={{ color: "var(--c-text-muted)", fontSize: 13, lineHeight: 1.5 }}>
          {t("admin.embed.intro")}
        </p>

        <h3>{t("admin.embed.configuration")}</h3>
        <div className="admin-form" style={{ gridTemplateColumns: "1fr 1fr 140px" }}>
          <label style={{ fontSize: 12, color: "var(--c-text-muted)" }}>
            {t("admin.embed.deployment_id")}
            <input
              type="text"
              value={deployment}
              onChange={(e) => setDeployment(e.target.value)}
              aria-label={t("admin.embed.deployment_id")}
              style={{ marginTop: 4, width: "100%" }}
            />
          </label>
          <label style={{ fontSize: 12, color: "var(--c-text-muted)" }}>
            {t("admin.embed.launcher_position")}
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as "right" | "left")}
              style={{ marginTop: 4, width: "100%" }}
              aria-label={t("admin.embed.launcher_position")}
            >
              <option value="right">right</option>
              <option value="left">left</option>
            </select>
          </label>
        </div>

        <h3 style={{ marginTop: 24 }}>{t("admin.embed.snippet")}</h3>
        <div style={{ position: "relative" }}>
          <pre
            style={{
              background: "var(--c-surface-2)",
              border: "1px solid var(--c-border)",
              padding: 14,
              borderRadius: 8,
              fontSize: 13,
              overflow: "auto",
              color: "var(--c-text)",
              fontFamily:
                "ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace",
            }}
          >
            <code>{snippet}</code>
          </pre>
          <button
            className="toolbar primary"
            onClick={copy}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
            }}
          >
            {copied ? t("admin.embed.copied") : t("admin.embed.copy")}
          </button>
        </div>

        <h3 style={{ marginTop: 24 }}>{t("admin.embed.js_api")}</h3>
        <p style={{ color: "var(--c-text-muted)", fontSize: 13, lineHeight: 1.5 }}>
          Once embedded, <code>window.hzaconnect</code> is available with:
        </p>
        <ul style={{ color: "var(--c-text)", fontSize: 13, lineHeight: 1.7 }}>
          <li>
            <code>hzaconnect.open()</code> /{" "}
            <code>hzaconnect.close()</code> /{" "}
            <code>hzaconnect.toggle()</code> — control the chat panel
          </li>
          <li>
            <code>hzaconnect.setContext({"{ "}page, game, locale{" }"})</code> —
            attach extra context to new conversations
          </li>
          <li>
            <code>hzaconnect.identify(ssoToken)</code> — Phase 2 stub for
            signed-identity SSO; currently no-op
          </li>
        </ul>

        <h3 style={{ marginTop: 24 }}>{t("admin.embed.verify")}</h3>
        <ol style={{ color: "var(--c-text)", fontSize: 13, lineHeight: 1.7 }}>
          <li>Reload the casino page after embedding.</li>
          <li>
            A floating launcher should appear in the bottom-{position} corner.
          </li>
          <li>
            Open this dashboard in a separate browser context — the
            conversation will land in the queue when the player sends their
            first message.
          </li>
        </ol>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
