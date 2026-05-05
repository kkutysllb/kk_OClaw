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
}

/**
 * Fetch global token usage statistics across all threads for the current user.
 */
export async function fetchTokenUsageStats(): Promise<TokenUsageStats> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/threads/token-usage/stats`,
    { method: "GET" },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch token usage stats: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch daily token usage timeseries, grouped by date and model.
 */
export async function fetchTokenUsageTimeseries(
  days = 30,
): Promise<TokenUsageTimeseriesItem[]> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/threads/token-usage/timeseries?days=${days}`,
    { method: "GET" },
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch token usage timeseries: ${res.status}`);
  }
  return res.json();
}
