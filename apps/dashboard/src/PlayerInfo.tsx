import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.js";

type Identifier = Awaited<ReturnType<typeof api.listSessionIdentifiers>>[number];
type Match = Awaited<ReturnType<typeof api.matchIdentifier>>[number];

const KIND_OPTIONS = ["player_id", "email", "phone", "username", "custom"] as const;

export function PlayerInfo({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Identifier[] | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<Identifier["kind"]>("player_id");
  const [newValue, setNewValue] = useState("");
  const [newCustomLabel, setNewCustomLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const list = await api.listSessionIdentifiers(sessionId);
      setRows(list);
      // Fetch matches for the current (non-superseded) identifiers.
      const current = list.filter((r) => !r.superseded_at);
      const ms: Match[] = [];
      for (const r of current) {
        try {
          const m = await api.matchIdentifier(r.kind, r.value, sessionId);
          for (const x of m) ms.push(x);
        } catch {
          // ignore
        }
      }
      setMatches(ms);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    load();
  }, [sessionId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!newValue.trim()) return;
    try {
      await api.recordSessionIdentifier(sessionId, {
        kind: newKind,
        value: newValue.trim(),
        custom_label: newKind === "custom" ? newCustomLabel || undefined : undefined,
      });
      setNewValue("");
      setNewCustomLabel("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  if (!rows) return null;
  const current = rows.filter((r) => !r.superseded_at);

  return (
    <div className="player-info">
      <div className="player-info-header">
        <strong>{t("conversation.player_info_heading")}</strong>
        <button
          className="toolbar"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? t("prechat.cancel") : t("conversation.add_identifier")}
        </button>
      </div>
      {current.length === 0 && !adding && (
        <div className="player-info-empty">{t("conversation.no_identifiers")}</div>
      )}
      <div className="player-info-list">
        {current.map((r) => (
          <span key={r.id} className="identifier-chip">
            <span className="identifier-kind">{kindLabel(r, t)}:</span>{" "}
            <span>{r.value}</span>
            <small style={{ color: "var(--c-text-subtle)", marginLeft: 4 }}>
              ({sourceLabel(r.source, t)})
            </small>
          </span>
        ))}
      </div>
      {adding && (
        <form onSubmit={add} className="identifier-add">
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as Identifier["kind"])}
            aria-label={t("conversation.identifier_kind")}
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {t(`identifier.${k}`)}
              </option>
            ))}
          </select>
          {newKind === "custom" && (
            <input
              type="text"
              placeholder={t("conversation.identifier_custom_label")}
              value={newCustomLabel}
              onChange={(e) => setNewCustomLabel(e.target.value)}
            />
          )}
          <input
            type="text"
            placeholder={t("conversation.identifier_value")}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            required
            aria-label={t("conversation.identifier_value")}
          />
          <button type="submit" className="toolbar primary">
            {t("conversation.save_identifier")}
          </button>
        </form>
      )}
      {matches.length > 0 && (
        <details className="player-info-history">
          <summary>
            {t("conversation.history_count", {
              total: matches.reduce((s, m) => s + m.conversations_count, 0),
              sessions: matches.length,
            })}
          </summary>
          <ul>
            {matches.map((m) => (
              <li key={m.session_id}>
                {kindShort(m.kind, t)} <code>{m.value}</code> — {m.conversations_count}{" "}
                {t("conversation.history_conversations")}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function kindLabel(r: Identifier, tr: ReturnType<typeof useTranslation>["t"]): string {
  if (r.kind === "custom" && r.custom_label) return r.custom_label;
  return tr(`identifier.${r.kind}`);
}
function kindShort(kind: string, tr: ReturnType<typeof useTranslation>["t"]): string {
  return tr(`identifier.${kind}`);
}
function sourceLabel(s: string, tr: ReturnType<typeof useTranslation>["t"]): string {
  return tr(`identifier.source.${s}`);
}
