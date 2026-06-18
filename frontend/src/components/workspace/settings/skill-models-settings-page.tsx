"use client";

import {
  CheckCircle2Icon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  KeyRoundIcon,
  Loader2Icon,
  MusicIcon,
  RefreshCwIcon,
  VideoIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isDesktop } from "@/core/config";
import { loadModels } from "@/core/models/api";

import { SettingsSection } from "./settings-section";

// ── Types (mirror desktop/types.ts; duplicated to avoid a cross-package import) ──

interface SkillModelField {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

interface SkillModelProvider {
  id: string;
  category: "image" | "av";
  title: string;
  description: string;
  matchKeywords: string[];
  fields: SkillModelField[];
}

interface SkillModelVar {
  key: string;
  value: string;
  configured: boolean;
  isSecret: boolean;
}

interface SkillModelsConfig {
  providers: SkillModelProvider[];
  vars: SkillModelVar[];
  filePath: string;
}

const REDACTION_PREFIX = "***";

function isRedacted(v: string): boolean {
  return v.startsWith(REDACTION_PREFIX);
}

/** Build the icon for a provider based on its category. */
function providerIcon(provider: SkillModelProvider) {
  if (provider.id === "minimax") {
    // TTS 配音 + 背景音乐：视频 + 音乐组合图标
    return (
      <div className="flex gap-1">
        <VideoIcon className="w-4 h-4 text-fuchsia-500" />
        <MusicIcon className="w-4 h-4 text-violet-500" />
      </div>
    );
  }
  if (provider.id === "kling") {
    // 可灵：纯视频生成，用醒目的枚红色区分
    return <VideoIcon className="w-4 h-4 text-rose-500" />;
  }
  if (provider.id === "gemini_video") {
    // Gemini Veo：视频备选方案，用蓝色区分
    return <VideoIcon className="w-4 h-4 text-sky-500" />;
  }
  // 默认：图片生成类 provider
  return <ImageIcon className="w-4 h-4 text-cyan-500" />;
}

export function SkillModelsSettingsPage() {
  const desktop = typeof window !== "undefined" ? window.oclawDesktop : undefined;
  const [config, setConfig] = useState<SkillModelsConfig | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [needsRestart, setNeedsRestart] = useState(false);

  // ── Load the redacted .env snapshot from the desktop bridge ──────────
  const reload = useCallback(async () => {
    if (!desktop) return;
    setLoading(true);
    try {
      const cfg = await desktop.getSkillModels();
      setConfig(cfg);
      const initialEdits: Record<string, string> = {};
      for (const v of cfg.vars) {
        initialEdits[v.key] = v.value;
      }
      setEdits(initialEdits);
      setNeedsRestart(false);
    } catch (e) {
      console.error("Failed to load skill models config:", e);
    } finally {
      setLoading(false);
    }
  }, [desktop]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ── Save: send the whole edits map back; secrets left as redaction ──
  // placeholders are preserved verbatim by the backend.
  const handleSave = useCallback(async () => {
    if (!desktop) return;
    setSaving(true);
    try {
      const updated = await desktop.setSkillModels(edits);
      const newEdits: Record<string, string> = {};
      for (const v of updated.vars) {
        newEdits[v.key] = v.value;
      }
      setConfig(updated);
      setEdits(newEdits);
      setNeedsRestart(true);
    } catch (e) {
      console.error("Failed to save skill models config:", e);
    } finally {
      setSaving(false);
    }
  }, [desktop, edits]);

  // ── Smart import: prefill base_url / model from configured dialog models ──
  // The /api/models endpoint does not expose raw API keys, so only the
  // non-secret fields are auto-filled. The user still enters the API key.
  const handleImportFromModels = useCallback(
    async (provider: SkillModelProvider) => {
      try {
        const resp = await loadModels();
        const models = resp.models ?? [];
        const lowerKeywords = provider.matchKeywords.map((k) => k.toLowerCase());
        const matched = models.find((m) => {
          const haystack = [m.use, m.model, m.name, m.display_name]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return lowerKeywords.some((kw) => haystack.includes(kw));
        });
        if (!matched) {
          return false;
        }
        const nextEdits = { ...edits };
        for (const field of provider.fields) {
          if (field.secret) continue;
          if (field.key.endsWith("_BASE_URL") && matched.base_url) {
            nextEdits[field.key] = matched.base_url;
          }
          if (field.key.endsWith("_MODEL") && matched.model) {
            nextEdits[field.key] = matched.model;
          }
        }
        setEdits(nextEdits);
        return true;
      } catch (e) {
        console.error("Smart import failed:", e);
        return false;
      }
    },
    [edits],
  );

  if (!isDesktop()) {
    return (
      <SettingsSection title="技能模型配置" icon={<KeyRoundIcon className="w-5 h-5 text-cyan-500" />}>
        <p className="text-sm text-muted-foreground">
          此配置仅适用于桌面端。Web 端请通过项目根目录的 <code className="rounded bg-muted px-1">.env</code> 文件配置技能模型凭证。
        </p>
      </SettingsSection>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        加载中…
      </div>
    );
  }

  if (!config) {
    return (
      <SettingsSection title="技能模型配置" icon={<KeyRoundIcon className="w-5 h-5 text-cyan-500" />}>
        <p className="text-sm text-muted-foreground">无法加载配置。</p>
      </SettingsSection>
    );
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title="技能模型配置"
        description="公共技能（图片生成 / 视频生成 / 音乐生成）通过固定环境变量名读取模型凭证。配置后需重启后端生效。"
        icon={<KeyRoundIcon className="w-5 h-5 text-cyan-500" />}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            配置文件：<code className="rounded bg-muted px-1 py-0.5">{config.filePath}</code>
          </p>

          {config.providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              vars={config.vars}
              edits={edits}
              showSecret={showSecret}
              onEdit={(key, value) =>
                setEdits((prev) => ({ ...prev, [key]: value }))
              }
              onToggleSecret={(key) =>
                setShowSecret((prev) => ({ ...prev, [key]: !prev[key] }))
              }
              onImport={() => handleImportFromModels(provider)}
            />
          ))}

          {needsRestart && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <RefreshCwIcon className="size-4 shrink-0" />
              <span>配置已保存，需重启后端才能生效（托盘 → 重启后端）。</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => void reload()} disabled={saving}>
              重置
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  保存中…
                </>
              ) : (
                "保存配置"
              )}
            </Button>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

// ── Provider card ──────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: SkillModelProvider;
  vars: SkillModelVar[];
  edits: Record<string, string>;
  showSecret: Record<string, boolean>;
  onEdit: (key: string, value: string) => void;
  onToggleSecret: (key: string) => void;
  onImport: () => Promise<boolean>;
}

function ProviderCard({
  provider,
  vars,
  edits,
  showSecret,
  onEdit,
  onToggleSecret,
  onImport,
}: ProviderCardProps) {
  const [imported, setImported] = useState<"idle" | "ok" | "none">("idle");

  const handleImportClick = async () => {
    const result = await onImport();
    setImported(result ? "ok" : "none");
    setTimeout(() => setImported("idle"), 3000);
  };

  return (
    <div className="rounded-lg border bg-muted/20">
      {/* Card header */}
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex size-6 items-center justify-center rounded-md bg-background">
            {providerIcon(provider)}
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold">{provider.title}</h4>
              {provider.fields.every((f) => {
                const varInfo = vars.find((v) => v.key === f.key);
                return varInfo?.configured;
              }) ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2Icon className="size-3.5" />
                  已配置
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">未配置</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{provider.description}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => void handleImportClick()}
        >
          <DownloadIcon className="size-3.5" />
          从对话模型导入
        </Button>
      </div>

      {/* Import feedback */}
      {imported === "ok" && (
        <div className="border-b bg-emerald-500/5 px-4 py-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          已匹配到对话模型，URL 和模型名已预填，请手动填写 API Key。
        </div>
      )}
      {imported === "none" && (
        <div className="border-b bg-muted px-4 py-1.5 text-xs text-muted-foreground">
          未找到匹配的对话模型，请手动填写。
        </div>
      )}

      {/* Fields */}
      <div className="space-y-3 px-4 py-3">
        {provider.fields.map((field) => {
          const varInfo = vars.find((v) => v.key === field.key);
          const value = edits[field.key] ?? "";
          const revealed = showSecret[field.key] ?? false;
          const isPlaceholder = isRedacted(value);
          return (
            <div key={field.key} className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor={field.key} className="text-xs font-medium">
                  {field.label}
                  <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                    {field.key}
                  </span>
                </label>
                {varInfo?.configured && field.secret && isPlaceholder && (
                  <span className="text-[10px] text-muted-foreground">
                    已保存（输入新值可替换）
                  </span>
                )}
              </div>
              <div className="relative">
                <Input
                  id={field.key}
                  type={field.secret && !revealed ? "password" : "text"}
                  value={value}
                  onChange={(e) => onEdit(field.key, e.target.value)}
                  onFocus={() => {
                    // Clear the redaction placeholder on focus so typing replaces it.
                    if (field.secret && isPlaceholder) {
                      onEdit(field.key, "");
                    }
                  }}
                  placeholder={field.placeholder ?? ""}
                  className={field.secret ? "pr-9" : ""}
                  autoComplete="off"
                />
                {field.secret && value && (
                  <button
                    type="button"
                    onClick={() => onToggleSecret(field.key)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    tabIndex={-1}
                    aria-label={revealed ? "隐藏" : "显示"}
                  >
                    {revealed ? (
                      <EyeOffIcon className="size-4" />
                    ) : (
                      <EyeIcon className="size-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
