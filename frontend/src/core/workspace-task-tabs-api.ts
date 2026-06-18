import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";
import {
  isWorkspaceTaskTab,
  type WorkspaceTaskTab,
  type WorkspaceTaskTabsPayload,
} from "@/core/workspace-task-tabs";

const WORKSPACE_TASK_TABS_API = "/api/workspace/task-tabs";

export async function fetchWorkspaceTaskTabs(): Promise<WorkspaceTaskTab[]> {
  const response = await fetch(`${getBackendBaseURL()}${WORKSPACE_TASK_TABS_API}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch workspace task tabs: ${response.status}`);
  }
  const payload = (await response.json()) as WorkspaceTaskTabsPayload;
  return Array.isArray(payload.tabs) ? payload.tabs.filter(isWorkspaceTaskTab) : [];
}

export async function saveWorkspaceTaskTabs(
  tabs: WorkspaceTaskTab[],
): Promise<WorkspaceTaskTab[]> {
  const response = await fetch(`${getBackendBaseURL()}${WORKSPACE_TASK_TABS_API}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabs }),
  });
  if (!response.ok) {
    throw new Error(`Failed to save workspace task tabs: ${response.status}`);
  }
  const payload = (await response.json()) as WorkspaceTaskTabsPayload;
  return Array.isArray(payload.tabs) ? payload.tabs.filter(isWorkspaceTaskTab) : tabs;
}
