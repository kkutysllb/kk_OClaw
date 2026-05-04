"use client";

import { BotIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useAgents } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";

import { AgentCard } from "./agent-card";

export function AgentGallery() {
  const { t } = useI18n();
  const { agents, isLoading } = useAgents();
  const router = useRouter();

  const handleNewAgent = () => {
    router.push("/workspace/agents/new");
  };

  return (
    <div className="flex size-full flex-col">
      {/* Page header */}
      <div className="relative shrink-0 border-b bg-gradient-to-b from-muted/30 to-transparent">
        {/* Decorative background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 size-64 rounded-full bg-violet-500/5 blur-3xl" />
          <div className="absolute -bottom-16 left-1/3 size-48 rounded-full bg-purple-500/5 blur-3xl" />
        </div>

        <div className="relative flex items-center justify-between px-6 py-5">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-violet-500 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent">
                {t.agents.title}
              </span>
            </h1>
            <p className="text-muted-foreground text-sm max-w-xl">
              {t.agents.description}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {agents.length > 0 && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex size-2 rounded-full bg-violet-400" />
                {agents.length} 个智能体
              </div>
            )}
            <Button
              onClick={handleNewAgent}
              className="bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:from-violet-600 hover:to-purple-600 shadow-md shadow-violet-500/25 transition-all duration-200 hover:shadow-lg hover:shadow-violet-500/30"
            >
              <PlusIcon className="mr-1.5 h-4 w-4" />
              {t.agents.newAgent}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-48 animate-pulse rounded-xl border bg-muted/30"
              >
                <div className="h-1 w-full rounded-t-xl bg-violet-500/20" />
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-xl bg-muted" />
                    <div className="space-y-2 flex-1">
                      <div className="h-4 w-2/3 rounded bg-muted" />
                      <div className="h-3 w-1/3 rounded bg-muted" />
                    </div>
                  </div>
                  <div className="h-3 w-full rounded bg-muted" />
                  <div className="h-3 w-2/3 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-violet-500/10 blur-xl" />
              <div className="relative bg-violet-500/10 flex h-16 w-16 items-center justify-center rounded-2xl ring-1 ring-violet-500/20">
                <BotIcon className="text-violet-500 h-8 w-8" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-lg">{t.agents.emptyTitle}</p>
              <p className="text-muted-foreground mt-1 text-sm max-w-sm">
                {t.agents.emptyDescription}
              </p>
            </div>
            <Button
              onClick={handleNewAgent}
              className="mt-2 bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:from-violet-600 hover:to-purple-600"
            >
              <PlusIcon className="mr-1.5 h-4 w-4" />
              {t.agents.newAgent}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {agents.map((agent) => (
              <AgentCard key={agent.name} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
