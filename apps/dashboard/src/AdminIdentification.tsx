import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.js";

type Field = {
  kind: "player_id" | "email" | "phone" | "username" | "custom";
  custom_label?: string;
  required?: boolean;
  regex?: string;
  label_en?: string;
  label_tr?: string;
};

const KINDS: Field["kind"][] = ["player_id", "email", "phone", "username", "custom"];

export function AdminIdentification() {
  const { t } = useTranslation();
  const [fields, setFields] = useState<Field[]>([]);
  const [requireBeforeChat, setRequireBeforeChat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const s = await api.getDeploymentSettings();
      setFields(s.identifier_fields ?? []);
      setRequireBeforeChat(!!s.require_before_chat);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await api.putDeploymentSettings({
        identifier_fields: fields,
        require_before_chat: requireBeforeChat,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function update(i: number, patch: Partial<Field>) {
    setFields((arr) => arr.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function add() {
    setFields((arr) => [...arr, { kind: "player_id", required: false }]);
  }
  function remove(i: number) {
    setFields((arr) => arr.filter((_, idx) => idx !== i));
  }

  return (
    <div className="admin">
      <header>
        <strong>{t("admin.identification.heading")}</strong>
      </header>
      <div style={{ padding: 16, overflow: "auto" }}>
        <p style={{ color: "var(--c-text-muted)", fontSize: 13, lineHeight: 1.5 }}>
          {t("admin.identification.intro")}
        </p>

        <h3>{t("admin.identification.fields")}</h3>
        {fields.length === 0 && (
          <div style={{ color: "var(--c-text-subtle)", fontSize: 13 }}>
            {t("admin.identification.no_fields")}
          </div>
        )}
        {fields.map((f, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "120px 140px 1fr 1fr 100px 90px",
              gap: 8,
              marginBottom: 8,
              alignItems: "center",
            }}
          >
            <select
              value={f.kind}
              onChange={(e) => update(i, { kind: e.target.value as Field["kind"] })}
              aria-label={`${t("admin.identification.kind")} ${i}`}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`identifier.${k}`)}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder={t("admin.identification.custom_label_placeholder")}
              value={f.custom_label ?? ""}
              onChange={(e) => update(i, { custom_label: e.target.value })}
              disabled={f.kind !== "custom"}
              aria-label={`${t("admin.identification.custom_label")} ${i}`}
            />
            <input
              type="text"
              placeholder={t("admin.identification.label_en")}
              value={f.label_en ?? ""}
              onChange={(e) => update(i, { label_en: e.target.value })}
              aria-label={`${t("admin.identification.label_en")} ${i}`}
            />
            <input
              type="text"
              placeholder={t("admin.identification.label_tr")}
              value={f.label_tr ?? ""}
              onChange={(e) => update(i, { label_tr: e.target.value })}
              aria-label={`${t("admin.identification.label_tr")} ${i}`}
            />
            <label style={{ display: "flex", gap: 4, fontSize: 12, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!f.required}
                onChange={(e) => update(i, { required: e.target.checked })}
              />
              {t("admin.identification.required")}
            </label>
            <button
              type="button"
              className="toolbar danger"
              onClick={() => remove(i)}
            >
              {t("admin.identification.remove")}
            </button>
          </div>
        ))}
        <button type="button" className="toolbar" onClick={add} style={{ marginTop: 8 }}>
          {t("admin.identification.add_field")}
        </button>

        <h3 style={{ marginTop: 20 }}>{t("admin.identification.policy")}</h3>
        <label style={{ display: "flex", gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={requireBeforeChat}
            onChange={(e) => setRequireBeforeChat(e.target.checked)}
          />
          {t("admin.identification.require_before_chat")}
        </label>

        <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="toolbar primary"
            onClick={save}
            disabled={busy}
          >
            {busy
              ? t("admin.maintenance.working")
              : t("admin.identification.save")}
          </button>
          {saved && (
            <span style={{ color: "#16a34a", fontSize: 13 }}>
              {t("admin.identification.saved")}
            </span>
          )}
        </div>
        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    </div>
  );
}
