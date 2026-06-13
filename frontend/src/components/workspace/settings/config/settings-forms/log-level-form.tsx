"use client";

import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useConfigSection } from "../use-config-section";

const labelCls = "text-sm font-medium leading-none";

export function LogLevelForm() {
  const { data, loading, saving, save } = useConfigSection<string>(
    "log_level",
    "info",
  );
  const [value, setValue] = useState(data);

  // Sync external data into local state when loaded
  if (loading && value !== data) {
    setValue(data);
  }

  const dirty = value !== data;

  const handleSave = async () => {
    try {
      await save(value);
      toast.success("日志级别已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">日志级别</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">
          控制 KKOCLAW 模块的日志输出详细程度
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2">
            <label className={labelCls}>日志级别</label>
            <Select
              value={String(value)}
              onValueChange={(v) => setValue(v)}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="debug">debug</SelectItem>
                <SelectItem value="info">info</SelectItem>
                <SelectItem value="warning">warning</SelectItem>
                <SelectItem value="error">error</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              debug 输出最详细，error 仅输出错误信息
            </p>
          </div>

          <div className="flex gap-2 pt-2">
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
                onClick={() => setValue(data)}
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
