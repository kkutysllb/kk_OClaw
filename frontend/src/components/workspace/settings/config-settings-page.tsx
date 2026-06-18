"use client";

import {
  BrainIcon,
  ChevronDown,
  ClockIcon,
  Code2Icon,
  CpuIcon,
  DatabaseIcon,
  FileUpIcon,
  HardDriveIcon,
  Loader2Icon,
  PowerIcon,
  ScrollTextIcon,
  Settings2Icon,
  TerminalIcon,
  TypeIcon,
  ZapIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isDesktopBackendManagedMode } from "@/core/config";
import { restartBackend } from "@/core/desktop";
import { restartGateway, waitForGateway } from "@/core/settings-config/api";
import { cn } from "@/lib/utils";

import { ModelConfigSection } from "./config/model-config-section";
import { CodingAgentForm } from "./config/settings-forms/coding-agent-form";
import { CronForm } from "./config/settings-forms/cron-form";
import { DatabaseForm } from "./config/settings-forms/database-form";
import { LogLevelForm } from "./config/settings-forms/log-level-form";
import { MemoryForm } from "./config/settings-forms/memory-form";
import { RunEventsForm } from "./config/settings-forms/run-events-form";
import { SandboxForm } from "./config/settings-forms/sandbox-form";
import { SummarizationForm } from "./config/settings-forms/summarization-form";
import { TitleForm } from "./config/settings-forms/title-form";
import { TokenEconomyForm } from "./config/settings-forms/token-economy-form";
import { TokenUsageForm } from "./config/settings-forms/token-usage-form";
import { UploadsForm } from "./config/settings-forms/uploads-form";
import { YamlEditorSection } from "./config/yaml-editor-section";

type ConfigSubPage =
  | "models"
  | "sandbox"
  | "coding_agent"
  | "database"
  | "run_events"
  | "cron"
  | "title"
  | "summarization"
  | "memory"
  | "uploads"
  | "log_level"
  | "token_usage"
  | "token_economy"
  | "yaml";

interface NavItem {
  id: ConfigSubPage;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export function ConfigSettingsPage() {
  const [active, setActive] = useState<ConfigSubPage>("models");
  const [restarting, setRestarting] = useState(false);

  const handleApplyAndRestart = async () => {
    if (!confirm("确定要重启后端便配置生效吗？重启期间服务将短暂不可用。"))
      return;

    setRestarting(true);

    try {
      if (isDesktopBackendManagedMode()) {
        const result = await restartBackend();
        if (result) {
          toast.success("后端已重启，配置已生效");
        } else {
          toast.error("重启失败，请查看托盘菜单手动重启");
        }
      } else {
        // Web and desktop dev: backend self-restart via API + health polling.
        toast.info("正在重启后端…");
        try {
          await restartGateway();
        } catch {
          // Connection reset is expected during shutdown
        }
        // Wait for gateway to come back online
        const ok = await waitForGateway(30_000, 1_000);
        if (ok) {
          toast.success("后端已重启，配置已生效");
        } else {
          toast.error("后端重启超时，请检查服务状态");
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重启失败");
    } finally {
      setRestarting(false);
    }
  };

  const groups: NavGroup[] = [
    {
      title: "模型配置",
      items: [{ id: "models", label: "模型管理", icon: CpuIcon }],
    },
    {
      title: "运行时",
      items: [
        { id: "sandbox", label: "沙箱", icon: TerminalIcon },
        { id: "coding_agent", label: "Coding Agent", icon: Code2Icon },
        { id: "database", label: "数据库", icon: DatabaseIcon },
        { id: "run_events", label: "运行事件", icon: HardDriveIcon },
        { id: "cron", label: "定时任务", icon: ClockIcon },
      ],
    },
    {
      title: "对话行为",
      items: [
        { id: "title", label: "标题生成", icon: TypeIcon },
        { id: "summarization", label: "上下文摘要", icon: ScrollTextIcon },
        { id: "memory", label: "记忆", icon: BrainIcon },
        { id: "token_economy", label: "Token 经济", icon: ZapIcon },
      ],
    },
    {
      title: "工具与上传",
      items: [{ id: "uploads", label: "上传限制", icon: FileUpIcon }],
    },
    {
      title: "高级",
      items: [
        { id: "log_level", label: "日志级别", icon: Code2Icon },
        { id: "token_usage", label: "Token 使用", icon: ZapIcon },
        { id: "yaml", label: "YAML 编辑器", icon: Settings2Icon },
      ],
    },
  ];

  return (
    <div className="flex min-h-[500px] min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500">
            <Settings2Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold">系统配置</h3>
            <p className="text-muted-foreground text-xs">
              管理 config.yaml 中的所有配置项，修改后点击「应用并重启」生效
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={handleApplyAndRestart}
          disabled={restarting}
          className="w-fit gap-1.5 self-start sm:self-auto"
        >
          {restarting ? (
            <>
              <Loader2Icon className="size-3.5 animate-spin" />
              重启中…
            </>
          ) : (
            <>
              <PowerIcon className="size-3.5" />
              应用并重启
            </>
          )}
        </Button>
      </div>

      <div className="flex min-w-0 gap-4">
        {/* Left: sub-navigation */}
        <nav className="w-44 shrink-0 space-y-1">
          {groups.map((group) => (
            <Collapsible key={group.title} defaultOpen>
              <CollapsibleTrigger className="text-muted-foreground/70 hover:bg-muted/50 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold tracking-wider uppercase">
                <span>{group.title}</span>
                <ChevronDown className="size-3.5 shrink-0 transition-transform [[data-state=closed]_&]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="space-y-0.5 pt-1 pb-1">
                  {group.items.map((item) => {
                    const isActive = active === item.id;
                    const Icon = item.icon;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setActive(item.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                            isActive
                              ? "bg-cyan-500/10 font-medium text-cyan-600 dark:text-cyan-400"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                          )}
                        >
                          <Icon className="size-3.5 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </nav>

        {/* Right: form content */}
        <ScrollArea className="h-[calc(75vh-10rem)] min-h-[400px] min-w-0 flex-1 rounded-lg border">
          <div className="min-w-0 p-5">
            {active === "models" && <ModelConfigSection />}
            {active === "sandbox" && <SandboxForm />}
            {active === "coding_agent" && <CodingAgentForm />}
            {active === "database" && <DatabaseForm />}
            {active === "run_events" && <RunEventsForm />}
            {active === "cron" && <CronForm />}
            {active === "title" && <TitleForm />}
            {active === "summarization" && <SummarizationForm />}
            {active === "memory" && <MemoryForm />}
            {active === "uploads" && <UploadsForm />}
            {active === "log_level" && <LogLevelForm />}
            {active === "token_usage" && <TokenUsageForm />}
            {active === "token_economy" && <TokenEconomyForm />}
            {active === "yaml" && <YamlEditorSection />}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
