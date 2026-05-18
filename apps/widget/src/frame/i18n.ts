/**
 * Tiny i18n for the widget iframe. ~600 bytes; no library dependency.
 *
 * Usage:
 *   import { t, setLocale, useLocale } from "./i18n.js";
 *   t("composer.placeholder")
 */

import { useEffect, useState } from "preact/hooks";

const en = {
  prechat: {
    heading: "Welcome to support",
    subheading: "Optional — share your details so we can help faster.",
    skip: "Skip — chat anonymously",
    submit: "Start chat",
    edit_heading: "Your info",
    edit_button: "Edit my info",
    save: "Save",
    cancel: "Cancel",
    placeholder: "(optional)",
    invalid: "Doesn't match the expected format.",
  },
  header: {
    title: "Support",
    online: "Online",
    reconnecting: "Reconnecting…",
  },
  banner: {
    reconnecting:
      "Reconnecting… messages will be delivered when the connection is back.",
    restored_one: "Restored 1 message.",
    restored_many: "Restored {{count}} messages.",
    service_suspended: "Service suspended.",
  },
  composer: {
    empty: "Send a message to start the conversation.",
    placeholder: "Type a message…",
    closed: "Conversation closed",
    send: "Send",
    attach_image: "Attach image",
    only_images: "Only png/jpeg/webp/gif",
    max_size: "Max 5 MB",
    presign_failed: "Presign failed",
    upload_failed: "Upload failed",
    not_connected: "Not connected",
  },
  typing: {
    one: "{{name}} is typing…",
    other: "{{name}} are typing…",
    fallback: "Support",
  },
  close_button: "Close",
};

const tr: typeof en = {
  prechat: {
    heading: "Destek hattına hoş geldiniz",
    subheading: "İsteğe bağlı — daha hızlı yardım için bilgilerinizi paylaşabilirsiniz.",
    skip: "Atla — anonim devam et",
    submit: "Sohbeti başlat",
    edit_heading: "Bilgileriniz",
    edit_button: "Bilgilerimi düzenle",
    save: "Kaydet",
    cancel: "İptal",
    placeholder: "(isteğe bağlı)",
    invalid: "Beklenen biçimle eşleşmiyor.",
  },
  header: {
    title: "Destek",
    online: "Çevrimiçi",
    reconnecting: "Yeniden bağlanıyor…",
  },
  banner: {
    reconnecting:
      "Yeniden bağlanılıyor… bağlantı geri geldiğinde mesajlar iletilecek.",
    restored_one: "1 mesaj geri yüklendi.",
    restored_many: "{{count}} mesaj geri yüklendi.",
    service_suspended: "Hizmet askıya alındı.",
  },
  composer: {
    empty: "Görüşmeyi başlatmak için bir mesaj gönderin.",
    placeholder: "Mesaj yazın…",
    closed: "Görüşme kapatıldı",
    send: "Gönder",
    attach_image: "Görsel ekle",
    only_images: "Yalnızca png/jpeg/webp/gif",
    max_size: "En fazla 5 MB",
    presign_failed: "Yetkilendirme başarısız",
    upload_failed: "Yükleme başarısız",
    not_connected: "Bağlantı yok",
  },
  typing: {
    one: "{{name}} yazıyor…",
    other: "{{name}} yazıyor…",
    fallback: "Destek",
  },
  close_button: "Kapat",
};

const catalogs: Record<string, typeof en> = { en, tr };

const SUPPORTED = ["en", "tr"] as const;
export type WidgetLocale = (typeof SUPPORTED)[number];

let current: WidgetLocale = "en";
const subs = new Set<() => void>();

export function setLocale(loc: string) {
  const norm = (
    SUPPORTED.includes(loc.slice(0, 2) as WidgetLocale) ? loc.slice(0, 2) : "en"
  ) as WidgetLocale;
  if (norm !== current) {
    current = norm;
    subs.forEach((fn) => fn());
  }
}
export function getLocale(): WidgetLocale {
  return current;
}

function get(path: string): string {
  const parts = path.split(".");
  let node: unknown = catalogs[current];
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as object)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return path;
    }
  }
  return typeof node === "string" ? node : path;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let out = get(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return out;
}

/** React/Preact hook so components re-render on locale change. */
export function useLocale(): WidgetLocale {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  }, []);
  return current;
}
