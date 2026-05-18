import React, { useState } from "react";
import { useTranslation } from "react-i18next";

const API_BASE = "";

async function adminPost<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

import { authToken } from "./api.js";

export function AdminMaintenance() {
  const { t } = useTranslation();
  const [hours, setHours] = useState(24);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    setResult(null);
    try {
      const r = await fn();
      setResult(`${label}: ${JSON.stringify(r)}`);
    } catch (e) {
      setError(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  function token(): string {
    const t = authToken.get();
    if (!t) throw new Error("not authenticated");
    return t;
  }

  return (
    <div className="admin">
      <header>
        <strong>{t("admin.maintenance.heading")}</strong>
      </header>
      <div style={{ padding: 16, overflow: "auto" }}>
        <p style={{ color: "var(--c-text-muted)", fontSize: 13, lineHeight: 1.5 }}>
          {t("admin.maintenance.intro")}
        </p>

        <section style={{ marginBottom: 24 }}>
          <h3>{t("admin.maintenance.close_stale_heading")}</h3>
          <p style={{ color: "var(--c-text-muted)", fontSize: 13 }}>
            {t("admin.maintenance.close_stale_explain")}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 13 }}>
              {t("admin.maintenance.older_than_hours")}
            </label>
            <input
              type="number"
              min={1}
              max={24 * 30}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              style={{ width: 80, padding: 6 }}
              aria-label="Stale hours"
            />
            <button
              className="toolbar danger"
              onClick={() =>
                run("close-stale", () =>
                  adminPost("/api/admin/close-stale", { hours }, token()),
                )
              }
              disabled={!!busy}
            >
              {busy === "close-stale"
                ? t("admin.maintenance.working")
                : t("admin.maintenance.close_stale")}
            </button>
          </div>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h3>{t("admin.maintenance.prune_heading")}</h3>
          <p style={{ color: "var(--c-text-muted)", fontSize: 13 }}>
            {t("admin.maintenance.prune_explain")}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={{ fontSize: 13 }}>
              {t("admin.maintenance.older_than_days")}
            </label>
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              style={{ width: 80, padding: 6 }}
              aria-label="Prune days"
            />
            <button
              className="toolbar danger"
              onClick={() =>
                run("prune-sessions", () =>
                  adminPost("/api/admin/prune-sessions", { days }, token()),
                )
              }
              disabled={!!busy}
            >
              {busy === "prune-sessions"
                ? t("admin.maintenance.working")
                : t("admin.maintenance.prune")}
            </button>
          </div>
        </section>

        {result && (
          <div
            style={{
              padding: 8,
              background: "rgba(22,163,74,0.1)",
              border: "1px solid rgba(22,163,74,0.3)",
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            {result}
          </div>
        )}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
