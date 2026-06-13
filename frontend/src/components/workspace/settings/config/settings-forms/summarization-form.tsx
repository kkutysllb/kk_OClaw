"use client";

import { Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { useConfigSection } from "../use-config-section";

const labelCls = "text-sm font-medium leading-none";
const hintCls = "mt-0.5 text-xs text-muted-foreground";

interface SummarizationConfig {
  enabled: boolean;
  model_name: string | null;
  trigger: Array<{ type: string; value: number }>;
  keep: { type: string; value: number };
  trim_tokens_to_summarize: number;
  summary_prompt: string | null;
  preserve_recent_skill_count: number;
}

const defaultConfig: SummarizationConfig = {
  enabled: true,
  model_name: null,
  trigger: [{ type: "tokens", value: 15564 }],
  keep: { type: "messages", value: 10 },
  trim_tokens_to_summarize: 15564,
  summary_prompt: null,
  preserve_recent_skill_count: 5,
};

export function SummarizationForm() {
  const { data, loading, saving, save } = useConfigSection<SummarizationConfig>(
    "summarization",
    defaultConfig,
  );
  const [local, setLocal] = useState<SummarizationConfig>(data);

  useEffect(() => {
    setLocal(data);
  }, [data]);

  const dirty = JSON.stringify(local) !== JSON.stringify(data);

  const update = <K extends keyof SummarizationConfig>(
    key: K,
    value: SummarizationConfig[K],
  ) => setLocal((prev) => ({ ...prev, [key]: value }));

  const triggerValue = local.trigger?.[0]?.value ?? 15564;
  const keepValue = local.keep?.value ?? 10;

  const handleTriggerChange = (value: number) => {
    update("trigger", [{ type: "tokens", value }]);
  };
  const handleKeepChange = (value: number) => {
    update("keep", { type: local.keep?.type ?? "messages", value });
  };

  const handleSave = async () => {
    try {
      await save(local);
      toast.success("上下文摘要配置已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">上下文摘要 (Summarization)</h4>
        <p className={hintCls}>
          当对话上下文接近 token 限制时自动摘要历史消息
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
            <div>
              <p className={labelCls}>启用上下文摘要</p>
              <p className={hintCls}>
                关闭后超长对话可能因 token 溢出而报错
              </p>
            </div>
            <Switch
              checked={local.enabled}
              onCheckedChange={(v) => update("enabled", v)}
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label className={labelCls}>触发阈值 (tokens)</label>
              <Input
                type="number"
                min={1000}
                value={triggerValue}
                onChange={(e) => handleTriggerChange(Number(e.target.value))}
                disabled={saving || !local.enabled}
              />
              <p className={hintCls}>上下文超过此 token 数时触发摘要</p>
            </div>
            <div className="grid gap-1.5">
              <label className={labelCls}>保留条数 (messages)</label>
              <Input
                type="number"
                min={1}
                value={keepValue}
                onChange={(e) => handleKeepChange(Number(e.target.value))}
                disabled={saving || !local.enabled}
              />
              <p className={hintCls}>摘要后保留的最近消息数量</p>
            </div>
          </div>

          <div className="grid gap-1.5">
            <label className={labelCls}>保留最近技能数量</label>
            <Input
              type="number"
              min={0}
              value={local.preserve_recent_skill_count}
              onChange={(e) =>
                update("preserve_recent_skill_count", Number(e.target.value))
              }
              disabled={saving || !local.enabled}
            />
            <p className={hintCls}>
              摘要时保留最近使用的技能文件上下文数量
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              disabled={!dirty || saving}
              onClick={handleSave}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
            {dirty && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLocal(data)}
                disabled={saving}
              >
                重置
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
