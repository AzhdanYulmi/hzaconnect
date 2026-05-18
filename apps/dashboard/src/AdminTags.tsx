import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.js";

type Tag = Awaited<ReturnType<typeof api.adminListTags>>[number];

const DEFAULT_COLORS = [
  "#374151",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0d9488",
  "#2563eb",
  "#7c3aed",
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function AdminTags() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Tag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [labelEn, setLabelEn] = useState("");
  const [labelTr, setLabelTr] = useState("");
  const [color, setColor] = useState(DEFAULT_COLORS[5] ?? "#0d9488");

  async function refresh() {
    try {
      const list = await api.adminListTags();
      setRows(list);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.adminCreateTag({
        slug: slugify(labelEn),
        label_en: labelEn,
        label_tr: labelTr || undefined,
        color,
      });
      setLabelEn("");
      setLabelTr("");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, p: Parameters<typeof api.adminUpdateTag>[1]) {
    setError(null);
    try {
      await api.adminUpdateTag(id, p);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="admin">
      <header>
        <strong>{t("admin.tags.heading")}</strong>
      </header>
      <div style={{ padding: 16, overflow: "auto" }}>
        <p style={{ color: "var(--c-text-muted)", fontSize: 13 }}>{t("admin.tags.intro")}</p>

        <h3>{t("admin.tags.create_heading")}</h3>
        <form
          onSubmit={create}
          className="admin-form"
          style={{ gridTemplateColumns: "1fr 1fr 60px 100px" }}
        >
          <input
            type="text"
            placeholder={t("admin.tags.label_en")}
            value={labelEn}
            onChange={(e) => setLabelEn(e.target.value)}
            required
            aria-label={t("admin.tags.label_en")}
          />
          <input
            type="text"
            placeholder={t("admin.tags.label_tr")}
            value={labelTr}
            onChange={(e) => setLabelTr(e.target.value)}
            aria-label={t("admin.tags.label_tr")}
          />
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label={t("admin.tags.color")}
            style={{ width: 60, height: 36, padding: 2 }}
          />
          <button type="submit" disabled={busy || !labelEn.trim()}>
            {busy ? "…" : t("admin.tags.create")}
          </button>
        </form>

        <h3 style={{ marginTop: 20 }}>{t("admin.tags.list_heading")}</h3>
        {rows === null ? (
          <div>{t("admin.agents.loading")}</div>
        ) : rows.length === 0 ? (
          <div style={{ color: "var(--c-text-subtle)", fontSize: 13 }}>{t("admin.tags.empty")}</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("admin.tags.preview")}</th>
                <th>{t("admin.tags.slug")}</th>
                <th>{t("admin.tags.label_en")}</th>
                <th>{t("admin.tags.label_tr")}</th>
                <th>{t("admin.tags.color")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  style={r.archived_at ? { opacity: 0.4 } : undefined}
                >
                  <td>
                    <span
                      className="tag-chip"
                      style={{ background: r.color }}
                    >
                      {r.label_en}
                    </span>
                  </td>
                  <td>
                    <code style={{ fontSize: 12 }}>{r.slug}</code>
                  </td>
                  <td>
                    <input
                      defaultValue={r.label_en}
                      onBlur={(e) =>
                        e.target.value !== r.label_en &&
                        patch(r.id, { label_en: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      defaultValue={r.label_tr ?? ""}
                      onBlur={(e) =>
                        patch(r.id, { label_tr: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="color"
                      defaultValue={r.color}
                      onBlur={(e) => patch(r.id, { color: e.target.value })}
                      style={{ width: 60, height: 28, padding: 2 }}
                    />
                  </td>
                  <td>
                    {r.archived_at ? (
                      <button
                        className="toolbar primary"
                        onClick={() => patch(r.id, { archived: false })}
                      >
                        {t("admin.tags.restore")}
                      </button>
                    ) : (
                      <button
                        className="toolbar danger"
                        onClick={() => patch(r.id, { archived: true })}
                      >
                        {t("admin.tags.archive")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
