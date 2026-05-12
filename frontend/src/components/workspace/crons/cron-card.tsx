"use client";

import { ClockIcon, TerminalIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import type { CronJobConfig } from "@/core/crons/types";

interface CronCardProps {
  name: string;
  config: CronJobConfig;
  onToggle: (name: string, enabled: boolean) => void;
  onDelete: (name: string) => void;
}

export function CronCard({ name, config, onToggle, onDelete }: CronCardProps) {
  const { t } = useI18n();

  return (
    <div className="group flex items-center gap-4 rounded-lg border bg-card px-4 py-3 transition-all duration-200 hover:bg-accent/50 hover:shadow-sm">
      {/* Icon */}
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
        <ClockIcon className="size-4.5" />
      </div>

      {/* Name + description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{name}</span>
          <Badge
            variant={config.enabled ? "default" : "secondary"}
            className={
              config.enabled
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] px-1.5 py-0"
                : "bg-muted text-muted-foreground text-[10px] px-1.5 py-0"
            }
          >
            {config.enabled ? t.crons.enabled : t.crons.disabled}
          </Badge>
        </div>
        {config.description && (
          <p className="text-muted-foreground/70 mt-0.5 truncate text-xs">
            {config.description}
          </p>
        )}
      </div>

      {/* Cron expression */}
      <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground/60 font-mono shrink-0">
        <TerminalIcon className="size-3" />
        {config.cron}
      </div>

      {/* Agent badge */}
      <Badge
        variant="outline"
        className="hidden md:inline-flex text-[10px] bg-orange-500/10 text-orange-500 border-orange-500/20 px-1.5 py-0 shrink-0"
      >
        {config.agent}
      </Badge>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Switch
          checked={config.enabled}
          onCheckedChange={(checked) => onToggle(name, checked)}
        />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onDelete(name)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.crons.deleteJob}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
