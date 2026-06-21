import type { QueryKey } from "@tanstack/react-query";

import type {
  WorkspaceTaskKind,
  WorkspaceTaskTab,
} from "@/core/workspace-task-tabs";

export interface TaskRuntimeTarget {
  taskId: string;
  kind: WorkspaceTaskKind;
  threadId: string;
  projectId?: string;
}

export function getRuntimeTargetForWorkspaceTask(
  tab: WorkspaceTaskTab,
  storage: Storage | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
): TaskRuntimeTarget | null {
  if ((tab.kind === "chat" || tab.kind === "agent") && tab.threadId) {
    return {
      taskId: tab.id,
      kind: tab.kind,
      threadId: tab.threadId,
    };
  }

  if (tab.kind === "coding" && tab.projectId) {
    const threadId =
      tab.threadId ?? storage?.getItem(`coding:thread:${tab.projectId}`) ?? null;
    if (!threadId) {
      return null;
    }
    return {
      taskId: tab.id,
      kind: "coding",
      threadId,
      projectId: tab.projectId,
    };
  }

  return null;
}

export function getRuntimeRefreshQueries(target: TaskRuntimeTarget): QueryKey[] {
  const keys: QueryKey[] = [["thread", target.threadId], ["threads", "search"]];

  if (target.kind === "coding" && target.projectId) {
    keys.push(
      ["projects", target.projectId, "files"],
      ["projects", target.projectId, "file"],
      ["projects", target.projectId, "diff"],
      ["coding", "projects"],
      // Precise to the current thread so review/roi/changes queries for
      // *this* coding session refresh without re-fetching unrelated sessions.
      // Kept before the broader prefix for readability; order does not
      // affect React Query's prefix matching with exact:false.
      ["coding", "sessions", target.threadId],
      ["coding", "sessions"],
    );
  }

  return keys;
}
