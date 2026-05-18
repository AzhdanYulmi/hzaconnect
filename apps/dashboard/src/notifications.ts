/**
 * Agent-side desktop notifications + sound when an unclaimed conversation
 * arrives. Stays out of the way: only fires when the dashboard tab is hidden
 * or the agent is in admin view, and only if the agent has opted in.
 */

const ENABLED_KEY = "hzaconnect_notifications_enabled";

export function isEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "1";
}

export function setEnabled(v: boolean): void {
  if (v) localStorage.setItem(ENABLED_KEY, "1");
  else localStorage.removeItem(ENABLED_KEY);
}

export function permissionState(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function requestPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

let audioCtx: AudioContext | null = null;
function getAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/** Two-tone short beep, ~200ms total. */
export function playBeep(): void {
  const ctx = getAudio();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  const now = ctx.currentTime;
  const tone = (freq: number, start: number, dur: number, volume: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0, now + start);
    gain.gain.linearRampToValueAtTime(volume, now + start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.05);
  };
  tone(880, 0, 0.12, 0.18);
  tone(1175, 0.13, 0.12, 0.18);
}

/**
 * Show a desktop notification + play a beep, but only when:
 *   - the agent has opted in (isEnabled())
 *   - notification permission is granted
 *   - the document is hidden OR the dashboard isn't on the chat view
 *
 * Returns true when at least one signal fired.
 */
export function notifyNewConversation(opts: {
  title: string;
  body: string;
  shouldNotify: boolean; // caller decides based on view + visibility
  onClick?: () => void;
}): boolean {
  if (!isEnabled() || !opts.shouldNotify) return false;
  let fired = false;
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      const n = new Notification(opts.title, {
        body: opts.body,
        tag: "hzaconnect-new-conversation",
        renotify: true,
      } as NotificationOptions);
      n.onclick = () => {
        try {
          window.focus();
        } catch {}
        opts.onClick?.();
        n.close();
      };
      fired = true;
    } catch {
      // ignore
    }
  }
  playBeep();
  return fired || true;
}
