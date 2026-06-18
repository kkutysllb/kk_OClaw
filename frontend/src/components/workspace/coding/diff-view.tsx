"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SideBySideDiffRow {
  oldLine: string;
  newLine: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  type: "context" | "added" | "deleted" | "meta";
}

export type DiffViewMode = "side-by-side" | "unified";

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseUnifiedDiffForSideBySide(
  diffText: string,
): SideBySideDiffRow[] {
  if (!diffText.trim()) return [];

  const rows: SideBySideDiffRow[] = [];
  const pendingDeleted: string[] = [];
  const pendingDeletedLineNumbers: number[] = [];
  let oldLineNumber = 0;
  let newLineNumber = 0;
  const flushDeleted = () => {
    while (pendingDeleted.length > 0) {
      rows.push({
        oldLine: pendingDeleted.shift() ?? "",
        newLine: "",
        oldLineNumber: pendingDeletedLineNumbers.shift() ?? null,
        newLineNumber: null,
        type: "deleted",
      });
    }
  };

  for (const line of diffText.split("\n")) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      flushDeleted();
      oldLineNumber = Number(hunk[1]);
      newLineNumber = Number(hunk[2]);
      rows.push({
        oldLine: line,
        newLine: line,
        oldLineNumber: null,
        newLineNumber: null,
        type: "meta",
      });
      continue;
    }

    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("Binary files ") ||
      line.includes("binary files differ")
    ) {
      flushDeleted();
      rows.push({
        oldLine: line,
        newLine: line,
        oldLineNumber: null,
        newLineNumber: null,
        type: "meta",
      });
      continue;
    }

    if (line.startsWith("+")) {
      rows.push({
        oldLine: pendingDeleted.shift() ?? "",
        newLine: line.slice(1),
        oldLineNumber: pendingDeletedLineNumbers.shift() ?? null,
        newLineNumber,
        type: "added",
      });
      newLineNumber += 1;
      continue;
    }

    if (line.startsWith("-")) {
      pendingDeleted.push(line.slice(1));
      pendingDeletedLineNumbers.push(oldLineNumber);
      oldLineNumber += 1;
      continue;
    }

    flushDeleted();
    const content = line.startsWith(" ") ? line.slice(1) : line;
    rows.push({
      oldLine: content,
      newLine: content,
      oldLineNumber,
      newLineNumber,
      type: "context",
    });
    oldLineNumber += 1;
    newLineNumber += 1;
  }
  flushDeleted();

  return rows;
}

// ---------------------------------------------------------------------------
// SideBySide Diff Renderer
// ---------------------------------------------------------------------------

export function SideBySideDiff({
  highlightedNewLine,
  highlightedOldLine,
  rows,
}: {
  highlightedNewLine?: number | null;
  highlightedOldLine?: number | null;
  rows: SideBySideDiffRow[];
}) {
  const highlightedRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    highlightedRowRef.current?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [highlightedNewLine, highlightedOldLine]);

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        该文件没有可显示的文本 Diff。
      </div>
    );
  }

  return (
    <div className="min-w-[860px] font-mono text-xs leading-5">
      <div className="bg-muted/50 text-muted-foreground grid grid-cols-[56px_minmax(0,1fr)_56px_minmax(0,1fr)] border-b text-[11px]">
        <div className="border-r px-2 py-1.5 text-right">旧</div>
        <div className="border-r px-3 py-1.5">修改前</div>
        <div className="border-r px-2 py-1.5 text-right">新</div>
        <div className="px-3 py-1.5">修改后</div>
      </div>
      {rows.map((row, index) => (
        <div
          ref={
            (highlightedNewLine != null &&
              row.newLineNumber === highlightedNewLine) ||
            (highlightedOldLine != null && row.oldLineNumber === highlightedOldLine)
              ? highlightedRowRef
              : undefined
          }
          key={`${index}-${row.oldLine}-${row.newLine}`}
          className={cn(
            "border-border/40 grid grid-cols-[56px_minmax(0,1fr)_56px_minmax(0,1fr)] border-b",
            row.type === "meta" && "bg-muted/40 text-muted-foreground",
            ((highlightedNewLine != null &&
              row.newLineNumber === highlightedNewLine) ||
              (highlightedOldLine != null &&
                row.oldLineNumber === highlightedOldLine)) &&
              "ring-1 ring-amber-500/60 bg-amber-500/10",
          )}
        >
          <LineNumber value={row.oldLineNumber} muted={row.type === "added"} />
          <DiffCell side="old" row={row} />
          <LineNumber
            value={row.newLineNumber}
            muted={row.type === "deleted"}
          />
          <DiffCell side="new" row={row} />
        </div>
      ))}
    </div>
  );
}

function LineNumber({
  muted,
  value,
}: {
  muted?: boolean;
  value: number | null;
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground/80 border-r px-2 py-0.5 text-right select-none",
        muted && "text-muted-foreground/30",
      )}
    >
      {value ?? ""}
    </span>
  );
}

function DiffCell({
  row,
  side,
}: {
  row: SideBySideDiffRow;
  side: "old" | "new";
}) {
  const isDeleted = side === "old" && row.type === "deleted";
  const isAdded = side === "new" && row.type === "added";
  const text = side === "old" ? row.oldLine : row.newLine;

  return (
    <pre
      className={cn(
        "min-h-5 overflow-x-auto border-r px-3 py-0.5 whitespace-pre",
        side === "new" && "border-r-0",
        isDeleted && "bg-red-500/10 text-red-700 dark:text-red-300",
        isAdded && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      )}
    >
      {text || " "}
    </pre>
  );
}
