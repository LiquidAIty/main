import type { AgentCardRuntimeOptions, CardRuntime } from '../../types/agentgraph';

export type NativeHermesMcpServerView = {
  name: string;
  transport: string;
  enabled: boolean;
  auth: string | null;
  credentialStatus: 'not_required' | 'not_configured' | 'configured';
  toolFilter: string[];
};

export type NativeHermesCardView = {
  native: {
    name: string;
    description: string;
    soul: string;
    model: { provider: string; default: string };
    skills: Array<{ name: string; enabled: boolean }>;
    toolsets: Array<{ name: string; label?: string; enabled: boolean; tool_count?: number }>;
    toolsetsPinned: boolean;
    mcpServers: NativeHermesMcpServerView[];
  };
  fingerprint: string;
  drift: { status: 'in_sync' | 'drifted'; fields: string[] };
  unsupported: Array<{ field: string; values: string[]; reason: string }>;
  intent: {
    profile: string;
    mode: 'main' | 'delegate' | 'kanban';
    workspace: string | null;
    cardGrants: string[];
    nativeTools: string[];
  };
  mutated?: boolean;
};

export type HermesCardDraft = {
  role: string;
  prompt: string;
  runtime: Extract<CardRuntime, { kind: 'hermes' }>;
  runtimeOptions: AgentCardRuntimeOptions;
};

async function responseJson(response: Response): Promise<Record<string, any>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(String(body?.error || `hermes_native_request_failed:${response.status}`));
  }
  return body;
}

export async function loadNativeHermesCard(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  signal?: AbortSignal;
}): Promise<NativeHermesCardView> {
  const query = new URLSearchParams({ projectId: input.projectId, deckId: input.deckId });
  const response = await fetch(
    `/api/hermes-profile/cards/${encodeURIComponent(input.cardId)}?${query.toString()}`,
    { signal: input.signal },
  );
  return responseJson(response) as Promise<NativeHermesCardView>;
}

export async function applyNativeHermesCard(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  expectedFingerprint: string;
  draft: HermesCardDraft;
}): Promise<NativeHermesCardView> {
  const response = await fetch(
    `/api/hermes-profile/cards/${encodeURIComponent(input.cardId)}/apply`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: input.projectId,
        deckId: input.deckId,
        expectedFingerprint: input.expectedFingerprint,
        draft: input.draft,
      }),
    },
  );
  return responseJson(response) as Promise<NativeHermesCardView>;
}

export async function previewNativeHermesCard(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  draft: HermesCardDraft;
  signal?: AbortSignal;
}): Promise<NativeHermesCardView> {
  const response = await fetch(
    `/api/hermes-profile/cards/${encodeURIComponent(input.cardId)}/preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: input.projectId,
        deckId: input.deckId,
        draft: input.draft,
      }),
      signal: input.signal,
    },
  );
  return responseJson(response) as Promise<NativeHermesCardView>;
}

export async function testNativeHermesMcp(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  serverName: string;
}): Promise<{
  ok: boolean;
  server: string;
  tools: Array<{ name: string; description?: string }>;
  effectiveTools: string[];
  prompts: number;
  resources: number;
  credentialStatus: string;
  error: string | null;
}> {
  const response = await fetch(
    `/api/hermes-profile/cards/${encodeURIComponent(input.cardId)}/mcp/${encodeURIComponent(input.serverName)}/test`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: input.projectId, deckId: input.deckId }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.error || `hermes_mcp_test_failed:${response.status}`));
  return body;
}
