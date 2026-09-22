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
    learning: {
      count: number;
      summary: string[];
      buckets: Array<{
        index: number;
        label: string;
        date: string;
        skills: number;
        memories: number;
        total: number;
        category: string | null;
        color: string | null;
        nodes: Array<{
          id: string;
          glyph: string;
          label: string;
          fullLabel: string;
          meta: string;
          body: string;
          style: string;
        }>;
      }>;
    };
  };
  binding: {
    profile: string;
    mode: 'main' | 'delegate' | 'kanban' | 'magentic_one';
  };
};

export type NativeHermesOperation =
  | { method: 'learning.detail'; params: { id: string } }
  | { method: 'learning.edit'; params: { id: string; content: string } }
  | { method: 'skills.manage'; params: Record<string, unknown> }
  | { method: 'tools.configure'; params: Record<string, unknown> }
  | { method: 'toolsets.list'; params?: Record<string, unknown> }
  | { method: 'mcp.servers.list'; params?: Record<string, unknown> }
  | { method: 'mcp.servers.test'; params: { name: string } };

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

export async function applyNativeHermesOperation(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  change: NativeHermesOperation;
}): Promise<NativeHermesCardView & { result: unknown }> {
  const response = await fetch(
    `/api/hermes-profile/cards/${encodeURIComponent(input.cardId)}/native`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: input.projectId, deckId: input.deckId, ...input.change }),
    },
  );
  const body = await responseJson(response) as NativeHermesCardView & { result: unknown };
  window.dispatchEvent(new CustomEvent('liquidaity:hermes-profile-updated', {
    detail: { cardId: input.cardId },
  }));
  return body;
}

export async function loadNativeHermesLearningDetail(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  nodeId: string;
}): Promise<{ ok: true; kind: 'memory' | 'skill'; id: string; label: string; content: string }> {
  const response = await fetch(
    `/api/hermes-profile/cards/${encodeURIComponent(input.cardId)}/native`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: input.projectId,
        deckId: input.deckId,
        method: 'learning.detail',
        params: { id: input.nodeId },
      }),
    },
  );
  const body = await responseJson(response);
  return body.result;
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
  prompts: number;
  resources: number;
  credentialStatus: string;
  error: string | null;
}> {
  const response = await fetch(
    `/api/hermes-profile/cards/${encodeURIComponent(input.cardId)}/native`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: input.projectId,
        deckId: input.deckId,
        method: 'mcp.servers.test',
        params: { name: input.serverName },
      }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.error || `hermes_mcp_test_failed:${response.status}`));
  return { server: input.serverName, ...body.result };
}
