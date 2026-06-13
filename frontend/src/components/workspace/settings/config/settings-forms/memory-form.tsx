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

interface MemoryConfig {
  enabled: boolean;
  storage_path: string;
  debounce_seconds: number;
  model_name: string | null;
  max_facts: number;
  fact_confidence_threshold: number;
  injection_enabled: boolean;
  max_injection_tokens: number;
}

const defaultConfig: MemoryConfig = {
  enabled: true,
  storage_path: "memory.json",
  debounce_seconds: 30,
  model_name: null,
  max_facts: 100,
  fact_confidence_threshold: 0.7,
  injection_enabled: true,
  max_injection_tokens: 2000,
};

export function MemoryForm() {
  const { data, loading, saving, save } = useConfigSection<MemoryConfig>(
    "memory",
    defaultConfig,
  );
  const [local, setLocal] = useState<MemoryConfig>(data);

  useEffect(() => {
    setLocal(data);
  }, [data]);

  const dirty = JSON.stringify(local) !== JSON.stringify(data);

  const update = <K extends keyof MemoryConfig>(
    key: K,
    value: MemoryConfig[K],
  ) => setLocal((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    try {
      await save(local);
      toast.success("记忆配置已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">记忆 (Memory)</h4>
        <p className={hintCls}>
          智能体长期记忆系统，自动提取和管理对话中的关键事实
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="space-y-3">
          {/* Enabled */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
            <div>
              <p className={labelCls}>启用记忆系统</p>
              <p className={hintCls}>关闭后智能体不会自动提取或存储记忆</p>
            </div>
            <Switch
              checked={local.enabled}
              onCheckedChange={(v) => update("enabled", v)}
              disabled={saving}
            />
          </div>

          {/* Injection */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
            <div>
              <p className={labelCls}>启用记忆注入</p>
              <p className={hintCls}>
                将相关记忆自动注入对话上下文
              </p>
            </div>
            <Switch
              checked={local.injection_enabled}
              onCheckedChange={(v) => update("injection_enabled", v)}
              disabled={saving || !local.enabled}
            />
          </div>

          {/* Numeric fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label className={labelCls}>最大事实数</label>
              <Input
                type="number"
                min={1}
                value={local.max_facts}
                onChange={(e) => update("max_facts", Number(e.target.value))}
                disabled={saving || !local.enabled}
              />
            </div>
            <div className="grid gap-1.5">
              <label className={labelCls}>置信度阈值</label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={local.fact_confidence_threshold}
                onChange={(e) =>
                  update("fact_confidence_threshold", Number(e.target.value))
                }
                disabled={saving || !local.enabled}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label className={labelCls}>写入防抖 (秒)</label>
              <Input
                type="number"
                min={1}
                value={local.debounce_seconds}
                onChange={(e) =>
                  update("debounce_seconds", Number(e.target.value))
                }
                disabled={saving || !local.enabled}
              />
            </div>
            <div className="grid gap-1.5">
              <label className={labelCls}>注入 Token 上限</label>
              <Input
                type="number"
                min={100}
                value={local.max_injection_tokens}
                onChange={(e) =>
                  update("max_injection_tokens", Number(e.target.value))
                }
                disabled={saving || !local.enabled || !local.injection_enabled}
              />
            </div>
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
