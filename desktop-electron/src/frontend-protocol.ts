import { extname, normalize, sep } from "node:path";

const ASSET_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".css",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".avif",
  ".txt",
  ".json",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
]);

function stripQueryAndHash(pathname: string): string {
  return pathname.split("?")[0].split("#")[0];
}

function decodePath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function normalizeSafeRelativePath(input: string): string | null {
  const decoded = decodePath(stripQueryAndHash(input));
  if (decoded === null) return null;

  const clean = decoded.replace(/^\/+/, "").replaceAll("\\", "/");
  if (!clean) return "";

  if (clean.split("/").some((segment) => segment === "..")) {
    return null;
  }

  const normalized = normalize(clean).replaceAll(sep, "/");
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.includes("\0")
  ) {
    return null;
  }
  return normalized === "." ? "" : normalized;
}

export function resolveFrontendRequestPath(input: string): string {
  const clean = normalizeSafeRelativePath(input);
  if (clean === null) {
    return "index.html";
  }

  if (!clean || clean === "") {
    return "index.html";
  }

  if (clean === "favicon.svg") {
    return "favicon.svg";
  }

  // _next/ assets: webpack chunk URLs may be absolute (/_next/...) or
  // relative to the current page URL (e.g. workspace/chats/_next/...) when
  // the page is a dynamic route served via the fallback below. Normalize
  // any path containing _next/ to the canonical _next/ prefix so the file
  // is found in the static export directory.
  const nextIdx = clean.indexOf("_next/");
  if (nextIdx >= 0) {
    return clean.slice(nextIdx);
  }

  // Static assets with known extensions — check BEFORE the dynamic route
  // fallback so that resource requests are never accidentally served as
  // HTML pages.
  const ext = extname(clean);
  if (ext && ASSET_EXTENSIONS.has(ext)) {
    return clean;
  }

  // Desktop dynamic route fallback (only for page navigations — paths
  // without a file extension). Chat thread pages are fully client-rendered;
  // only "chats/new" is pre-rendered (via generateStaticParams in the
  // desktop build). For any other thread_id, serve the "new" page — the
  // ChatPage component reads thread_id from useParams() at runtime and
  // loads the correct thread data.
  if (
    clean.startsWith("workspace/chats/") &&
    !clean.startsWith("workspace/chats/new")
  ) {
    return "workspace/chats/new.html";
  }

  // Agent chat pages are not pre-rendered in the desktop build (agent_name
  // is dynamic and unknowable at build time). Fall back to the regular chat
  // page — the client-side router renders the correct agent-specific UI.
  if (
    clean.startsWith("workspace/agents/") &&
    clean.includes("/chats/")
  ) {
    return "workspace/chats/new.html";
  }

  // Coding workspace: "workspace/coding" is pre-rendered as a static page,
  // but "workspace/coding/<projectId>" is a dynamic route. Fall back to the
  // coding page shell — the client-side router renders the correct project.
  if (
    clean.startsWith("workspace/coding/") &&
    !clean.startsWith("workspace/coding/new")
  ) {
    return "workspace/coding.html";
  }

  return `${clean}.html`;
}

export function getFrontendURLPath(url: string): string {
  const parsed = new URL(url);
  return resolveFrontendRequestPath(parsed.pathname + parsed.search + parsed.hash);
}
