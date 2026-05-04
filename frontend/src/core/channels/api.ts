import { getBackendBaseURL } from "@/core/config";
import { fetch } from "@/core/api/fetcher";

export interface ChannelConfigItem {
  enabled: boolean;
  credential_keys: string[];
  configured: boolean;
  display_name: string;
  display_name_zh: string;
  supports_streaming: boolean;
}

export interface ChannelsConfigResponse {
  channels: Record<string, ChannelConfigItem>;
}

export interface ChannelRestartResponse {
  success: boolean;
  message: string;
}

export async function fetchChannelConfigs(): Promise<ChannelsConfigResponse> {
  const res = await fetch(`${getBackendBaseURL()}/api/channels/config`);
  const data = (await res.json()) as Partial<ChannelsConfigResponse>;
  return {
    channels: data.channels ?? {},
  };
}

export async function updateChannelConfig(
  name: string,
  enabled: boolean,
  config: Record<string, string>,
): Promise<ChannelsConfigResponse> {
  const res = await fetch(`${getBackendBaseURL()}/api/channels/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, enabled, config }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(
      (detail as { detail?: string }).detail ??
        `Failed to update channel config (${res.status})`,
    );
  }
  return (await res.json()) as ChannelsConfigResponse;
}

export async function restartChannel(
  name: string,
): Promise<ChannelRestartResponse> {
  const res = await fetch(
    `${getBackendBaseURL()}/api/channels/${encodeURIComponent(name)}/restart`,
    {
      method: "POST",
    },
  );
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(
      (detail as { detail?: string }).detail ??
        `Failed to restart channel (${res.status})`,
    );
  }
  return (await res.json()) as ChannelRestartResponse;
}
