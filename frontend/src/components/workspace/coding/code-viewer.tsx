"use client";

import { FileTextIcon, WrapTextIcon } from "lucide-react";
import { useState } from "react";
import type { BundledLanguage } from "shiki";

import { CodeBlock } from "@/components/ai-elements/code-block";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/workspace/copy-button";
import { MarkdownContent } from "@/components/workspace/messages/markdown-content";
import { Tooltip } from "@/components/workspace/tooltip";
import { useFileContent } from "@/core/projects";
import { streamdownPlugins } from "@/core/streamdown";
import { cn } from "@/lib/utils";

interface CodeViewerProps {
  projectId: string;
  filePath: string | null;
}

export function CodeViewer({ projectId, filePath }: CodeViewerProps) {
  const { file, isLoading } = useFileContent(projectId, filePath);
  const [wrapLines, setWrapLines] = useState(false);

  if (!filePath) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 text-center">
        <div className="bg-muted/50 flex h-16 w-16 items-center justify-center rounded-2xl">
          <FileTextIcon className="text-muted-foreground h-8 w-8" />
        </div>
        <div>
          <p className="font-medium">选择一个文件查看内容</p>
          <p className="text-muted-foreground mt-0.5 text-sm">
            从左侧文件浏览器中点击文件
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* File header */}
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FileTextIcon className="text-muted-foreground h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="truncate font-mono text-sm leading-5">{filePath}</p>
            {file && (
              <p className="text-muted-foreground truncate text-xs">
                {file.language.toUpperCase()} · {formatFileSize(file.size)} ·{" "}
                {countLines(file.content)} 行
              </p>
            )}
          </div>
        </div>
        {file && (
          <div className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
            <CopyButton
              aria-label="复制文件路径"
              clipboardData={filePath}
              className="h-7 w-7"
              tooltip="复制文件路径"
            />
            <CopyButton
              aria-label="复制文件内容"
              clipboardData={file.content}
              className="h-7 w-7"
              tooltip="复制文件内容"
            />
            {!isMarkdown(filePath, file.language) && (
              <Tooltip content={wrapLines ? "关闭自动换行" : "开启自动换行"}>
                <Button
                  aria-label={wrapLines ? "关闭自动换行" : "开启自动换行"}
                  aria-pressed={wrapLines}
                  className={cn(
                    "h-7 w-7",
                    wrapLines && "bg-accent text-accent-foreground",
                  )}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                  onClick={() => setWrapLines((value) => !value)}
                >
                  <WrapTextIcon className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {/* Code content */}
      <ScrollArea className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-4"
                style={{ width: `${60 + Math.random() * 40}%` }}
              />
            ))}
          </div>
        ) : file ? (
          <FileContent
            content={file.content}
            language={file.language}
            filePath={filePath}
            wrapLines={wrapLines}
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            无法加载文件内容
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

/**
 * Renders file content with appropriate formatting:
 * - Markdown files → rendered markdown (GFM, math, syntax-highlighted code blocks)
 * - Everything else → shiki syntax-highlighted source with line numbers
 */
function FileContent({
  content,
  language,
  filePath,
  wrapLines,
}: {
  content: string;
  language: string;
  filePath: string;
  wrapLines: boolean;
}) {
  if (isMarkdown(filePath, language)) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <MarkdownContent
          content={content}
          isLoading={false}
          rehypePlugins={streamdownPlugins.rehypePlugins}
        />
      </div>
    );
  }

  return (
    <CodeBlock
      code={content}
      language={resolveShikiLanguage(language, filePath)}
      showLineNumbers
      wrapLines={wrapLines}
      className="rounded-none border-0"
    />
  );
}

// ---------------------------------------------------------------------------
// Language helpers
// ---------------------------------------------------------------------------

function isMarkdown(filePath: string, language: string): boolean {
  if (language === "markdown") return true;
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return ext === ".md" || ext === ".markdown" || ext === ".mdx";
}

/**
 * Map the backend-reported language id + file extension to a shiki
 * ``BundledLanguage``. The backend collapses ``.tsx``/``.jsx`` into
 * ``typescript``/``javascript``; refine from the extension when possible so
 * JSX/TSX get correct highlighting. Unknown ids fall back to ``"text"``.
 */
function resolveShikiLanguage(
  language: string,
  filePath: string,
): BundledLanguage {
  const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  // Extension-first refinement for JSX/TSX (backend maps them to ts/js).
  if (ext === "tsx") return "tsx";
  if (ext === "jsx") return "jsx";

  return asBundledLanguage(language);
}

// Backend language ids that are valid shiki bundled languages. Anything not
// listed here (e.g. "text") is coerced to "text" which shiki renders plainly.
const VALID_SHIKI_LANGS: ReadonlySet<string> = new Set<BundledLanguage>([
  "python",
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "json",
  "markdown",
  "yaml",
  "html",
  "css",
  "scss",
  "go",
  "rust",
  "java",
  "kotlin",
  "c",
  "cpp",
  "shell",
  "bash",
  "sql",
  "xml",
  "toml",
  "ini",
  "ruby",
  "php",
  "swift",
  "vue",
  "svelte",
  "dockerfile",
  "makefile",
] as unknown as BundledLanguage[]);

function asBundledLanguage(language: string): BundledLanguage {
  const normalized = language.toLowerCase();
  if (VALID_SHIKI_LANGS.has(normalized)) {
    return normalized as BundledLanguage;
  }
  return "text" as BundledLanguage;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countLines(content: string): number {
  if (!content) return 0;
  return content.split(/\r\n|\r|\n/).length;
}
