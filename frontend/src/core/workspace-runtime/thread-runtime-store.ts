import type { Message } from "@langchain/langgraph-sdk";
import { useSyncExternalStore } from "react";

import type { AgentThreadState } from "@/core/threads/types";

export interface ThreadRuntimeSnapshot {
  messages: Message[];
  values: AgentThreadState;
  isLoading: boolean;
  error: unknown;
  updatedAt: number;
}

type ThreadRuntimeSnapshotInput = Omit<ThreadRuntimeSnapshot, "updatedAt"> & {
  updatedAt?: number;
};

type ThreadRuntimeStoreConfig = {
  maxSnapshots: number;
  snapshotTtlMs: number;
};

const config: ThreadRuntimeStoreConfig = {
  maxSnapshots: 30,
  snapshotTtlMs: 30 * 60_000,
};

const snapshots = new Map<string, ThreadRuntimeSnapshot>();
const snapshotSignatures = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function noop() {
  // no subscription needed without a thread id
}

function emit(threadId: string) {
  listeners.get(threadId)?.forEach((listener) => listener());
}

function subscribeThreadRuntimeSnapshot(
  threadId: string | null | undefined,
  listener: () => void,
) {
  if (!threadId) {
    return noop;
  }
  const threadListeners = listeners.get(threadId) ?? new Set<() => void>();
  threadListeners.add(listener);
  listeners.set(threadId, threadListeners);
  return () => {
    threadListeners.delete(listener);
    if (threadListeners.size === 0) {
      listeners.delete(threadId);
    }
  };
}

export function getThreadRuntimeSnapshot(
  threadId: string | null | undefined,
): ThreadRuntimeSnapshot | null {
  if (!threadId) {
    return null;
  }
  return snapshots.get(threadId) ?? null;
}

export function publishThreadRuntimeSnapshot(
  threadId: string | null | undefined,
  snapshot: ThreadRuntimeSnapshotInput,
) {
  if (!threadId) {
    return;
  }
  const signature = getSnapshotSignature(snapshot);
  if (snapshotSignatures.get(threadId) === signature) {
    return;
  }
  snapshots.set(threadId, {
    ...snapshot,
    updatedAt: snapshot.updatedAt ?? Date.now(),
  });
  snapshotSignatures.set(threadId, signature);
  evictOverflowSnapshots();
  emit(threadId);
}

export function clearThreadRuntimeSnapshot(threadId: string | null | undefined) {
  if (!threadId) {
    return;
  }
  snapshots.delete(threadId);
  snapshotSignatures.delete(threadId);
  emit(threadId);
}

export function configureThreadRuntimeStore(
  options: Partial<ThreadRuntimeStoreConfig>,
) {
  config.maxSnapshots = options.maxSnapshots ?? config.maxSnapshots;
  config.snapshotTtlMs = options.snapshotTtlMs ?? config.snapshotTtlMs;
  evictOverflowSnapshots();
}

export function pruneThreadRuntimeSnapshots(now = Date.now()) {
  for (const [threadId, snapshot] of snapshots) {
    if (snapshot.isLoading) {
      continue;
    }
    if (now - snapshot.updatedAt > config.snapshotTtlMs) {
      clearThreadRuntimeSnapshot(threadId);
    }
  }
  evictOverflowSnapshots();
}

export function useThreadRuntimeSnapshot(
  threadId: string | null | undefined,
): ThreadRuntimeSnapshot | null {
  return useSyncExternalStore(
    (listener) => subscribeThreadRuntimeSnapshot(threadId, listener),
    () => getThreadRuntimeSnapshot(threadId),
    () => getThreadRuntimeSnapshot(threadId),
  );
}

function evictOverflowSnapshots() {
  const maxSnapshots = Math.max(1, config.maxSnapshots);
  while (snapshots.size > maxSnapshots) {
    const oldest = [...snapshots.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    )[0];
    if (!oldest) {
      break;
    }
    const [threadId] = oldest;
    snapshots.delete(threadId);
    snapshotSignatures.delete(threadId);
    emit(threadId);
  }
}

function getSnapshotSignature(snapshot: ThreadRuntimeSnapshotInput): string {
  return safeStringify({
    messages: snapshot.messages.map((message) => ({
      id: "tool_call_id" in message ? message.tool_call_id : message.id,
      type: message.type,
      content: message.content,
    })),
    values: snapshot.values,
    isLoading: snapshot.isLoading,
    error: normalizeError(snapshot.error),
  });
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return error;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
