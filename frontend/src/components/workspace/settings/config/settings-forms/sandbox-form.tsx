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
import { Switch } from "@/components/ui/switch";

import { useConfigSection } from "../use-config-section";

const labelCls = "text-sm font-medium leading-none";
const hintCls = "mt-0.5 text-xs text-muted-foreground";

interface SandboxConfig {
  use: string;
  allow_host_bash: boolean;
  bash_output_max_chars: number;
  read_file_output_max_chars: number;
  ls_output_max_chars: number;
}

const defaultConfig: SandboxConfig = {
  use: "kkoclaw.sandbox.local:LocalSandboxProvider",
  allow_host_bash: true,
  bash_output_max_chars: 20000,
  read_file_output_max_chars: 50000,
  ls_output_max_chars: 20000,
};

export function SandboxForm() {
  const { data, loading, saving, save } = useConfigSection<SandboxConfig>(
    "sandbox",
    defaultConfig,
  );
  const [local, setLocal] = useState<SandboxConfig>(data);
  const [providerKey, setProviderKey] = useState("local");

  useEffect(() => {
    setLocal(data);
    setProviderKey(data.use?.includes("Local") ? "local" : "docker");
  }, [data]);

  const dirty = JSON.stringify(local) !== JSON.stringify(data);

  const update = <K extends keyof SandboxConfig>(
    key: K,
    value: SandboxConfig[K],
  ) => setLocal((prev) => ({ ...prev, [key]: value }));

  const handleProviderChange = (key: string) => {
    setProviderKey(key);
    if (key === "local") {
      update("use", "kkoclaw.sandbox.local:LocalSandboxProvider");
    } else {
      update("use", "kkoclaw.sandbox.docker:DockerSandboxProvider");
    }
  };

  const handleSave = async () => {
    try {
      await save(local);
      toast.success("沙箱配置已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">沙箱 (Sandbox)</h4>
        <p className={hintCls}>控制代码执行与文件操作的沙箱环境</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="space-y-3">
          {/* Provider */}
          <div className="grid gap-2">
            <label className={labelCls}>沙箱提供者</label>
            <Select value={providerKey} onValueChange={handleProviderChange}>
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">
                  本地执行 (LocalSandboxProvider)
                </SelectItem>
                <SelectItem value="docker">
                  Docker (DockerSandboxProvider)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className={hintCls}>
              桌面端推荐使用本地执行；Docker 模式需要已安装并运行 Docker
            </p>
          </div>

          {/* Allow host bash */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
            <div>
              <p className={labelCls}>允许主机 Bash 执行</p>
              <p className={hintCls}>
                开启后智能体可直接在主机上执行 bash 命令
              </p>
            </div>
            <Switch
              checked={local.allow_host_bash}
              onCheckedChange={(v) => update("allow_host_bash", v)}
              disabled={saving}
            />
          </div>

          {/* Output truncation limits */}
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <label className={labelCls}>Bash 输出截断</label>
              <Input
                type="number"
                value={local.bash_output_max_chars}
                onChange={(e) =>
                  update(
                    "bash_output_max_chars",
                    Number(e.target.value),
                  )
                }
                disabled={saving}
              />
            </div>
            <div className="grid gap-1.5">
              <label className={labelCls}>读文件截断</label>
              <Input
                type="number"
                value={local.read_file_output_max_chars}
                onChange={(e) =>
                  update(
                    "read_file_output_max_chars",
                    Number(e.target.value),
                  )
                }
                disabled={saving}
              />
            </div>
            <div className="grid gap-1.5">
              <label className={labelCls}>ls 输出截断</label>
              <Input
                type="number"
                value={local.ls_output_max_chars}
                onChange={(e) =>
                  update("ls_output_max_chars", Number(e.target.value))
                }
                disabled={saving}
              />
            </div>
          </div>
          <p className={hintCls}>以上数值单位为字符数，超过将被截断</p>

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
