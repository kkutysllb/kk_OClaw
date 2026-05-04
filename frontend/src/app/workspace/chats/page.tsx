"use client";

import { MessageSquareIcon, PlusIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { useThreads } from "@/core/threads/hooks";
import { pathOfThread, titleOfThread } from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";
import { cn } from "@/lib/utils";

export default function ChatsPage() {
  const { t } = useI18n();
  const { data: threads, isLoading } = useThreads();
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = `${t.pages.chats} - ${t.pages.appName}`;
  }, [t.pages.chats, t.pages.appName]);

  const filteredThreads = useMemo(() => {
    return threads?.filter((thread) => {
      return titleOfThread(thread).toLowerCase().includes(search.toLowerCase());
    });
  }, [threads, search]);

  const threadCount = filteredThreads?.length ?? 0;

  return (
    <WorkspaceContainer>
      <WorkspaceHeader></WorkspaceHeader>
      <WorkspaceBody>
        <div className="flex size-full flex-col">
          {/* Page header */}
          <div className="relative shrink-0 border-b bg-gradient-to-b from-muted/30 to-transparent">
            {/* Decorative background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute -top-24 -right-24 size-64 rounded-full bg-sky-500/5 blur-3xl" />
              <div className="absolute -bottom-16 left-1/3 size-48 rounded-full bg-cyan-500/5 blur-3xl" />
              <div className="absolute top-1/4 right-1/4 size-32 rounded-full bg-blue-500/5 blur-3xl" />
            </div>

            <div className="relative flex items-center justify-between px-6 py-5">
              <div className="space-y-1.5">
                <h1 className="text-2xl font-extrabold tracking-tight">
                  <span className="bg-gradient-to-r from-sky-500 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                    {t.pages.chats}
                  </span>
                </h1>
                <p className="text-muted-foreground text-sm max-w-xl">
                  {t.chats.searchChats}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {threadCount > 0 && (
                  <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex size-2 rounded-full bg-sky-400" />
                    {threadCount} {threadCount === 1 ? "conversation" : "conversations"}
                  </div>
                )}
                <Button
                  onClick={() => {
                    window.location.href = "/workspace/chats/new";
                  }}
                  className="bg-gradient-to-r from-sky-500 to-cyan-500 text-white hover:from-sky-600 hover:to-cyan-600 shadow-md shadow-sky-500/25 transition-all duration-200 hover:shadow-lg hover:shadow-sky-500/30"
                >
                  <PlusIcon className="mr-1.5 h-4 w-4" />
                  {t.pages.newChat}
                </Button>
              </div>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative shrink-0 px-6 pt-5 pb-3">
            <div className="relative mx-auto max-w-(--container-width-md)">
              <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted-foreground/60" />
              <Input
                type="search"
                className="h-12 w-full pl-12 text-base rounded-xl border-muted-foreground/15 bg-muted/30 focus-visible:bg-background focus-visible:border-sky-500/40 focus-visible:ring-sky-500/20 transition-all duration-200"
                placeholder={t.chats.searchChats}
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Content */}
          <main className="min-h-0 flex-1">
            <ScrollArea className="size-full">
              <div className="mx-auto flex max-w-(--container-width-md) flex-col px-6 pb-6">
                {isLoading ? (
                  /* Loading skeleton */
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-20 animate-pulse rounded-xl border bg-muted/20"
                      >
                        <div className="h-1 w-full rounded-t-xl bg-sky-500/20" />
                        <div className="p-4 space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="size-10 rounded-xl bg-muted" />
                            <div className="space-y-2 flex-1">
                              <div className="h-4 w-2/3 rounded bg-muted" />
                              <div className="h-3 w-1/3 rounded bg-muted" />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filteredThreads && filteredThreads.length === 0 ? (
                  /* Empty state */
                  <div className="relative flex flex-col items-center justify-center py-20">
                    <div className="absolute -top-10 size-32 rounded-full bg-sky-500/5 blur-3xl" />
                    <div className="relative flex size-16 items-center justify-center rounded-2xl bg-sky-500/10 ring-1 ring-sky-500/20">
                      <MessageSquareIcon className="size-8 text-sky-500" />
                    </div>
                    <h3 className="mt-5 text-lg font-semibold">{search ? "No results" : t.conversation.noMessages}</h3>
                    <p className="mt-2 text-center text-sm text-muted-foreground max-w-xs">
                      {search ? "Try adjusting your search terms." : t.conversation.startConversation}
                    </p>
                  </div>
                ) : (
                  filteredThreads?.map((thread) => {
                    const title = titleOfThread(thread);
                    const agentName = thread.metadata?.agent_name as string | undefined;
                    return (
                      <Link
                        key={thread.thread_id}
                        href={pathOfThread(thread)}
                        className="group"
                      >
                        <div className="flex items-start gap-4 rounded-xl border border-transparent p-4 transition-all duration-200 hover:bg-muted/40 hover:border-muted-foreground/10 hover:shadow-sm">
                          {/* Avatar icon */}
                          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 ring-1 ring-inset ring-sky-500/20 transition-transform duration-200 group-hover:scale-110">
                            <MessageSquareIcon className="size-5 text-sky-500" />
                          </div>

                          {/* Content */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                                {title}
                              </h3>
                              {agentName && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400 ring-1 ring-inset ring-violet-500/20">
                                  {agentName}
                                </span>
                              )}
                            </div>
                            {thread.updated_at && (
                              <p className="mt-1 text-xs text-muted-foreground/70">
                                {formatTimeAgo(thread.updated_at)}
                              </p>
                            )}
                          </div>

                          {/* Arrow indicator */}
                          <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/40 transition-all duration-200 group-hover:text-sky-500 group-hover:bg-sky-500/10">
                            <svg className="size-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                            </svg>
                          </div>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </main>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
