import { getBackendBaseURL } from "../config";
import { fetch } from "../api/fetcher";

import type { Model, ModelRequest, ModelsResponse } from "./types";

export async function loadModels(): Promise<ModelsResponse> {
  const res = await fetch(`${getBackendBaseURL()}/api/models`);
  const data = (await res.json()) as Partial<ModelsResponse>;
  return {
    models: data.models ?? [],
    token_usage: data.token_usage ?? { enabled: false },
  };
}

export async function createModel(req: ModelRequest): Promise<Model> {
  const res = await fetch(`${getBackendBaseURL()}/api/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { detail?: string }).detail ?? `Failed to create model (${res.status})`);
  }
  return (await res.json()) as Model;
}

export async function updateModel(name: string, req: ModelRequest): Promise<Model> {
  const res = await fetch(`${getBackendBaseURL()}/api/models/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { detail?: string }).detail ?? `Failed to update model (${res.status})`);
  }
  return (await res.json()) as Model;
}

export async function deleteModel(name: string): Promise<void> {
  const res = await fetch(`${getBackendBaseURL()}/api/models/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { detail?: string }).detail ?? `Failed to delete model (${res.status})`);
  }
}
