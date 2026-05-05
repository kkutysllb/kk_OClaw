"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";

import {
  BotIcon,
  BrainIcon,
  CpuIcon,
  GlobeIcon,
  MessageSquareIcon,
  SparklesIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { AuroraText } from "../ui/aurora-text";

let waved = false;

// 装饰图标数据
const DECORATIVE_ICONS = [
  { icon: BotIcon, color: "text-violet-400" },
  { icon: CpuIcon, color: "text-emerald-400" },
  { icon: BrainIcon, color: "text-cyan-400" },
  { icon: GlobeIcon, color: "text-blue-400" },
  { icon: TerminalIcon, color: "text-amber-400" },
  { icon: MessageSquareIcon, color: "text-rose-400" },
  { icon: WrenchIcon, color: "text-orange-400" },
];

// 底部特性标签
const FEATURE_BADGES = [
  { label: "LangGraph", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { label: "沙箱执行", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  { label: "长期记忆", color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  { label: "子智能体", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { label: "多模型", color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
];

export function Welcome({
  className,
  mode,
}: {
  className?: string;
  mode?: "ultra" | "pro" | "thinking" | "flash";
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const isUltra = useMemo(() => mode === "ultra", [mode]);
  const colors = useMemo(() => {
    if (isUltra) {
      return ["#efefbb", "#e9c665", "#e3a812"];
    }
    return ["#22d3ee", "#a855f7", "#ec4899"];
  }, [isUltra]);
  useEffect(() => {
    waved = true;
  }, []);
  return (
    <div
      className={cn(
        "relative mx-auto flex w-full flex-col items-center justify-center gap-3 px-8 py-6 text-center",
        className,
      )}
    >
      {/* Decorative icon row */}
      <div className="relative flex items-center gap-1.5 opacity-50">
        {DECORATIVE_ICONS.map(({ icon: Icon, color }, i) => (
          <Icon
            key={i}
            className={cn("size-3.5 transition-all duration-500", color)}
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>

      {/* Main title */}
      <div className="relative">
        <div className="relative text-xl font-bold">
        {searchParams.get("mode") === "skill" ? (
          <span className="bg-linear-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-transparent">
            ✨ {t.welcome.createYourOwnSkill} ✨
          </span>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className={cn("inline-block text-3xl", !waved ? "animate-bounce" : "")}>
              {isUltra ? "🚀" : "👋"}
            </div>
            <AuroraText colors={isUltra ? ["#efefbb", "#e9c665", "#e3a812"] : ["#a78bfa", "#6366f1", "#3b82f6"]}>
              {t.welcome.greeting}
            </AuroraText>
          </div>
        )}
      </div>
      </div>

      {searchParams.get("mode") === "skill" ? (
        <div className="relative text-muted-foreground text-sm leading-relaxed max-w-lg">
          {t.welcome.createYourOwnSkillDescription.includes("\n") ? (
            <pre className="font-sans whitespace-pre">
              {t.welcome.createYourOwnSkillDescription}
            </pre>
          ) : (
            <p>{t.welcome.createYourOwnSkillDescription}</p>
          )}
        </div>
      ) : (
        <div className="relative text-muted-foreground text-sm leading-relaxed max-w-lg">
          {t.welcome.description.includes("\n") ? (
            <pre className="font-sans whitespace-pre">
              {t.welcome.description}
            </pre>
          ) : (
            <p>{t.welcome.description}</p>
          )}
        </div>
      )}

      {/* Feature badges */}
      {searchParams.get("mode") !== "skill" && (
        <div className="relative flex flex-wrap items-center justify-center gap-2 pt-1">
          {FEATURE_BADGES.map(({ label, color }) => (
            <span
              key={label}
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium",
                color,
              )}
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
