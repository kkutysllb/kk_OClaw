"use client";

import { ClockIcon, HelpCircleIcon, Settings2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import type { CronJobConfig } from "@/core/crons/types";
import { loadModels } from "@/core/models/api";
import type { Model } from "@/core/models/types";

import { CronHelp } from "./cron-help";

const GRADIENT = "from-orange-400 to-amber-400";
const ICON_COLOR = "bg-orange-500/10 text-orange-500";

const labelCls =
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70";
const hintCls = "text-muted-foreground text-xs";
const sectionTitleCls =
  "text-xs font-semibold uppercase tracking-wider text-muted-foreground/70";

const AGENT_OPTIONS = ["lead_agent", "custom_agent"];

interface CronDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string | null;
  config: CronJobConfig | null;
  onSave: (
    name: string,
    isNew: boolean,
    config: CronJobConfig,
  ) => Promise<void>;
}

export function CronDialog({
  open,
  onOpenChange,
  name,
  config,
  onSave,
}: CronDialogProps) {
  const { t } = useI18n();
  const isEdit = !!name && !!config;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const [jobName, setJobName] = useState("");
  const [cron, setCron] = useState("");
  const [description, setDescription] = useState("");
  const [agent, setAgent] = useState("lead_agent");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(true);

  // Available models from API
  const [models, setModels] = useState<Model[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const [errFields, setErrFields] = useState<Set<string>>(new Set());

  // Load models when dialog opens
  const fetchModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const data = await loadModels();
      setModels(data.models);
    } catch {
      // Silently fail — model dropdown will just be empty
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchModels();
      if (isEdit && config) {
        setJobName(name!);
        setCron(config.cron || "");
        setDescription(config.description || "");
        setAgent(config.agent || "lead_agent");
        setModel(config.model || "");
        setPrompt(config.prompt || "");
        setEnabled(config.enabled);
      } else {
        setJobName("");
        setCron("");
        setDescription("");
        setAgent("lead_agent");
        setModel("");
        setPrompt("");
        setEnabled(true);
      }
      setShowHelp(false);
      setError(null);
      setErrFields(new Set());
    }
  }, [open, isEdit, name, config, fetchModels]);

  const handleSave = async () => {
    const missing = new Set<string>();
    if (!jobName.trim()) missing.add("name");
    if (!cron.trim()) missing.add("cron");
    if (!prompt.trim()) missing.add("prompt");
    setErrFields(missing);
    if (missing.size > 0) return;

    const jobConfig: CronJobConfig = {
      enabled,
      cron: cron.trim(),
      description: description.trim(),
      agent: agent.trim() || "lead_agent",
      model: model.trim() || null,
      prompt: prompt.trim(),
    };

    setSaving(true);
    setError(null);
    try {
      await onSave(jobName.trim(), !isEdit, jobConfig);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = (field: string) =>
    errFields.has(field) ? "border-destructive" : "";

  if (showHelp) {
    return <CronHelp onBack={() => setShowHelp(false)} />;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-xl">
        {/* Accent bar */}
        <div
          className={`h-1.5 w-full rounded-t-lg bg-gradient-to-r ${GRADIENT}`}
        />

        <DialogHeader className="px-6 pt-5">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${ICON_COLOR}`}
            >
              <ClockIcon className="h-4 w-4" />
            </span>
            {isEdit ? t.crons.editJob : t.crons.addJob}
          </DialogTitle>
          <DialogDescription className="pl-10">
            {isEdit ? `"${name}"` : t.crons.description}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          {/* Basic Info */}
          <div className="space-y-3">
            <p className={sectionTitleCls}>
              <Settings2Icon className="mr-1.5 inline h-3.5 w-3.5" />
              基本信息
            </p>
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="grid gap-2">
                <label htmlFor="cron-name" className={labelCls}>
                  {t.crons.name} <span className="text-orange-500 font-bold">*</span>
                </label>
                <Input
                  id="cron-name"
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  placeholder="daily-summary"
                  disabled={isEdit}
                  className={fieldCls("name")}
                />
                <p className={hintCls}>{t.crons.nameHint}</p>
              </div>

              <div className="grid gap-2">
                <label htmlFor="cron-expr" className={labelCls}>
                  {t.crons.cron} <span className="text-orange-500 font-bold">*</span>
                </label>
                <Input
                  id="cron-expr"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder={t.crons.cronPlaceholder}
                  className={`font-mono text-xs ${fieldCls("cron")}`}
                />
                <p className={hintCls}>{t.crons.cronHint}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Task Config */}
          <div className="space-y-3">
            <p className={sectionTitleCls}>
              <ClockIcon className="mr-1.5 inline h-3.5 w-3.5" />
              任务配置
            </p>
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="grid gap-2">
                <label htmlFor="cron-agent" className={labelCls}>
                  {t.crons.agent}
                </label>
                <Select value={agent} onValueChange={setAgent}>
                  <SelectTrigger id="cron-agent">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGENT_OPTIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className={hintCls}>{t.crons.agentHint}</p>
              </div>

              <div className="grid gap-2">
                <label htmlFor="cron-model" className={labelCls}>
                  {t.crons.model}
                </label>
                <Select
                  value={model}
                  onValueChange={(v) => setModel(v === "__none__" ? "" : v)}
                  disabled={loadingModels}
                >
                  <SelectTrigger id="cron-model">
                    <SelectValue placeholder={t.crons.modelPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      {t.crons.modelPlaceholder}
                    </SelectItem>
                    {models.map((m) => (
                      <SelectItem key={m.name} value={m.name}>
                        {m.display_name || m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className={hintCls}>{t.crons.modelHint}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Prompt */}
          <div className="space-y-3">
            <p className={sectionTitleCls}>
              <Settings2Icon className="mr-1.5 inline h-3.5 w-3.5" />
              提示词
            </p>
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="grid gap-2">
                <label htmlFor="cron-prompt" className={labelCls}>
                  {t.crons.prompt} <span className="text-orange-500 font-bold">*</span>
                </label>
                <Textarea
                  id="cron-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={t.crons.promptPlaceholder}
                  rows={4}
                  className={`font-mono text-xs ${fieldCls("prompt")}`}
                />
                <p className={hintCls}>{t.crons.promptHint}</p>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-3">
            <p className={sectionTitleCls}>
              <Settings2Icon className="mr-1.5 inline h-3.5 w-3.5" />
              {t.crons.jobDescription}
            </p>
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="grid gap-2">
                <Textarea
                  id="cron-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t.crons.jobDescriptionHint}
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-4">
            <div>
              <p className="text-sm font-medium">{t.crons.enabled}</p>
              <p className={hintCls}>
                {enabled ? "任务已启用，将按计划执行" : "任务已禁用"}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Help button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setShowHelp(true)}
          >
            <HelpCircleIcon className="mr-1.5 h-4 w-4" />
            {t.crons.guide}
          </Button>
        </div>

        {error && (
          <p className="mx-6 text-destructive text-sm rounded-md bg-destructive/5 px-3 py-2">
            {error}
          </p>
        )}

        <Separator />

        <DialogFooter className="px-6 pb-5">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t.common.cancel}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className={`bg-gradient-to-r ${GRADIENT} text-white hover:opacity-90 shadow-sm`}
          >
            {saving ? t.common.loading : t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
