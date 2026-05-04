"use client";

import { ArrowLeftIcon, ExternalLinkIcon, HelpCircleIcon, TerminalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/core/i18n/hooks";

const RECOMMENDED_SERVERS: { name: string; description: string; url: string }[] = [
  {
    name: "GitHub",
    description: "Repository management, issue tracking, PR operations",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
  },
  {
    name: "Filesystem",
    description: "Secure file system access with configurable permissions",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    name: "Brave Search",
    description: "Web search via Brave Search API",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
  },
  {
    name: "PostgreSQL",
    description: "Database schema inspection and query execution",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
  },
  {
    name: "Puppeteer",
    description: "Browser automation and web scraping",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
  },
  {
    name: "Memory",
    description: "Knowledge graph-based persistent memory",
    url: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
];

interface McpHelpProps {
  onBack: () => void;
}

export function McpHelp({ onBack }: McpHelpProps) {
  const { t } = useI18n();

  return (
    <Dialog open={true} onOpenChange={() => onBack()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-lg">
        {/* Accent bar */}
        <div className="h-1.5 w-full rounded-t-lg bg-gradient-to-r from-amber-400 to-orange-400" />

        <DialogHeader className="px-6 pt-5">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onBack}
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                <HelpCircleIcon className="h-4 w-4" />
              </span>
              {t.mcp.guide}
            </DialogTitle>
          </div>
          <DialogDescription className="pl-16">
            {t.mcp.guideIntro}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-4">
          {/* STDIO Section */}
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/10 text-emerald-500">
                <TerminalIcon className="h-3.5 w-3.5" />
              </span>
              {t.mcp.guideStdioTitle}
            </h3>
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-muted-foreground text-sm whitespace-pre-line leading-relaxed">
                {t.mcp.guideStdioSteps}
              </p>
            </div>
          </div>

          {/* SSE/HTTP Section */}
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-blue-500/10 text-blue-500">
                <TerminalIcon className="h-3.5 w-3.5" />
              </span>
              {t.mcp.guideSseTitle}
            </h3>
            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-muted-foreground text-sm whitespace-pre-line leading-relaxed">
                {t.mcp.guideSseSteps}
              </p>
            </div>
          </div>

          <Separator />

          {/* Recommended Servers */}
          <div>
            <h3 className="text-sm font-semibold mb-3">{t.mcp.guideLinks}</h3>
            <div className="space-y-1.5">
              {RECOMMENDED_SERVERS.map((server) => (
                <a
                  key={server.name}
                  href={server.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 rounded-md bg-muted/30 px-3 py-2.5 hover:bg-muted/50 transition-colors"
                >
                  <ExternalLinkIcon className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                  <div>
                    <span className="text-sm font-medium">{server.name}</span>
                    <p className="text-muted-foreground/70 text-xs mt-0.5">
                      {server.description}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </div>

          <Separator />

          <p className="text-muted-foreground/60 text-xs text-center">
            更多 MCP 服务器请访问{" "}
            <a
              href="https://github.com/modelcontextprotocol/servers"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-500 underline"
            >
              github.com/modelcontextprotocol/servers
            </a>
          </p>
        </div>

        <Separator />

        <div className="px-6 pb-5 pt-4">
          <Button variant="outline" onClick={onBack} className="w-full">
            <ArrowLeftIcon className="mr-1.5 h-4 w-4" />
            返回配置
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
