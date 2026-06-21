import type { Run } from "@langchain/langgraph-sdk";

import type { AgentThreadState, RunMessage } from "@/core/threads/types";

import { getRuntimeRefreshQueries, type TaskRuntimeTarget } from "./task-runtime-adapters";
import {
  getThreadRuntimeSnapshot,
  publishThreadRuntimeSnapshot,
} from "./thread-runtime-store";

type RuntimeRun = Pick<Run, "run_id" | "status">;

export interface RuntimeRefreshClient {
  listRuns: (threadId: string) => Promise<RuntimeRun[]>;
  fetchRunMessages: (threadId: string, runId: string) => Promise<RunMessage[]>;
  invalidateQueries: (queryKey: readonly unknown[]) => void;
  getFallbackState: () => AgentThreadState;
}

export async function refreshRuntimeTargetsOnce(
  targets: TaskRuntimeTarget[],
  client: RuntimeRefreshClient,
) {
  await Promise.all(
    targets.map(async (target) => {
      const runs = await client.listRuns(target.threadId);
      const activeRun = runs.find(
        (run) => run.status === "running" || run.status === "pending",
      );
      if (!activeRun) {
        const current = getThreadRuntimeSnapshot(target.threadId);
        if (current?.isLoading) {
          publishThreadRuntimeSnapshot(target.threadId, {
            ...current,
            isLoading: false,
          });
        }
        return;
      }

      const runMessages = await client.fetchRunMessages(
        target.threadId,
        activeRun.run_id,
      );
      const messages = runMessages
        .filter((message) => !message.metadata.caller?.startsWith("middleware:"))
        .map((message) => message.content);
      const current = getThreadRuntimeSnapshot(target.threadId);
      const values = current?.values ?? {
        ...client.getFallbackState(),
        messages,
      };

      publishThreadRuntimeSnapshot(target.threadId, {
        messages,
        values,
        isLoading: true,
        error: current?.error ?? null,
      });

      for (const queryKey of getRuntimeRefreshQueries(target)) {
        client.invalidateQueries(queryKey);
      }
    }),
  );
}
