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

/**
 * Next.js App Router static-export RSC payload file naming.
 *
 * During client-side navigation, App Router fetches the destination URL with
 * `RSC: 1` header to retrieve the RSC Flight payload.  In a static export,
 * each pre-rendered page emits a `__next.<segments>.__PAGE__.txt` file under
 * its own directory.  Dynamic segments (e.g. `[thread_id]`) are encoded as
 * `$d$<paramname>`.
 *
 * Only the placeholder variant is pre-rendered for dynamic routes
 * (e.g. /workspace/chats/new, /workspace/coding/__init__).  All other ids
 * have no `.txt` file.  Without a dedicated handler, the fetch returns the
 * fallback HTML and Next.js logs
 * "Failed to fetch RSC payload for ... Falling back to browser navigation",
 * which triggers a full page reload — killing active SSE streams and
 * interrupting running coding-agent / chat tasks on tab switches.
 *
 * For RSC requests on dynamic routes, we therefore return the placeholder's
 * `__PAGE__.txt`.  Because `[thread_id]/page.tsx` is a client component, the
 * RSC payload only carries component references (not thread-specific data);
 * the actual id is read from usePathname() at runtime, so serving the
 * placeholder payload for any id is safe.
 */
const CHATS_DYNAMIC_RSC =
  "workspace/chats/new/__next.workspace.chats.$d$thread_id.__PAGE__.txt";
const CODING_DYNAMIC_RSC =
  "workspace/coding/__init__/__next.workspace.coding.$d$projectId.__PAGE__.txt";

export function resolveFrontendRequestPath(
  input: string,
  isRsc = false,
): string {
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

  // ── RSC payload requests (Next.js App Router client-side navigation) ──
  // Next.js sends `RSC: 1` header during client-side navigation to fetch
  // the Flight payload instead of HTML.  In a static export each pre-rendered
  // page directory contains a `__next.<segments>.__PAGE__.txt` file.
  //
  // If we return HTML for an RSC request, Next.js logs
  //   "Failed to fetch RSC payload for ... Falling back to browser navigation"
  // and performs a FULL page reload — which kills every active SSE stream
  // (chat replies, coding-agent runs).  This is the #1 cause of tab-switch
  // task interruptions in the desktop packaged build.
  //
  // For dynamic routes (e.g. /workspace/chats/<id>) only one placeholder
  // variant is pre-rendered, so we map every id to that placeholder's
  // __PAGE__.txt.  For static routes (e.g. /workspace/coding) we compute
  // the canonical __PAGE__.txt path directly.
  if (isRsc) {
    // Dynamic routes → placeholder RSC payload
    if (
      clean.startsWith("workspace/chats/") &&
      !clean.startsWith("workspace/chats/new")
    ) {
      return CHATS_DYNAMIC_RSC;
    }
    if (
      clean.startsWith("workspace/agents/") &&
      clean.includes("/chats/")
    ) {
      // Agent chat routes share the ChatPage component; reuse chats RSC.
      return CHATS_DYNAMIC_RSC;
    }
    if (
      clean.startsWith("workspace/coding/") &&
      !clean.startsWith("workspace/coding/new") &&
      !clean.startsWith("workspace/coding/__init__")
    ) {
      return CODING_DYNAMIC_RSC;
    }

    // Static routes → canonical __PAGE__.txt path.
    //   pathname ""               → "__next.__PAGE__.txt"
    //   pathname "workspace"      → "workspace/__next.workspace.__PAGE__.txt"
    //   pathname "workspace/coding"→ "workspace/coding/__next.workspace.coding.__PAGE__.txt"
    if (!clean) {
      return "__next.__PAGE__.txt";
    }
    const segments = clean.replaceAll("/", ".");
    return `${clean}/__next.${segments}.__PAGE__.txt`;
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

  // Coding workspace: "workspace/coding/<projectId>" is a dynamic route.
  // The desktop build pre-renders exactly one placeholder via
  // generateStaticParams (projectId: "__init__"), producing
  // workspace/coding/__init__.html. For any other projectId, fall back to
  // that pre-rendered shell — page.tsx is a client component that reads
  // projectId from usePathname() at runtime and loads the correct project.
  //
  // IMPORTANT: the fallback MUST be __init__.html (the project detail shell),
  // NOT workspace/coding.html (which is the project gallery at
  // /workspace/coding). Returning the gallery HTML causes the client router
  // to repeatedly try to reconcile the URL vs. the rendered component,
  // resulting in an infinite refresh loop.
  if (
    clean.startsWith("workspace/coding/") &&
    !clean.startsWith("workspace/coding/new")
  ) {
    return "workspace/coding/__init__.html";
  }

  return `${clean}.html`;
}

export function getFrontendURLPath(url: string, isRsc = false): string {
  const parsed = new URL(url);
  return resolveFrontendRequestPath(
    parsed.pathname + parsed.search + parsed.hash,
    isRsc,
  );
}
