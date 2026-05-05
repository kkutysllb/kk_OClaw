"use client";

import {
  BarChart3Icon,
  BotIcon,
  CpuIcon,
  CoinsIcon,
  HashIcon,
  LayersIcon,
  RefreshCwIcon,
  WrenchIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchTokenUsageStats,
  fetchTokenUsageTimeseries,
  type TokenUsageStats,
  type TokenUsageTimeseriesItem,
} from "@/core/api/token-usage";
import { loadModels } from "@/core/models/api";
import type { Model } from "@/core/models/types";
import { useI18n } from "@/core/i18n/hooks";
import { formatTokenCount } from "@/core/messages/usage";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | {
      status: "data";
      stats: TokenUsageStats;
      timeseries: TokenUsageTimeseriesItem[];
    };

const MODEL_COLORS = [
  "#8b5cf6",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#f43f5e",
  "#6366f1",
  "#84cc16",
  "#d946ef",
];

const CALLER_CONFIG = [
  { key: "lead_agent" as const, color: "#8b5cf6", bg: "bg-violet-500/10", text: "text-violet-400" },
  { key: "subagent" as const, color: "#06b6d4", bg: "bg-cyan-500/10", text: "text-cyan-400" },
  { key: "middleware" as const, color: "#f59e0b", bg: "bg-amber-500/10", text: "text-amber-400" },
];

/** Fill missing dates in a time-series with zero values for chart continuity. */
function fillDateRange(
  items: { date: string; run_count: number; total_tokens: number }[],
): { date: string; run_count: number; total_tokens: number }[] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return sorted;
  const minDate = new Date(first.date);
  const maxDate = new Date(last.date);
  const dateMap = new Map(sorted.map((d) => [d.date, d]));

  const result: { date: string; run_count: number; total_tokens: number }[] = [];
  const cur = new Date(minDate);
  while (cur <= maxDate) {
    const key = cur.toISOString().slice(0, 10);
    const existing = dateMap.get(key);
    result.push({
      date: `${cur.getMonth() + 1}-${cur.getDate()}`,
      run_count: existing?.run_count ?? 0,
      total_tokens: existing?.total_tokens ?? 0,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

function formatShortDate(label: React.ReactNode): string {
  if (typeof label !== "string") return "";
  const parts = label.split("-");
  if (parts.length < 2) return label;
  return `${parseInt(parts[0] ?? "0")}-${parseInt(parts[1] ?? "0")}`;
}

export function TokenUsageSettingsPage() {
  const { t } = useI18n();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [models, setModels] = useState<Model[]>([]);

  const modelDisplayNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of models) {
      map.set(m.name, m.display_name || m.name);
    }
    return map;
  }, [models]);

  /** Resolve a model_name to its display_name, falls back to model_name itself.
   *  When model is "unknown", use the first configured model's display name
   *  as a fallback (the backend should have already resolved unknown to the
   *  default model, but this provides a safety net). */
  const resolveModelDisplay = useCallback(
    (raw: string) => {
      const direct = modelDisplayNameMap.get(raw);
      if (direct) return direct;
      if (raw === "unknown" && modelDisplayNameMap.size >= 1) {
        return modelDisplayNameMap.values().next().value ?? raw;
      }
      return raw;
    },
    [modelDisplayNameMap],
  );

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const [stats, timeseries, modelsData] = await Promise.all([
        fetchTokenUsageStats(),
        fetchTokenUsageTimeseries(31),
        loadModels(),
      ]);
      setModels(modelsData.models);
      if (stats.total_runs === 0) {
        setLoadState({ status: "empty" });
      } else {
        setLoadState({ status: "data", stats, timeseries });
      }
    } catch (err) {
      setLoadState({
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const modelEntries = useMemo(() => {
    if (loadState.status !== "data") return [];
    return Object.entries(loadState.stats.by_model).sort(
      ([, a], [, b]) => b.tokens - a.tokens,
    );
  }, [loadState]);

  // Group timeseries by model, fill date gaps
  const modelTimeseries = useMemo(() => {
    if (loadState.status !== "data") return {};
    const byModel: Record<string, TokenUsageTimeseriesItem[]> = {};
    for (const item of loadState.timeseries) {
      const m = item.model_name;
      if (!byModel[m]) byModel[m] = [];
      byModel[m].push(item);
    }
    // Fill dates for chart continuity
    const result: Record<string, { date: string; run_count: number; total_tokens: number }[]> = {};
    for (const [model, items] of Object.entries(byModel)) {
      result[model] = fillDateRange(items);
    }
    return result;
  }, [loadState]);

  // --- Loading skeleton ---
  if (loadState.status === "loading") {
    return (
      <section className="space-y-8">
        <header className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </header>
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border bg-card p-4 space-y-3">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
        {[1, 2].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-5 space-y-4">
            <Skeleton className="h-5 w-32" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-[160px] rounded-lg" />
              <Skeleton className="h-[160px] rounded-lg" />
            </div>
          </div>
        ))}
      </section>
    );
  }

  // --- Error state ---
  if (loadState.status === "error") {
    return (
      <section className="space-y-8">
        <header className="space-y-2">
          <div className="text-lg font-semibold">{t.settings.tokenUsage.title}</div>
          <div className="text-muted-foreground text-sm">{t.settings.tokenUsage.description}</div>
        </header>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-rose-500/30 bg-rose-500/5 py-12 text-center">
          <div className="mb-3 rounded-full bg-rose-500/10 p-3">
            <RefreshCwIcon className="h-6 w-6 text-rose-400" />
          </div>
          <p className="text-sm text-muted-foreground">{loadState.message}</p>
          <button
            type="button"
            onClick={load}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-400 transition-colors hover:bg-rose-500/20"
          >
            <RefreshCwIcon className="h-4 w-4" />
            Retry
          </button>
        </div>
      </section>
    );
  }

  // --- Empty state ---
  if (loadState.status === "empty") {
    return (
      <section className="space-y-8">
        <header className="space-y-2">
          <div className="text-lg font-semibold">{t.settings.tokenUsage.title}</div>
          <div className="text-muted-foreground text-sm">{t.settings.tokenUsage.description}</div>
        </header>
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-muted-foreground/20 py-16 text-center">
          <div className="mb-3 rounded-full bg-muted p-3">
            <BarChart3Icon className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">{t.settings.tokenUsage.noData}</p>
        </div>
      </section>
    );
  }

  const { stats } = loadState;

  return (
    <section className="space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <div className="text-lg font-semibold">{t.settings.tokenUsage.title}</div>
        <div className="text-muted-foreground text-sm">{t.settings.tokenUsage.description}</div>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-shadow hover:shadow-md">
          <div className="absolute top-0 right-0 h-16 w-16 translate-x-4 -translate-y-4 rounded-full bg-violet-500/10 opacity-50 blur-xl transition-opacity group-hover:opacity-80" />
          <div className="relative space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10">
                <CoinsIcon className="h-3.5 w-3.5 text-violet-400" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                {t.settings.tokenUsage.summaryTotalTokens}
              </span>
            </div>
            <div className="bg-gradient-to-r from-violet-400 to-purple-400 bg-clip-text text-2xl font-bold text-transparent">
              {formatTokenCount(stats.total_tokens)}
            </div>
          </div>
        </div>
        <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-shadow hover:shadow-md">
          <div className="absolute top-0 right-0 h-16 w-16 translate-x-4 -translate-y-4 rounded-full bg-cyan-500/10 opacity-50 blur-xl transition-opacity group-hover:opacity-80" />
          <div className="relative space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10">
                <HashIcon className="h-3.5 w-3.5 text-cyan-400" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                {t.settings.tokenUsage.summaryTotalRuns}
              </span>
            </div>
            <div className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-2xl font-bold text-transparent">
              {stats.total_runs.toLocaleString()}
            </div>
          </div>
        </div>
        <div className="group relative overflow-hidden rounded-xl border bg-card p-4 transition-shadow hover:shadow-md">
          <div className="absolute top-0 right-0 h-16 w-16 translate-x-4 -translate-y-4 rounded-full bg-emerald-500/10 opacity-50 blur-xl transition-opacity group-hover:opacity-80" />
          <div className="relative space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
                <LayersIcon className="h-3.5 w-3.5 text-emerald-400" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                {t.settings.tokenUsage.summaryModels}
              </span>
            </div>
            <div className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-2xl font-bold text-transparent">
              {models.length}
            </div>
          </div>
        </div>
      </div>

      {/* Per-Model Time-Series Cards (Figure 2 style) */}
      {modelEntries.length > 0 && (
        <div className="space-y-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/10">
              <BarChart3Icon className="h-3.5 w-3.5 text-violet-400" />
            </span>
            {t.settings.tokenUsage.byModel}
          </h3>

          <div className="space-y-5">
            {modelEntries.map(([model, data], idx) => {
              const color = MODEL_COLORS[idx % MODEL_COLORS.length];
              const tsData = modelTimeseries[model] ?? [];

              return (
                <div key={model} className="overflow-hidden rounded-xl border bg-card">
                  {/* Model Header */}
                  <div className="flex items-center gap-3 border-b px-5 py-3">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-sm font-semibold truncate">{resolveModelDisplay(model)}</span>
                  </div>

                  {/* Metrics Row */}
                  <div className="grid grid-cols-2 divide-x">
                    <div className="px-5 py-3">
                      <div className="text-xs text-muted-foreground">
                        API {t.settings.tokenUsage.summaryTotalRuns}
                      </div>
                      <div className="mt-1 text-2xl font-bold tabular-nums">
                        {data.runs.toLocaleString()}
                      </div>
                    </div>
                    <div className="px-5 py-3">
                      <div className="text-xs text-muted-foreground">Tokens</div>
                      <div className="mt-1 text-2xl font-bold tabular-nums">
                        {formatTokenCount(data.tokens)}
                      </div>
                    </div>
                  </div>

                  {/* Time-Series Charts */}
                  {tsData.length > 0 && (
                    <div className="grid grid-cols-2 gap-0 divide-x border-t">
                      {/* Area Chart: API Requests over time */}
                      <div className="px-3 py-4">
                        <div className="mb-2 text-xs text-muted-foreground">
                          API {t.settings.tokenUsage.summaryTotalRuns}
                        </div>
                        <div className="h-[160px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={tsData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                              <defs>
                                <linearGradient id={`area-${model}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                              <XAxis
                                dataKey="date"
                                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                                axisLine={false}
                                tickLine={false}
                                interval="preserveStartEnd"
                                tickFormatter={formatShortDate}
                              />
                              <YAxis
                                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                                axisLine={false}
                                tickLine={false}
                                width={36}
                              />
                              <Tooltip
                                cursor={{ fill: "transparent" }}
                                contentStyle={{
                                  backgroundColor: "var(--card)",
                                  border: "1px solid var(--border)",
                                  borderRadius: "8px",
                                  fontSize: "12px",
                                  color: "var(--foreground)",
                                }}
                                labelStyle={{ color: "var(--foreground)" }}
                                labelFormatter={formatShortDate}
                              />
                              <Area
                                type="monotone"
                                dataKey="run_count"
                                stroke={color}
                                strokeWidth={2}
                                fill={`url(#area-${model})`}
                                dot={false}
                                activeDot={{ r: 4, fill: color }}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Bar Chart: Token usage over time */}
                      <div className="px-3 py-4">
                        <div className="mb-2 text-xs text-muted-foreground">Tokens</div>
                        <div className="h-[160px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={tsData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                              <XAxis
                                dataKey="date"
                                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                                axisLine={false}
                                tickLine={false}
                                interval="preserveStartEnd"
                                tickFormatter={formatShortDate}
                              />
                              <YAxis
                                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                                axisLine={false}
                                tickLine={false}
                                width={36}
                                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                              />
                              <Tooltip
                                cursor={{ fill: "transparent" }}
                                contentStyle={{
                                  backgroundColor: "var(--card)",
                                  border: "1px solid var(--border)",
                                  borderRadius: "8px",
                                  fontSize: "12px",
                                  color: "var(--foreground)",
                                }}
                                labelStyle={{ color: "var(--foreground)" }}
                                labelFormatter={formatShortDate}
                                formatter={(value) => [formatTokenCount(Number(value)), "Tokens"]}
                              />
                              <Bar dataKey="total_tokens" fill={color} radius={[3, 3, 0, 0]} maxBarSize={24} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* By Caller Section */}
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-cyan-500/10">
            <BotIcon className="h-3.5 w-3.5 text-cyan-400" />
          </span>
          {t.settings.tokenUsage.byCaller}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {CALLER_CONFIG.map((cfg) => {
            const tokens = stats.by_caller[cfg.key];
            const callerTotal = Math.max(
              stats.by_caller.lead_agent + stats.by_caller.subagent + stats.by_caller.middleware,
              1,
            );
            const pct = Math.max((tokens / callerTotal) * 100, 2);
            const label =
              cfg.key === "lead_agent"
                ? t.settings.tokenUsage.leadAgent
                : cfg.key === "subagent"
                  ? t.settings.tokenUsage.subagent
                  : t.settings.tokenUsage.middleware;
            return (
              <div key={cfg.key} className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", cfg.bg)}>
                    {cfg.key === "lead_agent" ? (
                      <CpuIcon className={cn("h-3.5 w-3.5", cfg.text)} />
                    ) : cfg.key === "subagent" ? (
                      <BotIcon className={cn("h-3.5 w-3.5", cfg.text)} />
                    ) : (
                      <WrenchIcon className={cn("h-3.5 w-3.5", cfg.text)} />
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <div className="font-mono text-lg font-bold">{formatTokenCount(tokens)}</div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: cfg.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
