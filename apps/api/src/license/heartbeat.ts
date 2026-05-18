import { config } from "../config.js";
import {
  getLicenseState,
  setLicenseState,
  type LicenseState,
} from "./state.js";

/**
 * Periodically POST to the license server's /heartbeat. The server's
 * response decides our state:
 *  - "ok"          → ok:true (refresh lastCheckOk)
 *  - "suspended"   → ok:false ("suspended")
 *  - "expired"     → ok:false ("server_says_expired")
 *  - "revoked"     → ok:false ("revoked")
 *  - "unknown_*"   → ok:false ("unknown_license")
 *  - network error → keep current state, but if lastCheckOk is older than
 *                    LICENSE_HEARTBEAT_GRACE_SECONDS, downgrade to ok:false
 */
export function startHeartbeat(opts: {
  logger?: { info?: any; warn?: any; error?: any };
}): { stop: () => void } {
  if (config.LICENSE_ENFORCEMENT === "disabled") {
    opts.logger?.info?.("heartbeat disabled (LICENSE_ENFORCEMENT=disabled)");
    return { stop: () => {} };
  }

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    const state = getLicenseState();
    const payload = state.payload;
    if (!payload) {
      // No verified token → nothing to heartbeat about.
      return;
    }
    try {
      const res = await fetch(
        `${config.LICENSE_SERVER_URL.replace(/\/+$/, "")}/heartbeat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            license_id: payload.license_id,
            customer_id: payload.customer_id,
            origin: config.PUBLIC_ORIGIN,
          }),
          // Don't hold the event loop forever on a slow license server.
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) {
        throw new Error(`heartbeat http ${res.status}`);
      }
      const body = (await res.json()) as { status: string };
      switch (body.status) {
        case "ok": {
          const next: LicenseState = {
            ok: true,
            payload,
            lastCheckOk: Date.now(),
          };
          setLicenseState(next);
          break;
        }
        case "suspended":
          setLicenseState({ ok: false, reason: "suspended", payload });
          break;
        case "revoked":
          setLicenseState({ ok: false, reason: "revoked", payload });
          break;
        case "expired":
          setLicenseState({ ok: false, reason: "expired_per_server", payload });
          break;
        case "unknown_license":
          setLicenseState({ ok: false, reason: "unknown_license", payload });
          break;
        default:
          opts.logger?.warn?.(
            { status: body.status },
            "unexpected heartbeat status",
          );
      }
    } catch (err) {
      // Network / server-down. Hold steady but watch the grace window.
      const last = state.ok ? state.lastCheckOk : state.lastCheckOk ?? 0;
      const ageMs = Date.now() - last;
      if (ageMs > config.LICENSE_HEARTBEAT_GRACE_SECONDS * 1000) {
        setLicenseState({
          ok: false,
          reason: "heartbeat_outage",
          payload,
        });
      }
      opts.logger?.warn?.({ err, ageMs }, "heartbeat failed");
    }
  };

  // Fire one immediately, then on interval.
  void tick();
  timer = setInterval(tick, config.LICENSE_HEARTBEAT_SECONDS * 1000);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}
