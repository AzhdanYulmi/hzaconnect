import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.js";
import { useStore } from "./store.js";

export function QueueFilter() {
  const { t, i18n } = useTranslation();
  const tagFilter = useStore((s) => s.tagFilter);
  const setTagFilter = useStore((s) => s.setTagFilter);
  const setConversationsForTag = useStore((s) => s.setConversationsForTag);
  const [tags, setTags] = useState<Awaited<ReturnType<typeof api.listTags>>>([]);

  useEffect(() => {
    api.listTags().then(setTags).catch(() => {});
  }, []);

  // Whenever the active filter changes, fetch the matching conversation IDs.
  useEffect(() => {
    if (!tagFilter) {
      setConversationsForTag(new Set());
      return;
    }
    api
      .conversationsByTag(tagFilter)
      .then((ids) => setConversationsForTag(new Set(ids)))
      .catch(() => setConversationsForTag(new Set()));
  }, [tagFilter, setConversationsForTag]);

  if (tags.length === 0) return null;

  return (
    <div className="queue-filter">
      <select
        value={tagFilter ?? ""}
        onChange={(e) => setTagFilter(e.target.value || null)}
        aria-label={t("queue.filter_by_tag")}
      >
        <option value="">{t("queue.filter_all")}</option>
        {tags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {i18n.language.startsWith("tr") && tag.label_tr ? tag.label_tr : tag.label_en}
          </option>
        ))}
      </select>
    </div>
  );
}
