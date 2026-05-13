import { getBackendBaseURL } from "../config";

import { fetch } from "./fetcher";

export interface TokenUsageStats {
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_runs: number;
  by_model: Record<string, { tokens: number; runs: number; input_tokens: number; output_tokens: number }>;
  by_caller: {
    lead_agent: number;
    subagent: number;
    middleware: number;
  };
}

export interface TokenUsageTimeseriesItem {
  date: string;
  model_name: string;
  run_count: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
}

export interface MonthFilter {
  year: number;
  month: number;
}

/**
 * Fetch global token usage statistics across all threads for the current user.
 * Optionally filter by calendar month.
 */
export async function fetchTokenUsageStats(
  filter?: MonthFilter,
): Promise<TokenUsageStats> {
  const params = new URLSearchParams();
  if (filter) {
    params.set("year", String(filter.year));
    params.set("month", String(filter.month));
  }
  const qs = params.toString();
  const url = `${getBackendBaseURL()}/api/threads/token-usage/stats${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Failed to fetch token usage stats: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch daily token usage timeseries, grouped by date and model.
 * Optionally filter by calendar month instead of rolling days window.
 */
export async function fetchTokenUsageTimeseries(
  days = 30,
  filter?: MonthFilter,
): Promise<TokenUsageTimeseriesItem[]> {
  const params = new URLSearchParams({ days: String(days) });
  if (filter) {
    params.set("year", String(filter.year));
    params.set("month", String(filter.month));
  }
  const res = await fetch(
    `${getBackendBaseURL()}/api/threads/token-usage/timeseries?${params}`,
    { method: "GET" },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch token usage timeseries: ${res.status}`);
  }
  return res.json();
}
