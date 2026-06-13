"use client";

import { Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useConfigSection } from "../use-config-section";

const labelCls = "text-sm font-medium leading-none";
const hintCls = "mt-0.5 text-xs text-muted-foreground";

interface DatabaseConfig {
  backend: string;
  sqlite_dir: string;
}

const defaultConfig: DatabaseConfig = {
  backend: "sqlite",
  sqlite_dir: ".kkoclaw/data",
};

export function DatabaseForm() {
  const { data, loading, saving, save } = useConfigSection<DatabaseConfig>(
    "database",
    defaultConfig,
  );
  const [local, setLocal] = useState<DatabaseConfig>(data);

  useEffect(() => {
    setLocal(data);
  }, [data]);

  const dirty = JSON.stringify(local) !== JSON.stringify(data);

  const update = <K extends keyof DatabaseConfig>(
    key: K,
    value: DatabaseConfig[K],
  ) => setLocal((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    try {
      await save(local);
      toast.success("数据库配置已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">数据库 (Database)</h4>
        <p className={hintCls}>对话历史和运行事件的数据存储后端</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2">
            <label className={labelCls}>数据库后端</label>
            <Select
              value={local.backend}
              onValueChange={(v) => update("backend", v)}
            >
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sqlite">SQLite</SelectItem>
                <SelectItem value="postgres">PostgreSQL</SelectItem>
              </SelectContent>
            </Select>
            <p className={hintCls}>
              桌面端推荐使用 SQLite（无需额外服务）
            </p>
          </div>

          {local.backend === "sqlite" && (
            <div className="grid gap-2">
              <label className={labelCls}>SQLite 数据目录</label>
              <Input
                value={local.sqlite_dir}
                onChange={(e) => update("sqlite_dir", e.target.value)}
                disabled={saving}
                className="w-72 font-mono text-sm"
              />
              <p className={hintCls}>相对于工作目录的 SQLite 文件存储路径</p>
            </div>
          )}

          {local.backend === "postgres" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠️ PostgreSQL 需要额外配置连接参数（host、port、database、user、password）。请使用 YAML 编辑器手动配置。
              </p>
            </div>
          )}

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
