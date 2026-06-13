import { env } from "@/env";

// ── Desktop (Tauri) detection ──────────────────────────────────────────────

/** Detect if running inside Tauri desktop shell. */
export function isDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

/** Default gateway port used by the embedded backend. */
const DESKTOP_GATEWAY_PORT =
  typeof window !== "undefined" &&
  (window as unknown as Record<string, unknown>).__TAURI_GATEWAY_PORT__ != null
    ? Number(
        (window as unknown as Record<string, unknown>).__TAURI_GATEWAY_PORT__,
      )
    : 9987;

function getBaseOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  // Fallback for SSR
  return "http://localhost:9191";
}

export function getBackendBaseURL() {
  // In desktop dev mode, Next.js rewrites proxy to gateway (handles auth cookies).
  // In desktop production (static dist), connect directly to embedded gateway.
  if (isDesktop()) {
    // dev: window.location is localhost:8659 (Next.js), use rewrite proxy
    if (typeof window !== "undefined" && window.location.port === "8659") {
      return "";
    }
    return `http://127.0.0.1:${DESKTOP_GATEWAY_PORT}`;
  }

  if (env.NEXT_PUBLIC_BACKEND_BASE_URL) {
    return new URL(env.NEXT_PUBLIC_BACKEND_BASE_URL, getBaseOrigin())
      .toString()
      .replace(/\/+$/, "");
  } else {
    return "";
  }
}

export function getLangGraphBaseURL(isMock?: boolean) {
  // In desktop dev mode, use Next.js rewrite proxy (handles auth).
  // In desktop production, connect directly to embedded gateway.
  if (isDesktop()) {
    if (typeof window !== "undefined" && window.location.port === "8659") {
      // Dev mode: use rewrite proxy
      return `${window.location.origin}/api/langgraph`;
    }
    return `http://127.0.0.1:${DESKTOP_GATEWAY_PORT}/api`;
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
    // LangGraph SDK requires a full URL, construct it from current origin
    if (typeof window !== "undefined") {
      return `${window.location.origin}/api/langgraph`;
    }
    // Fallback for SSR
    return "http://localhost:9191/api/langgraph";
  }
}
