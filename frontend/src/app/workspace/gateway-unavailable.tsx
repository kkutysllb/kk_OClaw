"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function GatewayUnavailable() {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Silently ignore — the gateway is already unreachable
    }
    // Clear any local state and redirect home
    router.push("/");
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4">
      <p className="text-muted-foreground">
        Service temporarily unavailable.
      </p>
      <p className="text-muted-foreground text-xs">
        The backend may be restarting. Please wait a moment and try again.
      </p>
      <div className="flex gap-3">
        <Link
          href="/workspace"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm"
        >
          Retry
        </Link>
        <button
          onClick={handleLogout}
          className="text-muted-foreground hover:bg-muted rounded-md border px-4 py-2 text-sm"
        >
          Logout &amp; Reset
        </button>
      </div>
    </div>
  );
}
