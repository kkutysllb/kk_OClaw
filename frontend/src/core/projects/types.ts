/** TypeScript types matching the backend coding-project & worktree API. */

export interface Project {
  id: string;
  name: string;
  path: string;
  description: string;
  config: Record<string, unknown>;
  is_git_repo: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectRequest {
  name: string;
  path: string;
  description?: string;
  config?: Record<string, unknown> | null;
}

export interface UpdateProjectRequest {
  name?: string | null;
  description?: string | null;
  config?: Record<string, unknown> | null;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string | null;
  bare: string | null;
  detached: string | null;
}

export interface CreateWorktreeRequest {
  branch: string;
  base_branch?: string | null;
  path?: string | null;
}

export interface WorktreeCreateResult {
  path: string;
  branch: string;
  base_branch: string;
  repo_root: string;
}

export interface RemoveWorktreeRequest {
  path: string;
  force?: boolean;
  delete_branch?: boolean;
}

export interface WorktreeRemoveResult {
  path: string;
  removed: string;
  deleted_branch: string;
}

// ---------------------------------------------------------------------------
// File browsing
// ---------------------------------------------------------------------------

export interface FileEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  size: number;
  ext: string;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  language: string;
}

// ---------------------------------------------------------------------------
// Project diff
// ---------------------------------------------------------------------------

export interface ProjectDiffFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "copied";
  additions: number;
  deletions: number;
  previous_path?: string | null;
  diff?: string;
}

export interface ProjectDiff {
  is_git_repo: boolean;
  has_changes: boolean;
  files: ProjectDiffFile[];
  diff: string;
}

export interface DiscardProjectFileChangeRequest {
  path: string;
}

export interface DiscardProjectFileChangeResult {
  path: string;
  discarded: boolean;
}

export interface GitHubCliStatus {
  available: boolean;
  authenticated: boolean;
  username: string | null;
  host: string | null;
  detail: string | null;
}

export interface ProjectSource {
  label: string;
  remote: string | null;
  provider: string;
}

export interface ProjectEnvironment {
  is_git_repo: boolean;
  branch: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changed_files: number;
  additions: number;
  deletions: number;
  github_cli: GitHubCliStatus;
  source: ProjectSource;
}

export interface ProjectGitCommitRequest {
  message: string;
}

export interface ProjectGitCommitResult {
  head: string;
  summary: string;
  message: string;
}

export interface ProjectGitPushResult {
  branch: string;
  upstream: string | null;
  summary: string;
}

// ---------------------------------------------------------------------------
// Coding Agent inspector
// ---------------------------------------------------------------------------

export interface QiongqiEvent {
  schema_version: number;
  source: string;
  seq: number;
  thread_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface QiongqiEventsList {
  thread_id: string;
  events: QiongqiEvent[];
}

export interface QiongqiSessionSnapshot {
  thread_id: string;
  project_root: string | null;
  scratch_root: string | null;
  skills: Array<Record<string, unknown>>;
  active_coding_skills: Array<Record<string, unknown>>;
  tool_policy: Array<Record<string, unknown>>;
  roi: Record<string, unknown>;
  change_summary: Record<string, unknown>;
  updated_at: string | null;
}

export interface QiongqiSession {
  thread_id: string;
  session: QiongqiSessionSnapshot;
}

export interface QiongqiRoiReport {
  seq: number;
  thread_id: string;
  stable_prompt_fingerprint: string;
  tool_catalog_fingerprint: string;
  immutable_prefix_fingerprint: string;
  full_tool_count: number;
  visible_tool_count: number;
  hidden_tool_count: number;
  provider_usage: Record<string, number>;
  tool_output: Record<string, number>;
  token_economy: Record<string, number>;
  created_at: string;
}

export interface QiongqiRoiDerived {
  actual_tokens: number;
  estimated_saved_tokens: number;
  estimated_baseline_tokens: number;
  saving_ratio: number;
  tool_hidden_ratio: number;
  tool_catalog_saved_tokens: number;
  tool_output_saved_tokens: number;
  token_economy_saved_tokens: number;
}

export interface QiongqiRoiSummaryPayload {
  thread_id: string;
  report_count: number;
  latest: QiongqiRoiReport | null;
  provider_usage: Record<string, number>;
  tool_output: Record<string, number>;
  token_economy: Record<string, number>;
  derived: QiongqiRoiDerived;
}

export interface QiongqiRoiSummary {
  thread_id: string;
  summary: QiongqiRoiSummaryPayload;
}

export interface QiongqiRoiReportsList {
  thread_id: string;
  reports: QiongqiRoiReport[];
}

export interface CodingSkill {
  id: string;
  name: string;
  description: string;
  scope: "project" | "global";
  legacy: boolean;
  activation_keywords: string[];
  always_activate: boolean;
  allowed_tools: string[];
  permissions: Record<string, unknown> | null;
  skill_file: string;
  enabled: boolean;
  manifest_errors: string[];
  commands: Array<Record<string, string>>;
  ui: Record<string, unknown> | null;
}

export interface CodingSkillDetail {
  skill: CodingSkill;
  instructions: string;
}

export interface SetCodingSkillEnabledRequest {
  project_root?: string | null;
  scope: "project" | "global";
  enabled: boolean;
}

export interface CodingSkillWriteRequest {
  project_root?: string | null;
  id?: string;
  name: string;
  description: string;
  instructions: string;
  activation_keywords: string[];
  always_activate: boolean;
  allowed_tools: string[];
  permissions?: Record<string, unknown> | null;
}

export interface CodingSkillDeleteResult {
  deleted: boolean;
  skill_id: string;
}

export interface QiongqiChange {
  thread_id: string;
  task_id: string;
  project_root: string | null;
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff: string;
  created_at: string;
}

export interface QiongqiChangesList {
  thread_id: string;
  task_id: string | null;
  changes: QiongqiChange[];
}

export interface CodingReviewFinding {
  id: string;
  severity: "critical" | "major" | "minor" | "nitpick";
  category: string;
  file: string | null;
  line: number | null;
  task_id: string | null;
  message: string;
  suggestion: string;
  evidence: string[];
  fix: {
    applicable: boolean;
    kind: string | null;
    description: string;
    patch: string;
    applied: boolean;
    applied_at?: string;
  };
}

export interface CodingReviewSummary {
  project_files: number;
  task_changes: number;
  qiongqi_events: number;
  commits: number;
  additions: number;
  deletions: number;
  critical: number;
  major: number;
  minor: number;
  nitpick: number;
}

export interface CodingReview {
  review_id: string;
  project_id: string;
  project_root: string;
  thread_id: string;
  scope: "project_diff" | "task_changes" | "all" | string;
  decision: "pass" | "needs_review" | "request_changes" | string;
  summary: CodingReviewSummary;
  findings: CodingReviewFinding[];
  source: Record<string, unknown>;
  created_at: string;
  next_plan: string[];
}

export interface CodingReviewRequest {
  project_id: string;
  project_root: string;
  thread_id: string;
  scope: "project_diff" | "task_changes" | "all" | "pr";
  base_ref?: string | null;
}

export interface CodingLatestReview {
  thread_id: string;
  review: CodingReview | null;
}

export interface CodingReviewApplyFixRequest {
  thread_id: string;
  review_id: string;
  finding_id: string;
}

export interface CodingReviewApplyFixResult {
  thread_id: string;
  review_id: string;
  finding_id: string;
  file: string;
  applied: boolean;
}

// ---------------------------------------------------------------------------
// Delivery stage tracking
// ---------------------------------------------------------------------------

export interface DeliveryStage {
  id: string;
  title: string;
  goal: string;
  recommended_skills: string[];
  suggested_prompt: string;
  next_stage_id: string | null;
}

export interface DeliveryStagesResponse {
  stages: DeliveryStage[];
}

export interface StageHistoryEntry {
  from_stage_id: string | null;
  to_stage_id: string;
  reason: string;
  source: "user" | "agent_suggested" | "agent_accepted";
  timestamp: string;
  thread_id?: string | null;
  run_outcome?: string | null;
}

export interface StageSuggestion {
  stage_id: string;
  reason: string;
  suggested_by_thread_id: string;
  timestamp: string;
}

export interface ProjectStageState {
  project_root: string;
  current_stage: string | null;
  stage_history: StageHistoryEntry[];
  pending_suggestion: StageSuggestion | null;
  updated_at: string | null;
}

export interface SetStageRequest {
  stage_id: string;
  reason?: string;
}
