import React from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LOCALES, type Locale } from "./i18n/index.js";

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  return (
    <select
      aria-label={t("language.label")}
      value={i18n.language.startsWith("tr") ? "tr" : "en"}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      style={{
        background: "var(--c-bg)",
        color: "var(--c-text)",
        border: "1px solid var(--c-border)",
        borderRadius: 6,
        padding: "5px 8px",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {SUPPORTED_LOCALES.map((loc: Locale) => (
        <option key={loc} value={loc}>
          {t(`language.${loc}`)}
        </option>
      ))}
    </select>
  );
}
