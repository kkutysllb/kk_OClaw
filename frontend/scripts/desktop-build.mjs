/**
 * Desktop build script — produces a static export of the Next.js frontend
 * for use as Tauri's frontendDist.
 *
 * Next.js `output: "export"` is incompatible with several app features.
 * This script temporarily patches them, runs the build, then restores
 * everything to its original state.
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const APP_DIR = join(ROOT, "src", "app");
const BACKUP_DIR = join(ROOT, ".desktop-build-backup");

// ── Directories to move aside (incompatible with static export) ───────────
// api/ — server-only route handlers
// mock/ — server-only mock data routes
// [lang]/ — i18n dynamic segment (no generateStaticParams for static export)
// workspace/agents/[agent_name]/chats/[thread_id]/ — dynamic route, client component
// workspace/chats/[thread_id]/ — dynamic route, client component
const CONFLICT_DIRS = [
  "api",
  "mock",
  "[lang]",
  "workspace/agents/[agent_name]/chats/[thread_id]",
  "workspace/chats/[thread_id]",
];

// ── Layouts to replace with static versions ───────────────────────────────
const LAYOUT_PATCHES = [
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
    // etc. With `output: export` we have no server, so we perform the same
    // checks client-side against /api/v1/auth/me and /api/v1/auth/setup-status,
    // preserving identical behaviour to the web build.
    file: join(APP_DIR, "workspace", "layout.tsx"),
    content: `"use client";

import { type ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AuthProvider } from "@/core/auth/AuthProvider";
import { buildLoginUrl, type User } from "@/core/auth/types";

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
      try {
        const meRes = await fetch("/api/v1/auth/me", {
          credentials: "include",
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
            const setupRes = await fetch("/api/v1/auth/setup-status", {
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
    file: join(APP_DIR, "workspace", "workspace-content.tsx"),
    content: `import { Toaster } from "sonner";

import { QueryClientProvider } from "@/components/query-client-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { CommandPalette } from "@/components/workspace/command-palette";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";

// Desktop static export: no cookies() access
export function WorkspaceContent({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <QueryClientProvider>
      <SidebarProvider className="h-screen" defaultOpen={false}>
        <WorkspaceSidebar />
        <SidebarInset className="min-w-0">{children}</SidebarInset>
      </SidebarProvider>
      <CommandPalette />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
`,
  },
];



// ── Build logic ───────────────────────────────────────────────────────────

function main() {
  console.log("[desktop-build] Starting static export build...");

  const outDir = join(ROOT, "out");
  if (existsSync(outDir)) {
    execSync(`rm -rf "${outDir}"`);
  }

  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // Track all modifications for restoration
  const movedDirs = [];
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

  // 2. Patch layouts
  for (const patch of LAYOUT_PATCHES) {
    if (!existsSync(patch.file)) continue;
    const original = readFileSync(patch.file, "utf-8");
    patchedLayouts.push({ file: patch.file, content: original });
    console.log(`[desktop-build] Patching layout: ${patch.file}`);
    writeFileSync(patch.file, patch.content, "utf-8");
  }

  try {
    console.log("[desktop-build] Running next build with DESKTOP_BUILD=true...");
    execSync("npx next build", {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        DESKTOP_BUILD: "true",
        SKIP_ENV_VALIDATION: "1",
      },
    });

    if (!existsSync(outDir)) {
      throw new Error("Build completed but out/ directory was not created");
    }

    console.log("[desktop-build] Static export complete.");

    const topFiles = readdirSync(outDir);
    console.log(
      `[desktop-build] Top-level output: ${topFiles.slice(0, 15).join(", ")}...`,
    );
  } finally {
    // Restore patched layouts
    for (const { file, content } of patchedLayouts) {
      console.log(`[desktop-build] Restoring: ${file}`);
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
        console.error(`[desktop-build] Failed to restore ${dir}: ${e.message}`);
        // Try copy as fallback
        try {
          execSync(`cp -r "${src}" "${dst}"`);
          execSync(`rm -rf "${src}"`);
          console.log(`[desktop-build] Restored via copy: ${dir}`);
        } catch (e2) {
          console.error(`[desktop-build] Copy also failed for ${dir}: ${e2.message}`);
        }
      }
    }

    // Clean backup dir
    execSync(`rm -rf "${BACKUP_DIR}"`);
  }
}

main();
