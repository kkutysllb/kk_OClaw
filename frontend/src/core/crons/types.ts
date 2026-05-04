/** Cron job configuration returned by the API. */
export interface CronJobConfig {
  enabled: boolean;
  cron: string;
  description: string;
  agent: string;
  model: string | null;
  prompt: string;
}

/** Response from GET /api/crons */
export interface CronJobsListResponse {
  cron_jobs: Record<string, CronJobConfig>;
}
