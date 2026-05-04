import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

import type { CronJobConfig, CronJobsListResponse } from "./types";

/** List all cron jobs. */
export async function fetchCronJobs(): Promise<CronJobsListResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/crons`);
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      (detail as { detail?: string }).detail ??
        `Failed to fetch cron jobs (${response.status})`,
    );
  }
  return response.json() as Promise<CronJobsListResponse>;
}

/** Create a new cron job. */
export async function createCronJob(
  name: string,
  config: CronJobConfig,
): Promise<CronJobConfig> {
  const response = await fetch(`${getBackendBaseURL()}/api/crons/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      (detail as { detail?: string }).detail ??
        `Failed to create cron job (${response.status})`,
    );
  }
  return response.json() as Promise<CronJobConfig>;
}

/** Update an existing cron job. */
export async function updateCronJob(
  name: string,
  config: CronJobConfig,
): Promise<CronJobConfig> {
  const response = await fetch(`${getBackendBaseURL()}/api/crons/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      (detail as { detail?: string }).detail ??
        `Failed to update cron job (${response.status})`,
    );
  }
  return response.json() as Promise<CronJobConfig>;
}

/** Delete a cron job. */
export async function deleteCronJob(name: string): Promise<void> {
  const response = await fetch(`${getBackendBaseURL()}/api/crons/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      (detail as { detail?: string }).detail ??
        `Failed to delete cron job (${response.status})`,
    );
  }
}
