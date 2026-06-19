"use client";

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
        const meRes = await fetch(`${base}/api/v1/auth/me`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
            const setupRes = await fetch(`${base}/api/v1/auth/setup-status`, {
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
