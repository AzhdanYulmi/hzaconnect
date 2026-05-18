/**
 * In-memory state of the API's license. Updated by the verifier at startup
 * and the heartbeat task on every tick.
 */
import type { LicensePayload } from "@hzaconnect/license";

export type LicenseState =
  | { ok: true; payload: LicensePayload; lastCheckOk: number; reason?: string }
  | {
      ok: false;
      reason: string;
      // We still expose the cached payload (if any) so the dashboard can show
      // *which* customer is suspended.
      payload?: LicensePayload;
      lastCheckOk?: number;
    };

let current: LicenseState = {
  ok: false,
  reason: "uninitialized",
};

const subscribers = new Set<(s: LicenseState) => void>();

export function getLicenseState(): LicenseState {
  return current;
}

export function setLicenseState(next: LicenseState): void {
  current = next;
  for (const fn of subscribers) {
    try {
      fn(next);
    } catch {}
  }
}

export function onLicenseStateChange(fn: (s: LicenseState) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
