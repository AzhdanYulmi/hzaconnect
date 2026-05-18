import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Status =
  | { ok: true; customer_name: string; expires_at: number }
  | { ok: false; reason: string; customer_name: string | null };

export function LicenseBanner() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/license/status");
        if (!res.ok) return;
        const data = (await res.json()) as Status;
        if (!cancelled) setStatus(data);
      } catch {
        // ignore — banner just stays hidden
      }
    };
    void fetchStatus();
    // Poll on a sane cadence; the WS-disconnect listener below makes the
    // banner appear near-instantly when an active session is suspended.
    const t = setInterval(fetchStatus, 15_000);
    // The realtime layer fires this event whenever the agent's WS drops
    // (license suspension is one of the reasons). On any drop we refresh
    // the status so the banner appears immediately.
    const onDrop = () => void fetchStatus();
    window.addEventListener("hzaconnect:ws-disconnect", onDrop);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener("hzaconnect:ws-disconnect", onDrop);
    };
  }, []);

  if (!status || status.ok) return null;

  return (
    <div role="alert" className="license-banner">
      {t("license.suspended")}
    </div>
  );
}
