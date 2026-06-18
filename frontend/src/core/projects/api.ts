import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

import type {
  CreateProjectRequest,
  CreateWorktreeRequest,
  CodingLatestReview,
  CodingReview,
  CodingReviewApplyFixRequest,
  CodingReviewApplyFixResult,
  CodingReviewRequest,
  CodingSkillDeleteResult,
  CodingSkillWriteRequest,
  CodingSkillDetail,
  CodingSkill,
  DiscardProjectFileChangeRequest,
  DiscardProjectFileChangeResult,
  FileContent,
  FileEntry,
  Project,
  ProjectDiff,
  QiongqiChangesList,
  QiongqiEventsList,
  QiongqiSession,
  QiongqiRoiReportsList,
  QiongqiRoiSummary,
  RemoveWorktreeRequest,
  SetCodingSkillEnabledRequest,
  WorktreeCreateResult,
  WorktreeInfo,
  WorktreeRemoveResult,
} from "./types";

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  const res = await fetch(`${getBackendBaseURL()}/api/projects`);
  if (!res.ok) throw new Error(`Failed to load projects: ${res.statusText}`);
  const data = (await res.json()) as { projects: Project[] };
  return data.projects;
}

export async function getProject(projectId: string): Promise<Project> {
  const res = await fetch(`${getBackendBaseURL()}/api/projects/${projectId}`);
  if (!res.ok) throw new Error(`Project '${projectId}' not found`);
  return res.json() as Promise<Project>;
}

export async function createProject(
  request: CreateProjectRequest,
): Promise<Project> {
  const res = await fetch(`${getBackendBaseURL()}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to create project: ${res.statusText}`,
    );
  }
  return res.json() as Promise<Project>;
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`${getBackendBaseURL()}/api/projects/${projectId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete project: ${res.statusText}`);
}

// ---------------------------------------------------------------------------
// Worktrees
// ---------------------------------------------------------------------------

export async function listWorktrees(
  projectId: string,
): Promise<WorktreeInfo[]> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/projects/${projectId}/worktrees`,
  );
  if (!res.ok) throw new Error(`Failed to list worktrees: ${res.statusText}`);
  const data = (await res.json()) as { worktrees: WorktreeInfo[] };
  return data.worktrees;
}

export async function createWorktree(
  projectId: string,
  request: CreateWorktreeRequest,
): Promise<WorktreeCreateResult> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/projects/${projectId}/worktrees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to create worktree: ${res.statusText}`,
    );
  }
  return res.json() as Promise<WorktreeCreateResult>;
}

export async function removeWorktree(
  projectId: string,
  request: RemoveWorktreeRequest,
): Promise<WorktreeRemoveResult> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/projects/${projectId}/worktrees`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to remove worktree: ${res.statusText}`,
    );
  }
  return res.json() as Promise<WorktreeRemoveResult>;
}

// ---------------------------------------------------------------------------
// File browsing
// ---------------------------------------------------------------------------

export async function listFiles(
  projectId: string,
  subpath: string = ".",
): Promise<FileEntry[]> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/projects/${projectId}/files?path=${encodeURIComponent(subpath)}`,
  );
  if (!res.ok) throw new Error(`Failed to list files: ${res.statusText}`);
  const data = (await res.json()) as { entries: FileEntry[] };
  return data.entries;
}

export async function readFile(
  projectId: string,
  subpath: string,
): Promise<FileContent> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/projects/${projectId}/file?path=${encodeURIComponent(subpath)}`,
  );
  if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);
  return res.json() as Promise<FileContent>;
}

export async function getProjectDiff(projectId: string): Promise<ProjectDiff> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/projects/${projectId}/diff`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to load project diff: ${res.statusText}`,
    );
  }
  return res.json() as Promise<ProjectDiff>;
}

export async function discardProjectFileChange(
  projectId: string,
  request: DiscardProjectFileChangeRequest,
): Promise<DiscardProjectFileChangeResult> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/projects/${projectId}/diff/discard`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to discard file change: ${res.statusText}`,
    );
  }
  return res.json() as Promise<DiscardProjectFileChangeResult>;
}

// ---------------------------------------------------------------------------
// Coding Agent inspector
// ---------------------------------------------------------------------------

export async function getCodingSession(
  threadId: string,
): Promise<QiongqiSession> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/coding/sessions/${encodeURIComponent(threadId)}`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to load coding session: ${res.statusText}`,
    );
  }
  return res.json() as Promise<QiongqiSession>;
}

export async function listCodingSessionEvents(
  threadId: string,
): Promise<QiongqiEventsList> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/coding/sessions/${encodeURIComponent(threadId)}/events?limit=100`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to load coding events: ${res.statusText}`,
    );
  }
  return res.json() as Promise<QiongqiEventsList>;
}

export async function listCodingSessionChanges(
  threadId: string,
): Promise<QiongqiChangesList> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/coding/sessions/${encodeURIComponent(threadId)}/changes`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to load coding changes: ${res.statusText}`,
    );
  }
  return res.json() as Promise<QiongqiChangesList>;
}

export async function runCodingReview(
  request: CodingReviewRequest,
): Promise<CodingReview> {
  const res = await fetch(`${getBackendBaseURL()}/api/coding/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to run coding review: ${res.statusText}`,
    );
  }
  return res.json() as Promise<CodingReview>;
}

export async function getLatestCodingReview(
  threadId: string,
): Promise<CodingLatestReview> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/coding/sessions/${encodeURIComponent(threadId)}/review`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to load coding review: ${res.statusText}`,
    );
  }
  return res.json() as Promise<CodingLatestReview>;
}

export async function applyCodingReviewFix(
  request: CodingReviewApplyFixRequest,
): Promise<CodingReviewApplyFixResult> {
  const res = await fetch(`${getBackendBaseURL()}/api/coding/reviews/fixes/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to apply coding review fix: ${res.statusText}`,
    );
  }
  return res.json() as Promise<CodingReviewApplyFixResult>;
}

export async function getCodingRoiSummary(
  threadId: string,
): Promise<QiongqiRoiSummary> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/coding/sessions/${encodeURIComponent(threadId)}/roi/summary`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to load ROI summary: ${res.statusText}`,
    );
  }
  return res.json() as Promise<QiongqiRoiSummary>;
}

export async function listCodingRoiReports(
  threadId: string,
): Promise<QiongqiRoiReportsList> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/coding/sessions/${encodeURIComponent(threadId)}/roi`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to load ROI reports: ${res.statusText}`,
    );
  }
  return res.json() as Promise<QiongqiRoiReportsList>;
}

export async function listCodingSkills(
  projectRoot: string | null | undefined,
): Promise<CodingSkill[]> {
  const query = projectRoot
    ? `?project_root=${encodeURIComponent(projectRoot)}`
    : "";
  const res = await fetch(`${getBackendBaseURL()}/api/coding/skills${query}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to load coding skills: ${res.statusText}`,
    );
  }
  const data = (await res.json()) as { skills: CodingSkill[] };
  return data.skills;
}

export async function getCodingSkill(
  skillId: string,
  projectRoot: string | null | undefined,
): Promise<CodingSkillDetail> {
  const query = projectRoot
    ? `?project_root=${encodeURIComponent(projectRoot)}`
    : "";
  const res = await fetch(
    `${getBackendBaseURL()}/api/coding/skills/${encodeURIComponent(skillId)}${query}`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to load coding skill: ${res.statusText}`,
    );
  }
  return res.json() as Promise<CodingSkillDetail>;
}

export async function createCodingSkill(
  request: CodingSkillWriteRequest & { id: string },
): Promise<CodingSkillDetail> {
  const res = await fetch(`${getBackendBaseURL()}/api/coding/skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to create coding skill: ${res.statusText}`,
    );
  }
  return res.json() as Promise<CodingSkillDetail>;
}

export async function updateCodingSkill(
  skillId: string,
  request: CodingSkillWriteRequest,
): Promise<CodingSkillDetail> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/coding/skills/${encodeURIComponent(skillId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to update coding skill: ${res.statusText}`,
    );
  }
  return res.json() as Promise<CodingSkillDetail>;
}

export async function deleteCodingSkill(
  skillId: string,
  projectRoot: string | null | undefined,
): Promise<CodingSkillDeleteResult> {
  const query = projectRoot
    ? `?project_root=${encodeURIComponent(projectRoot)}`
    : "";
  const res = await fetch(
    `${getBackendBaseURL()}/api/coding/skills/${encodeURIComponent(skillId)}${query}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to delete coding skill: ${res.statusText}`,
    );
  }
  return res.json() as Promise<CodingSkillDeleteResult>;
}

export async function setCodingSkillEnabled(
  skillId: string,
  request: SetCodingSkillEnabledRequest,
): Promise<CodingSkillDetail> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/coding/skills/${encodeURIComponent(skillId)}/enabled`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `Failed to update coding skill: ${res.statusText}`,
    );
  }
  return res.json() as Promise<CodingSkillDetail>;
}
