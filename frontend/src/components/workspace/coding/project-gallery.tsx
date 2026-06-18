"use client";

import { CodeIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/core/projects";

import { CreateProjectDialog } from "./create-project-dialog";
import { ProjectCard } from "./project-card";

export function ProjectGallery() {
  const { projects, isLoading } = useProjects();

  return (
    <div className="flex size-full flex-col">
      {/* Page header */}
      <div className="relative shrink-0 border-b bg-gradient-to-b from-muted/30 to-transparent">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 size-64 rounded-full bg-emerald-500/5 blur-3xl" />
          <div className="absolute -bottom-16 left-1/3 size-48 rounded-full bg-teal-500/5 blur-3xl" />
        </div>

        <div className="relative flex items-center justify-between px-6 py-5">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
              <CodeIcon className="w-6 h-6 text-emerald-500" />
              <span className="bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 bg-clip-text text-transparent">
                Coding 项目
              </span>
            </h1>
            <p className="text-muted-foreground text-sm max-w-xl">
              管理你的代码仓库，使用 Coding Agent 进行智能编程。
            </p>
          </div>
          <div className="flex items-center gap-3">
            {projects.length > 0 && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex size-2 rounded-full bg-emerald-400" />
                {projects.length} 个项目
              </div>
            )}
            <CreateProjectDialog />
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
                className="h-40 animate-pulse rounded-xl border bg-muted/30"
              >
                <div className="h-1 w-full rounded-t-xl bg-emerald-500/20" />
                <div className="p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-11 rounded-xl" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-emerald-500/10 blur-xl" />
              <div className="relative bg-emerald-500/10 flex h-16 w-16 items-center justify-center rounded-2xl ring-1 ring-emerald-500/20">
                <CodeIcon className="text-emerald-500 h-8 w-8" />
              </div>
            </div>
            <div>
              <p className="font-semibold text-lg">还没有 Coding 项目</p>
              <p className="text-muted-foreground mt-1 text-sm max-w-sm">
                注册一个本地代码仓库，开始使用 Coding Agent 进行智能编程。
              </p>
            </div>
            <CreateProjectDialog />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
