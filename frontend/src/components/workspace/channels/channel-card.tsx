"use client";

import { Edit2Icon, LockIcon, MessageCircleIcon, RefreshCwIcon, ZapIcon } from "lucide-react";

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
import type { ChannelConfigItem } from "@/core/channels/api";

const CHANNEL_ACCENT_COLORS: Record<string, string> = {
  dingtalk: "from-sky-400 to-blue-400",
  discord: "from-indigo-400 to-violet-400",
  feishu: "from-blue-400 to-cyan-400",
  slack: "from-purple-400 to-fuchsia-400",
  telegram: "from-cyan-400 to-sky-400",
  wechat: "from-emerald-400 to-green-400",
  wecom: "from-teal-400 to-emerald-400",
};

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

  const gradient = CHANNEL_ACCENT_COLORS[name] ?? "from-violet-400 to-purple-400";
  const iconColor = CHANNEL_ICON_COLORS[name] ?? "bg-violet-500/10 text-violet-500";

  return (
    <Card className="group flex flex-col overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
      {/* Gradient top accent */}
      <div className={`h-1 w-full bg-gradient-to-r ${gradient}`} />
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          {/* Colored icon badge */}
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset transition-transform duration-200 group-hover:scale-110 ${iconColor} ${iconColor.replace('bg-', 'ring-').replace('/10', '/20')}`}>
            <MessageCircleIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">
              {config.display_name_zh || config.display_name}
            </CardTitle>
            <CardDescription className="text-muted-foreground/70 mt-0.5 truncate font-mono text-xs">
              {name}
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
            {config.enabled ? t.channels.enabled : t.channels.disabled}
          </Badge>
          <Badge
            variant={config.configured ? "default" : "outline"}
            className={
              config.configured
                ? "bg-sky-500/10 text-sky-600 border-sky-500/20 text-xs"
                : "text-muted-foreground/60 text-xs"
            }
          >
            {config.configured ? t.channels.configured : t.channels.notConfigured}
          </Badge>
        </div>

        {/* Credential keys */}
        <div className="text-xs flex items-center gap-1.5">
          <LockIcon className="text-muted-foreground/50 h-3 w-3 shrink-0" />
          <span className="text-muted-foreground font-medium">{t.channels.credentials}:</span>{" "}
          <span className="text-muted-foreground/70 font-mono">
            {config.credential_keys.join(", ")}
          </span>
        </div>

        {/* Streaming support */}
        {config.supports_streaming && (
          <div className="text-xs flex items-center gap-1.5">
            <ZapIcon className="text-cyan-500/60 h-3 w-3" />
            <span className="text-muted-foreground/50">支持流式响应</span>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-1 border-t pt-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-violet-500/10 hover:text-violet-500"
                onClick={() => onEdit(name)}
              >
                <Edit2Icon className="h-4 w-4" />
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
                className="hover:bg-sky-500/10 hover:text-sky-500"
                onClick={() => onRestart(name)}
                disabled={restarting}
              >
                <RefreshCwIcon
                  className={`h-4 w-4 ${restarting ? "animate-spin" : ""}`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.channels.restart}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardFooter>
    </Card>
  );
}
