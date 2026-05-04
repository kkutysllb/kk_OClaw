"use client";

import { Edit2Icon, LinkIcon, TerminalIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import type { MCPServerConfig } from "@/core/mcp/types";

const TYPE_GRADIENTS: Record<string, string> = {
  stdio: "from-emerald-400 to-teal-400",
  sse: "from-blue-400 to-cyan-400",
  http: "from-purple-400 to-fuchsia-400",
};

const TYPE_ICONS: Record<string, string> = {
  stdio: "bg-emerald-500/10 text-emerald-500",
  sse: "bg-blue-500/10 text-blue-500",
  http: "bg-purple-500/10 text-purple-500",
};

const TYPE_LABELS: Record<string, string> = {
  stdio: "STDIO",
  sse: "SSE",
  http: "HTTP",
};

interface McpCardProps {
  name: string;
  config: MCPServerConfig;
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
}

export function McpCard({ name, config, onEdit, onDelete }: McpCardProps) {
  const { t } = useI18n();

  const transportType = config.type || "stdio";
  const gradient =
    TYPE_GRADIENTS[transportType] ?? "from-amber-400 to-orange-400";
  const iconColor =
    TYPE_ICONS[transportType] ?? "bg-amber-500/10 text-amber-500";
  const typeLabel = TYPE_LABELS[transportType] ?? transportType.toUpperCase();

  return (
    <Card className="group flex flex-col overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
      {/* Gradient top accent */}
      <div className={`h-1 w-full bg-gradient-to-r ${gradient}`} />
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset transition-transform duration-200 group-hover:scale-110 ${iconColor} ${iconColor.replace('bg-', 'ring-').replace('/10', '/20')}`}
          >
            <TerminalIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">{name}</CardTitle>
            <CardDescription className="text-muted-foreground/70 mt-0.5 truncate font-mono text-xs">
              {typeLabel}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-2.5">
        {/* Status badges */}
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant={config.enabled ? "default" : "secondary"}
            className={
              config.enabled
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs"
                : "bg-muted text-muted-foreground text-xs"
            }
          >
            {config.enabled ? t.mcp.enabled : t.mcp.disabled}
          </Badge>
          <Badge
            variant="outline"
            className={`text-xs ${iconColor} border-current/20`}
          >
            {t.mcp.type}: {typeLabel}
          </Badge>
        </div>

        {/* Description */}
        {config.description && (
          <p className="text-muted-foreground/70 line-clamp-2 text-xs leading-relaxed">
            {config.description}
          </p>
        )}

        {/* Transport details */}
        {transportType === "stdio" && config.command && (
          <p className="text-muted-foreground/50 truncate font-mono text-xs flex items-center gap-1">
            <TerminalIcon className="h-3 w-3 shrink-0" />
            $ {config.command} {(config.args ?? []).join(" ")}
          </p>
        )}
        {(transportType === "sse" || transportType === "http") && config.url && (
          <p className="text-muted-foreground/50 truncate font-mono text-xs flex items-center gap-1">
            <LinkIcon className="h-3 w-3 shrink-0" />
            {config.url}
          </p>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-1 border-t pt-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-amber-500/10 hover:text-amber-500"
                onClick={() => onEdit(name)}
              >
                <Edit2Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.mcp.editServer}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onDelete(name)}
              >
                <Trash2Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.mcp.deleteServer}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardFooter>
    </Card>
  );
}
