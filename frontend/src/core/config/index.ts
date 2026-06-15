import { env } from "@/env";

// Side-effect import: registers the global `Window.oclawDesktop` augmentation
// so this module can read the bridge in a type-safe way.
import "@/core/desktop/types";

/**
 * The preload bridge exposed on `window.oclawDesktop` by Electron.
 *
 * Detection is intentionally a single existence check so the rest of the
 * frontend can branch on `isDesktop()` without importing any Electron
 * surface directly. When this property is absent we are in the web build.
 */
const DESKTOP_BRIDGE_KEY = "oclawDesktop";
const DESKTOP_DEV_SERVER_PORT = "18659";

let _desktopPort: number =
  typeof window !== "undefined" && window.oclawDesktop?.gatewayPort != null
    ? window.oclawDesktop.gatewayPort
    : 19987;

export async function initGatewayPort(): Promise<void> {
  if (!isDesktop()) return;
  try {
    const cfg = await window.oclawDesktop?.getGatewayConfig();
    if (cfg?.port) _desktopPort = cfg.port;
  } catch {
    // fallback to default port
  }
}

export function isDesktop(): boolean {
  return (
    typeof window !== "undefined" && DESKTOP_BRIDGE_KEY in window
  );
}

/**
 * Electron renderer loaded from the Next.js dev server.
 *
 * In this mode the gateway is owned by `desktop-electron/scripts/dev.mjs`,
 * while renderer API calls use Next rewrites for cookie-based auth.
 */
export function isDesktopDevMode(): boolean {
  return (
    isDesktop() &&
    typeof window !== "undefined" &&
    window.location.port === DESKTOP_DEV_SERVER_PORT
  );
}

/**
 * Desktop mode where Electron's BackendManager owns the gateway lifecycle.
 *
 * Packaged desktop uses this path; desktop dev does not, because the dev
 * launcher starts and respawns the gateway process.
 */
export function isDesktopBackendManagedMode(): boolean {
  return isDesktop() && !isDesktopDevMode();
}

function getBaseOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:9191";
}

export function getBackendBaseURL(): string {
  if (isDesktop()) {
    // In dev mode the frontend is served by Next.js on 18659 and proxies to
    // the gateway, so use a same-origin (empty) base. In the packaged static
    // export, talk to the embedded gateway directly.
    if (isDesktopDevMode()) {
      return "";
    }
    return `http://127.0.0.1:${_desktopPort}`;
  }

  if (env.NEXT_PUBLIC_BACKEND_BASE_URL) {
    return new URL(env.NEXT_PUBLIC_BACKEND_BASE_URL, getBaseOrigin())
      .toString()
      .replace(/\/+$/, "");
  } else {
    return "";
  }
}

export function getLangGraphBaseURL(isMock?: boolean): string {
  if (isDesktop()) {
    if (isDesktopDevMode()) {
      return `${window.location.origin}/api/langgraph`;
    }
    return `http://127.0.0.1:${_desktopPort}/api`;
  }

  if (env.NEXT_PUBLIC_LANGGRAPH_BASE_URL) {
    return new URL(
      env.NEXT_PUBLIC_LANGGRAPH_BASE_URL,
      getBaseOrigin(),
    ).toString();
  } else if (isMock) {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/mock/api`;
    }
    return "http://localhost:9192/mock/api";
  } else {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/langgraph`;
    }
    return "http://localhost:9191/api/langgraph";
  }
}
