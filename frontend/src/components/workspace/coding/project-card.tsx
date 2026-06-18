"use client";

import {
  FolderGit2Icon,
  FolderOpenIcon,
  GitBranchIcon,
  MoreVerticalIcon,
  Trash2Icon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isDesktop } from "@/core/config";
import { openFolder } from "@/core/desktop";
import { useDeleteProject } from "@/core/projects";
import type { Project } from "@/core/projects";

interface ProjectCardProps {
  project: Project;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const router = useRouter();
  const deleteProject = useDeleteProject();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function handleClick() {
    router.push(`/workspace/coding/${project.id}`);
  }

  async function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      toast.info("再次点击删除以确认");
      setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    try {
      await deleteProject.mutateAsync(project.id);
      toast.success(`项目「${project.name}」已删除`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除项目失败");
    }
  }

  return (
    <div
      onClick={handleClick}
      className="group relative cursor-pointer rounded-xl border bg-card p-5 transition-all duration-200 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5"
    >
      {/* Top accent bar */}
      <div className="absolute inset-x-0 top-0 h-1 rounded-t-xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 opacity-0 transition-opacity group-hover:opacity-100" />

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
            <FolderGit2Icon className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="space-y-0.5">
            <h3 className="font-semibold leading-tight">{project.name}</h3>
            {project.is_git_repo && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <GitBranchIcon className="h-3 w-3" />
                <span>Git 仓库</span>
              </div>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
            >
              <MoreVerticalIcon className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              onClick={() => {
                openFolder(project.path);
                if (!isDesktop()) {
                  toast.success("项目路径已复制到剪贴板");
                }
              }}
            >
              <FolderOpenIcon className="mr-2 h-4 w-4" />
              {isDesktop() ? "在访达中打开" : "复制项目路径"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDelete}
              className="text-red-500 focus:text-red-500"
            >
              <Trash2Icon className="mr-2 h-4 w-4" />
              {confirmingDelete ? "确认删除" : "删除项目"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              注册时间: {new Date(project.created_at).toLocaleDateString()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Description */}
      {project.description && (
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
          {project.description}
        </p>
      )}

      {/* Path */}
      <div className="mt-4 truncate rounded-md bg-muted/50 px-3 py-1.5 font-mono text-xs text-muted-foreground">
        {project.path}
      </div>
    </div>
  );
}
