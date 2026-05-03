"use client";

import {
  Blocks,
  Brain,
  Clock,
  Code2,
  HardDrive,
  Layers,
} from "lucide-react";

import MagicBento, { type BentoCardProps } from "@/components/ui/magic-bento";
import { cn } from "@/lib/utils";

import { Section } from "../section";

// ── 每张卡片的主题色 ──────────────────────────────────────────────
const purple = "#a855f7";
const amber = "#f59e0b";
const blue = "#3b82f6";
const emerald = "#10b981";
const cyan = "#06b6d4";
const teal = "#14b8a6";

function tint(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function cardDecoration(accent: string) {
  return (
    <div className="animated-decoration">
      <div
        className="card-decoration-orb card-decoration-orb--main"
        style={{
          background: `radial-gradient(circle at 30% 30%, ${accent}88 0%, ${accent}22 40%, transparent 70%)`,
        }}
      />
      <div
        className="card-decoration-orb card-decoration-orb--secondary"
        style={{
          background: `radial-gradient(circle at 60% 60%, ${accent}66 0%, ${accent}18 50%, transparent 75%)`,
        }}
      />
      <div
        className="card-decoration-orb card-decoration-orb--tertiary"
        style={{
          background: `radial-gradient(circle at 50% 50%, ${accent}aa 0%, transparent 60%)`,
        }}
      />
      <div className="card-decoration-shimmer" />
    </div>
  );
}

const features: BentoCardProps[] = [
  {
    color: tint(purple, 0.07),
    icon: <Brain className="size-5" style={{ color: purple }} />,
    decoration: cardDecoration(purple),
    label: "上下文工程",
    title: "长短期记忆",
    description: "智能体现在能更好地理解你",
  },
  {
    color: tint(amber, 0.07),
    icon: <Clock className="size-5" style={{ color: amber }} />,
    decoration: cardDecoration(amber),
    label: "长时间任务",
    title: "规划与子任务拆分",
    description:
      "提前规划，理清复杂逻辑，然后按序或并行执行",
  },
  {
    color: tint(blue, 0.07),
    icon: <Blocks className="size-5" style={{ color: blue }} />,
    decoration: cardDecoration(blue),
    label: "可扩展",
    title: "技能与工具",
    description:
      "即插即用，或自由替换内置工具。打造你想要的智能体。",
  },

  {
    color: tint(emerald, 0.07),
    icon: <HardDrive className="size-5" style={{ color: emerald }} />,
    decoration: cardDecoration(emerald),
    label: "持久化",
    title: "带文件系统的沙箱",
    description: "读取、写入、执行——像真实电脑一样",
  },
  {
    color: tint(cyan, 0.07),
    icon: <Layers className="size-5" style={{ color: cyan }} />,
    decoration: cardDecoration(cyan),
    label: "灵活",
    title: "多模型支持",
    description: "豆包、DeepSeek、OpenAI、Gemini 等",
  },
  {
    color: tint(teal, 0.07),
    icon: <Code2 className="size-5" style={{ color: teal }} />,
    decoration: cardDecoration(teal),
    label: "免费",
    title: "开源",
    description: "MIT 协议，自主部署，完全掌控",
  },
];

export function WhatsNewSection({ className }: { className?: string }) {
  return (
    <Section
      className={cn("", className)}
      title="KKOCLAW 平台特性"
      subtitle="KKOCLAW 正从深度研究智能体进化为全栈超级智能体。"
    >
      <div className="flex w-full items-center justify-center">
        <MagicBento data={features} />
      </div>
    </Section>
  );
}
