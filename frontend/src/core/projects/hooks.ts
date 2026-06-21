import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  acceptStageSuggestion,
  applyCodingReviewFix,
  createCodingSkill,
  createProject,
  createWorktree,
  deleteProject,
  deleteCodingSkill,
  discardProjectFileChange,
  getProjectEnvironment,
  getDeliveryStages,
  getLatestCodingReview,
  getCodingSession,
  getCodingRoiSummary,
  getCodingSkill,
  getProjectDiff,
  getProject,
  getProjectStage,
  listCodingRoiReports,
  listCodingSessionChanges,
  listCodingSessionEvents,
  listCodingSkills,
  listFiles,
  listProjects,
  listWorktrees,
  readFile,
  removeWorktree,
  runCodingReview,
  gitCommitProject,
  gitPushProject,
  setCodingSkillEnabled,
  setProjectStage,
  dismissStageSuggestion,
  updateCodingSkill,
} from "./api";
import type {
  CodingReviewApplyFixRequest,
  CodingReviewRequest,
  CodingSkillWriteRequest,
  CreateProjectRequest,
  CreateWorktreeRequest,
  DiscardProjectFileChangeRequest,
  RemoveWorktreeRequest,
  SetCodingSkillEnabledRequest,
  SetStageRequest,
} from "./types";

// ---------------------------------------------------------------------------
// Project queries
// ---------------------------------------------------------------------------

export function useProjects() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
  });
  return { projects: data ?? [], isLoading, error };
}

export function useProject(projectId: string | null | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  });
  return { project: data ?? null, isLoading, error };
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateProjectRequest) => createProject(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => deleteProject(projectId),
    onSuccess: (_result, projectId) => {
      // Critical: purge all cached queries for the deleted project BEFORE
      // invalidating the list. Otherwise `invalidateQueries({ queryKey: ["projects"] })`
      // uses prefix matching (exact:false by default) and re-fetches the now-
      // deleted project's detail, worktrees, files, diff, etc. — all returning
      // 404 and entering react-query's retry loop. Combined with
      // refetchOnWindowFocus/refetchOnMount this pins the UI for tens of
      // seconds (see gateway.log lines 199-210: repeated 404s after delete).
      queryClient.removeQueries({ queryKey: ["projects", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Worktree queries
// ---------------------------------------------------------------------------

export function useWorktrees(projectId: string | null | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects", projectId, "worktrees"],
    queryFn: () => listWorktrees(projectId!),
    enabled: !!projectId,
  });
  return { worktrees: data ?? [], isLoading, error };
}

export function useCreateWorktree(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateWorktreeRequest) =>
      createWorktree(projectId, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "worktrees"],
      });
    },
  });
}

export function useRemoveWorktree(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: RemoveWorktreeRequest) =>
      removeWorktree(projectId, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "worktrees"],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// File browsing queries
// ---------------------------------------------------------------------------

export function useFileList(
  projectId: string | null | undefined,
  subpath = ".",
) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects", projectId, "files", subpath],
    queryFn: () => listFiles(projectId!, subpath),
    enabled: !!projectId,
  });
  return { entries: data ?? [], isLoading, error };
}

export function useFileContent(
  projectId: string | null | undefined,
  subpath: string | null,
) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["projects", projectId, "file", subpath],
    queryFn: () => readFile(projectId!, subpath!),
    enabled: !!projectId && !!subpath,
  });
  return { file: data ?? null, isLoading, error };
}

export function useProjectDiff(projectId: string | null | undefined) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["projects", projectId, "diff"],
    queryFn: () => getProjectDiff(projectId!),
    enabled: !!projectId,
  });
  return { diff: data ?? null, isLoading, isFetching, error, refetch };
}

export function useProjectEnvironment(projectId: string | null | undefined) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["projects", projectId, "environment"],
    queryFn: () => getProjectEnvironment(projectId!),
    enabled: !!projectId,
  });
  return { environment: data ?? null, isLoading, isFetching, error, refetch };
}

export function useDiscardProjectFileChange(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: DiscardProjectFileChangeRequest) =>
      discardProjectFileChange(projectId, request),
    onSuccess: (_result, request) => {
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "diff"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "file", request.path],
      });
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "files"],
      });
    },
  });
}

export function useProjectGitCommit(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => gitCommitProject(projectId, { message }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "environment"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "diff"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "files"],
      });
    },
  });
}

export function useProjectGitPush(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => gitPushProject(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "environment"],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Coding Agent inspector queries
// ---------------------------------------------------------------------------

export function useCodingSession(threadId: string | null | undefined) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["coding", "sessions", threadId, "session"],
    queryFn: () => getCodingSession(threadId!),
    enabled: !!threadId,
  });
  return {
    session: data?.session ?? null,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

export function useCodingSessionEvents(threadId: string | null | undefined) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["coding", "sessions", threadId, "events"],
    queryFn: () => listCodingSessionEvents(threadId!),
    enabled: !!threadId,
  });
  return {
    events: data?.events ?? [],
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

export function useCodingSessionChanges(threadId: string | null | undefined) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["coding", "sessions", threadId, "changes"],
    queryFn: () => listCodingSessionChanges(threadId!),
    enabled: !!threadId,
  });
  return {
    changes: data?.changes ?? [],
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

export function useLatestCodingReview(threadId: string | null | undefined) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["coding", "sessions", threadId, "review"],
    queryFn: () => getLatestCodingReview(threadId!),
    enabled: !!threadId,
  });
  return {
    review: data?.review ?? null,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

export function useRunCodingReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CodingReviewRequest) => runCodingReview(request),
    onSuccess: (review) => {
      void queryClient.invalidateQueries({
        queryKey: ["coding", "sessions", review.thread_id, "review"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["coding", "sessions", review.thread_id, "changes"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["projects", review.project_id, "diff"],
      });
    },
  });
}

export function useApplyCodingReviewFix(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CodingReviewApplyFixRequest) =>
      applyCodingReviewFix(request),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: ["coding", "sessions", result.thread_id, "review"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "diff"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "file", result.file],
      });
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "files"],
      });
    },
  });
}

export function useCodingRoiSummary(threadId: string | null | undefined) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["coding", "sessions", threadId, "roi", "summary"],
    queryFn: () => getCodingRoiSummary(threadId!),
    enabled: !!threadId,
  });
  return {
    summary: data?.summary ?? null,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

export function useCodingRoiReports(threadId: string | null | undefined) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["coding", "sessions", threadId, "roi", "reports"],
    queryFn: () => listCodingRoiReports(threadId!),
    enabled: !!threadId,
  });
  return {
    reports: data?.reports ?? [],
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

export function useCodingSkills(projectRoot: string | null | undefined) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["coding", "skills", projectRoot],
    queryFn: () => listCodingSkills(projectRoot),
  });
  return {
    skills: data ?? [],
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

export function useCodingSkillDetail(
  skillId: string | null | undefined,
  projectRoot: string | null | undefined,
) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["coding", "skills", projectRoot, skillId],
    queryFn: () => getCodingSkill(skillId!, projectRoot),
    enabled: !!skillId,
  });
  return {
    detail: data ?? null,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

export function useSetCodingSkillEnabled(
  projectRoot: string | null | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      skillId,
      request,
    }: {
      skillId: string;
      request: SetCodingSkillEnabledRequest;
    }) => setCodingSkillEnabled(skillId, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["coding", "skills", projectRoot],
      });
    },
  });
}

export function useCreateCodingSkill(projectRoot: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CodingSkillWriteRequest & { id: string }) =>
      createCodingSkill(request),
    onSuccess: (detail) => {
      void queryClient.invalidateQueries({
        queryKey: ["coding", "skills", projectRoot],
      });
      void queryClient.invalidateQueries({
        queryKey: ["coding", "skills", projectRoot, detail.skill.id],
      });
    },
  });
}

export function useUpdateCodingSkill(projectRoot: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      skillId,
      request,
    }: {
      skillId: string;
      request: CodingSkillWriteRequest;
    }) => updateCodingSkill(skillId, request),
    onSuccess: (detail) => {
      void queryClient.invalidateQueries({
        queryKey: ["coding", "skills", projectRoot],
      });
      void queryClient.invalidateQueries({
        queryKey: ["coding", "skills", projectRoot, detail.skill.id],
      });
    },
  });
}

export function useDeleteCodingSkill(projectRoot: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (skillId: string) => deleteCodingSkill(skillId, projectRoot),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: ["coding", "skills", projectRoot],
      });
      void queryClient.removeQueries({
        queryKey: ["coding", "skills", projectRoot, result.skill_id],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Delivery stage tracking
// ---------------------------------------------------------------------------

export function useDeliveryStages() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["coding", "delivery-stages"],
    queryFn: () => getDeliveryStages(),
  });
  return {
    stages: data?.stages ?? [],
    isLoading,
    error,
  };
}

export function useProjectStage(projectRoot: string | null | undefined) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["coding", "projects", projectRoot, "stage"],
    queryFn: () => getProjectStage(projectRoot!),
    enabled: !!projectRoot,
  });
  return {
    stage: data ?? null,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

export function useSetProjectStage(projectRoot: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: SetStageRequest) =>
      setProjectStage(projectRoot!, request),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["coding", "projects", projectRoot, "stage"],
      });
      // Also invalidate all coding sessions for this project to refresh
      // the delivery_stage field embedded in session snapshots.
      void queryClient.invalidateQueries({
        queryKey: ["coding", "sessions"],
      });
    },
  });
}

export function useAcceptStageSuggestion(
  projectRoot: string | null | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => acceptStageSuggestion(projectRoot!),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["coding", "projects", projectRoot, "stage"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["coding", "sessions"],
      });
    },
  });
}

export function useDismissStageSuggestion(
  projectRoot: string | null | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => dismissStageSuggestion(projectRoot!),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["coding", "projects", projectRoot, "stage"],
      });
    },
  });
}
