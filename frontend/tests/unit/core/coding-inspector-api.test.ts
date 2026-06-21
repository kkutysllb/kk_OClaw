import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const repoRoot = resolve(__dirname, "../../..");

describe("coding inspector API", () => {
  test("projects core exposes qiongqi events, roi, and coding skills APIs", () => {
    const api = readFileSync(
      resolve(repoRoot, "src/core/projects/api.ts"),
      "utf8",
    );
    const hooks = readFileSync(
      resolve(repoRoot, "src/core/projects/hooks.ts"),
      "utf8",
    );
    const types = readFileSync(
      resolve(repoRoot, "src/core/projects/types.ts"),
      "utf8",
    );

    expect(types).toContain("export interface QiongqiEvent");
    expect(types).toContain("export interface QiongqiSessionSnapshot");
    expect(types).toContain("export interface QiongqiChange");
    expect(types).toContain("export interface CodingReview");
    expect(types).toContain("export interface CodingReviewFinding");
    expect(types).toContain("export interface CodingReviewApplyFixRequest");
    expect(types).toContain('"project_diff" | "task_changes" | "all" | "pr"');
    expect(types).toContain("export interface QiongqiRoiSummary");
    expect(types).toContain("export interface QiongqiRoiDerived");
    expect(types).toContain("estimated_saved_tokens");
    expect(types).toContain("saving_ratio");
    expect(types).toContain("export interface CodingSkill");
    expect(types).toContain("export interface SetCodingSkillEnabledRequest");
    expect(types).toContain("export interface CodingSkillWriteRequest");
    expect(types).toContain("export interface CodingSkillDeleteResult");
    expect(api).toContain("export async function getCodingSession");
    expect(api).toContain("/api/coding/sessions/${encodeURIComponent(threadId)}");
    expect(api).toContain("export async function listCodingSessionEvents");
    expect(api).toContain("/api/coding/sessions/");
    expect(api).toContain("/events?limit=100");
    expect(api).toContain("export async function listCodingSessionChanges");
    expect(api).toContain("/changes");
    expect(api).toContain("export async function runCodingReview");
    expect(api).toContain("/api/coding/reviews");
    expect(api).toContain("export async function getLatestCodingReview");
    expect(api).toContain("/review");
    expect(api).toContain("export async function applyCodingReviewFix");
    expect(api).toContain("/api/coding/reviews/fixes/apply");
    expect(api).toContain("export async function getCodingRoiSummary");
    expect(api).toContain("/roi/summary");
    expect(api).toContain("Promise<QiongqiRoiSummary>");
    expect(api).toContain("export async function listCodingSkills");
    expect(api).toContain("/api/coding/skills");
    expect(api).toContain("encodeURIComponent(projectRoot)");
    expect(api).not.toContain(
      "new URL(`${getBackendBaseURL()}/api/coding/skills`)",
    );
    expect(api).toContain("export async function getCodingSkill");
    expect(api).toContain("Failed to load coding skill");
    expect(api).toContain("export async function createCodingSkill");
    expect(api).toContain('method: "POST"');
    expect(api).toContain("export async function updateCodingSkill");
    expect(api).toContain("export async function deleteCodingSkill");
    expect(api).toContain('method: "DELETE"');
    expect(api).toContain("export async function setCodingSkillEnabled");
    expect(api).toContain("/enabled");
    expect(api).toContain('method: "PUT"');
    expect(hooks).toContain("export function useCodingSession");
    expect(hooks).toContain("export function useCodingSessionEvents");
    expect(hooks).toContain("export function useCodingSessionChanges");
    expect(hooks).toContain("export function useLatestCodingReview");
    expect(hooks).toContain("export function useRunCodingReview");
    expect(hooks).toContain("export function useApplyCodingReviewFix");
    expect(hooks).toContain("export function useCodingRoiSummary");
    expect(hooks).toContain("export function useCodingSkills");
    expect(hooks).toContain("export function useCodingSkillDetail");
    expect(hooks).toContain("export function useSetCodingSkillEnabled");
    expect(hooks).toContain("export function useCreateCodingSkill");
    expect(hooks).toContain("export function useUpdateCodingSkill");
    expect(hooks).toContain("export function useDeleteCodingSkill");
    expect(hooks).toContain(
      'queryKey: ["coding", "sessions", threadId, "session"]',
    );
    expect(hooks).toContain(
      'queryKey: ["coding", "sessions", threadId, "events"]',
    );
    expect(hooks).toContain(
      'queryKey: ["coding", "sessions", threadId, "changes"]',
    );
    expect(hooks).toContain(
      'queryKey: ["coding", "sessions", threadId, "review"]',
    );
    expect(hooks).toContain("runCodingReview(request)");
    expect(hooks).toContain("applyCodingReviewFix(request)");
    expect(hooks).toContain('queryKey: ["projects", projectId, "file", result.file]');
    expect(hooks).toContain(
      'queryKey: ["coding", "sessions", threadId, "roi", "summary"]',
    );
    expect(hooks).toContain('queryKey: ["coding", "skills", projectRoot]');
    expect(hooks).toContain(
      'queryKey: ["coding", "skills", projectRoot, skillId]',
    );
    expect(hooks).toContain("setCodingSkillEnabled(skillId, request)");
    expect(hooks).toContain("createCodingSkill(request)");
    expect(hooks).toContain("updateCodingSkill(skillId, request)");
    expect(hooks).toContain("deleteCodingSkill(skillId, projectRoot)");
  });
});
