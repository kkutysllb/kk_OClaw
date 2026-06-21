"use client";

import { Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";

import { useConfigSection } from "../use-config-section";

const labelCls = "text-sm font-medium leading-none";
const hintCls = "mt-0.5 text-xs text-muted-foreground";
const MODEL_INHERIT = "__inherit__";

interface CodingAgentConfig {
  enabled: boolean;
  model: string | null;
  sandbox: "local" | "docker";
  default_permission_mode: "safe-only" | "safe" | "yolo";
  post_edit_verify_enabled: boolean;
  post_edit_verify_mode: "soft" | "hard";
  auto_accept_forward_stage: boolean;
  worktree: {
    enabled: boolean;
    auto_create: boolean;
    base_branch: string;
  };
  git: {
    auto_commit: boolean;
    conventional_commits: boolean;
  };
  test: {
    auto_run: boolean;
    frameworks: string[];
  };
}

interface ModelConfig {
  name?: string;
  display_name?: string;
}

const defaultConfig: CodingAgentConfig = {
  enabled: true,
  model: null,
  sandbox: "local",
  default_permission_mode: "safe-only",
  post_edit_verify_enabled: true,
  post_edit_verify_mode: "soft",
  auto_accept_forward_stage: false,
  worktree: {
    enabled: true,
    auto_create: false,
    base_branch: "main",
  },
  git: {
    auto_commit: false,
    conventional_commits: true,
  },
  test: {
    auto_run: false,
    frameworks: ["pytest", "jest", "vitest", "go test"],
  },
};

export function CodingAgentForm() {
  const { data, loading, saving, save } =
    useConfigSection<CodingAgentConfig>("coding_agent", defaultConfig);
  const { data: models } = useConfigSection<ModelConfig[]>("models", []);
  const [local, setLocal] = useState<CodingAgentConfig>(data);

  useEffect(() => {
    setLocal(normalizeConfig(data));
  }, [data]);

  const frameworkText = useMemo(
    () => local.test.frameworks.join("\n"),
    [local.test.frameworks],
  );
  const dirty = JSON.stringify(local) !== JSON.stringify(normalizeConfig(data));

  const update = <K extends keyof CodingAgentConfig>(
    key: K,
    value: CodingAgentConfig[K],
  ) => setLocal((prev) => ({ ...prev, [key]: value }));

  const updateWorktree = <K extends keyof CodingAgentConfig["worktree"]>(
    key: K,
    value: CodingAgentConfig["worktree"][K],
  ) => setLocal((prev) => ({ ...prev, worktree: { ...prev.worktree, [key]: value } }));

  const updateGit = <K extends keyof CodingAgentConfig["git"]>(
    key: K,
    value: CodingAgentConfig["git"][K],
  ) => setLocal((prev) => ({ ...prev, git: { ...prev.git, [key]: value } }));

  const updateTest = <K extends keyof CodingAgentConfig["test"]>(
    key: K,
    value: CodingAgentConfig["test"][K],
  ) => setLocal((prev) => ({ ...prev, test: { ...prev.test, [key]: value } }));

  const handleSave = async () => {
    try {
      await save(normalizeConfig(local));
      toast.success("Coding Agent 配置已更新");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold">Coding Agent</h4>
        <p className={hintCls}>
          配置独立代码工程 Agent 的模型、权限、worktree、提交和测试策略
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
            <div>
              <p className={labelCls}>启用 Coding Agent</p>
              <p className={hintCls}>关闭后隐藏独立 coding_agent graph 的运行入口</p>
            </div>
            <Switch
              checked={local.enabled}
              onCheckedChange={(v) => update("enabled", v)}
              disabled={saving}
            />
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="grid gap-1.5">
              <label className={labelCls}>模型覆盖</label>
              <Select
                value={local.model ?? MODEL_INHERIT}
                onValueChange={(value) =>
                  update("model", value === MODEL_INHERIT ? null : value)
                }
                disabled={saving}
              >
                <SelectTrigger className="w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MODEL_INHERIT}>继承全局默认模型</SelectItem>
                  {models
                    .filter((model) => model.name)
                    .map((model) => (
                      <SelectItem key={model.name} value={model.name!}>
                        {model.display_name || model.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className={labelCls}>沙箱模式</label>
                <Select
                  value={local.sandbox}
                  onValueChange={(value) =>
                    update("sandbox", value as CodingAgentConfig["sandbox"])
                  }
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">local</SelectItem>
                    <SelectItem value="docker">docker</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <label className={labelCls}>默认权限模式</label>
                <Select
                  value={local.default_permission_mode}
                  onValueChange={(value) =>
                    update(
                      "default_permission_mode",
                      value as CodingAgentConfig["default_permission_mode"],
                    )
                  }
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="safe-only">safe-only</SelectItem>
                    <SelectItem value="safe">safe</SelectItem>
                    <SelectItem value="yolo">yolo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className={labelCls}>编辑后验证</p>
                <p className={hintCls}>
                  apply_diff / multi_edit / insert_at_line 成功后注入验证提醒，要求先调用 run_linter / run_tests
                </p>
              </div>
              <Switch
                checked={local.post_edit_verify_enabled}
                onCheckedChange={(v) => update("post_edit_verify_enabled", v)}
                disabled={saving}
              />
            </div>
            <div className="grid gap-1.5">
              <label className={labelCls}>验证模式</label>
              <Select
                value={local.post_edit_verify_mode}
                onValueChange={(value) =>
                  update(
                    "post_edit_verify_mode",
                    value as CodingAgentConfig["post_edit_verify_mode"],
                  )
                }
                disabled={saving || !local.post_edit_verify_enabled}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="soft">soft（仅提醒）</SelectItem>
                  <SelectItem value="hard">hard（验证未通过前阻止报告完成）</SelectItem>
                </SelectContent>
              </Select>
              <p className={hintCls}>
                soft：仅注入提醒；hard：模型在验证通过前不允许报告任务完成
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className={labelCls}>顺向阶段自动接受</p>
                <p className={hintCls}>
                  Agent 建议进入下一阶段时自动接受，不弹确认横幅。回退、跳级、进入 delivery 仍需人工确认。
                </p>
              </div>
              <Switch
                checked={local.auto_accept_forward_stage}
                onCheckedChange={(v) => update("auto_accept_forward_stage", v)}
                disabled={saving}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className={labelCls}>Git Worktree 隔离</p>
                <p className={hintCls}>为任务创建独立 worktree，减少对原项目目录的影响</p>
              </div>
              <Switch
                checked={local.worktree.enabled}
                onCheckedChange={(v) => updateWorktree("enabled", v)}
                disabled={saving}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className={labelCls}>基准分支</label>
                <Input
                  value={local.worktree.base_branch}
                  onChange={(e) => updateWorktree("base_branch", e.target.value)}
                  disabled={saving || !local.worktree.enabled}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border bg-muted/20 p-3">
                <div>
                  <p className={labelCls}>自动创建 Worktree</p>
                  <p className={hintCls}>任务启动时自动创建隔离分支目录</p>
                </div>
                <Switch
                  checked={local.worktree.auto_create}
                  onCheckedChange={(v) => updateWorktree("auto_create", v)}
                  disabled={saving || !local.worktree.enabled}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className={labelCls}>自动 Commit</p>
                <p className={hintCls}>Agent 完成变更后自动生成提交</p>
              </div>
              <Switch
                checked={local.git.auto_commit}
                onCheckedChange={(v) => updateGit("auto_commit", v)}
                disabled={saving}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className={labelCls}>Conventional Commits</p>
                <p className={hintCls}>约束自动提交信息格式</p>
              </div>
              <Switch
                checked={local.git.conventional_commits}
                onCheckedChange={(v) => updateGit("conventional_commits", v)}
                disabled={saving || !local.git.auto_commit}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className={labelCls}>自动运行测试</p>
                <p className={hintCls}>根据项目类型自动尝试运行测试命令</p>
              </div>
              <Switch
                checked={local.test.auto_run}
                onCheckedChange={(v) => updateTest("auto_run", v)}
                disabled={saving}
              />
            </div>
            <div className="grid gap-1.5">
              <label className={labelCls}>测试框架/命令</label>
              <Textarea
                value={frameworkText}
                onChange={(e) =>
                  updateTest(
                    "frameworks",
                    e.target.value
                      .split("\n")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  )
                }
                disabled={saving}
                className="min-h-24 font-mono text-xs"
              />
              <p className={hintCls}>每行一个，例如 pytest、vitest、go test</p>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
              {saving ? "保存中…" : "保存"}
            </Button>
            {dirty && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLocal(normalizeConfig(data))}
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

function normalizeConfig(config: CodingAgentConfig): CodingAgentConfig {
  return {
    ...defaultConfig,
    ...config,
    worktree: { ...defaultConfig.worktree, ...(config.worktree ?? {}) },
    git: { ...defaultConfig.git, ...(config.git ?? {}) },
    test: {
      ...defaultConfig.test,
      ...(config.test ?? {}),
      frameworks:
        Array.isArray(config.test?.frameworks) && config.test.frameworks.length > 0
          ? config.test.frameworks
          : defaultConfig.test.frameworks,
    },
  };
}
