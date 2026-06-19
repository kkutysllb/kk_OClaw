/**
 * Module-level cache of the latest *displayed* thread state.
 *
 * The cache survives React component unmount/remount (e.g. when the user
 * switches workspace tabs), so when the component re-mounts we can show the
 * previously rendered messages instantly while the `useStream` hook
 * silently reconnects the SSE stream in the background.
 *
 * Without this, the user sees a flash of:
 *   1. empty message list (useStream initialises with `messages: []`)
 *   2. `isLoading` toggling false → true as the stream reconnects
 * which makes tab switches feel janky even though the backend task keeps
 * running (`onDisconnect: "continue"`).
 *
 * Entries expire after `TTL_MS` to avoid unbounded memory growth.
 */

import type { Message } from "@langchain/langgraph-sdk";

import type { AgentThreadState } from "./types";

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ENTRIES = 30;

export interface CachedThreadState {
  /** Filtered, merged messages ready for display (no middleware messages). */
  messages: Message[];
  /** Latest thread values (agent state snapshot). */
  values: AgentThreadState;
  /** Whether a run was streaming when the component unmounted. */
  isLoading: boolean;
  /** Last-known error from the stream. */
  error: unknown;
  /** Timestamp of the last update (for TTL expiry). */
  timestamp: number;
}

const store = new Map<string, CachedThreadState>();

/**
 * Read the cached state for a thread.
 * Returns `undefined` if there is no cache or the entry has expired.
 */
export function getCachedThreadState(
  threadId: string,
): CachedThreadState | undefined {
  const entry = store.get(threadId);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > TTL_MS) {
    store.delete(threadId);
    return undefined;
  }
  return entry;
}

/**
 * Write (or overwrite) the cached state for a thread.
 * Evicts the oldest entries when the cache exceeds `MAX_ENTRIES`.
 */
export function setCachedThreadState(
  threadId: string,
  state: Omit<CachedThreadState, "timestamp">,
): void {
  // Evict expired entries first (cheap cleanup on every write).
  if (store.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [id, entry] of store) {
      if (now - entry.timestamp > TTL_MS) {
        store.delete(id);
      }
    }
    // If still over the limit, evict the oldest remaining entry.
    while (store.size >= MAX_ENTRIES) {
      const oldest = [...store.entries()].sort(
        (a, b) => a[1].timestamp - b[1].timestamp,
      )[0];
      if (!oldest) break;
      store.delete(oldest[0]);
    }
  }

  store.set(threadId, { ...state, timestamp: Date.now() });
}

/** Remove the cached state for a thread (e.g. when the thread is deleted). */
export function clearCachedThreadState(threadId: string): void {
  store.delete(threadId);
}
