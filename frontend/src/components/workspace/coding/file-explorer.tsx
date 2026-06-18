"use client";

import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { listFiles, useFileList } from "@/core/projects";
import type { FileEntry } from "@/core/projects";
import { cn } from "@/lib/utils";

interface FileExplorerProps {
  projectId: string;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  headerAction?: ReactNode;
}

interface TreeNode {
  name: string;
  path: string;
  type: "directory" | "file";
  ext: string;
  children?: TreeNode[];
  loaded?: boolean;
}

export function FileExplorer({
  headerAction,
  projectId,
  selectedFile,
  onSelectFile,
}: FileExplorerProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Load root directory
  const { entries, isLoading } = useFileList(projectId, ".");

  // Sync root entries to tree
  useEffect(() => {
    if (entries) {
      setTree(
        entries.map((e) => ({
          name: e.name,
          path: e.path,
          type: e.type,
          ext: e.ext,
          loaded: e.type === "file",
        })),
      );
    }
  }, [entries]);

  const toggleExpand = useCallback(
    async (nodePath: string) => {
      const newExpanded = new Set(expandedPaths);
      if (newExpanded.has(nodePath)) {
        newExpanded.delete(nodePath);
      } else {
        newExpanded.add(nodePath);
        // Lazy load children. Use listFiles() from core/projects so the
        // request goes through getBackendBaseURL() + the authed fetcher —
        // a raw fetch('/api/...') resolves against the page origin and breaks
        // in the packaged static export (app://- protocol → ERR_FILE_NOT_FOUND).
        try {
          const entries = await listFiles(projectId, nodePath);
          setTree((prev) => updateTreeChildren(prev, nodePath, entries));
        } catch {
          // ignore
        }
      }
      setExpandedPaths(newExpanded);
    },
    [expandedPaths, projectId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          文件浏览器
        </span>
        {headerAction}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1">
          {isLoading ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : (
            tree.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                projectId={projectId}
                expandedPaths={expandedPaths}
                selectedFile={selectedFile}
                onToggle={toggleExpand}
                onSelectFile={onSelectFile}
                level={0}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function TreeItem({
  node,
  projectId,
  expandedPaths,
  selectedFile,
  onToggle,
  onSelectFile,
  level,
}: {
  node: TreeNode;
  projectId: string;
  expandedPaths: Set<string>;
  selectedFile: string | null;
  onToggle: (path: string) => void;
  onSelectFile: (path: string) => void;
  level: number;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedFile === node.path;
  const paddingLeft = 8 + level * 16;
  const handleDragStart = (event: React.DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "application/x-oclaw-coding-path",
      JSON.stringify({ path: node.path, type: node.type }),
    );
    event.dataTransfer.setData(
      "text/plain",
      `${node.type === "directory" ? "Directory" : "File"}: ${node.path}`,
    );
  };

  if (node.type === "file") {
    return (
      <button
        draggable
        onClick={() => onSelectFile(node.path)}
        onDragStart={handleDragStart}
        className={cn(
          "hover:bg-muted/50 flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-sm transition-colors",
          isSelected &&
            "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        )}
        style={{ paddingLeft }}
      >
        <FileIcon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <>
      <button
        draggable
        onClick={() => onToggle(node.path)}
        onDragStart={handleDragStart}
        className="hover:bg-muted/50 flex w-full items-center gap-1 rounded-sm py-1 pr-2 text-left text-sm transition-colors"
        style={{ paddingLeft }}
      >
        <ChevronRightIcon
          className={cn(
            "text-muted-foreground h-3 w-3 shrink-0 transition-transform",
            isExpanded && "rotate-90",
          )}
        />
        {isExpanded ? (
          <FolderOpenIcon className="h-3.5 w-3.5 shrink-0 text-sky-500" />
        ) : (
          <FolderIcon className="h-3.5 w-3.5 shrink-0 text-sky-500" />
        )}
        <span className="truncate font-medium">{node.name}</span>
      </button>
      {isExpanded &&
        node.children?.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            projectId={projectId}
            expandedPaths={expandedPaths}
            selectedFile={selectedFile}
            onToggle={onToggle}
            onSelectFile={onSelectFile}
            level={level + 1}
          />
        ))}
    </>
  );
}

function updateTreeChildren(
  nodes: TreeNode[],
  targetPath: string,
  entries: FileEntry[],
): TreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return {
        ...node,
        children: entries.map((e) => ({
          name: e.name,
          path: e.path,
          type: e.type,
          ext: e.ext,
          loaded: e.type === "file",
        })),
        loaded: true,
      };
    }
    if (node.children) {
      return {
        ...node,
        children: updateTreeChildren(node.children, targetPath, entries),
      };
    }
    return node;
  });
}
