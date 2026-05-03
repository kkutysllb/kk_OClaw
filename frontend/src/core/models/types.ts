export interface Model {
  id: string;
  name: string;
  use: string;
  model: string;
  display_name: string;
  description?: string | null;
  api_key?: string | null;
  base_url?: string | null;
  max_tokens?: number | null;
  temperature?: number | null;
  request_timeout?: number | null;
  supports_thinking?: boolean;
  supports_vision?: boolean;
  supports_reasoning_effort?: boolean;
  when_thinking_enabled?: Record<string, unknown> | null;
  when_thinking_disabled?: Record<string, unknown> | null;
}

export interface ModelRequest {
  name: string;
  display_name?: string | null;
  use: string;
  model: string;
  api_key?: string | null;
  base_url?: string | null;
  max_tokens?: number | null;
  temperature?: number | null;
  request_timeout?: number | null;
  description?: string | null;
  supports_thinking?: boolean;
  supports_vision?: boolean;
  supports_reasoning_effort?: boolean;
  when_thinking_enabled?: Record<string, unknown> | null;
  when_thinking_disabled?: Record<string, unknown> | null;
}

export interface TokenUsageSettings {
  enabled: boolean;
}

export interface ModelsResponse {
  models: Model[];
  token_usage: TokenUsageSettings;
}
