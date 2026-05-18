import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.js";

export function ConversationTags({ conversationId }: { conversationId: string }) {
  const { t, i18n } = useTranslation();
  const [available, setAvailable] = useState<
    Awaited<ReturnType<typeof api.listTags>>
  >([]);
  const [applied, setApplied] = useState<
    Awaited<ReturnType<typeof api.listConversationTags>>
  >([]);
  const [adding, setAdding] = useState(false);

  async function load() {
    const [a, c] = await Promise.all([
      api.listTags().catch(() => []),
      api.listConversationTags(conversationId).catch(() => []),
    ]);
    setAvailable(a);
    setApplied(c);
  }
  useEffect(() => {
    load();
  }, [conversationId]);

  function labelOf(tag: { label_en: string; label_tr: string | null }): string {
    if (i18n.language.startsWith("tr") && tag.label_tr) return tag.label_tr;
    return tag.label_en;
  }

  const appliedIds = useMemo(() => new Set(applied.map((a) => a.tag_id)), [applied]);
  const unapplied = available.filter((a) => !appliedIds.has(a.id));

  async function apply(tagId: string) {
    await api.applyConversationTag(conversationId, tagId);
    setAdding(false);
    await load();
  }
  async function remove(tagId: string) {
    await api.removeConversationTag(conversationId, tagId);
    await load();
  }

  return (
    <div className="conv-tags">
      {applied.map((a) => (
        <span
          key={a.tag_id}
          className="tag-chip removable"
          style={{ background: a.color }}
          title={a.slug}
        >
          {labelOf(a)}
          <button
            type="button"
            className="tag-chip-remove"
            aria-label={`${t("admin.tags.remove")} ${labelOf(a)}`}
            onClick={() => remove(a.tag_id)}
          >
            ×
          </button>
        </span>
      ))}
      {!adding && unapplied.length > 0 && (
        <button
          type="button"
          className="toolbar"
          onClick={() => setAdding(true)}
        >
          {t("conversation.add_tag")}
        </button>
      )}
      {adding && (
        <select
          autoFocus
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) apply(e.target.value);
          }}
          onBlur={() => setAdding(false)}
          aria-label={t("conversation.add_tag")}
        >
          <option value="" disabled>
            {t("conversation.pick_tag")}
          </option>
          {unapplied.map((a) => (
            <option key={a.id} value={a.id}>
              {labelOf(a)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
