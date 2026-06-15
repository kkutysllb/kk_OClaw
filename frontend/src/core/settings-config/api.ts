import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfigData = Record<string, unknown>;

export interface ConfigSectionResponse {
  section: string;
  data: unknown;
}

export interface FullConfigResponse {
  config: ConfigData;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Load the full config.yaml (with sensitive values masked by the backend).
 */
export async function loadConfig(): Promise<ConfigData> {
  const res = await fetch(`${getBackendBaseURL()}/api/config`);
  if (!res.ok) {
    throw new Error(`Failed to load config (${res.status})`);
  }
  const data = (await res.json()) as Partial<FullConfigResponse>;
  return data.config ?? {};
}

/**
 * Load a single top-level section from config.yaml.
 */
export async function loadConfigSection(
  section: string,
): Promise<unknown> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/config/${encodeURIComponent(section)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to load config section '${section}' (${res.status})`);
  }
  const data = (await res.json()) as Partial<ConfigSectionResponse>;
  return data.data ?? null;
}

/**
 * Replace the entire config.yaml with new data.
 */
export async function saveFullConfig(data: ConfigData): Promise<ConfigData> {
  const res = await fetch(`${getBackendBaseURL()}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: data }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(
      (detail as { detail?: string }).detail ??
        `Failed to save config (${res.status})`,
    );
  }
  const result = (await res.json()) as Partial<FullConfigResponse>;
  return result.config ?? {};
}

/**
 * Trigger a gateway restart so config changes take effect.
 *
 * In packaged desktop mode, the caller should use `restartBackend()` from
 * `@/core/desktop` instead because Electron manages the process lifecycle.
 * Desktop dev uses this API path so the dev launcher can respawn the gateway.
 */
export async function restartGateway(): Promise<void> {
  const res = await fetch(`${getBackendBaseURL()}/api/config/restart`, {
    method: "POST",
  });
  // 502/503/connection-reset is expected: the process is shutting down.
  if (!res.ok && res.status !== 502 && res.status !== 503) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(
      (detail as { detail?: string }).detail ??
        `Failed to restart gateway (${res.status})`,
    );
  }
}

/**
 * Poll the /health endpoint until the gateway is back online.
 *
 * Returns true if healthy within `timeoutMs`, false otherwise.
 */
export async function waitForGateway(
  timeoutMs = 30_000,
  intervalMs = 1_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${getBackendBaseURL()}/health`);
      if (res.ok) return true;
    } catch {
      // Connection refused — process still restarting
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Save a single top-level section to config.yaml.
 */
export async function saveConfigSection(
  section: string,
  data: unknown,
): Promise<unknown> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/config/${encodeURIComponent(section)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    },
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(
      (detail as { detail?: string }).detail ??
        `Failed to save config section '${section}' (${res.status})`,
    );
  }
  const result = (await res.json()) as Partial<ConfigSectionResponse>;
  return result.data ?? null;
}
