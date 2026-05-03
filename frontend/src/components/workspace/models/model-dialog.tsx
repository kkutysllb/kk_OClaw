"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  CpuIcon,
  EyeIcon,
  EyeOffIcon,
  GlobeIcon,
  KeyIcon,
  Settings2Icon,
  ZapIcon,
} from "lucide-react";

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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useI18n } from "@/core/i18n/hooks";
import type { Model, ModelRequest } from "@/core/models/types";

interface ModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model?: Model | null;
  onSave: (req: ModelRequest) => Promise<void>;
}

const labelCls = "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70";
const hintCls = "text-muted-foreground text-xs";
const sectionTitleCls = "text-xs font-semibold uppercase tracking-wider text-muted-foreground/70";

/** Mask an API key: show first 7 and last 4 chars, obscure the middle. */
function maskApiKey(key: string | null | undefined): string {
  if (!key || key.trim().length === 0) return "";
  const k = key.trim();
  if (k.startsWith("$")) return k; // env var reference — show as-is
  if (k.length <= 12) return k.slice(0, 3) + "···" + k.slice(-3);
  return k.slice(0, 7) + "···" + k.slice(-4);
}

export function ModelDialog({
  open,
  onOpenChange,
  model,
  onSave,
}: ModelDialogProps) {
  const { t } = useI18n();
  const isEdit = !!model;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [useVal, setUseVal] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [temperature, setTemperature] = useState("");
  const [requestTimeout, setRequestTimeout] = useState("");
  const [description, setDescription] = useState("");
  const [supportsThinking, setSupportsThinking] = useState(false);
  const [supportsVision, setSupportsVision] = useState(false);
  const [supportsReasoningEffort, setSupportsReasoningEffort] =
    useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState("");
  const [thinkingDisabled, setThinkingDisabled] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [errFields, setErrFields] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      if (model) {
        setName(model.name);
        setDisplayName(model.display_name || "");
        setUseVal(model.use || "");
        setModelId(model.model || "");
        setApiKey(model.api_key || "");
        setBaseUrl(model.base_url || "");
        setMaxTokens(model.max_tokens != null ? String(model.max_tokens) : "");
        setTemperature(
          model.temperature != null ? String(model.temperature) : "",
        );
        setRequestTimeout(
          model.request_timeout != null ? String(model.request_timeout) : "",
        );
        setDescription(model.description || "");
        setSupportsThinking(!!model.supports_thinking);
        setSupportsVision(!!model.supports_vision);
        setSupportsReasoningEffort(!!model.supports_reasoning_effort);
        setThinkingEnabled(
          model.when_thinking_enabled
            ? JSON.stringify(model.when_thinking_enabled, null, 2)
            : "",
        );
        setThinkingDisabled(
          model.when_thinking_disabled
            ? JSON.stringify(model.when_thinking_disabled, null, 2)
            : "",
        );
      } else {
        setName("");
        setDisplayName("");
        setUseVal("");
        setModelId("");
        setApiKey("");
        setBaseUrl("");
        setMaxTokens("");
        setTemperature("");
        setRequestTimeout("");
        setDescription("");
        setSupportsThinking(false);
        setSupportsVision(false);
        setSupportsReasoningEffort(false);
        setThinkingEnabled("");
        setThinkingDisabled("");
      }
      setAdvancedOpen(false);
      setShowApiKey(false);
      setError(null);
      setErrFields(new Set());
    }
  }, [open, model]);

  const handleSave = async () => {
    const missing = new Set<string>();
    if (!name.trim()) missing.add("name");
    if (!useVal.trim()) missing.add("use");
    if (!modelId.trim()) missing.add("modelId");
    setErrFields(missing);
    if (missing.size > 0) return;

    let thinkingEnabledParsed: Record<string, unknown> | null = null;
    let thinkingDisabledParsed: Record<string, unknown> | null = null;
    if (thinkingEnabled.trim()) {
      try {
        thinkingEnabledParsed = JSON.parse(thinkingEnabled);
      } catch {
        setError(t.models.badJson + " (" + t.models.thinkingEnabled + ")");
        return;
      }
    }
    if (thinkingDisabled.trim()) {
      try {
        thinkingDisabledParsed = JSON.parse(thinkingDisabled);
      } catch {
        setError(t.models.badJson + " (" + t.models.thinkingDisabled + ")");
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        display_name: displayName.trim() || null,
        use: useVal.trim(),
        model: modelId.trim(),
        api_key: apiKey.trim() || null,
        base_url: baseUrl.trim() || null,
        max_tokens: maxTokens ? Number(maxTokens) : null,
        temperature: temperature ? Number(temperature) : null,
        request_timeout: requestTimeout ? Number(requestTimeout) : null,
        description: description.trim() || null,
        supports_thinking: supportsThinking,
        supports_vision: supportsVision,
        supports_reasoning_effort: supportsReasoningEffort,
        when_thinking_enabled: thinkingEnabledParsed,
        when_thinking_disabled: thinkingDisabledParsed,
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = (field: string) =>
    errFields.has(field) ? "border-destructive" : "";

  const maskedApiKey = useMemo(() => maskApiKey(apiKey), [apiKey]);
  const displayApiKey = showApiKey ? apiKey : maskedApiKey;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-xl">
        {/* Emerald accent bar */}
        <div className="h-1.5 w-full rounded-t-lg bg-gradient-to-r from-emerald-400 to-teal-400" />

        <DialogHeader className="px-6 pt-5">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <CpuIcon className="h-4 w-4" />
            </span>
            {isEdit ? t.models.editModel : t.models.addModel}
          </DialogTitle>
          <DialogDescription className="pl-10">
            {isEdit ? `"${model?.name}"` : t.models.emptyDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          {/* ── 基本信息 ── */}
          <div className="space-y-3">
            <p className={sectionTitleCls}>
              <Settings2Icon className="mr-1.5 inline h-3.5 w-3.5" />
              {t.common.more}
            </p>
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="grid gap-2">
                <label htmlFor="md-name" className={labelCls}>
                  {t.models.name} <span className="text-emerald-500 font-bold">*</span>
                </label>
                <Input
                  id="md-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="gpt-4"
                  disabled={isEdit}
                  className={fieldCls("name")}
                />
                <p className={hintCls}>{t.models.nameHint}</p>
              </div>

              <div className="grid gap-2">
                <label htmlFor="md-display" className={labelCls}>
                  {t.models.displayName}
                </label>
                <Input
                  id="md-display"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="GPT-4"
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor="md-use" className={labelCls}>
                  {t.models.provider} <span className="text-emerald-500 font-bold">*</span>
                </label>
                <Input
                  id="md-use"
                  value={useVal}
                  onChange={(e) => setUseVal(e.target.value)}
                  placeholder="langchain_openai:ChatOpenAI"
                  className={fieldCls("use")}
                />
                <p className={hintCls}>{t.models.providerHint}</p>
              </div>

              <div className="grid gap-2">
                <label htmlFor="md-model" className={labelCls}>
                  {t.models.modelId} <span className="text-emerald-500 font-bold">*</span>
                </label>
                <Input
                  id="md-model"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  placeholder="gpt-4"
                  className={fieldCls("modelId")}
                />
                <p className={hintCls}>{t.models.modelIdHint}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* ── 连接配置 ── */}
          <div className="space-y-3">
            <p className={sectionTitleCls}>
              <GlobeIcon className="mr-1.5 inline h-3.5 w-3.5" />
              连接配置
            </p>
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="grid gap-2">
                <label htmlFor="md-apikey" className={labelCls}>
                  {t.models.apiKey}
                </label>
                <div className="relative">
                  <Input
                    id="md-apikey"
                    type={showApiKey ? "text" : "password"}
                    value={displayApiKey}
                    onChange={(e) => {
                      if (!showApiKey) {
                        // User is editing masked value — start fresh
                        setShowApiKey(true);
                        setApiKey("");
                        return;
                      }
                      setApiKey(e.target.value);
                    }}
                    onFocus={() => {
                      if (apiKey && !showApiKey) {
                        setShowApiKey(true);
                      }
                    }}
                    placeholder="$OPENAI_API_KEY"
                    className="pr-10"
                    autoComplete="off"
                  />
                  {apiKey && (
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      tabIndex={-1}
                      aria-label={showApiKey ? "Hide API key" : "Show API key"}
                    >
                      {showApiKey ? (
                        <EyeOffIcon className="h-4 w-4" />
                      ) : (
                        <EyeIcon className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
                <p className={hintCls}>{t.models.apiKeyHint}</p>
              </div>

              <div className="grid gap-2">
                <label htmlFor="md-baseurl" className={labelCls}>
                  {t.models.baseUrl}
                </label>
                <Input
                  id="md-baseurl"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
                <p className={hintCls}>{t.models.baseUrlHint}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* ── 参数配置 ── */}
          <div className="space-y-3">
            <p className={sectionTitleCls}>
              <Settings2Icon className="mr-1.5 inline h-3.5 w-3.5" />
              参数配置
            </p>
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <label htmlFor="md-maxtokens" className={labelCls}>
                    {t.models.maxTokens}
                  </label>
                  <Input
                    id="md-maxtokens"
                    type="number"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                    placeholder="4096"
                  />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="md-temperature" className={labelCls}>
                    {t.models.temperature}
                  </label>
                  <Input
                    id="md-temperature"
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    placeholder="0.7"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <label htmlFor="md-timeout" className={labelCls}>
                  {t.models.requestTimeout}
                </label>
                <Input
                  id="md-timeout"
                  type="number"
                  step="0.1"
                  value={requestTimeout}
                  onChange={(e) => setRequestTimeout(e.target.value)}
                  placeholder="600"
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor="md-desc" className={labelCls}>
                  {t.models.modelDescription}
                </label>
                <Textarea
                  id="md-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t.models.modelDescriptionHint}
                  rows={2}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* ── 高级功能 ── */}
          <div className="space-y-3">
            <p className={sectionTitleCls}>
              <ZapIcon className="mr-1.5 inline h-3.5 w-3.5" />
              高级功能
            </p>
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">{t.models.supportsThinking}</span>
                <Switch
                  checked={supportsThinking}
                  onCheckedChange={setSupportsThinking}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">{t.models.supportsVision}</span>
                <Switch
                  checked={supportsVision}
                  onCheckedChange={setSupportsVision}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">
                  {t.models.supportsReasoningEffort}
                </span>
                <Switch
                  checked={supportsReasoningEffort}
                  onCheckedChange={setSupportsReasoningEffort}
                />
              </div>
            </div>

            <Collapsible
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
              className="border rounded-lg p-3"
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium">
                <span>
                  {advancedOpen ? t.common.close : t.common.more}
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3">
                <div className="grid gap-2">
                  <label className={labelCls}>
                    {t.models.thinkingEnabled}
                  </label>
                  <Textarea
                    value={thinkingEnabled}
                    onChange={(e) => setThinkingEnabled(e.target.value)}
                    placeholder='{"thinking": {"type": "enabled"}}'
                    rows={3}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="grid gap-2">
                  <label className={labelCls}>
                    {t.models.thinkingDisabled}
                  </label>
                  <Textarea
                    value={thinkingDisabled}
                    onChange={(e) => setThinkingDisabled(e.target.value)}
                    placeholder='{"thinking": {"type": "disabled"}}'
                    rows={3}
                    className="font-mono text-xs"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>

        {error && (
          <p className="mx-6 text-destructive text-sm rounded-md bg-destructive/5 px-3 py-2">{error}</p>
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
            className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600 shadow-sm"
          >
            {saving ? t.common.loading : t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
