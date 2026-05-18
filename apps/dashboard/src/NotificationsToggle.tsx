import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isEnabled,
  permissionState,
  requestPermission,
  setEnabled,
} from "./notifications.js";
import { BellIcon, BellOffIcon } from "./Icons.js";

export function NotificationsToggle() {
  const { t } = useTranslation();
  const [enabled, setEnabledState] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setEnabledState(isEnabled());
    setPerm(permissionState());
  }, []);

  async function toggle() {
    if (!enabled) {
      const p = await requestPermission();
      setPerm(p);
      // Even if the OS denies, we let the agent enable our local toggle —
      // the in-app sound still plays. Notifications API is just additional.
      setEnabled(true);
      setEnabledState(true);
    } else {
      setEnabled(false);
      setEnabledState(false);
    }
  }

  if (perm === "unsupported") return null;

  return (
    <button
      type="button"
      className={`icon-btn ${enabled ? "is-active" : ""}`}
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={t("notifications.toggle")}
      title={
        enabled
          ? t("notifications.on")
          : perm === "denied"
          ? t("notifications.os_denied")
          : t("notifications.off")
      }
    >
      {enabled ? <BellIcon size={16} /> : <BellOffIcon size={16} />}
    </button>
  );
}
