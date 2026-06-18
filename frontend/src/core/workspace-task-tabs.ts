export type WorkspaceTaskKind = "chat" | "agent" | "coding";

export interface WorkspaceTaskTab {
  id: string;
  href: string;
  kind: WorkspaceTaskKind;
  title: string;
  subtitle?: string;
  threadId?: string;
  agentName?: string;
  projectId?: string;
  lastActiveAt: number;
}

export interface WorkspaceTaskThreadTitleSource {
  thread_id: string;
  values?: {
    title?: string | null;
  } | null;
}

export const WORKSPACE_TASK_TABS_STORAGE_KEY = "oclaw.workspace.task-tabs.v1";
export const MAX_WORKSPACE_TASK_TABS = 12;

export interface WorkspaceTaskTabsPayload {
  tabs: WorkspaceTaskTab[];
}

export function createWorkspaceTaskTabFromPath(
  pathname: string | null | undefined,
  now = Date.now(),
): WorkspaceTaskTab | null {
  if (!pathname) return null;
  const path = stripQueryAndHash(pathname);

  const agentMatch = path.match(/^\/workspace\/agents\/([^/]+)\/chats\/([^/]+)$/);
  if (agentMatch) {
    const agentName = decodeSegment(agentMatch[1]);
    const threadId = decodeSegment(agentMatch[2]);
    if (!agentName || !threadId || threadId === "new") return null;
    return {
      id: `agent:${agentName}:${threadId}`,
      href: path,
      kind: "agent",
      title: shortId(threadId),
      subtitle: "Agent",
      threadId,
      agentName,
      lastActiveAt: now,
    };
  }

  const chatMatch = path.match(/^\/workspace\/chats\/([^/]+)$/);
  if (chatMatch) {
    const threadId = decodeSegment(chatMatch[1]);
    if (!threadId || threadId === "new") return null;
    return {
      id: `chat:${threadId}`,
      href: path,
      kind: "chat",
      title: shortId(threadId),
      subtitle: "Chat",
      threadId,
      lastActiveAt: now,
    };
  }

  const codingMatch = path.match(/^\/workspace\/coding\/([^/]+)$/);
  if (codingMatch) {
    const projectId = decodeSegment(codingMatch[1]);
    if (!projectId || projectId === "new") return null;
    return {
      id: `coding:${projectId}`,
      href: path,
      kind: "coding",
      title: `Coding ${shortId(projectId)}`,
      subtitle: "Coding",
      projectId,
      lastActiveAt: now,
    };
  }

  return null;
}

export function mergeWorkspaceTaskTabsWithThreads(
  tabs: WorkspaceTaskTab[],
  threads: WorkspaceTaskThreadTitleSource[] | undefined,
): WorkspaceTaskTab[] {
  if (!threads || threads.length === 0) return tabs;
  const titleByThreadId = new Map<string, string>();
  for (const thread of threads) {
    const title = thread.values?.title?.trim();
    if (title) {
      titleByThreadId.set(thread.thread_id, title);
    }
  }
  if (titleByThreadId.size === 0) return tabs;

  return tabs.map((tab) => {
    if (!tab.threadId) return tab;
    const title = titleByThreadId.get(tab.threadId);
    if (!title || title === tab.title) return tab;
    return { ...tab, title };
  });
}

export function upsertWorkspaceTaskTab(
  tabs: WorkspaceTaskTab[],
  tab: WorkspaceTaskTab,
  maxTabs = MAX_WORKSPACE_TASK_TABS,
): WorkspaceTaskTab[] {
  const existing = tabs.find((item) => item.id === tab.id);
  const next = tabs.filter((item) => item.id !== tab.id);
  next.push(mergeExistingTabTitle(existing, tab));
  return next.slice(Math.max(0, next.length - maxTabs));
}

export function closeWorkspaceTaskTab(
  tabs: WorkspaceTaskTab[],
  tabId: string,
  activeTabId: string | null | undefined,
): { tabs: WorkspaceTaskTab[]; nextHref: string | null } {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return { tabs, nextHref: null };

  const nextTabs = tabs.filter((tab) => tab.id !== tabId);
  if (activeTabId !== tabId) {
    return { tabs: nextTabs, nextHref: null };
  }

  const nextActive = nextTabs[index] ?? nextTabs[index - 1] ?? nextTabs.at(-1);
  return { tabs: nextTabs, nextHref: nextActive?.href ?? "/workspace/chats" };
}

export function readWorkspaceTaskTabs(storage: Storage | undefined): WorkspaceTaskTab[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(WORKSPACE_TASK_TABS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWorkspaceTaskTab).slice(-MAX_WORKSPACE_TASK_TABS);
  } catch {
    return [];
  }
}

export function writeWorkspaceTaskTabs(
  storage: Storage | undefined,
  tabs: WorkspaceTaskTab[],
): void {
  if (!storage) return;
  storage.setItem(WORKSPACE_TASK_TABS_STORAGE_KEY, JSON.stringify(tabs));
}

export function mergeWorkspaceTaskTabs(
  localTabs: WorkspaceTaskTab[],
  remoteTabs: WorkspaceTaskTab[],
  maxTabs = MAX_WORKSPACE_TASK_TABS,
): WorkspaceTaskTab[] {
  const byId = new Map<string, WorkspaceTaskTab>();
  for (const tab of [...localTabs, ...remoteTabs].filter(isWorkspaceTaskTab)) {
    const existing = byId.get(tab.id);
    byId.set(tab.id, chooseNewerTab(existing, tab));
  }
  return [...byId.values()]
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    .slice(Math.max(0, byId.size - maxTabs));
}

function stripQueryAndHash(pathname: string): string {
  return pathname.split("?")[0]?.split("#")[0] || "/";
}

function decodeSegment(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function shortId(value: string): string {
  return value.length > 12 ? value.slice(0, 8) : value;
}

function mergeExistingTabTitle(
  existing: WorkspaceTaskTab | undefined,
  incoming: WorkspaceTaskTab,
): WorkspaceTaskTab {
  if (!existing) return incoming;
  if (isPlaceholderTitle(existing) || !isPlaceholderTitle(incoming)) {
    return { ...existing, ...incoming };
  }
  return { ...existing, ...incoming, title: existing.title };
}

function isPlaceholderTitle(tab: WorkspaceTaskTab): boolean {
  if (tab.kind === "coding") {
    return tab.projectId ? tab.title === `Coding ${shortId(tab.projectId)}` : false;
  }
  return tab.threadId ? tab.title === shortId(tab.threadId) : false;
}

export function isWorkspaceTaskTab(value: unknown): value is WorkspaceTaskTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Partial<WorkspaceTaskTab>;
  return (
    typeof tab.id === "string" &&
    typeof tab.href === "string" &&
    typeof tab.title === "string" &&
    typeof tab.lastActiveAt === "number" &&
    (tab.threadId === undefined || typeof tab.threadId === "string") &&
    (tab.agentName === undefined || typeof tab.agentName === "string") &&
    (tab.projectId === undefined || typeof tab.projectId === "string") &&
    (tab.kind === "chat" || tab.kind === "agent" || tab.kind === "coding")
  );
}

function chooseNewerTab(
  existing: WorkspaceTaskTab | undefined,
  incoming: WorkspaceTaskTab,
): WorkspaceTaskTab {
  if (!existing) return incoming;
  if (incoming.lastActiveAt > existing.lastActiveAt) {
    return mergeExistingTabTitle(existing, incoming);
  }
  return mergeExistingTabTitle(incoming, existing);
}
