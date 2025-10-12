// InfraNodus MCP client - topic gaps and research-question generation
// We use InfraNodus for topic gaps and research-question generation

import { safeFetch } from "../security/safeFetch";
import { assertUrlAllowed } from "../security/urlGuard";

const ALLOW_INFRA = (process.env.ALLOW_HOSTS_INFRANODUS ?? "api.infranodus.com")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function callInfra<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.INFRANODUS_BASE_URL ?? "https://api.infranodus.com";
  const url = joinUrl(base, path);

  await assertUrlAllowed(url, { allowHosts: ALLOW_INFRA });
  const response = await safeFetch(url, {
    ...init,
    allowHosts: ALLOW_INFRA,
    timeoutMs: 10_000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.INFRANODUS_API_KEY ?? ""}`,
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`InfraNodus ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data as T;
}

export async function topicOverview(text: string): Promise<{ topics: Array<{ name: string; weight: number }> }> {
  const result = await callInfra<{ topics: Array<{ name: string; weight: number }> }>("/v1/topic-overview", {
    method: "POST",
    body: JSON.stringify({ text })
  });
  return result;
}

export async function contentGaps(params: {
  text?: string;
  graphId?: string;
}): Promise<{ gaps: Array<{ from: string; to: string; strength: number }> }> {
  const result = await callInfra<{ gaps: Array<{ from: string; to: string; strength: number }> }>("/v1/content-gaps", {
    method: "POST",
    body: JSON.stringify(params)
  });
  return result;
}

export async function generateQuestions(params: {
  text?: string;
  graphId?: string;
}): Promise<{ questions: string[] }> {
  const result = await callInfra<{ questions: string[] }>("/v1/generate-questions", {
    method: "POST",
    body: JSON.stringify(params)
  });
  return result;
}

export async function saveGraph(params: {
  name: string;
  text: string;
}): Promise<{ graphId: string }> {
  const result = await callInfra<{ graphId: string }>("/v1/save-graph", {
    method: "POST",
    body: JSON.stringify(params)
  });
  return result;
}
