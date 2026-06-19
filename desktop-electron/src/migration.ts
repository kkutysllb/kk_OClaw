/**
 * Web-to-desktop data migration core.
 *
 * The web deployment uses a **scattered layout**: data is spread across the
 * project repository rather than living under a single home folder.
 *
 * Web-side source paths (relative to the project repo root):
 * - skills:        <repo>/skills/custom/
 * - credentials:   <repo>/.env
 * - extensions:    <repo>/extensions_config.json
 * - memory:        <repo>/backend/.kkoclaw/memory.json
 * - agents:        <repo>/backend/.kkoclaw/agents/
 *
 * The desktop home (`~/.kkoclaw-desktop`) uses a flat layout where all
 * categories live directly under the home directory.
 *
 * Merge strategies per category:
 * - skills:   skip existing (desktop user edits win)
 * - agents:   skip existing
 * - memory:   copy only if target absent
 * - extensions: JSON shallow-merge (union of keys, source wins on conflict
 *   for boolean `enabled` to avoid silently disabling something the user
 *   explicitly turned on in the web deployment)
 * - credentials: dotenv union (source keys are appended when missing)
 */

import { existsSync } from "node:fs";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

// ── Public types ──────────────────────────────────────────────────────────

export type MigrationCategory =
  | "skills"
  | "extensions"
  | "credentials"
  | "memory"
  | "agents";

export interface MigrationOptions {
  skills: boolean;
  extensions: boolean;
  credentials: boolean;
  memory: boolean;
  agents: boolean;
}

export interface MigrationSourceCategory {
  available: boolean;
  count: number;
  description: string;
  paths: string[];
}

export interface MigrationScanResult {
  sourceRepoRoot: string;
  categories: {
    skills: MigrationSourceCategory;
    extensions: MigrationSourceCategory;
    credentials: MigrationSourceCategory;
    memory: MigrationSourceCategory;
    agents: MigrationSourceCategory;
  };
}

export interface MigrationCategoryResult {
  category: MigrationCategory;
  copied: number;
  skipped: number;
  merged: number;
  error?: string;
}

export interface MigrationResult {
  success: boolean;
  results: MigrationCategoryResult[];
  targetHome: string;
}

export interface DetectedSource {
  path: string;
  label: string;
  exists: boolean;
  hasData: boolean;
}

// ── Internal helpers ──────────────────────────────────────────────────────

function listSubdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => !name.startsWith("."))
      .map((name) => join(dir, name))
      .filter((p) => statSync(p).isDirectory());
  } catch {
    return [];
  }
}

function safeReadJson<T = unknown>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

/**
 * Parse a dotenv file into an ordered map. Reuses a minimal parser that
 * handles `KEY=value`, comments and quoted values — enough for the typical
 * skill-credentials `.env` files.
 */
function parseDotenv(file: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(file)) return out;
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out.set(key, value);
  }
  return out;
}

function serializeDotenv(entries: Array<[string, string]>): string {
  return entries.map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

// ── Source detection ──────────────────────────────────────────────────────

/**
 * Web-side scattered-layout path resolvers.
 *
 * Given a web project repo root, these return the canonical paths for each
 * data category. They are also used by `detectMigrationSources` to decide
 * whether the repo has any migratable data at all.
 */
export function getWebSkillsPath(repoRoot: string): string {
  return join(repoRoot, "skills", "custom");
}
export function getWebCredentialsPath(repoRoot: string): string {
  return join(repoRoot, ".env");
}
export function getWebExtensionsPath(repoRoot: string): string {
  return join(repoRoot, "extensions_config.json");
}
export function getWebMemoryPath(repoRoot: string): string {
  return join(repoRoot, "backend", ".kkoclaw", "memory.json");
}
export function getWebAgentsPath(repoRoot: string): string {
  return join(repoRoot, "backend", ".kkoclaw", "agents");
}

/**
 * Detect candidate web-deployment repo roots.
 *
 * The web app stores everything inside the project repository, so the
 * "source" is the repo root itself, not a user home folder. We check for
 * marker files/dirs (`skills/custom`, `.env`, `extensions_config.json`,
 * `backend/.kkoclaw/memory.json`) to decide whether a given directory is a
 * real web deployment worth importing from.
 */
export function detectMigrationSources(repoRoot?: string): DetectedSource[] {
  const candidates: Array<{ path: string; label: string }> = [];
  if (repoRoot) {
    candidates.push({
      path: repoRoot,
      label: `Web 端项目目录 (${repoRoot})`,
    });
  }
  // Deduplicate by path.
  const seen = new Set<string>();
  return candidates
    .filter((c) => {
      if (seen.has(c.path)) return false;
      seen.add(c.path);
      return true;
    })
    .map((c) => {
      const exists = existsSync(c.path);
      const hasData =
        exists &&
        (existsSync(getWebSkillsPath(c.path)) ||
          existsSync(getWebCredentialsPath(c.path)) ||
          existsSync(getWebExtensionsPath(c.path)) ||
          existsSync(getWebMemoryPath(c.path)) ||
          existsSync(getWebAgentsPath(c.path)));
      return { ...c, exists, hasData };
    });
}

// ── Scan ──────────────────────────────────────────────────────────────────

/**
 * Scan a web-deployment repo root and report what data is available.
 *
 * The parameter is the web project root (NOT a user home). Data is read
 * from the scattered web-side layout (skills/custom, .env, backend/.kkoclaw, …).
 */
export function scanMigrationSources(
  sourceRepoRoot: string,
): MigrationScanResult {
  const resolved = resolve(sourceRepoRoot);

  // Skills: <repo>/skills/custom/
  const skillsDir = getWebSkillsPath(resolved);
  const skillsPaths = listSubdirs(skillsDir);
  const skills: MigrationSourceCategory = {
    available: skillsPaths.length > 0,
    count: skillsPaths.length,
    description:
      skillsPaths.length > 0
        ? `${skillsPaths.length} 个自定义技能`
        : "未检测到自定义技能",
    paths: skillsPaths,
  };

  // Extensions: <repo>/extensions_config.json
  const extFile = getWebExtensionsPath(resolved);
  const extData = safeReadJson<{
    mcpServers?: Record<string, unknown>;
    skills?: Record<string, unknown>;
  }>(extFile);
  const extCount =
    (extData?.mcpServers ? Object.keys(extData.mcpServers).length : 0) +
    (extData?.skills ? Object.keys(extData.skills).length : 0);
  const extensions: MigrationSourceCategory = {
    available: extData !== null && extCount > 0,
    count: extCount,
    description:
      extCount > 0
        ? `${extCount} 个扩展配置（MCP 服务器 + 技能开关）`
        : "未检测到扩展配置",
    paths: extData ? [extFile] : [],
  };

  // Credentials: <repo>/.env
  const envFile = getWebCredentialsPath(resolved);
  const envVars = parseDotenv(envFile);
  const credentials: MigrationSourceCategory = {
    available: envVars.size > 0,
    count: envVars.size,
    description:
      envVars.size > 0
        ? `${envVars.size} 个环境变量凭证`
        : "未检测到技能凭证",
    paths: envVars.size > 0 ? [envFile] : [],
  };

  // Memory: <repo>/backend/.kkoclaw/memory.json
  const memoryFile = getWebMemoryPath(resolved);
  const memoryData = safeReadJson(memoryFile);
  const memory: MigrationSourceCategory = {
    available: memoryData !== null,
    count: memoryData ? 1 : 0,
    description: memoryData ? "1 个记忆文件" : "未检测到记忆数据",
    paths: memoryData ? [memoryFile] : [],
  };

  // Agents: <repo>/backend/.kkoclaw/agents/
  const agentsDir = getWebAgentsPath(resolved);
  const agentPaths = listSubdirs(agentsDir);
  const agents: MigrationSourceCategory = {
    available: agentPaths.length > 0,
    count: agentPaths.length,
    description:
      agentPaths.length > 0
        ? `${agentPaths.length} 个自定义 agent`
        : "未检测到自定义 agent",
    paths: agentPaths,
  };

  return {
    sourceRepoRoot: resolved,
    categories: { skills, extensions, credentials, memory, agents },
  };
}

// ── Execute ───────────────────────────────────────────────────────────────

type ProgressFn = (
  category: MigrationCategory,
  done: number,
  total: number,
) => void;

function migrateSkills(
  sourceRepoRoot: string,
  targetHome: string,
  onProgress?: ProgressFn,
): MigrationCategoryResult {
  // Web source: <repo>/skills/custom/  →  Desktop target: <home>/skills/custom/
  const srcDir = getWebSkillsPath(sourceRepoRoot);
  const dstDir = join(targetHome, "skills", "custom");
  if (!existsSync(srcDir)) {
    return {
      category: "skills",
      copied: 0,
      skipped: 0,
      merged: 0,
    };
  }
  mkdirSync(dstDir, { recursive: true });
  const items = listSubdirs(srcDir);
  let copied = 0;
  let skipped = 0;
  items.forEach((src, i) => {
    const name = src.split("/").pop()!;
    const dst = join(dstDir, name);
    if (existsSync(dst)) {
      skipped++;
    } else {
      cpSync(src, dst, { recursive: true });
      copied++;
    }
    onProgress?.("skills", i + 1, items.length);
  });
  return { category: "skills", copied, skipped, merged: 0 };
}

function migrateAgents(
  sourceRepoRoot: string,
  targetHome: string,
  onProgress?: ProgressFn,
): MigrationCategoryResult {
  // Web source: <repo>/backend/.kkoclaw/agents/  →  Desktop target: <home>/agents/
  const srcDir = getWebAgentsPath(sourceRepoRoot);
  const dstDir = join(targetHome, "agents");
  if (!existsSync(srcDir)) {
    return { category: "agents", copied: 0, skipped: 0, merged: 0 };
  }
  mkdirSync(dstDir, { recursive: true });
  const items = listSubdirs(srcDir);
  let copied = 0;
  let skipped = 0;
  items.forEach((src, i) => {
    const name = src.split("/").pop()!;
    const dst = join(dstDir, name);
    if (existsSync(dst)) {
      skipped++;
    } else {
      cpSync(src, dst, { recursive: true });
      copied++;
    }
    onProgress?.("agents", i + 1, items.length);
  });
  return { category: "agents", copied, skipped, merged: 0 };
}

function migrateMemory(
  sourceRepoRoot: string,
  targetHome: string,
): MigrationCategoryResult {
  // Web source: <repo>/backend/.kkoclaw/memory.json  →  Desktop target: <home>/memory.json
  const src = getWebMemoryPath(sourceRepoRoot);
  const dst = join(targetHome, "memory.json");
  if (!existsSync(src)) {
    return { category: "memory", copied: 0, skipped: 0, merged: 0 };
  }
  mkdirSync(targetHome, { recursive: true });
  if (existsSync(dst)) {
    return { category: "memory", copied: 0, skipped: 1, merged: 0 };
  }
  cpSync(src, dst);
  return { category: "memory", copied: 1, skipped: 0, merged: 0 };
}

function migrateExtensions(
  sourceRepoRoot: string,
  targetHome: string,
): MigrationCategoryResult {
  // Web source: <repo>/extensions_config.json  →  Desktop target: <home>/extensions_config.json
  const srcFile = getWebExtensionsPath(sourceRepoRoot);
  const dstFile = join(targetHome, "extensions_config.json");
  const src = safeReadJson<{
    mcpServers?: Record<string, unknown>;
    skills?: Record<string, unknown>;
  }>(srcFile);
  if (!src) {
    return { category: "extensions", copied: 0, skipped: 0, merged: 0 };
  }
  mkdirSync(targetHome, { recursive: true });
  const dst = safeReadJson<{
    mcpServers?: Record<string, unknown>;
    skills?: Record<string, unknown>;
  }>(dstFile) ?? { mcpServers: {}, skills: {} };

  // Shallow union: source entries win on key conflict so the user's explicit
  // web-deployment choice is preserved.
  const mergedMcp = { ...(dst.mcpServers ?? {}), ...(src.mcpServers ?? {}) };
  const mergedSkills = { ...(dst.skills ?? {}), ...(src.skills ?? {}) };
  const merged = {
    ...dst,
    mcpServers: mergedMcp,
    skills: mergedSkills,
  };
  writeFileSync(dstFile, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  const mergedCount =
    Object.keys(src.mcpServers ?? {}).length +
    Object.keys(src.skills ?? {}).length;
  return {
    category: "extensions",
    copied: 0,
    skipped: 0,
    merged: mergedCount,
  };
}

function migrateCredentials(
  sourceRepoRoot: string,
  targetHome: string,
): MigrationCategoryResult {
  // Web source: <repo>/.env  →  Desktop target: <home>/.env
  const srcFile = getWebCredentialsPath(sourceRepoRoot);
  const dstFile = join(targetHome, ".env");
  const srcEnv = parseDotenv(srcFile);
  if (srcEnv.size === 0) {
    return { category: "credentials", copied: 0, skipped: 0, merged: 0 };
  }
  mkdirSync(targetHome, { recursive: true });
  const dstEnv = parseDotenv(dstFile);
  let appended = 0;
  const merged = new Map(dstEnv);
  for (const [k, v] of srcEnv) {
    if (!merged.has(k)) {
      merged.set(k, v);
      appended++;
    }
  }
  writeFileSync(dstFile, serializeDotenv([...merged.entries()]), "utf-8");
  return {
    category: "credentials",
    copied: 0,
    skipped: 0,
    merged: appended,
  };
}

export async function executeMigration(
  sourceRepoRoot: string,
  targetHome: string,
  options: MigrationOptions,
  onProgress?: ProgressFn,
): Promise<MigrationResult> {
  const results: MigrationCategoryResult[] = [];
  let success = true;

  // Ensure target exists up front so individual category functions can assume it.
  try {
    mkdirSync(targetHome, { recursive: true });
  } catch (e) {
    return {
      success: false,
      targetHome,
      results: [
        {
          category: "skills",
          copied: 0,
          skipped: 0,
          merged: 0,
          error: e instanceof Error ? e.message : String(e),
        },
      ],
    };
  }

  if (options.skills) {
    try {
      results.push(migrateSkills(sourceRepoRoot, targetHome, onProgress));
    } catch (e) {
      success = false;
      results.push({
        category: "skills",
        copied: 0,
        skipped: 0,
        merged: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (options.agents) {
    try {
      results.push(migrateAgents(sourceRepoRoot, targetHome, onProgress));
    } catch (e) {
      success = false;
      results.push({
        category: "agents",
        copied: 0,
        skipped: 0,
        merged: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (options.memory) {
    try {
      results.push(migrateMemory(sourceRepoRoot, targetHome));
      onProgress?.("memory", 1, 1);
    } catch (e) {
      success = false;
      results.push({
        category: "memory",
        copied: 0,
        skipped: 0,
        merged: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (options.extensions) {
    try {
      results.push(migrateExtensions(sourceRepoRoot, targetHome));
      onProgress?.("extensions", 1, 1);
    } catch (e) {
      success = false;
      results.push({
        category: "extensions",
        copied: 0,
        skipped: 0,
        merged: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (options.credentials) {
    try {
      results.push(migrateCredentials(sourceRepoRoot, targetHome));
      onProgress?.("credentials", 1, 1);
    } catch (e) {
      success = false;
      results.push({
        category: "credentials",
        copied: 0,
        skipped: 0,
        merged: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { success, results, targetHome };
}
