"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { getAPIClient } from "@/core/api";
import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";
import type { AgentThreadState, RunMessage } from "@/core/threads/types";
import {
  readWorkspaceTaskTabs,
  WORKSPACE_TASK_TABS_STORAGE_KEY,
} from "@/core/workspace-task-tabs";

import { refreshRuntimeTargetsOnce } from "./runtime-refresh";
import { getRuntimeTargetForWorkspaceTask } from "./task-runtime-adapters";
import { pruneThreadRuntimeSnapshots } from "./thread-runtime-store";

const WORKSPACE_RUNTIME_REFRESH_MS = 2_500;

function makeFallbackState(): AgentThreadState {
  return {
    title: "",
    messages: [],
    artifacts: [],
  };
}

export function WorkspaceRuntimeProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (cancelled || typeof window === "undefined") {
        return;
      }

      const tabs = readWorkspaceTaskTabs(window.localStorage);
      const targets = tabs
        .map((tab) => getRuntimeTargetForWorkspaceTask(tab))
        .filter((target) => target !== null);
      pruneThreadRuntimeSnapshots();

      if (targets.length === 0) {
        return;
      }

      await refreshRuntimeTargetsOnce(targets, {
        listRuns: async (threadId) => getAPIClient().runs.list(threadId),
        fetchRunMessages: async (threadId, runId) => {
          const response = await fetch(
            `${getBackendBaseURL()}/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/messages`,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
              },
              credentials: "include",
            },
          );
          if (!response.ok) {
            return [];
          }
          const result = (await response.json()) as {
            data?: RunMessage[];
          };
          return result.data ?? [];
        },
        invalidateQueries: (queryKey) => {
          void queryClient.invalidateQueries({
            queryKey,
            exact: false,
          });
        },
        getFallbackState: makeFallbackState,
      }).catch(() => {
        // Runtime refresh is best-effort; mounted pages still own their live stream.
      });
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, WORKSPACE_RUNTIME_REFRESH_MS);
    const onStorage = (event: StorageEvent) => {
      if (event.key === WORKSPACE_TASK_TABS_STORAGE_KEY) {
        void refresh();
      }
    };
    const onFocus = () => {
      void refresh();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [queryClient]);

  return children;
}
