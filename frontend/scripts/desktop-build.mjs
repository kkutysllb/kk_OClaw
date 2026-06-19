/**
 * Desktop build script — produces a static export of the Next.js frontend
 * for use as the Electron `BrowserWindow.loadFile` target.
 *
 * Next.js `output: "export"` is incompatible with several app features
 * (server routes, i18n dynamic segments, SSR auth guards). This script
 * temporarily patches them, runs the build, then restores everything to
 * its original state in a `finally` block.
 */

import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const APP_DIR = join(ROOT, "src", "app");
const BACKUP_DIR = join(ROOT, ".desktop-build-backup");

// ── Resolve gateway port from the shared repo-root .env ───────────────────
// The Electron static export talks to the embedded gateway owned by the
// desktop shell. Falling back to 19987 preserves the default desktop port
// when .env is absent.
function resolveGatewayPort() {
  const envFile = resolve(ROOT, "..", ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key !== "GATEWAY_PORT") continue;
      const val = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      const port = Number.parseInt(val, 10);
      if (Number.isFinite(port) && port > 0) return String(port);
    }
  }
  return "19987";
}
const GATEWAY_PORT = resolveGatewayPort();
console.log(`[desktop-build] using GATEWAY_PORT=${GATEWAY_PORT} (from shared .env or fallback)`);

// ── Directories to move aside (incompatible with static export) ───────────
// api/ — server-only route handlers
// mock/ — server-only mock data routes
// [lang]/ — i18n dynamic segment (no generateStaticParams for static export)
// workspace/agents/[agent_name]/chats/[thread_id]/ — dynamic route, client
//   component. NOT moved aside; given a generateStaticParams layout (created
//   via LAYOUT_PATCHES) so the route survives the static export. The page.tsx
//   reads agent_name from usePathname() and thread_id from useThreadChat().
//
// NOTE: workspace/chats/[thread_id]/ is NOT moved aside — it is kept and
// patched via LAYOUT_PATCHES below to export generateStaticParams, which
// pre-renders /workspace/chats/new. Other thread IDs are handled at runtime
// by the Electron protocol handler fallback + client-side useParams().
//
// NOTE: workspace/coding/[projectId]/ is NOT moved aside — it is kept and
// given a generateStaticParams layout (created via NEW_FILES) so the dynamic
// route survives the static export. The page.tsx is a client component that
// reads projectId from usePathname() at runtime.
const CONFLICT_DIRS = [
  "api",
  "mock",
  "[lang]",
];

// ── Files to move aside (incompatible with static export) ──────────────────
// (none currently — using --webpack avoids the Turbopack _global-error bug)
const CONFLICT_FILES = [];

// ── Temporary files to create for the build, then remove afterwards ────────
// NOTE: _chat-providers.tsx used to be listed here as a "temp file", but both
// web and desktop layouts now permanently import it. It lives in the source
// tree as a normal file and must NOT be created/deleted by this script —
// doing so deletes a tracked source file and breaks `next dev` on web.
const NEW_FILES = [
  {
    // Server-component layout for the coding project dynamic route.
    // page.tsx is "use client" and reads projectId from usePathname(), so it
    // cannot export generateStaticParams itself. This layout is a server
    // component that satisfies Next.js `output: export` by pre-rendering a
    // single placeholder. At runtime the client router loads the page.tsx
    // chunk for ANY projectId and resolves it client-side.
    file: join(APP_DIR, "workspace", "coding", "[projectId]", "layout.tsx"),
    content: `export function generateStaticParams() {
  return [{ projectId: "__init__" }];
}

export default function CodingProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
`,
  },
];

// ── Other source files to patch for static export compatibility ──────────
const SOURCE_PATCHES = [
  {
    // Header contains a docs link to `/${lang}/docs` which is a [lang] dynamic
    // route — moved aside during desktop build (no generateStaticParams).
    // Replace with an external link to the GitHub repo so the landing page
    // still shows a "Docs" entry without hitting a non-existent route.
    file: join(ROOT, "src", "components", "landing", "header.tsx"),
    content: `import { GitHubLogoIcon } from "@radix-ui/react-icons";

import { cn } from "@/lib/utils";

export type HeaderProps = {
  className?: string;
  homeURL?: string;
};

export async function Header({ className, homeURL }: HeaderProps) {
  return (
    <header
      className={cn(
        "container-md fixed top-0 right-0 left-0 z-20 mx-auto flex h-16 items-center justify-between backdrop-blur-xs",
        className,
      )}
    >
      <div className="flex items-center gap-6">
        <a href={homeURL ?? "/"}>
          <h1 className="font-serif text-xl">
            <span className="bg-gradient-to-r from-pink-500 via-amber-400 via-yellow-300 to-cyan-400 bg-clip-text text-transparent font-extrabold tracking-wider">
              KK
            </span>
            <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              OClaw
            </span>
          </h1>
        </a>
      </div>
      <nav className="mr-8 ml-auto flex items-center gap-8 text-sm font-medium">
        <a
          href="https://github.com/kkutysllb/kk_OClaw"
          target="_blank"
          rel="noopener noreferrer"
          className="text-secondary-foreground hover:text-foreground transition-colors"
        >
          Docs
        </a>
        <a
          href="https://github.com/kkutysllb/kk_OClaw"
          target="_blank"
          rel="noopener noreferrer"
          className="text-secondary-foreground hover:text-foreground transition-colors"
        >
          <GitHubLogoIcon className="size-5" />
        </a>
      </nav>
      <hr className="from-border/0 via-border/70 to-border/0 absolute top-16 right-0 left-0 z-10 m-0 h-px w-full border-none bg-linear-to-r" />
    </header>
  );
}
`,
  },
  {
    // ThemeProvider calls usePathname() to force dark theme on the landing
    // page. During `output: "export"` prerendering in Next.js 16 Turbopack,
    // usePathname() returns null and next-themes' internal useContext throws.
    // Desktop doesn't need the forced-theme-on-landing logic, so strip it.
    file: join(ROOT, "src", "components", "theme-provider.tsx"),
    content: `"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
`,
  },
];

// ── Layouts to replace with static versions ───────────────────────────────
const LAYOUT_PATCHES = [
  {
    // Root layout for desktop static export. The original wraps children in
    // ThemeProvider (next-themes) and I18nProvider, both of which call
    // useContext/usePathname and crash during Next.js 16 `output: "export"`
    // prerendering. Desktop pages are client-rendered, so we mount the
    // providers inside a client component (DesktopProviders) that defers
    // context setup to the browser — it renders children directly during SSR.
    file: join(APP_DIR, "layout.tsx"),
    content: `import "@/styles/globals.css";
import "katex/dist/katex.min.css";

import { type ReactNode } from "react";

import { DesktopProviders } from "@/components/desktop/providers";

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <DesktopProviders>{children}</DesktopProviders>
      </body>
    </html>
  );
}
`,
  },
  {
    file: join(APP_DIR, "(auth)", "layout.tsx"),
    content: `import { type ReactNode } from "react";

import { AuthProvider } from "@/core/auth/AuthProvider";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthProvider initialUser={null}>{children}</AuthProvider>;
}
`,
  },
  {
    // Desktop static export: replicate web SSR auth guard on the client.
    // The web version (app/workspace/layout.tsx) calls getServerSideUser()
    // and redirects unauthenticated users to /login, needs_setup to /setup,
    // etc. With \`output: export\` we have no server, so we perform the same
    // checks client-side against /api/v1/auth/me and /api/v1/auth/setup-status,
    // preserving identical behaviour to the web build.
    file: join(APP_DIR, "workspace", "layout.tsx"),
    content: `"use client";

import { type ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AuthProvider } from "@/core/auth/AuthProvider";
import { getDesktopSessionToken } from "@/core/auth/session";
import { buildLoginUrl, type User } from "@/core/auth/types";
import { getBackendBaseURL } from "@/core/config";

import { GatewayUnavailable } from "./gateway-unavailable";
import { WorkspaceContent } from "./workspace-content";

type GuardState =
  | { tag: "loading" }
  | { tag: "authenticated"; user: User }
  | { tag: "unauthenticated" }
  | { tag: "setup" }
  | { tag: "gateway_unavailable" };

export default function WorkspaceLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GuardState>({ tag: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const base = getBackendBaseURL();
      try {
        const token = getDesktopSessionToken();
        const meRes = await fetch(\`\${base}/api/v1/auth/me\`, {
          headers: token ? { Authorization: \`Bearer \${token}\` } : undefined,
          cache: "no-store",
        });

        if (meRes.ok) {
          const data = (await meRes.json()) as User;
          if (cancelled) return;
          if (data.needs_setup) {
            setState({ tag: "setup" });
          } else {
            setState({ tag: "authenticated", user: data });
          }
          return;
        }

        if (meRes.status === 401 || meRes.status === 403) {
          // No session — check whether the system still needs setup.
          try {
            const setupRes = await fetch(\`\${base}/api/v1/auth/setup-status\`, {
              cache: "no-store",
            });
            if (setupRes.ok) {
              const setupData = (await setupRes.json()) as { needs_setup?: boolean };
              if (cancelled) return;
              if (setupData.needs_setup) {
                setState({ tag: "setup" });
                return;
              }
            }
          } catch {
            // fall through to unauthenticated
          }
          if (!cancelled) setState({ tag: "unauthenticated" });
          return;
        }

        // Any other status → gateway in a bad state.
        if (!cancelled) setState({ tag: "gateway_unavailable" });
      } catch {
        if (!cancelled) setState({ tag: "gateway_unavailable" });
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.tag === "unauthenticated") {
      router.replace(buildLoginUrl(pathname || "/workspace"));
    } else if (state.tag === "setup") {
      router.replace("/setup");
    }
  }, [state, pathname, router]);

  if (state.tag === "loading" || state.tag === "unauthenticated" || state.tag === "setup") {
    return null;
  }

  if (state.tag === "gateway_unavailable") {
    return <GatewayUnavailable />;
  }

  return (
    <AuthProvider initialUser={state.user}>
      <WorkspaceContent>{children}</WorkspaceContent>
    </AuthProvider>
  );
}
`,
  },
  {
    // NOTE: This patch must stay in sync with the source
    // app/workspace/workspace-content.tsx. The only difference from the source
    // is the leading comment ("Desktop static export: no cookies() access").
    // If you add/remove a component in the source version, mirror the change
    // here — otherwise the desktop packaged build silently loses the change
    // (historically bitten by the WorkspaceTaskTabs omission, which caused the
    // multi-tab feature to work in dev but vanish in packaged builds).
    file: join(APP_DIR, "workspace", "workspace-content.tsx"),
    content: `import { Toaster } from "sonner";

import { QueryClientProvider } from "@/components/query-client-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { CommandPalette } from "@/components/workspace/command-palette";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";
import { WorkspaceTaskTabs } from "@/components/workspace/workspace-task-tabs";

// Desktop static export: no cookies() access
export function WorkspaceContent({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <QueryClientProvider>
      <SidebarProvider className="h-screen" defaultOpen={false}>
        <WorkspaceSidebar />
        <SidebarInset className="min-w-0">
          <WorkspaceTaskTabs />
          {children}
        </SidebarInset>
      </SidebarProvider>
      <CommandPalette />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
`,
  },
  {
    // Desktop static export: convert the chat layout from "use client" to a
    // server component so it can export generateStaticParams. The providers
    // (SubtasksProvider, ArtifactsProvider, PromptInputProvider) are client
    // components — rendering them from a server component is the standard
    // Next.js App Router pattern.
    //
    // generateStaticParams returns only "new" because:
    //   1. /workspace/chats/new is the initial redirect target after login
    //   2. When a new thread is created, history.replaceState updates the URL
    //      without triggering a page navigation
    //   3. Direct navigation to existing chats falls back to chats/new.html
    //      via the Electron protocol handler (frontend-protocol.ts)
    file: join(APP_DIR, "workspace", "chats", "[thread_id]", "layout.tsx"),
    content: `import { ChatProviders } from "./_chat-providers";

export function generateStaticParams() {
  return [{ thread_id: "new" }];
}

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ChatProviders>{children}</ChatProviders>;
}
`,
  },
  {
    // Same treatment for the agent chat dynamic route. The original layout
    // is a client component ("use client" + providers); replace it with a
    // server component that exports generateStaticParams and delegates the
    // providers to the _chat-providers client wrapper.
    file: join(
      APP_DIR,
      "workspace",
      "agents",
      "[agent_name]",
      "chats",
      "[thread_id]",
      "layout.tsx",
    ),
    content: `import { ChatProviders } from "./_chat-providers";

export function generateStaticParams() {
  return [{ agent_name: "__init__", thread_id: "new" }];
}

export default function AgentChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ChatProviders>{children}</ChatProviders>;
}
`,
  },
];

// ── Build logic ───────────────────────────────────────────────────────────

function main() {
  console.log("[desktop-build] Starting static export build...");

  const outDir = join(ROOT, "out");
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }

  // Clear the Next.js build cache to avoid stale type/route conflicts (e.g.
  // `.next/dev` types from a prior `next dev` run mismatching the production
  // `.next/types`), which break the build worker's type-check step.
  const nextDir = join(ROOT, ".next");
  if (existsSync(nextDir)) {
    console.log("[desktop-build] Clearing stale .next cache...");
    rmSync(nextDir, { recursive: true, force: true });
  }

  if (existsSync(BACKUP_DIR)) {
    console.log("[desktop-build] Removing stale backup directory...");
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  }

  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // Track all modifications for restoration
  const movedDirs = [];
  const movedFiles = [];
  const patchedLayouts = [];

  // 1. Move conflicting directories
  for (const dir of CONFLICT_DIRS) {
    const src = join(APP_DIR, dir);
    const dst = join(BACKUP_DIR, dir);
    if (existsSync(src)) {
      // Ensure parent directory exists in backup
      mkdirSync(join(dst, ".."), { recursive: true });
      console.log(`[desktop-build] Backing up app/${dir}/`);
      renameSync(src, dst);
      movedDirs.push(dir);
    }
  }

  // 1b. Move conflicting files
  for (const file of CONFLICT_FILES) {
    const src = join(APP_DIR, file);
    const dst = join(BACKUP_DIR, file);
    if (existsSync(src)) {
      mkdirSync(join(dst, ".."), { recursive: true });
      console.log(`[desktop-build] Backing up app/${file}`);
      renameSync(src, dst);
      movedFiles.push(file);
    }
  }

  // 2. Patch layouts
  for (const patch of LAYOUT_PATCHES) {
    if (!existsSync(patch.file)) continue;
    const original = readFileSync(patch.file, "utf-8");
    patchedLayouts.push({ file: patch.file, content: original });
    console.log(`[desktop-build] Patching layout: ${patch.file}`);
    writeFileSync(patch.file, patch.content, "utf-8");
  }

  // 2b. Patch other source files (ThemeProvider, etc.)
  const patchedSources = [];
  for (const patch of SOURCE_PATCHES) {
    if (!existsSync(patch.file)) continue;
    const original = readFileSync(patch.file, "utf-8");
    patchedSources.push({ file: patch.file, content: original });
    console.log(`[desktop-build] Patching source: ${patch.file}`);
    writeFileSync(patch.file, patch.content, "utf-8");
  }

  // 2c. Create temporary new files needed by patched layouts
  const createdFiles = [];
  for (const entry of NEW_FILES) {
    console.log(`[desktop-build] Creating temp file: ${entry.file}`);
    mkdirSync(join(entry.file, ".."), { recursive: true });
    writeFileSync(entry.file, entry.content, "utf-8");
    createdFiles.push(entry.file);
  }

  try {
    console.log("[desktop-build] Running next build --webpack with DESKTOP_BUILD=true...");
    try {
      execSync("npx next build --webpack", {
        cwd: ROOT,
        stdio: "inherit",
        env: {
          ...process.env,
          // Force production mode — the shell may export NODE_ENV=development
          // (common in dev profiles), which breaks Next.js 16's prerendering
          // of internal routes like /_global-error (see vercel/next.js#87719).
          NODE_ENV: "production",
          DESKTOP_BUILD: "true",
          SKIP_ENV_VALIDATION: "1",
          // Point the frontend at the gateway port resolved from the shared
          // .env so the desktop shell and the web build share the same backend.
          NEXT_PUBLIC_BACKEND_BASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
          NEXT_PUBLIC_LANGGRAPH_BASE_URL: `http://127.0.0.1:${GATEWAY_PORT}/api`,
          GATEWAY_PORT,
        },
      });
    } catch (buildErr) {
      // execSync with stdio:"inherit" swallows the child's output on failure.
      // Re-run capturing stderr so we can show the real Next.js error.
      console.error("[desktop-build] next build failed. Re-running to capture error...");
      let stderr = "";
      try {
        execSync("npx next build --webpack", {
          cwd: ROOT,
          stdio: "pipe",
          env: {
            ...process.env,
            NODE_ENV: "production",
            DESKTOP_BUILD: "true",
            SKIP_ENV_VALIDATION: "1",
            NEXT_PUBLIC_BACKEND_BASE_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
            NEXT_PUBLIC_LANGGRAPH_BASE_URL: `http://127.0.0.1:${GATEWAY_PORT}/api`,
            GATEWAY_PORT,
          },
        });
      } catch (e2) {
        stderr = (e2.stdout?.toString() ?? "") + (e2.stderr?.toString() ?? "");
      }
      console.error(stderr.slice(-3000));
      throw buildErr;
    }

    if (!existsSync(outDir)) {
      throw new Error("Build completed but out/ directory was not created");
    }

    console.log("[desktop-build] Static export complete.");

    const topFiles = readdirSync(outDir);
    console.log(
      `[desktop-build] Top-level output: ${topFiles.slice(0, 15).join(", ")}...`,
    );
  } finally {
    // Delete temporary new files
    for (const file of createdFiles) {
      console.log(`[desktop-build] Removing temp file: ${file}`);
      rmSync(file, { force: true });
    }

    // Restore patched layouts
    for (const { file, content } of patchedLayouts) {
      console.log(`[desktop-build] Restoring: ${file}`);
      writeFileSync(file, content, "utf-8");
    }

    // Restore patched source files
    for (const { file, content } of patchedSources) {
      console.log(`[desktop-build] Restoring source: ${file}`);
      writeFileSync(file, content, "utf-8");
    }

    // Restore moved directories (process in reverse order for nested paths)
    const reversed = [...movedDirs].reverse();
    for (const dir of reversed) {
      const src = join(BACKUP_DIR, dir);
      const dst = join(APP_DIR, dir);
      console.log(`[desktop-build] Restoring app/${dir}/`);
      try {
        // Ensure parent exists
        mkdirSync(join(dst, ".."), { recursive: true });
        renameSync(src, dst);
      } catch (e) {
        // Try copy as fallback
        try {
          cpSync(src, dst, { recursive: true });
          rmSync(src, { recursive: true, force: true });
          console.log(`[desktop-build] Restored via copy: ${dir}`);
        } catch (e2) {
          console.error(`[desktop-build] Copy also failed for ${dir}: ${e2.message}`);
        }
      }
    }

    // Restore moved files
    for (const file of movedFiles) {
      const src = join(BACKUP_DIR, file);
      const dst = join(APP_DIR, file);
      console.log(`[desktop-build] Restoring app/${file}`);
      try {
        mkdirSync(join(dst, ".."), { recursive: true });
        renameSync(src, dst);
      } catch (e) {
        console.error(`[desktop-build] Failed to restore ${file}: ${e.message}`);
      }
    }

    // Clean backup dir
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  }
}

main();
