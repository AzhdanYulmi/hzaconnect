import { useEffect, useState } from "preact/hooks";
import { t, getLocale } from "./i18n.js";

export type IdentifierField = {
  kind: "player_id" | "email" | "phone" | "username" | "custom";
  custom_label?: string;
  required?: boolean;
  regex?: string;
  label_en?: string;
  label_tr?: string;
};

const DEFAULT_LABELS: Record<IdentifierField["kind"], { en: string; tr: string }> = {
  player_id: { en: "Player ID", tr: "Oyuncu Kimliği" },
  email: { en: "Email", tr: "E-posta" },
  phone: { en: "Phone", tr: "Telefon" },
  username: { en: "Username", tr: "Kullanıcı adı" },
  custom: { en: "Custom", tr: "Özel" },
};

function fieldLabel(field: IdentifierField): string {
  const loc = getLocale();
  if (loc === "tr" && field.label_tr) return field.label_tr;
  if (field.label_en) return field.label_en;
  if (field.kind === "custom" && field.custom_label) return field.custom_label;
  return DEFAULT_LABELS[field.kind][loc === "tr" ? "tr" : "en"];
}

type ValueMap = Record<string, string>;

export function PreChat({
  fields,
  onSubmit,
  onSkip,
  onCancel,
  initial,
  mode,
}: {
  fields: IdentifierField[];
  onSubmit: (
    values: Array<{ kind: IdentifierField["kind"]; custom_label?: string; value: string }>,
  ) => void;
  onSkip?: () => void;
  onCancel?: () => void;
  initial?: ValueMap;
  mode: "first" | "edit";
}) {
  const [values, setValues] = useState<ValueMap>(initial ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    setValues(initial ?? {});
  }, [JSON.stringify(initial ?? {})]);

  function keyOf(f: IdentifierField): string {
    return f.kind === "custom" ? `custom:${f.custom_label ?? ""}` : f.kind;
  }

  function submit(e: Event) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const picked: Array<{ kind: IdentifierField["kind"]; custom_label?: string; value: string }> = [];
    for (const f of fields) {
      const key = keyOf(f);
      const v = (values[key] ?? "").trim();
      if (!v) {
        if (f.required) errs[key] = t("prechat.invalid");
        continue;
      }
      if (f.regex) {
        try {
          if (!new RegExp(f.regex).test(v)) errs[key] = t("prechat.invalid");
          else picked.push({ kind: f.kind, custom_label: f.custom_label, value: v });
        } catch {
          picked.push({ kind: f.kind, custom_label: f.custom_label, value: v });
        }
      } else {
        picked.push({ kind: f.kind, custom_label: f.custom_label, value: v });
      }
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    onSubmit(picked);
  }

  return (
    <form class="hza-prechat" onSubmit={submit}>
      <h2 class="hza-prechat-heading">
        {mode === "first" ? t("prechat.heading") : t("prechat.edit_heading")}
      </h2>
      {mode === "first" && (
        <p class="hza-prechat-sub">{t("prechat.subheading")}</p>
      )}
      {fields.map((f) => {
        const key = keyOf(f);
        const err = errors[key];
        const label = fieldLabel(f) + (f.required ? " *" : "");
        return (
          <label key={key} class="hza-prechat-field">
            <span class="hza-prechat-label">{label}</span>
            <input
              type={f.kind === "email" ? "email" : "text"}
              class={`hza-prechat-input${err ? " hza-prechat-input--error" : ""}`}
              placeholder={t("prechat.placeholder")}
              value={values[key] ?? ""}
              onInput={(e) =>
                setValues((m) => ({
                  ...m,
                  [key]: (e.currentTarget as HTMLInputElement).value,
                }))
              }
              required={!!f.required}
              aria-label={fieldLabel(f)}
            />
            {err && <span class="hza-prechat-error">{err}</span>}
          </label>
        );
      })}
      <div class="hza-prechat-actions">
        {mode === "first" && onSkip && (
          <button type="button" class="hza-btn hza-btn--ghost" onClick={onSkip}>
            {t("prechat.skip")}
          </button>
        )}
        {mode === "edit" && onCancel && (
          <button type="button" class="hza-btn hza-btn--ghost" onClick={onCancel}>
            {t("prechat.cancel")}
          </button>
        )}
        <button type="submit" class="hza-btn hza-btn--primary">
          {mode === "first" ? t("prechat.submit") : t("prechat.save")}
        </button>
      </div>
    </form>
  );
}
