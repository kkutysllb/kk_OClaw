"use client";

import {
  BookOpenIcon,
  ChartBarIcon,
  Code2Icon,
  FileSearchIcon,
  FlaskConicalIcon,
  GlobeIcon,
  ImageIcon,
  LightbulbIcon,
  MegaphoneIcon,
  MicIcon,
  MonitorIcon,
  NewspaperIcon,
  PaletteIcon,
  PencilRulerIcon,
  PresentationIcon,
  PuzzleIcon,
  RocketIcon,
  SearchIcon,
  SparklesIcon,
  VideoIcon,
  WandIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";
import { useEnableSkill, useSkills } from "@/core/skills/hooks";
import type { Skill } from "@/core/skills/type";
import { env } from "@/env";
import { cn } from "@/lib/utils";

// ── Chinese descriptions for all skills ──────────────────────────────────────
const CHINESE_DESCRIPTIONS: Record<string, string> = {
  "academic-paper-review":
    "对学术论文、研究文章、预印本或科学出版物进行全面的结构化评审。涵盖方法论评估、贡献评价、文献定位与建设性反馈，支持 NeurIPS/ICML/ACL 等顶会标准。",
  bootstrap:
    "通过温暖、自适应的引导式对话生成个性化 SOUL.md 身份文档。让 AI 了解你的角色、偏好和愿景，打造专属于你的智能体灵魂。",
  "chart-visualization":
    "将数据智能转化为可视化图表。从 26 种图表类型中自动选择最优方案，支持折线图、柱状图、饼图、雷达图、桑基图、热力图等。",
  "claude-to-kkoclaw":
    "通过 HTTP API 与 KKOCLAW 平台交互。可发送消息进行深度研究分析、管理对话线程、列出模型/技能/智能体、管理记忆、上传文件等。",
  "code-documentation":
    "为代码库、API、库或软件项目生成专业文档。支持 README、API 参考、内联注释、架构文档、变更日志和开发者指南等格式。",
  "consulting-analysis":
    "生成专业咨询级研究报告，涵盖市场分析、消费者洞察、品牌策略、财务分析、行业研究、竞争情报和投资尽调等领域。遵循 McKinsey/BCG 专业语调。",
  "data-analysis":
    "使用 DuckDB 分析引擎对 Excel/CSV 文件进行深度数据分析。支持 Schema 检查、SQL 查询、统计摘要、透视表、跨表关联和数据导出。",
  "deep-research":
    "替代简单搜索，对任何需要网络调研的问题进行系统性的多角度深度研究。从广泛探索到深度挖掘再到交叉验证，确保信息全面可靠。",
  "find-skills":
    "帮助用户发现和安装智能体技能。当你询问\u201C如何做 X\u201D、\u201C有没有可以做...的技能\u201D或希望扩展平台能力时自动触发。",
  "frontend-design":
    "创建独特的生产级前端界面，生成高质量的网页组件、登录页、仪表盘、React 组件、HTML/CSS 布局等。避免千篇一律的 AI 美学风格。",
  "github-deep-research":
    "对 GitHub 仓库进行多轮深度研究。支持全面分析、时间线重建、竞争对比和深度调查，输出带执行摘要和 Mermaid 图的结构化报告。",
  "image-generation":
    "根据文本描述生成图像内容，包括人物角色、场景、产品等视觉素材。支持结构化提示词和参考图像引导生成，创作高质量视觉作品。",
  "newsletter-generation":
    "生成时事通讯、邮件摘要、每周综述、行业简报或精选内容。支持基于主题的研究、多源内容策展和专业的邮件/网页排版格式。",
  "podcast-generation":
    "将文本内容转换为双主持人对话式播客音频。自动生成自然流畅的对话脚本并合成音频，支持不同风格和语调的播客产出。",
  "ppt-generation":
    "生成专业演示文稿（PPT/PPTX）。通过为每张幻灯片生成高质量图像并组合成 PowerPoint 文件，创建视觉冲击力强的演示内容。",
  "skill-creator":
    "创建新技能、修改和改进现有技能，并评估技能表现。支持从零创建技能、编辑优化、运行评测、基准测试和触发准确性分析。",
  "surprise-me":
    "通过动态发现和创意组合其他已启用技能，为用户创造令人惊喜的意外体验。当你感到无聊、想要灵感或期待\u201C小惊喜\u201D时触发。",
  "systematic-literature-review":
    "对某主题的多篇学术论文进行系统性文献综述。支持标注参考文献、跨论文比较，可输出 APA/IEEE/BibTeX 格式。适用于综述类任务。",
  "vercel-deploy-claimable":
    "一键部署应用到 Vercel 平台。无需身份验证，自动返回预览 URL 和可认领的部署链接，快速将项目发布上线。",
  "video-generation":
    "根据用户请求生成视频内容。支持结构化提示词和参考图像引导生成，将创意构思转化为动态视频作品。",
  "web-design-guidelines":
    "审查 UI 代码是否符合 Web 界面设计指南。检查可访问性、UX 最佳实践、设计一致性，确保界面符合专业标准。",
};

// ── Per-skill color theme ────────────────────────────────────────────────────
interface SkillTheme {
  gradient: string; // card border / header gradient
  iconBg: string; // icon container background
  iconColor: string; // icon color
  badgeBg: string; // badge background
  badgeText: string; // badge text
}

const SKILL_THEMES: Record<string, SkillTheme> = {
  "academic-paper-review": {
    gradient: "from-indigo-500/20 to-violet-500/10",
    iconBg: "bg-indigo-500/15",
    iconColor: "text-indigo-400",
    badgeBg: "bg-indigo-500/15",
    badgeText: "text-indigo-400",
  },
  bootstrap: {
    gradient: "from-violet-500/20 to-purple-500/10",
    iconBg: "bg-violet-500/15",
    iconColor: "text-violet-400",
    badgeBg: "bg-violet-500/15",
    badgeText: "text-violet-400",
  },
  "chart-visualization": {
    gradient: "from-cyan-500/20 to-blue-500/10",
    iconBg: "bg-cyan-500/15",
    iconColor: "text-cyan-400",
    badgeBg: "bg-cyan-500/15",
    badgeText: "text-cyan-400",
  },
  "claude-to-kkoclaw": {
    gradient: "from-teal-500/20 to-emerald-500/10",
    iconBg: "bg-teal-500/15",
    iconColor: "text-teal-400",
    badgeBg: "bg-teal-500/15",
    badgeText: "text-teal-400",
  },
  "code-documentation": {
    gradient: "from-blue-500/20 to-sky-500/10",
    iconBg: "bg-blue-500/15",
    iconColor: "text-blue-400",
    badgeBg: "bg-blue-500/15",
    badgeText: "text-blue-400",
  },
  "consulting-analysis": {
    gradient: "from-slate-500/20 to-gray-500/10",
    iconBg: "bg-slate-500/15",
    iconColor: "text-slate-300",
    badgeBg: "bg-slate-500/15",
    badgeText: "text-slate-300",
  },
  "data-analysis": {
    gradient: "from-sky-500/20 to-cyan-500/10",
    iconBg: "bg-sky-500/15",
    iconColor: "text-sky-400",
    badgeBg: "bg-sky-500/15",
    badgeText: "text-sky-400",
  },
  "deep-research": {
    gradient: "from-purple-500/20 to-fuchsia-500/10",
    iconBg: "bg-purple-500/15",
    iconColor: "text-purple-400",
    badgeBg: "bg-purple-500/15",
    badgeText: "text-purple-400",
  },
  "find-skills": {
    gradient: "from-amber-500/20 to-yellow-500/10",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-400",
    badgeBg: "bg-amber-500/15",
    badgeText: "text-amber-400",
  },
  "frontend-design": {
    gradient: "from-rose-500/20 to-pink-500/10",
    iconBg: "bg-rose-500/15",
    iconColor: "text-rose-400",
    badgeBg: "bg-rose-500/15",
    badgeText: "text-rose-400",
  },
  "github-deep-research": {
    gradient: "from-emerald-500/20 to-green-500/10",
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-400",
    badgeBg: "bg-emerald-500/15",
    badgeText: "text-emerald-400",
  },
  "image-generation": {
    gradient: "from-fuchsia-500/20 to-pink-500/10",
    iconBg: "bg-fuchsia-500/15",
    iconColor: "text-fuchsia-400",
    badgeBg: "bg-fuchsia-500/15",
    badgeText: "text-fuchsia-400",
  },
  "newsletter-generation": {
    gradient: "from-orange-500/20 to-amber-500/10",
    iconBg: "bg-orange-500/15",
    iconColor: "text-orange-400",
    badgeBg: "bg-orange-500/15",
    badgeText: "text-orange-400",
  },
  "podcast-generation": {
    gradient: "from-red-500/20 to-rose-500/10",
    iconBg: "bg-red-500/15",
    iconColor: "text-red-400",
    badgeBg: "bg-red-500/15",
    badgeText: "text-red-400",
  },
  "ppt-generation": {
    gradient: "from-lime-500/20 to-green-500/10",
    iconBg: "bg-lime-500/15",
    iconColor: "text-lime-400",
    badgeBg: "bg-lime-500/15",
    badgeText: "text-lime-400",
  },
  "skill-creator": {
    gradient: "from-yellow-500/20 to-amber-500/10",
    iconBg: "bg-yellow-500/15",
    iconColor: "text-yellow-400",
    badgeBg: "bg-yellow-500/15",
    badgeText: "text-yellow-400",
  },
  "surprise-me": {
    gradient: "from-pink-500/20 to-rose-500/10",
    iconBg: "bg-pink-500/15",
    iconColor: "text-pink-400",
    badgeBg: "bg-pink-500/15",
    badgeText: "text-pink-400",
  },
  "systematic-literature-review": {
    gradient: "from-stone-500/20 to-neutral-500/10",
    iconBg: "bg-stone-500/15",
    iconColor: "text-stone-400",
    badgeBg: "bg-stone-500/15",
    badgeText: "text-stone-300",
  },
  "vercel-deploy-claimable": {
    gradient: "from-green-500/20 to-emerald-500/10",
    iconBg: "bg-green-500/15",
    iconColor: "text-green-400",
    badgeBg: "bg-green-500/15",
    badgeText: "text-green-400",
  },
  "video-generation": {
    gradient: "from-blue-500/20 to-indigo-500/10",
    iconBg: "bg-blue-500/15",
    iconColor: "text-blue-400",
    badgeBg: "bg-blue-500/15",
    badgeText: "text-blue-400",
  },
  "web-design-guidelines": {
    gradient: "from-neutral-500/20 to-stone-500/10",
    iconBg: "bg-neutral-500/15",
    iconColor: "text-neutral-400",
    badgeBg: "bg-neutral-500/15",
    badgeText: "text-neutral-400",
  },
};

const DEFAULT_THEME: SkillTheme = {
  gradient: "from-primary/20 to-primary/5",
  iconBg: "bg-primary/15",
  iconColor: "text-primary",
  badgeBg: "bg-primary/15",
  badgeText: "text-primary",
};

function getSkillTheme(name: string): SkillTheme {
  return SKILL_THEMES[name] ?? DEFAULT_THEME;
}

/** Returns the Chinese description for a skill, falling back to the original. */
function getChineseDescription(name: string, original: string): string {
  return CHINESE_DESCRIPTIONS[name] ?? original;
}

// ── Icons ────────────────────────────────────────────────────────────────────
const SKILL_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  "academic-paper-review": BookOpenIcon,
  bootstrap: RocketIcon,
  "chart-visualization": ChartBarIcon,
  "claude-to-kkoclaw": WandIcon,
  "code-documentation": Code2Icon,
  "consulting-analysis": LightbulbIcon,
  "data-analysis": ChartBarIcon,
  "deep-research": SearchIcon,
  "find-skills": FileSearchIcon,
  "frontend-design": MonitorIcon,
  "github-deep-research": GlobeIcon,
  "image-generation": ImageIcon,
  "newsletter-generation": NewspaperIcon,
  "podcast-generation": MicIcon,
  "ppt-generation": PresentationIcon,
  "skill-creator": PencilRulerIcon,
  "surprise-me": PuzzleIcon,
  "systematic-literature-review": FlaskConicalIcon,
  "vercel-deploy-claimable": RocketIcon,
  "video-generation": VideoIcon,
  "web-design-guidelines": PaletteIcon,
};

const DEFAULT_ICON = SparklesIcon;

function getSkillIcon(name: string): React.ComponentType<{ className?: string }> {
  return SKILL_ICON_MAP[name] ?? DEFAULT_ICON;
}

function getCategoryLabel(
  category: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (category === "public") return t.common.public;
  if (category === "custom") return t.common.custom;
  return category;
}

// ── Category Filter Pills ────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  all: "border-violet-500/50 bg-violet-500/10 text-violet-400",
  public: "border-cyan-500/50 bg-cyan-500/10 text-cyan-400",
  custom: "border-amber-500/50 bg-amber-500/10 text-amber-400",
};

function FilterPill({
  children,
  active,
  category,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  category: string;
  onClick: () => void;
}) {
  const activeColors = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.all;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-4 py-1.5 text-xs font-semibold transition-all duration-200",
        active
          ? activeColors + " shadow-sm scale-105"
          : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────

function EmptySkill({ onCreateSkill }: { onCreateSkill: () => void }) {
  const { t } = useI18n();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SparklesIcon className="text-amber-400" />
        </EmptyMedia>
        <EmptyTitle>{t.settings.skills.emptyTitle}</EmptyTitle>
        <EmptyDescription>
          {t.settings.skills.emptyDescription}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          onClick={onCreateSkill}
          className="bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600"
        >
          <SparklesIcon className="size-4" />
          {t.settings.skills.emptyButton}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

// ── Skill Card ───────────────────────────────────────────────────────────────

function SkillCard({ skill }: { skill: Skill }) {
  const { t } = useI18n();
  const { mutate: enableSkill } = useEnableSkill();
  const Icon = getSkillIcon(skill.name);
  const theme = getSkillTheme(skill.name);
  const description = getChineseDescription(skill.name, skill.description);

  return (
    <div
      className={cn(
        "bg-card group relative flex flex-col gap-3 rounded-2xl border p-5 transition-all duration-300",
        "hover:shadow-lg hover:-translate-y-0.5",
        !skill.enabled && "opacity-50 grayscale-[30%]",
      )}
    >
      {/* Decorative top gradient bar */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r opacity-60",
          theme.gradient.replace("/20", "/60").replace("/10", "/30"),
        )}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 pt-1">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset transition-transform duration-200 group-hover:scale-110",
              theme.iconBg,
              theme.iconColor.replace("text-", "ring-") + "/30",
            )}
          >
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold tracking-tight truncate">
              {skill.name}
            </h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  theme.badgeBg,
                  theme.badgeText,
                )}
              >
                {getCategoryLabel(skill.category, t)}
              </span>
            </div>
          </div>
        </div>
        <Switch
          checked={skill.enabled}
          disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
          onCheckedChange={(checked) =>
            enableSkill({ skillName: skill.name, enabled: checked })
          }
          className={cn(
            "data-[state=checked]:bg-gradient-to-r!",
            theme.gradient,
          )}
        />
      </div>

      {/* Description */}
      <p className="text-muted-foreground line-clamp-3 text-[13px] leading-relaxed">
        {description}
      </p>
    </div>
  );
}

// ── Skeleton Loading ─────────────────────────────────────────────────────────

function SkillsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="bg-card animate-pulse rounded-2xl border p-5 space-y-3"
        >
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-xl bg-muted" />
            <div className="space-y-2 flex-1">
              <div className="h-3.5 w-24 rounded bg-muted" />
              <div className="h-2.5 w-16 rounded bg-muted" />
            </div>
            <div className="h-5 w-9 rounded-full bg-muted" />
          </div>
          <div className="space-y-2">
            <div className="h-2.5 w-full rounded bg-muted" />
            <div className="h-2.5 w-3/4 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function SkillsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { skills, isLoading, error } = useSkills();
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // 始终展示「公共」和「自定义」两个分类筛选，即使某个分类下暂无技能
  const categories = useMemo(() => ["public", "custom"], []);

  const filteredSkills = useMemo(() => {
    let result = skills;
    if (filter !== "all") {
      result = result.filter((s) => s.category === filter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (CHINESE_DESCRIPTIONS[s.name] ?? s.description)
            .toLowerCase()
            .includes(q),
      );
    }
    return result;
  }, [skills, filter, search]);

  const handleCreateSkill = () => {
    router.push("/workspace/chats/new?mode=skill");
  };

  const activeCount = useMemo(
    () => skills.filter((s) => s.enabled).length,
    [skills],
  );

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header Section ────────────────────────────────────────────── */}
      <div className="relative shrink-0 border-b bg-gradient-to-b from-muted/30 to-transparent">
        {/* Decorative background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -right-24 size-64 rounded-full bg-violet-500/5 blur-3xl" />
          <div className="absolute -bottom-16 left-1/3 size-48 rounded-full bg-cyan-500/5 blur-3xl" />
          <div className="absolute -top-8 left-1/4 size-32 rounded-full bg-amber-500/5 blur-3xl" />
        </div>

        <div className="relative px-6 pt-7 pb-5">
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-extrabold tracking-tight">
                <span className="bg-gradient-to-r from-violet-500 via-cyan-400 to-amber-400 bg-clip-text text-transparent">
                  {t.sidebar.skills}
                </span>
              </h1>
              <p className="text-muted-foreground text-sm max-w-xl">
                {t.settings.skills.description}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {skills.length > 0 && (
                <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex size-2 rounded-full bg-emerald-400" />
                  {activeCount}/{skills.length} 已启用
                </div>
              )}
              <Button
                onClick={handleCreateSkill}
                className="bg-gradient-to-r from-violet-500 to-cyan-500 text-white hover:from-violet-600 hover:to-cyan-600 shadow-md shadow-violet-500/25 transition-all duration-200 hover:shadow-lg hover:shadow-violet-500/30"
              >
                <SparklesIcon className="size-4" />
                {t.settings.skills.createSkill}
              </Button>
            </div>
          </div>

          {/* Search + Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-5">
            <div className="relative flex-1 max-w-sm">
              <SearchIcon className="text-muted-foreground absolute left-3.5 top-1/2 size-4 -translate-y-1/2" />
              <Input
                className="pl-10 h-10 rounded-xl border-muted-foreground/20 bg-muted/50 focus-visible:ring-violet-500/30"
                placeholder={t.common.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <FilterPill
                active={filter === "all"}
                category="all"
                onClick={() => setFilter("all")}
              >
                {t.common.all}
              </FilterPill>
              {categories.map((cat) => (
                <FilterPill
                  key={cat}
                  active={filter === cat}
                  category={cat}
                  onClick={() => setFilter(cat)}
                >
                  {getCategoryLabel(cat, t)}
                </FilterPill>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isLoading ? (
          <SkillsSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="size-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
              <MegaphoneIcon className="size-7 text-red-400" />
            </div>
            <p className="text-sm text-red-400 font-medium">加载失败</p>
            <p className="text-muted-foreground text-xs mt-1">
              {error.message}
            </p>
          </div>
        ) : filteredSkills.length === 0 ? (
          search ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="size-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <SearchIcon className="size-7 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">未找到匹配的技能</p>
              <p className="text-muted-foreground text-xs mt-1">
                尝试其他关键词
              </p>
            </div>
          ) : (
            <EmptySkill onCreateSkill={handleCreateSkill} />
          )
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredSkills.map((skill) => (
                <SkillCard key={skill.name} skill={skill} />
              ))}
            </div>
            <div className="mt-8 text-center text-muted-foreground text-xs">
              共 {filteredSkills.length} 个技能{skills.length !== filteredSkills.length ? `（已筛选，共 ${skills.length} 个）` : ""}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
