/**
 * Skill model credentials `.env` reader/writer.
 *
 * Public skills (image/video/music generation) hardcode environment variable
 * names like `GEMINI_API_KEY` and `MINIMAX_API_KEY`. The desktop shell stores
 * these in `<KKOCLAW_HOME>/.env`; this module parses/serializes that file and
 * applies secret redaction so the renderer never receives raw API keys.
 *
 * Read returns redacted values (UI display); write accepts either plain
 * values or the redaction placeholder (`***`-prefixed) — placeholders are
 * skipped so unchanged secrets are preserved verbatim.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { getSkillModelsEnvPath } from "./paths.js";

// ── Provider / field schema ──────────────────────────────────────────────

export interface SkillModelField {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

export interface SkillModelProvider {
  id: string;
  category: "image" | "av";
  title: string;
  description: string;
  /** Provider-name substrings used for smart-import from dialog models. */
  matchKeywords: string[];
  fields: SkillModelField[];
}

/**
 * Canonical provider definitions. Keep in sync with the skills that consume
 * them (skills/public/{image,video,music}-generation/scripts/generate.py).
 */
export const SKILL_MODEL_PROVIDERS: SkillModelProvider[] = [
  {
    id: "gemini",
    category: "image",
    title: "Gemini / Doubao",
    description: "image-generation 技能优先使用（doubao-seedream 等 OpenAI 兼容接口）",
    matchKeywords: ["gemini", "doubao", "seedream"],
    fields: [
      { key: "GEMINI_API_KEY", label: "API Key", secret: true, placeholder: "sk-..." },
      { key: "GEMINI_BASE_URL", label: "Base URL", secret: false, placeholder: "https://api.vectorengine.ai/v1/images/generations" },
      { key: "GEMINI_MODEL", label: "Model", secret: false, placeholder: "doubao-seedream-5-0-260128" },
    ],
  },
  {
    id: "gpt_image2",
    category: "image",
    title: "GPT-Image2",
    description: "image-generation 技能兜底方案（Gemini 未配置时使用）",
    matchKeywords: ["gpt-image", "gpt_image", "image2"],
    fields: [
      { key: "GPT_IMAGE2_API_KEY", label: "API Key", secret: true, placeholder: "sk-..." },
      { key: "GPT_IMAGE2_BASE_URL", label: "Base URL", secret: false, placeholder: "https://api.vectorengine.ai/v1/images/generations" },
      { key: "GPT_IMAGE2_MODEL", label: "Model", secret: false, placeholder: "gpt-image-2" },
    ],
  },
  {
    id: "minimax",
    category: "av",
    title: "MiniMax",
    description: "video-generation 的 TTS 配音 / 背景音乐，以及 music-generation 技能使用（Speech / Music API）",
    matchKeywords: ["minimax", "hailuo"],
    fields: [
      { key: "MINIMAX_API_KEY", label: "API Key", secret: true, placeholder: "sk-..." },
      { key: "MINIMAX_BASE_URL", label: "Base URL", secret: false, placeholder: "https://api.minimaxi.com/v1" },
    ],
  },
  {
    id: "kling",
    category: "av",
    title: "可灵 Kling",
    description: "video-generation 技能优先使用（文生视频 / 图生视频）。支持官方 JWT 与中转 Bearer 两种鉴权，二选一",
    matchKeywords: ["kling", "可灵"],
    fields: [
      // 官方 JWT 模式（与 Secret Key 配对使用）
      { key: "KLING_ACCESS_KEY", label: "Access Key（官方 JWT 模式）", secret: true, placeholder: "快手机密管理获取的 Access Key" },
      { key: "KLING_SECRET_KEY", label: "Secret Key（官方 JWT 模式）", secret: true, placeholder: "与 Access Key 配对的 Secret Key" },
      // 中转 Bearer 模式（Ace Data Cloud、阿里云百炼等聚合平台）
      { key: "KLING_API_KEY", label: "API Key（中转 Bearer 模式）", secret: true, placeholder: "中转平台的 API Token" },
      { key: "KLING_BASE_URL", label: "Base URL", secret: false, placeholder: "https://api-beijing.klingai.com" },
      { key: "KLING_MODEL", label: "Model", secret: false, placeholder: "kling-v2-6" },
    ],
  },
  {
    id: "gemini_video",
    category: "av",
    title: "Gemini Veo",
    description: "video-generation 技能备选方案（可灵未配置或失败时降级）。使用 predictLongRunning 异步接口",
    matchKeywords: ["veo", "gemini-video"],
    fields: [
      // 视频专用 key；未设置时 provider 会 fallback 到共享的 GEMINI_API_KEY
      { key: "GEMINI_VIDEO_API_KEY", label: "API Key（可选，缺省时复用上方 Gemini 的 GEMINI_API_KEY）", secret: true, placeholder: "sk-..." },
      // 视频专用 base URL，必须指向根域名（与图片生成的 GEMINI_BASE_URL 隔离）
      { key: "GEMINI_VIDEO_BASE_URL", label: "Base URL（视频专用，不可用图片端点）", secret: false, placeholder: "https://generativelanguage.googleapis.com" },
      { key: "GEMINI_VIDEO_MODEL", label: "Model（标准档）", secret: false, placeholder: "veo-3.1-generate-001" },
      { key: "GEMINI_VIDEO_FAST_MODEL", label: "Model（快速档，--fast 时使用）", secret: false, placeholder: "veo-3.1-fast-generate-001" },
    ],
  },
];

/** Every env var known to the skill model providers (for quick lookup). */
const KNOWN_SECRET_KEYS = new Set(
  SKILL_MODEL_PROVIDERS.flatMap((p) => p.fields).filter((f) => f.secret).map((f) => f.key),
);

// ── Public data shapes (mirrored by frontend desktop/types.ts) ───────────

export interface SkillModelVar {
  key: string;
  /** Redacted value for UI display. Secrets show `***` + last 4 chars. */
  value: string;
  configured: boolean;
  isSecret: boolean;
}

export interface SkillModelsConfig {
  providers: SkillModelProvider[];
  vars: SkillModelVar[];
  filePath: string;
}

// ── .env parsing / serialization ────────────────────────────────────────

/** Sentinel prefix marking a redacted value sent back from the renderer. */
const REDACTION_PREFIX = "***";

/**
 * Parse a `.env` file into a key→value map.
 *
 * Minimal parser: supports `KEY=value`, `KEY="value"`, comments (`#`), and
 * blank lines. Quoted values have their surrounding quotes stripped. Lines
 * without `=` are ignored.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    // Strip matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Serialize a key→value map back to `.env` text, preserving a header comment
 * block and grouping variables under provider sections when known.
 */
export function serializeEnvFile(vars: Record<string, string>): string {
  const lines: string[] = [
    "# =============================================================================",
    "# OClaw Desktop — Skill Model Credentials",
    "# =============================================================================",
    "# Provider credentials for public skills (image / video / music generation).",
    "# The gateway reads this file on launch and injects every variable into its",
    "# child-process environment so skill scripts inherit them via os.environ.",
    "#",
    "# Edit via Settings → Skill Models (recommended) or this file directly.",
    "# After changes, restart the backend (tray → Restart Backend).",
    "",
  ];

  for (const provider of SKILL_MODEL_PROVIDERS) {
    lines.push(`# ── ${provider.title} ──`);
    lines.push(`# ${provider.description}`);
    for (const field of provider.fields) {
      const value = vars[field.key] ?? "";
      lines.push(`${field.key}=${value}`);
    }
    lines.push("");
  }

  // Preserve any unknown keys verbatim (forward-compat for future skills).
  const knownKeys = new Set(SKILL_MODEL_PROVIDERS.flatMap((p) => p.fields.map((f) => f.key)));
  const extras = Object.entries(vars).filter(([k]) => !knownKeys.has(k));
  if (extras.length > 0) {
    lines.push("# ── Additional variables ──");
    for (const [k, v] of extras) {
      lines.push(`${k}=${v}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Redaction ───────────────────────────────────────────────────────────

function redactValue(key: string, value: string): string {
  if (!value) return "";
  if (!KNOWN_SECRET_KEYS.has(key)) return value;
  if (value.length <= 4) return REDACTION_PREFIX;
  return `${REDACTION_PREFIX}${value.slice(-4)}`;
}

/** True when a value coming back from the renderer is an unchanged redaction. */
export function isRedactedPlaceholder(value: string): boolean {
  return value.startsWith(REDACTION_PREFIX);
}

// ── High-level read / write ─────────────────────────────────────────────

/** Read & redact the skill models `.env`. Creates an empty file if absent. */
export function readSkillModelsEnv(): SkillModelsConfig {
  const filePath = getSkillModelsEnvPath();
  let raw = "";
  if (existsSync(filePath)) {
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      raw = "";
    }
  }
  const parsed = parseEnvFile(raw);

  const vars: SkillModelVar[] = SKILL_MODEL_PROVIDERS.flatMap((p) => p.fields).map((field) => {
    const value = parsed[field.key] ?? "";
    return {
      key: field.key,
      value: redactValue(field.key, value),
      configured: value.length > 0,
      isSecret: field.secret,
    };
  });

  return { providers: SKILL_MODEL_PROVIDERS, vars, filePath };
}

/**
 * Merge updates into the `.env`, preserving existing values for any secret
 * field whose incoming value is a redaction placeholder (i.e. unchanged).
 *
 * Returns the full redacted snapshot after writing.
 */
export function writeSkillModelsEnv(updates: Record<string, string>): SkillModelsConfig {
  const filePath = getSkillModelsEnvPath();
  const existing = existsSync(filePath)
    ? parseEnvFile(readFileSync(filePath, "utf8"))
    : {};

  const merged: Record<string, string> = { ...existing };
  for (const [key, incoming] of Object.entries(updates)) {
    if (KNOWN_SECRET_KEYS.has(key) && isRedactedPlaceholder(incoming)) {
      // Unchanged secret — keep the stored value.
      continue;
    }
    if (incoming === "") {
      // Empty value clears the key but we keep the entry (explicit blank).
      merged[key] = "";
    } else {
      merged[key] = incoming;
    }
  }

  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, serializeEnvFile(merged), "utf8");
  } catch (e) {
    throw new Error(
      `Failed to write skill models .env: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return readSkillModelsEnv();
}

/**
 * Initialize an empty `.env` on first run so the file exists and the user can
 * discover/edit it manually. No-op if the file already exists.
 */
export function initSkillModelsEnv(): void {
  const filePath = getSkillModelsEnvPath();
  if (existsSync(filePath)) return;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, serializeEnvFile({}), "utf8");
  } catch {
    // Non-fatal — the file is created lazily on first write.
  }
}
