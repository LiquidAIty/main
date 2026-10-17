/**
 * Entity: Hermes Profiles
 * Relationship: Loads one authorized saved Card's profile, learning, and MCP status, applies bounded operations, and manages validated loopback OAuth start, poll, and cancel lifecycle.
 */

export type HermesMcpServerView = {
  name: string;
  transport: string;
  enabled: boolean;
  auth: string | null;
  credentialStatus: 'not_required' | 'not_configured' | 'configured';
  toolFilter: string[];
};

export type HermesProfileView = {
  profile: {
    name: string;
    description: string;
    soul: string;
    model: { provider: string; default: string };
    skills: Array<{ name: string; enabled: boolean }>;
    toolsets: Array<{ name: string; label?: string; enabled: boolean; tool_count?: number }>;
    toolsetsPinned: boolean;
    mcpServers: HermesMcpServerView[];
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
    mode: 'main' | 'delegate' | 'magentic_one';
  };
};

export type HermesProfileOperation =
  | { method: 'learning.detail'; params: { id: string } }
  | { method: 'learning.edit'; params: { id: string; content: string } }
  | { method: 'mcp.servers.test'; params: { name: string } }
  | { method: 'mcp.servers.oauth.start'; params: { name: string } }
  | { method: 'mcp.servers.oauth.poll'; params: { name: string; session_id: string } }
  | { method: 'mcp.servers.oauth.cancel'; params: { name: string; session_id: string } };

async function responseJson(response: Response): Promise<Record<string, any>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(String(body?.error || `hermes_profile_request_failed:${response.status}`));
  }
  return body;
}

export async function loadHermesProfile(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  signal?: AbortSignal;
}): Promise<HermesProfileView> {
  const query = new URLSearchParams({ projectId: input.projectId, deckId: input.deckId });
  const response = await fetch(
    `/api/hermes-profile/cards/${encodeURIComponent(input.cardId)}?${query.toString()}`,
    { signal: input.signal },
  );
  return responseJson(response) as Promise<HermesProfileView>;
}

export async function applyHermesProfileOperation(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  change: HermesProfileOperation;
}): Promise<HermesProfileView & { result: unknown }> {
  const response = await fetch(
    `/api/hermes-profile/cards/${encodeURIComponent(input.cardId)}/operations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: input.projectId, deckId: input.deckId, ...input.change }),
    },
  );
  return responseJson(response) as Promise<HermesProfileView & { result: unknown }>;
}

export async function loadHermesLearningDetail(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  nodeId: string;
}): Promise<{ ok: true; kind: 'memory' | 'skill'; id: string; label: string; content: string }> {
  const response = await fetch(
    `/api/hermes-profile/cards/${encodeURIComponent(input.cardId)}/operations`,
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

export async function testHermesMcp(input: {
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
    `/api/hermes-profile/cards/${encodeURIComponent(input.cardId)}/operations`,
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

function waitForOAuthPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('MCP OAuth cancelled', 'AbortError'));
      return;
    }
    let timer = 0;
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('MCP OAuth cancelled', 'AbortError'));
    };
    timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, 1_000);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function connectHermesMcpOAuth(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  serverName: string;
  signal: AbortSignal;
  authorizationWindow: Window;
}): Promise<HermesProfileView & { toolCount: number }> {
  const authority = {
    projectId: input.projectId,
    deckId: input.deckId,
    cardId: input.cardId,
  };
  const started = await applyHermesProfileOperation({
    ...authority,
    change: { method: 'mcp.servers.oauth.start', params: { name: input.serverName } },
  });
  const startResult = started.result && typeof started.result === 'object'
    ? started.result as Record<string, unknown>
    : {};
  const sessionId = String(startResult.session_id || '').trim();
  const authUrl = String(startResult.auth_url || '').trim();
  if (!sessionId || !authUrl) throw new Error('hermes_mcp_oauth_start_invalid');
  let approved = false;
  try {
    const parsedAuthUrl = new URL(authUrl);
    if (!['http:', 'https:'].includes(parsedAuthUrl.protocol)) {
      throw new Error('hermes_mcp_oauth_url_invalid');
    }
    const redirectValue = parsedAuthUrl.searchParams.get('redirect_uri') || '';
    const redirect = new URL(redirectValue);
    if (
      redirect.protocol !== 'http:'
      || redirect.hostname !== '127.0.0.1'
      || !redirect.port
      || redirect.pathname !== '/callback'
      || redirect.username
      || redirect.password
      || redirect.search
      || redirect.hash
    ) throw new Error('hermes_mcp_oauth_callback_invalid');
    input.authorizationWindow.opener = null;
    input.authorizationWindow.location.replace(parsedAuthUrl.toString());
    const deadline = Date.now() + 360_000;
    while (Date.now() < deadline) {
      if (input.signal.aborted) throw new DOMException('MCP OAuth cancelled', 'AbortError');
      await waitForOAuthPoll(input.signal);
      const polled = await applyHermesProfileOperation({
        ...authority,
        change: {
          method: 'mcp.servers.oauth.poll',
          params: { name: input.serverName, session_id: sessionId },
        },
      });
      const pollResult = polled.result && typeof polled.result === 'object'
        ? polled.result as Record<string, unknown>
        : {};
      if (input.signal.aborted) throw new DOMException('MCP OAuth cancelled', 'AbortError');
      const status = String(pollResult.status || '').trim();
      if (status === 'approved') {
        approved = true;
        return {
          ...polled,
          toolCount: Array.isArray(pollResult.tools) ? pollResult.tools.length : 0,
        };
      }
      if (status === 'error') {
        throw new Error(String(pollResult.error_message || 'hermes_mcp_oauth_failed'));
      }
      if (status !== 'pending') throw new Error('hermes_mcp_oauth_status_invalid');
    }
    throw new Error('hermes_mcp_oauth_timed_out');
  } finally {
    if (!approved) {
      await applyHermesProfileOperation({
        ...authority,
        change: {
          method: 'mcp.servers.oauth.cancel',
          params: { name: input.serverName, session_id: sessionId },
        },
      }).catch(() => undefined);
    }
  }
}
