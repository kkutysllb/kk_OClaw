"use client";

import { Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import { useConfigSection } from "../use-config-section";

const labelCls = "text-sm font-medium leading-none";

interface TokenUsageConfig {
  enabled: boolean;
}

export function TokenUsageForm() {
  const { data, loading, saving, save } = useConfigSection<TokenUsageConfig>(
    "token_usage",
    { enabled: false },
  );
  const [enabled, setEnabled] = useState(data.enabled);

  useEffect(() => {
    setEnabled(data.enabled);
  }, [data.enabled]);

  const dirty = enabled !== data.enabled;

  const handleSave = async () => {
    try {
      await save({ enabled });
      toast.success("Token 使用设置已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">Token 使用统计</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          记录每次模型调用的 token 消耗并在界面中展示
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
              <p className={labelCls}>启用 Token 使用统计</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                启用后将在对话中显示输入/输出 token 数量
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={saving}
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
                onClick={() => setEnabled(data.enabled)}
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
