import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import tr from "./tr.json";

export const SUPPORTED_LOCALES = ["en", "tr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      tr: { translation: tr },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LOCALES as unknown as string[],
    interpolation: { escapeValue: false },
    detection: {
      // Prefer the persisted choice, then browser, then HTML attr.
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: "hzaconnect_dashboard_locale",
      caches: ["localStorage"],
    },
  });

export function setLocale(loc: Locale) {
  void i18n.changeLanguage(loc);
}
export default i18n;
