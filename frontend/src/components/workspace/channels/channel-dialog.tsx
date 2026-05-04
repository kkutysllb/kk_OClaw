"use client";

import { useEffect, useState } from "react";
import {
  HelpCircleIcon,
  KeyIcon,
  MessageCircleIcon,
  Settings2Icon,
  ToggleLeftIcon,
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
import { useI18n } from "@/core/i18n/hooks";
import type { ChannelConfigItem } from "@/core/channels/api";

import { ChannelHelp } from "./channel-help";

const CHANNEL_ICON_COLORS: Record<string, string> = {
  dingtalk: "bg-sky-500/10 text-sky-500",
  discord: "bg-indigo-500/10 text-indigo-500",
  feishu: "bg-blue-500/10 text-blue-500",
  slack: "bg-purple-500/10 text-purple-500",
  telegram: "bg-cyan-500/10 text-cyan-500",
  wechat: "bg-emerald-500/10 text-emerald-500",
  wecom: "bg-teal-500/10 text-teal-500",
};

const GRADIENT_COLORS: Record<string, string> = {
  dingtalk: "from-sky-400 to-blue-400",
  discord: "from-indigo-400 to-violet-400",
  feishu: "from-blue-400 to-cyan-400",
  slack: "from-purple-400 to-fuchsia-400",
  telegram: "from-cyan-400 to-sky-400",
  wechat: "from-emerald-400 to-green-400",
  wecom: "from-teal-400 to-emerald-400",
};

interface ChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string | null;
  config: ChannelConfigItem | null;
  onSave: (name: string, enabled: boolean, creds: Record<string, string>) => Promise<void>;
}

const labelCls = "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70";
const hintCls = "text-muted-foreground text-xs";
const sectionTitleCls = "text-xs font-semibold uppercase tracking-wider text-muted-foreground/70";

/**
 * Return a human-friendly placeholder for a credential key.
 */
function placeholderForKey(key: string): string {
  const map: Record<string, string> = {
    client_id: "输入 Client ID",
    client_secret: "输入 Client Secret",
    app_id: "输入 App ID",
    app_secret: "输入 App Secret",
    bot_token: "输入 Bot Token",
    app_token: "输入 App Token",
    bot_id: "输入 Bot ID",
    bot_secret: "输入 Bot Secret",
  };
  return map[key] ?? `输入 ${key}`;
}

/**
 * Return a human-friendly label for a credential key.
 */
function labelForKey(key: string): string {
  const map: Record<string, string> = {
    client_id: "Client ID",
    client_secret: "Client Secret",
    app_id: "App ID",
    app_secret: "App Secret",
    bot_token: "Bot Token",
    app_token: "App Token",
    bot_id: "Bot ID",
    bot_secret: "Bot Secret",
  };
  return map[key] ?? key;
}

export function ChannelDialog({
  open,
  onOpenChange,
  name,
  config,
  onSave,
}: ChannelDialogProps) {
  const { t } = useI18n();

  const [enabled, setEnabled] = useState(false);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const iconColor =
    CHANNEL_ICON_COLORS[name ?? ""] ?? "bg-violet-500/10 text-violet-500";
  const gradient =
    GRADIENT_COLORS[name ?? ""] ?? "from-violet-400 to-purple-400";

  useEffect(() => {
    if (open && config) {
      setEnabled(config.enabled);
      // Initialize with empty values — we don't expose actual credentials
      const empty: Record<string, string> = {};
      for (const k of config.credential_keys) {
        empty[k] = "";
      }
      setCreds(empty);
      setShowHelp(false);
    }
  }, [open, config]);

  const handleSave = async () => {
    if (!name) return;
    setSaving(true);
    try {
      // Filter out empty credential values
      const filteredCreds: Record<string, string> = {};
      for (const [k, v] of Object.entries(creds)) {
        if (v.trim()) {
          filteredCreds[k] = v.trim();
        }
      }
      await onSave(name, enabled, filteredCreds);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const displayName = config?.display_name_zh || config?.display_name || name || "";

  if (showHelp && name) {
    return (
      <ChannelHelp
        name={name}
        displayName={displayName}
        credentialKeys={config?.credential_keys ?? []}
        onBack={() => setShowHelp(false)}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-lg">
        {/* Accent bar */}
        <div className={`h-1.5 w-full rounded-t-lg bg-gradient-to-r ${gradient}`} />

        <DialogHeader className="px-6 pt-5">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconColor}`}>
              <MessageCircleIcon className="h-4 w-4" />
            </span>
            {t.channels.editConfig}
          </DialogTitle>
          <DialogDescription className="pl-10">
            {displayName} ({name})
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-5">
          {/* ── 启用状态 ── */}
          <div className="space-y-3">
            <p className={sectionTitleCls}>
              <ToggleLeftIcon className="mr-1.5 inline h-3.5 w-3.5" />
              {t.channels.status}
            </p>
            <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-4">
              <div>
                <p className="text-sm font-medium">{t.channels.enabled}</p>
                <p className={hintCls}>
                  {enabled ? "渠道已启用，将在服务启动时自动加载" : "渠道已禁用"}
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>

          <Separator />

          {/* ── 凭证配置 ── */}
          <div className="space-y-3">
            <p className={sectionTitleCls}>
              <KeyIcon className="mr-1.5 inline h-3.5 w-3.5" />
              {t.channels.credentials}
            </p>
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              {config?.credential_keys.map((key) => (
                <div key={key} className="grid gap-2">
                  <label htmlFor={`cred-${key}`} className={labelCls}>
                    {labelForKey(key)}
                  </label>
                  <Input
                    id={`cred-${key}`}
                    type="password"
                    value={creds[key] ?? ""}
                    onChange={(e) =>
                      setCreds((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder={placeholderForKey(key)}
                    autoComplete="off"
                  />
                  <p className={hintCls}>
                    {config.configured
                      ? "已保存凭证（出于安全考虑不显示原始值）"
                      : `需要提供 ${labelForKey(key)}`}
                  </p>
                </div>
              ))}
              {(!config?.credential_keys || config.credential_keys.length === 0) && (
                <p className="text-muted-foreground text-sm text-center py-2">
                  该渠道无需额外凭证配置
                </p>
              )}
            </div>
          </div>

          {/* ── 帮助按钮 ── */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setShowHelp(true)}
          >
            <HelpCircleIcon className="mr-1.5 h-4 w-4" />
            {t.channels.help}
          </Button>
        </div>

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
            className={`bg-gradient-to-r ${gradient} text-white hover:opacity-90 shadow-sm`}
          >
            {saving ? t.common.loading : t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
