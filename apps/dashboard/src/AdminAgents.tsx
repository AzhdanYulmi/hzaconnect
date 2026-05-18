import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type AgentRow } from "./api.js";
import { useStore } from "./store.js";

const ROLES: AgentRow["role"][] = ["agent", "supervisor", "admin"];

export function AdminAgents() {
  const { t } = useTranslation();
  const me = useStore((s) => s.me);
  const [rows, setRows] = useState<AgentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Create-form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AgentRow["role"]>("agent");

  async function refresh() {
    try {
      const list = await api.listAgents();
      setRows(list);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api.createAgent({ email, password, display_name: displayName, role });
      setEmail("");
      setPassword("");
      setDisplayName("");
      setRole("agent");
      await refresh();
    } catch (e) {
      setError(t("admin.agents.create_failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, patch: Parameters<typeof api.updateAgent>[1]) {
    setError(null);
    try {
      await api.updateAgent(id, patch);
      await refresh();
    } catch (e) {
      setError(t("admin.agents.update_failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  return (
    <div className="admin">
      <header>
        <strong>{t("admin.agents.heading")}</strong>
      </header>

      <div style={{ padding: 16, overflow: "auto" }}>
        <section style={{ marginBottom: 24 }}>
          <h3 style={{ marginTop: 0 }}>{t("admin.agents.create_heading")}</h3>
          <form onSubmit={onCreate} className="admin-form">
            <input
              type="email"
              placeholder={t("admin.agents.placeholder_email")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-label="New agent email"
            />
            <input
              type="text"
              placeholder={t("admin.agents.placeholder_name")}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              aria-label="New agent display name"
            />
            <input
              type="password"
              placeholder={t("admin.agents.placeholder_password")}
              value={password}
              minLength={12}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-label="New agent password"
            />
            <select value={role} onChange={(e) => setRole(e.target.value as AgentRow["role"])}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button type="submit" disabled={creating}>
              {creating ? t("admin.agents.creating") : t("admin.agents.create")}
            </button>
          </form>
        </section>

        {error && <div className="error">{error}</div>}

        <section>
          <h3>{t("admin.agents.list_heading")}</h3>
          {rows === null ? (
            <div>{t("admin.agents.loading")}</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("admin.agents.email")}</th>
                  <th>{t("admin.agents.name")}</th>
                  <th>{t("admin.agents.role")}</th>
                  <th>{t("admin.agents.status")}</th>
                  <th>{t("admin.agents.last_seen")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSelf = row.id === me?.id;
                  return (
                    <tr key={row.id}>
                      <td>{row.email}</td>
                      <td>{row.display_name}</td>
                      <td>
                        <select
                          value={row.role}
                          disabled={isSelf}
                          onChange={(e) =>
                            patch(row.id, { role: e.target.value as AgentRow["role"] })
                          }
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span
                          className={`status-pill ${row.status}`}
                          style={{
                            padding: "2px 8px",
                            borderRadius: 10,
                            fontSize: 11,
                            background:
                              row.status === "active" ? "#16a34a" : "#6b7280",
                          }}
                        >
                          {t(`admin.agents.${row.status}`)}
                        </span>
                      </td>
                      <td>
                        {row.last_seen_at
                          ? new Date(row.last_seen_at).toLocaleString()
                          : "—"}
                      </td>
                      <td>
                        {row.status === "active" ? (
                          <button
                            disabled={isSelf}
                            onClick={() => patch(row.id, { status: "disabled" })}
                            className="toolbar danger"
                          >
                            {t("admin.agents.disable")}
                          </button>
                        ) : (
                          <button
                            onClick={() => patch(row.id, { status: "active" })}
                            className="toolbar primary"
                          >
                            {t("admin.agents.enable")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
