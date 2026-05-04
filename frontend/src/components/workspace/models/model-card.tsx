"use client";

import {
  BrainIcon,
  CpuIcon,
  Edit2Icon,
  EyeIcon,
  GlobeIcon,
  HashIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";

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
import type { Model } from "@/core/models/types";

interface Capability {
  label: string;
  icon: React.ReactNode;
  color: string;
}

export function ModelCard({
  model,
  onEdit,
  onDelete,
}: {
  model: Model;
  onEdit: (model: Model) => void;
  onDelete: (model: Model) => void;
}) {
  const { t } = useI18n();

  const capabilities: Capability[] = [];
  if (model.supports_thinking)
    capabilities.push({
      label: t.models.supportsThinking,
      icon: <BrainIcon className="h-3 w-3" />,
      color:
        "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400 dark:border-amber-400/20",
    });
  if (model.supports_vision)
    capabilities.push({
      label: t.models.supportsVision,
      icon: <EyeIcon className="h-3 w-3" />,
      color:
        "bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-400 dark:border-sky-400/20",
    });
  if (model.supports_reasoning_effort)
    capabilities.push({
      label: t.models.supportsReasoningEffort,
      icon: <ZapIcon className="h-3 w-3" />,
      color:
        "bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400 dark:border-purple-400/20",
    });

  return (
    <Card className="group flex flex-col overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
      {/* Gradient top accent */}
      <div className="h-1 w-full bg-gradient-to-r from-emerald-400 to-teal-400" />
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          {/* Colored icon badge */}
          <div className="bg-emerald-500/10 text-emerald-500 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-emerald-500/20 transition-transform duration-200 group-hover:scale-110">
            <CpuIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">
              {model.display_name || model.name}
            </CardTitle>
            <CardDescription className="text-muted-foreground/70 mt-0.5 truncate font-mono text-xs">
              {model.name}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 space-y-2.5">
        <div className="flex items-center gap-1.5 text-xs">
          <GlobeIcon className="text-muted-foreground/50 h-3 w-3 shrink-0" />
          <span className="text-muted-foreground shrink-0 font-medium">
            {t.models.provider}:
          </span>
          <span className="text-muted-foreground/70 truncate font-mono">
            {model.use}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <HashIcon className="text-muted-foreground/50 h-3 w-3 shrink-0" />
          <span className="text-muted-foreground shrink-0 font-medium">
            {t.models.modelId}:
          </span>
          <span className="text-muted-foreground/70 truncate font-mono">
            {model.model}
          </span>
        </div>
        {model.description && (
          <p className="text-muted-foreground/70 line-clamp-2 text-xs leading-relaxed">
            {model.description}
          </p>
        )}
        {capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {capabilities.map((cap) => (
              <span
                key={cap.label}
                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium ${cap.color}`}
              >
                {cap.icon}
                {cap.label}
              </span>
            ))}
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
                className="hover:bg-emerald-500/10 hover:text-emerald-500"
                onClick={() => onEdit(model)}
              >
                <Edit2Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.models.editModel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onDelete(model)}
              >
                <Trash2Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.models.deleteModel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardFooter>
    </Card>
  );
}
