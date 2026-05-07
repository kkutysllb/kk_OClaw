"use client";

import { ClockIcon, QuoteIcon, TerminalIcon, Trash2Icon } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/core/i18n/hooks";
import type { CronJobConfig } from "@/core/crons/types";

const GRADIENT = "from-orange-400 to-amber-400";
const ICON_COLOR = "bg-orange-500/10 text-orange-500";

interface CronCardProps {
  name: string;
  config: CronJobConfig;
  onToggle: (name: string, enabled: boolean) => void;
  onDelete: (name: string) => void;
}

export function CronCard({ name, config, onToggle, onDelete }: CronCardProps) {
  const { t } = useI18n();

  return (
    <Card className="group flex flex-col overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
      {/* Gradient top accent */}
      <div className={`h-1 w-full bg-gradient-to-r ${GRADIENT}`} />
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset transition-transform duration-200 group-hover:scale-110 ${ICON_COLOR} ring-orange-500/20`}
          >
            <ClockIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">{name}</CardTitle>
            <CardDescription className="text-muted-foreground/70 mt-0.5 truncate font-mono text-xs">
              {config.cron}
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
            {config.enabled ? t.crons.enabled : t.crons.disabled}
          </Badge>
          <Badge
            variant="outline"
            className={`text-xs ${ICON_COLOR} border-current/20`}
          >
            {config.agent}
          </Badge>
          {config.model && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {config.model}
            </Badge>
          )}
        </div>

        {/* Description */}
        {config.description && (
          <p className="text-muted-foreground/70 line-clamp-2 text-xs leading-relaxed">
            {config.description}
          </p>
        )}

        {/* Cron expression */}
        <div className="text-muted-foreground/50 truncate font-mono text-xs flex items-center gap-1">
          <TerminalIcon className="h-3 w-3 shrink-0" />
          {config.cron}
        </div>

        {/* Prompt preview */}
        {config.prompt && (
          <div className="text-muted-foreground/40 line-clamp-1 text-xs italic flex items-center gap-1">
            <QuoteIcon className="h-3 w-3 shrink-0" />
            {config.prompt}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-2 border-t pt-3">
        <div className="flex items-center gap-2">
          <Switch
            checked={config.enabled}
            onCheckedChange={(checked) => onToggle(name, checked)}
          />
          <span className="text-xs text-muted-foreground">
            {config.enabled ? t.crons.enabled : t.crons.disabled}
          </span>
        </div>
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
            <TooltipContent>{t.crons.deleteJob}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardFooter>
    </Card>
  );
}
