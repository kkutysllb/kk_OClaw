"use client";

import { ArrowLeftIcon, FileTextIcon, PackageOpenIcon } from "lucide-react";
import { useState } from "react";

import {
  ArtifactFileDetail,
  ArtifactFileList,
  useArtifacts,
} from "@/components/workspace/artifacts";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CodingResultsPanelProps {
  threadId: string;
}

export function CodingResultsPanel({ threadId }: CodingResultsPanelProps) {
  const { artifacts } = useArtifacts();
  const [selectedResultArtifact, setSelectedResultArtifact] = useState<
    string | null
  >(null);
  const safeArtifacts = artifacts ?? [];

  if (selectedResultArtifact) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center border-b px-2 py-1.5">
          <Button
            className="text-muted-foreground hover:text-foreground"
            size="sm"
            variant="ghost"
            onClick={() => setSelectedResultArtifact(null)}
          >
            <ArrowLeftIcon className="h-4 w-4" />
            结果列表
          </Button>
        </div>
        <ArtifactFileDetail
          className="min-h-0 flex-1 rounded-none border-0"
          filepath={selectedResultArtifact}
          isMock={false}
          threadId={threadId}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <PackageOpenIcon className="text-muted-foreground h-4 w-4 shrink-0" />
          <span className="truncate text-sm font-semibold">结果文件</span>
        </div>
        {safeArtifacts.length > 0 && (
          <span className="text-muted-foreground text-xs">
            {safeArtifacts.length} 个文件
          </span>
        )}
      </div>

      {safeArtifacts.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="bg-muted/60 flex h-14 w-14 items-center justify-center rounded-lg">
            <FileTextIcon className="text-muted-foreground h-7 w-7" />
          </div>
          <div>
            <p className="text-sm font-medium">暂无结果文件</p>
            <p className="text-muted-foreground mt-1 max-w-xs text-xs">
              Agent 生成的文件会显示在这里，不会再挤压右侧对话面板。
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ArtifactFileList
            className="gap-2 p-4"
            files={safeArtifacts}
            onSelectFile={setSelectedResultArtifact}
            threadId={threadId}
          />
        </ScrollArea>
      )}
    </div>
  );
}
