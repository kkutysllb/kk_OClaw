"use client";

import { Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { useConfigSection } from "../use-config-section";

const labelCls = "text-sm font-medium leading-none";
const hintCls = "mt-0.5 text-xs text-muted-foreground";

interface RunEventsConfig {
  backend: string;
  max_trace_content: number;
  track_token_usage: boolean;
}

const defaultConfig: RunEventsConfig = {
  backend: "db",
  max_trace_content: 10240,
  track_token_usage: true,
};

export function RunEventsForm() {
  const { data, loading, saving, save } = useConfigSection<RunEventsConfig>(
    "run_events",
    defaultConfig,
  );
  const [local, setLocal] = useState<RunEventsConfig>(data);

  useEffect(() => {
    setLocal(data);
  }, [data]);

  const dirty = JSON.stringify(local) !== JSON.stringify(data);

  const update = <K extends keyof RunEventsConfig>(
    key: K,
    value: RunEventsConfig[K],
  ) => setLocal((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    try {
      await save(local);
      toast.success("运行事件配置已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">运行事件 (Run Events)</h4>
        <p className={hintCls}>对话历史和运行 trace 的持久化配置</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2">
            <label className={labelCls}>存储后端</label>
            <Select
              value={local.backend}
              onValueChange={(v) => update("backend", v)}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="db">数据库 (db)</SelectItem>
                <SelectItem value="none">不存储 (none)</SelectItem>
              </SelectContent>
            </Select>
            <p className={hintCls}>
              存储后端关闭后将无法查看历史对话
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
            <div>
              <p className={labelCls}>记录 Token 用量</p>
              <p className={hintCls}>
                在运行 trace 中记录每次模型调用的 token 消耗
              </p>
            </div>
            <Switch
              checked={local.track_token_usage}
              onCheckedChange={(v) => update("track_token_usage", v)}
              disabled={saving || local.backend === "none"}
            />
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
