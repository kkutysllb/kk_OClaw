import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

import type { MCPServerConfig, MCPConfig } from "./types";

export async function loadMCPConfig(): Promise<MCPConfig> {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/config`);
  return response.json() as Promise<MCPConfig>;
}

export async function updateMCPConfig(config: MCPConfig) {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      (detail as { detail?: string }).detail ??
        `Failed to update MCP config (${response.status})`,
    );
  }
  return response.json() as Promise<MCPConfig>;
}

export async function addMCPServer(
  name: string,
  serverConfig: MCPServerConfig,
): Promise<MCPConfig> {
  const current = await loadMCPConfig();
  const updated: MCPConfig = {
    mcp_servers: {
      ...current.mcp_servers,
      [name]: serverConfig,
    },
  };
  return updateMCPConfig(updated);
}

export async function deleteMCPServer(name: string): Promise<MCPConfig> {
  const current = await loadMCPConfig();
  const servers = { ...current.mcp_servers };
  delete servers[name];
  const updated: MCPConfig = { mcp_servers: servers };
  return updateMCPConfig(updated);
}
