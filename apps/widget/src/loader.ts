/**
 * hzaconnect widget loader (IIFE).
 * Embedded via:
 *   <script src="https://chat.casino.example/widget.js" async></script>
 *
 * - Mounts a closed Shadow DOM launcher on the host page (no CSS/JS pollution).
 * - Persists an anonymous session ID in localStorage.
 * - On open, injects an iframe served from the chat origin for full isolation.
 * - Communicates with the iframe via postMessage with strict origin check.
 */

type HostMsg =
  | { type: "HZA_READY" }
  | {
      type: "HZA_HANDSHAKE_ACK";
      session_token: string;
      session_id: string;
      origin: string;
      locale?: string;
    }
  | { type: "HZA_SET_CONTEXT"; context: Record<string, unknown> }
  | { type: "HZA_SET_LOCALE"; locale: string };

type FrameMsg =
  | { type: "HZA_HANDSHAKE_REQ" }
  | { type: "HZA_UNREAD"; count: number }
  | { type: "HZA_RESIZE"; height?: number; width?: number }
  | { type: "HZA_CLOSE" };

const SESSION_ID_KEY = "hzaconnect_session_id";
const SESSION_TOKEN_KEY = "hzaconnect_session_token";

type IdentifierInput = {
  kind: "player_id" | "email" | "phone" | "username" | "custom";
  value: string;
  custom_label?: string;
};
type HZAConnect = {
  open: () => void;
  close: () => void;
  toggle: () => void;
  identify: (ssoToken: string) => Promise<void>;
  /**
   * Programmatic equivalent of the player typing into the pre-chat form.
   * Useful when the casino site already knows partial identity (e.g. the
   * player is signed into the casino site itself). Treated as `source='self'`.
   */
  setIdentifiers: (ids: IdentifierInput[]) => Promise<void>;
  setContext: (ctx: Record<string, unknown>) => void;
  setLocale: (locale: string) => void;
};

(function main() {
  const selfScript =
    (document.currentScript as HTMLScriptElement | null) ??
    (Array.from(document.getElementsByTagName("script")).find((s) =>
      (s.src || "").includes("widget.js"),
    ) as HTMLScriptElement | undefined);
  if (!selfScript) return;

  const origin = new URL(selfScript.src, location.href).origin;
  const deployment = selfScript.dataset.deployment ?? "default";
  const position = (selfScript.dataset.position as "right" | "left") ?? "right";

  // Locale resolution order: data-locale attr → navigator → "en"
  function resolveLocale(): string {
    const fromAttr = selfScript!.dataset.locale;
    if (fromAttr) return fromAttr;
    const nav = navigator?.language ?? "en";
    return nav;
  }
  let locale = resolveLocale();

  let sessionId = localStorage.getItem(SESSION_ID_KEY);
  let sessionToken = localStorage.getItem(SESSION_TOKEN_KEY);
  let hostContext: Record<string, unknown> = { deployment, url: location.href };

  let iframeEl: HTMLIFrameElement | null = null;
  let unreadCount = 0;
  let opened = false;
  let badgeEl: HTMLDivElement | null = null;
  let panelEl: HTMLDivElement | null = null;
  let launcherEl: HTMLButtonElement | null = null;

  async function ensureSession() {
    if (sessionId && sessionToken) {
      // try refresh
      try {
        const res = await fetch(`${origin}/api/widget/session/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: sessionToken }),
        });
        if (res.ok) {
          const data = await res.json();
          sessionId = data.session_id;
          sessionToken = data.session_token;
          localStorage.setItem(SESSION_ID_KEY, sessionId!);
          localStorage.setItem(SESSION_TOKEN_KEY, sessionToken!);
          return;
        }
      } catch {}
    }
    const res = await fetch(`${origin}/api/widget/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ casino_context: hostContext }),
    });
    if (!res.ok) throw new Error("session_create_failed");
    const data = await res.json();
    sessionId = data.session_id;
    sessionToken = data.session_token;
    localStorage.setItem(SESSION_ID_KEY, sessionId!);
    localStorage.setItem(SESSION_TOKEN_KEY, sessionToken!);
  }

  function mount() {
    const host = document.createElement("div");
    host.setAttribute("data-hzaconnect-root", "");
    host.style.all = "initial";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "closed" });

    const container = document.createElement("div");
    container.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .wrap {
          position: fixed;
          ${position}: 20px;
          bottom: 20px;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        }
        @keyframes hza-launcher-in {
          from { transform: scale(0.6) translateY(12px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes hza-launcher-pulse {
          0%, 100% { box-shadow: 0 8px 24px -6px rgba(67, 56, 202, 0.45),
                                 0 4px 8px -2px rgba(15, 23, 42, 0.12); }
          50%      { box-shadow: 0 12px 32px -4px rgba(67, 56, 202, 0.55),
                                 0 4px 8px -2px rgba(15, 23, 42, 0.12); }
        }
        .launcher {
          width: 60px; height: 60px; border-radius: 50%;
          background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
          color: #fff;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          box-shadow: 0 8px 24px -6px rgba(67, 56, 202, 0.45),
                      0 4px 8px -2px rgba(15, 23, 42, 0.12);
          border: none;
          transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1),
                      box-shadow 200ms cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          animation: hza-launcher-in 320ms cubic-bezier(0.16, 1, 0.3, 1),
                     hza-launcher-pulse 3s ease-in-out 1.6s 1;
        }
        .launcher:hover { transform: scale(1.06); }
        .launcher:active { transform: scale(0.96); }
        .launcher svg { width: 26px; height: 26px; }
        .launcher .icon-open, .launcher .icon-close {
          position: absolute; transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1),
                              opacity 200ms ease;
        }
        .launcher .icon-close { transform: rotate(-45deg) scale(0.7); opacity: 0; }
        .launcher.open .icon-open { transform: rotate(45deg) scale(0.7); opacity: 0; }
        .launcher.open .icon-close { transform: rotate(0deg) scale(1); opacity: 1; }
        .badge {
          position: absolute; top: -4px; ${position === "left" ? "left" : "right"}: -4px;
          background: #ef4444; color: #fff;
          font-size: 11px; font-weight: 700;
          border-radius: 999px; padding: 2px 6px; min-width: 20px;
          text-align: center; line-height: 1.2;
          box-shadow: 0 2px 6px rgba(239, 68, 68, 0.35);
          border: 2px solid #fff;
          display: none;
          animation: hza-launcher-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .badge.visible { display: block; }
        @keyframes hza-panel-in {
          from { transform: translateY(16px) scale(0.98); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes hza-panel-out {
          from { transform: translateY(0) scale(1); opacity: 1; }
          to   { transform: translateY(8px) scale(0.98); opacity: 0; }
        }
        .panel {
          position: fixed;
          ${position}: 20px;
          bottom: 96px;
          width: 380px;
          max-width: calc(100vw - 40px);
          height: min(640px, calc(100vh - 130px));
          background: #fff;
          border-radius: 18px;
          overflow: hidden;
          box-shadow: 0 24px 64px -16px rgba(15, 23, 42, 0.28),
                      0 8px 24px -8px rgba(15, 23, 42, 0.12);
          transform-origin: ${position} bottom;
          display: none;
        }
        .panel.open {
          display: block;
          animation: hza-panel-in 240ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .panel iframe {
          width: 100%; height: 100%; border: 0;
          background: #fff;
        }
        @media (max-width: 480px) {
          .panel {
            ${position}: 0;
            bottom: 0;
            width: 100vw;
            max-width: 100vw;
            height: 100vh;
            border-radius: 0;
          }
        }
      </style>
      <div class="wrap">
        <div class="panel"></div>
        <button class="launcher" aria-label="Open support chat">
          <svg class="icon-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6 6 18"/>
            <path d="m6 6 12 12"/>
          </svg>
          <div class="badge"></div>
        </button>
      </div>
    `;
    shadow.appendChild(container);

    launcherEl = shadow.querySelector(".launcher") as HTMLButtonElement;
    panelEl = shadow.querySelector(".panel") as HTMLDivElement;
    badgeEl = shadow.querySelector(".badge") as HTMLDivElement;

    launcherEl.addEventListener("click", () => {
      if (opened) doClose();
      else doOpen();
    });
  }

  function doOpen() {
    if (opened || !panelEl) return;
    opened = true;
    unreadCount = 0;
    updateBadge();
    if (!iframeEl) {
      iframeEl = document.createElement("iframe");
      iframeEl.setAttribute("allow", "clipboard-write");
      iframeEl.setAttribute(
        "sandbox",
        "allow-scripts allow-forms allow-same-origin",
      );
      iframeEl.src = `${origin}/widget/frame.html?deployment=${encodeURIComponent(
        deployment,
      )}`;
      panelEl.appendChild(iframeEl);
    }
    panelEl.classList.add("open");
    launcherEl?.classList.add("open");
    launcherEl?.setAttribute("aria-label", "Close support chat");
  }

  function doClose() {
    opened = false;
    panelEl?.classList.remove("open");
    launcherEl?.classList.remove("open");
    launcherEl?.setAttribute("aria-label", "Open support chat");
  }

  function updateBadge() {
    if (!badgeEl) return;
    if (unreadCount > 0) {
      badgeEl.textContent = String(unreadCount > 99 ? "99+" : unreadCount);
      badgeEl.classList.add("visible");
    } else {
      badgeEl.classList.remove("visible");
    }
  }

  window.addEventListener("message", (evt) => {
    if (evt.origin !== origin) return;
    if (!iframeEl || evt.source !== iframeEl.contentWindow) return;
    const data = evt.data as FrameMsg;
    if (!data || typeof data !== "object") return;
    switch (data.type) {
      case "HZA_HANDSHAKE_REQ":
        if (sessionToken && sessionId) {
          const msg: HostMsg = {
            type: "HZA_HANDSHAKE_ACK",
            session_token: sessionToken,
            session_id: sessionId,
            origin: location.origin,
            locale,
          };
          iframeEl.contentWindow?.postMessage(msg, origin);
          const ctx: HostMsg = { type: "HZA_SET_CONTEXT", context: hostContext };
          iframeEl.contentWindow?.postMessage(ctx, origin);
        }
        break;
      case "HZA_UNREAD":
        if (!opened) {
          unreadCount = data.count;
          updateBadge();
        }
        break;
      case "HZA_CLOSE":
        doClose();
        break;
    }
  });

  const publicApi: HZAConnect = {
    open: () => doOpen(),
    close: () => doClose(),
    toggle: () => (opened ? doClose() : doOpen()),
    identify: async (_ssoToken: string) => {
      // Stub for Phase 2 SSO. Will call /api/widget/session/upgrade.
      return;
    },
    setContext: (ctx: Record<string, unknown>) => {
      hostContext = { ...hostContext, ...ctx };
      if (iframeEl?.contentWindow) {
        const msg: HostMsg = { type: "HZA_SET_CONTEXT", context: hostContext };
        iframeEl.contentWindow.postMessage(msg, origin);
      }
    },
    setLocale: (loc: string) => {
      locale = loc;
      if (iframeEl?.contentWindow) {
        const msg: HostMsg = { type: "HZA_SET_LOCALE", locale: loc };
        iframeEl.contentWindow.postMessage(msg, origin);
      }
    },
    setIdentifiers: async (ids: IdentifierInput[]) => {
      // The session token lives in localStorage of the chat origin only —
      // we can't read it from the host page. Use the loader's stored token
      // (also in chat-origin localStorage, but the loader proxies via fetch).
      if (!sessionToken) return;
      for (const id of ids) {
        try {
          await fetch(`${origin}/api/widget/session/identifiers`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify(id),
          });
        } catch {
          // host-side programmatic identification is best-effort
        }
      }
    },
  };
  ensureSession()
    .then(() => {
      mount();
      // Only expose the public API once the launcher is mounted, so callers
      // (and e2e tests) can rely on `window.hzaconnect` implying readiness.
      (window as unknown as { hzaconnect: HZAConnect }).hzaconnect = publicApi;
      window.dispatchEvent(new CustomEvent("hzaconnect:ready"));
    })
    .catch((err) => {
      // Silent-ish: widget fails closed, don't break the host page.
      console.warn("[hzaconnect] session init failed", err);
    });
})();
