"use client";

import {
  QueryClient,
  QueryClientProvider as TanStackQueryClientProvider,
} from "@tanstack/react-query";

/**
 * Returns ``true`` for HTTP 4xx client errors that should NOT be retried.
 *
 * Why: react-query's default ``retry: 3`` with exponential backoff is great
 * for transient network/server failures but catastrophic for requests that
 * will *never* succeed on retry — e.g. fetching a project that has just been
 * deleted (404). Combined with ``refetchOnWindowFocus`` / ``refetchOnMount``
 * this previously pinned the UI for tens of seconds after a project delete
 * (see gateway.log lines 199-210: a tight loop of 404s on
 * ``/api/projects/{id}`` and ``/api/projects/{id}/worktrees``).
 *
 * The contract: if an API helper throws an error carrying a numeric
 * ``status`` field (see :class:`ProjectFetchError`), we trust that value.
 * Otherwise we fall back to sniffing the message for "404"/"not found" so
 * legacy helpers that throw plain ``Error`` still short-circuit retries.
 */
function isHttpClientError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object" && "status" in error) {
    const status = Number((error as { status: number }).status);
    if (Number.isFinite(status)) {
      return status >= 400 && status < 500;
    }
  }
  if (error instanceof Error) {
    return /\b(40[0-9]|4[0-9]{2})\b|not found/i.test(error.message);
  }
  return false;
}

// Top-level workspace task tabs are route changes, so their pages unmount and
// remount during ordinary task switching. Keep recently fetched task data fresh
// for a short window so switching between active tasks feels instant instead of
// fanning out backend reads on every click.
const TASK_SWITCH_STALE_TIME_MS = 30 * 1000;
const TASK_SWITCH_GC_TIME_MS = 30 * 60 * 1000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Never auto-refetch on window focus: the workspace has many
      // long-lived queries (project detail, worktrees, session events...) and
      // a single alt-tab would otherwise fan out a burst of requests that, if
      // any returned 4xx, cascaded into retry storms.
      refetchOnWindowFocus: false,
      staleTime: TASK_SWITCH_STALE_TIME_MS,
      gcTime: TASK_SWITCH_GC_TIME_MS,
      retry: (failureCount, error) => {
        // 4xx means the request itself is invalid for the current state
        // (deleted resource, bad id, ...). Retrying is pointless and, with
        // backoff, visibly freezes the UI.
        if (isHttpClientError(error)) return false;
        // Otherwise mirror react-query's default: up to 3 retries with
        // exponential backoff for transient network/server errors.
        return failureCount < 3;
      },
    },
  },
});

export function QueryClientProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <TanStackQueryClientProvider client={queryClient}>
      {children}
    </TanStackQueryClientProvider>
  );
}
