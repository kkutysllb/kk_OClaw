"use client";

import { BotIcon, Code2Icon, MessageSquareIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { fetchThreadTitle } from "@/core/threads/api";
import { useThreads } from "@/core/threads/hooks";
import {
  clearThreadRuntimeSnapshot,
  getRuntimeTargetForWorkspaceTask,
} from "@/core/workspace-runtime";
import {
  closeWorkspaceTaskTab,
  createWorkspaceTaskTabFromPath,
  mergeWorkspaceTaskTabs,
  mergeWorkspaceTaskTabsWithThreads,
  readWorkspaceTaskTabs,
  upsertWorkspaceTaskTab,
  writeWorkspaceTaskTabs,
  type WorkspaceTaskTab,
} from "@/core/workspace-task-tabs";
import {
  fetchWorkspaceTaskTabs,
  saveWorkspaceTaskTabs,
} from "@/core/workspace-task-tabs-api";
import { cn } from "@/lib/utils";

const WORKSPACE_TASK_ROUTE_EVENT = "oclaw:workspace-task-route";

export function notifyWorkspaceTaskRouteChanged(pathname: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_TASK_ROUTE_EVENT, { detail: { pathname } }),
  );
}

export function WorkspaceTaskTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const [tabs, setTabs] = useState<WorkspaceTaskTab[]>([]);
  const { data: threads } = useThreads({ limit: 100 });

  const activeTab = useMemo(
    () => createWorkspaceTaskTabFromPath(pathname),
    [pathname],
  );
  const activeTabId = activeTab?.id ?? null;
  const activeThreadId = activeTab?.threadId ?? null;
  const activePlaceholderTitle = activeTab?.title ?? null;

  const persistTabs = useCallback((next: WorkspaceTaskTab[]) => {
    writeWorkspaceTaskTabs(window.localStorage, next);
    void saveWorkspaceTaskTabs(next).catch(() => {
      // Local cache remains the fallback when the gateway is unavailable.
    });
  }, []);

  const syncPath = useCallback((nextPathname: string | null | undefined) => {
    const parsedTab = createWorkspaceTaskTabFromPath(nextPathname);
    const tab =
      parsedTab?.kind === "coding" && parsedTab.projectId
        ? {
            ...parsedTab,
            threadId:
              parsedTab.threadId ??
              window.localStorage.getItem(`coding:thread:${parsedTab.projectId}`) ??
              undefined,
          }
        : parsedTab;
    if (!tab) return;
    setTabs((current) => {
      const next = upsertWorkspaceTaskTab(current, tab);
      persistTabs(next);
      return next;
    });
  }, [persistTabs]);

  useEffect(() => {
    const localTabs = readWorkspaceTaskTabs(window.localStorage);
    setTabs(localTabs);

    let cancelled = false;
    void fetchWorkspaceTaskTabs()
      .then((remoteTabs) => {
        if (cancelled) return;
        setTabs((current) => {
          const next = mergeWorkspaceTaskTabs(
            current.length > 0 ? current : localTabs,
            remoteTabs,
          );
          persistTabs(next);
          return next;
        });
      })
      .catch(() => {
        // The local cache is enough for offline/dev gateway failure cases.
      });

    return () => {
      cancelled = true;
    };
  }, [persistTabs]);

  useEffect(() => {
    syncPath(pathname);
  }, [pathname, syncPath]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ pathname?: string }>).detail;
      syncPath(detail?.pathname);
    };
    window.addEventListener(WORKSPACE_TASK_ROUTE_EVENT, handler);
    return () => {
      window.removeEventListener(WORKSPACE_TASK_ROUTE_EVENT, handler);
    };
  }, [syncPath]);

  useEffect(() => {
    setTabs((current) => {
      const next = mergeWorkspaceTaskTabsWithThreads(current, threads);
      if (next === current) return current;
      persistTabs(next);
      return next;
    });
  }, [persistTabs, threads]);

  useEffect(() => {
    if (!activeThreadId || !activeTabId || !activePlaceholderTitle) return;
    const currentTab = tabs.find((tab) => tab.id === activeTabId);
    const titleFromList = threads?.find(
      (thread) => thread.thread_id === activeThreadId,
    )?.values?.title?.trim();
    if (titleFromList || currentTab?.title !== activePlaceholderTitle) {
      return;
    }

    let cancelled = false;
    void fetchThreadTitle(activeThreadId).then((title) => {
      if (cancelled || !title) return;
      setTabs((current) => {
        const next = current.map((tab) =>
          tab.id === activeTabId ? { ...tab, title } : tab,
        );
        persistTabs(next);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [activePlaceholderTitle, activeTabId, activeThreadId, persistTabs, tabs, threads]);

  const handleClose = useCallback(
    (tabId: string) => {
      const closingTab = tabs.find((tab) => tab.id === tabId);
      const target = closingTab
        ? getRuntimeTargetForWorkspaceTask(closingTab)
        : null;
      if (target) {
        clearThreadRuntimeSnapshot(target.threadId);
      }
      const result = closeWorkspaceTaskTab(tabs, tabId, activeTabId);
      persistTabs(result.tabs);
      setTabs(result.tabs);
      if (result.nextHref) {
        router.push(result.nextHref);
      }
    },
    [activeTabId, persistTabs, router, tabs],
  );

  if (tabs.length === 0) return null;

  return (
    <div className="bg-background/95 flex h-10 shrink-0 items-center gap-1 border-b px-2">
      <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={cn(
                "group flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                isActive
                  ? "bg-muted text-foreground border-border"
                  : "text-muted-foreground hover:bg-muted/60 border-transparent",
              )}
              title={tab.title}
            >
              <Link
                href={tab.href}
                className="flex min-w-0 flex-1 items-center gap-1.5"
              >
                <TaskKindIcon kind={tab.kind} />
                <span className="truncate">{tab.title}</span>
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="hover:bg-background/80 -mr-1 size-5 shrink-0 opacity-60 group-hover:opacity-100"
                aria-label={`关闭 ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  handleClose(tab.id);
                }}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskKindIcon({ kind }: { kind: WorkspaceTaskTab["kind"] }) {
  if (kind === "coding") return <Code2Icon className="size-3.5 shrink-0" />;
  if (kind === "agent") return <BotIcon className="size-3.5 shrink-0" />;
  return <MessageSquareIcon className="size-3.5 shrink-0" />;
}
