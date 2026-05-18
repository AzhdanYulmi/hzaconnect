import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, authToken, type AgentMe } from "./api.js";
import { LanguageSwitcher } from "./LanguageSwitcher.js";

export function Login({ onLoggedIn }: { onLoggedIn: (m: AgentMe) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(email, password);
      authToken.set(res.access_token);
      onLoggedIn(res.agent);
    } catch (err) {
      setError(t("auth.invalid"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <div className="brand">
          <span className="brand-mark">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <div className="brand-text">
            <span className="brand-name">hzaconnect</span>
          </div>
        </div>
        <LanguageSwitcher />
      </div>
      <h1>{t("auth.signin_heading")}</h1>
      <form onSubmit={submit}>
        <label htmlFor="login-email">{t("auth.email")}</label>
        <input
          id="login-email"
          type="email"
          aria-label={t("auth.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          autoComplete="email"
        />
        <label htmlFor="login-password">{t("auth.password")}</label>
        <input
          id="login-password"
          type="password"
          aria-label={t("auth.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
        <button disabled={busy}>
          {busy ? t("auth.signing_in") : t("auth.signin")}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
