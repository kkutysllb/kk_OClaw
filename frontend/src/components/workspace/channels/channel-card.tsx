"use client";

import { Edit2Icon, LockIcon, MessageCircleIcon, RefreshCwIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import type { ChannelConfigItem } from "@/core/channels/api";

const CHANNEL_ICON_COLORS: Record<string, string> = {
  dingtalk: "bg-sky-500/10 text-sky-500",
  discord: "bg-indigo-500/10 text-indigo-500",
  feishu: "bg-blue-500/10 text-blue-500",
  slack: "bg-purple-500/10 text-purple-500",
  telegram: "bg-cyan-500/10 text-cyan-500",
  wechat: "bg-emerald-500/10 text-emerald-500",
  wecom: "bg-teal-500/10 text-teal-500",
};

interface ChannelCardProps {
  name: string;
  config: ChannelConfigItem;
  onEdit: (name: string) => void;
  onRestart: (name: string) => void;
  restarting: boolean;
}

export function ChannelCard({
  name,
  config,
  onEdit,
  onRestart,
  restarting,
}: ChannelCardProps) {
  const { t } = useI18n();

  const iconColor = CHANNEL_ICON_COLORS[name] ?? "bg-violet-500/10 text-violet-500";

  return (
    <div className="group flex items-center gap-4 rounded-lg border bg-card px-4 py-3 transition-all duration-200 hover:bg-accent/50 hover:shadow-sm">
      {/* Icon */}
      <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${iconColor}`}>
        <MessageCircleIcon className="size-4.5" />
      </div>

      {/* Name + credentials */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">
            {config.display_name_zh || config.display_name}
          </span>
          <Badge
            variant={config.enabled ? "default" : "secondary"}
            className={
              config.enabled
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] px-1.5 py-0"
                : "bg-muted text-muted-foreground text-[10px] px-1.5 py-0"
            }
          >
            {config.enabled ? t.channels.enabled : t.channels.disabled}
          </Badge>
          <Badge
            variant={config.configured ? "default" : "outline"}
            className={
              config.configured
                ? "bg-sky-500/10 text-sky-600 border-sky-500/20 text-[10px] px-1.5 py-0"
                : "text-muted-foreground/60 text-[10px] px-1.5 py-0"
            }
          >
            {config.configured ? t.channels.configured : t.channels.notConfigured}
          </Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground/60 truncate">
          <LockIcon className="size-3 shrink-0" />
          <span className="font-mono truncate">{config.credential_keys.join(", ")}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 hover:bg-violet-500/10 hover:text-violet-500"
                onClick={() => onEdit(name)}
              >
                <Edit2Icon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.channels.editConfig}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 hover:bg-sky-500/10 hover:text-sky-500"
                onClick={() => onRestart(name)}
                disabled={restarting}
              >
                <RefreshCwIcon className={`size-3.5 ${restarting ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.channels.restart}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
