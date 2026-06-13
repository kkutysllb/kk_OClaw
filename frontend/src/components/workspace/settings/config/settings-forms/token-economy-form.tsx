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

interface TokenEconomyConfig {
  enabled: boolean;
  concise_responses: boolean;
  compress_history_tool_results: boolean;
  max_history_tool_result_chars: number;
  recent_tool_result_count: number;
  storm_breaker_enabled: boolean;
  storm_breaker_threshold: number;
  storm_breaker_window: number;
}

const defaultConfig: TokenEconomyConfig = {
  enabled: false,
  concise_responses: true,
  compress_history_tool_results: true,
  max_history_tool_result_chars: 2000,
  recent_tool_result_count: 4,
  storm_breaker_enabled: true,
  storm_breaker_threshold: 2,
  storm_breaker_window: 8,
};

export function TokenEconomyForm() {
  const { data, loading, saving, save } =
    useConfigSection<TokenEconomyConfig>("token_economy", defaultConfig);
  const [local, setLocal] = useState<TokenEconomyConfig>(data);

  useEffect(() => {
    setLocal(data);
  }, [data]);

  const dirty = JSON.stringify(local) !== JSON.stringify(data);

  const update = <K extends keyof TokenEconomyConfig>(
    key: K,
    value: TokenEconomyConfig[K],
  ) => setLocal((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    try {
      await save(local);
      toast.success("Token Economy 设置已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">Token Economy（Token 经济系统）</h4>
        <p className={hintCls}>
          多层 token 优化策略，降低 token 消耗。参考 Kun 项目 5 层 Token
          经济机制设计，默认禁用。
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="space-y-4">
          {/* 主开关 */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
            <div>
              <p className={labelCls}>启用 Token Economy</p>
              <p className={hintCls}>
                总开关。关闭后所有 token 优化策略均不生效
              </p>
            </div>
            <Switch
              checked={local.enabled}
              onCheckedChange={(v) => update("enabled", v)}
              disabled={saving}
            />
          </div>

          {/* 简洁响应 */}
          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className={labelCls}>简洁响应指令</p>
                <p className={hintCls}>
                  注入 system-reminder，指示模型直接回答、跳过寒暄填充
                </p>
              </div>
              <Switch
                checked={local.concise_responses}
                onCheckedChange={(v) => update("concise_responses", v)}
                disabled={saving || !local.enabled}
              />
            </div>
          </div>

          {/* 历史工具结果压缩 */}
          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className={labelCls}>压缩历史工具结果</p>
                <p className={hintCls}>
                  截断旧 ToolMessage 内容（head+tail 策略，保护代码块 / URL /
                  文件路径 / 错误信号）
                </p>
              </div>
              <Switch
                checked={local.compress_history_tool_results}
                onCheckedChange={(v) =>
                  update("compress_history_tool_results", v)
                }
                disabled={saving || !local.enabled}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className={labelCls}>
                  历史结果保留字符数
                </label>
                <Input
                  type="number"
                  min={0}
                  step={500}
                  value={local.max_history_tool_result_chars}
                  onChange={(e) =>
                    update(
                      "max_history_tool_result_chars",
                      Number(e.target.value),
                    )
                  }
                  disabled={
                    saving ||
                    !local.enabled ||
                    !local.compress_history_tool_results
                  }
                />
                <p className={hintCls}>
                  每条旧 ToolMessage 保留的最大字符数（head+tail 合计）
                </p>
              </div>
              <div className="grid gap-1.5">
                <label className={labelCls}>最近 N 条免压缩</label>
                <Input
                  type="number"
                  min={0}
                  value={local.recent_tool_result_count}
                  onChange={(e) =>
                    update(
                      "recent_tool_result_count",
                      Number(e.target.value),
                    )
                  }
                  disabled={
                    saving ||
                    !local.enabled ||
                    !local.compress_history_tool_results
                  }
                />
                <p className={hintCls}>
                  最近的 N 条 ToolMessage 保持原样不压缩
                </p>
              </div>
            </div>
          </div>

          {/* Storm Breaker */}
          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className={labelCls}>Storm Breaker（同回合重复抑制）</p>
                <p className={hintCls}>
                  滑动窗口跟踪同回合工具调用，相同 name + args 达到阈值后自动拦截
                </p>
              </div>
              <Switch
                checked={local.storm_breaker_enabled}
                onCheckedChange={(v) => update("storm_breaker_enabled", v)}
                disabled={saving || !local.enabled}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className={labelCls}>抑制阈值</label>
                <Input
                  type="number"
                  min={1}
                  value={local.storm_breaker_threshold}
                  onChange={(e) =>
                    update(
                      "storm_breaker_threshold",
                      Number(e.target.value),
                    )
                  }
                  disabled={
                    saving ||
                    !local.enabled ||
                    !local.storm_breaker_enabled
                  }
                />
                <p className={hintCls}>
                  相同调用出现 N 次后第 N+1 次被拦截（最小 2）
                </p>
              </div>
              <div className="grid gap-1.5">
                <label className={labelCls}>滑动窗口大小</label>
                <Input
                  type="number"
                  min={1}
                  value={local.storm_breaker_window}
                  onChange={(e) =>
                    update("storm_breaker_window", Number(e.target.value))
                  }
                  disabled={
                    saving ||
                    !local.enabled ||
                    !local.storm_breaker_enabled
                  }
                />
                <p className={hintCls}>
                  跟踪最近 N 次工具调用（超出窗口的旧记录自动清除）
                </p>
              </div>
            </div>
          </div>

          {/* 保存按钮 */}
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

          {/* 信息提示 */}
          <p className="text-xs text-muted-foreground">
            提示：修改后请点击右上角「应用并重启」使配置生效
          </p>
        </div>
      )}
    </div>
  );
}
