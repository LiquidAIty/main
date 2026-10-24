/**
 * Entity: Card Profiles
 * Relationship: This file loads one authorized saved Card's profile and learning state and applies only the bounded profile operations exposed by the backend.
 * Entity: Credentials
 * Relationship: This file manages the validated loopback OAuth start, poll, approval, cancellation, and timeout lifecycle for a Card profile's selected MCP server.
 * Entity: Tool Catalog
 * Relationship: This file reads and tests the MCP server tools exposed through the selected saved Card profile without changing Card grants.
 */

export type CardMcpServerView = {
  name: string;
  transport: string;
  enabled: boolean;
  auth: string | null;
  credentialStatus: 'not_required' | 'not_configured' | 'configured';
  toolFilter: string[];
};

export type CardProfileView = {
  profile: {
    name: string;
    description: string;
    soul: string;
    model: { provider: string; default: string };
    skills: Array<{ name: string; enabled: boolean }>;
    toolsets: Array<{ name: string; label?: string; enabled: boolean; tool_count?: number }>;
    toolsetsPinned: boolean;
    mcpServers: CardMcpServerView[];
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

export type CardProfileOperation =
  | { method: 'learning.detail'; params: { id: string } }
  | { method: 'learning.edit'; params: { id: string; content: string } }
  | { method: 'mcp.servers.test'; params: { name: string } }
  | { method: 'mcp.servers.oauth.start'; params: { name: string } }
  | { method: 'mcp.servers.oauth.poll'; params: { name: string; session_id: string } }
  | { method: 'mcp.servers.oauth.cancel'; params: { name: string; session_id: string } };

async function responseJson(response: Response): Promise<Record<string, any>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(String(body?.error || `card_profile_request_failed:${response.status}`));
  }
  return body;
}

export async function loadCardProfile(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  signal?: AbortSignal;
}): Promise<CardProfileView> {
  const query = new URLSearchParams({ projectId: input.projectId, deckId: input.deckId });
  const response = await fetch(
    `/api/card-profile/cards/${encodeURIComponent(input.cardId)}?${query.toString()}`,
    { signal: input.signal },
  );
  return responseJson(response) as Promise<CardProfileView>;
}

export async function applyCardProfileOperation(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  change: CardProfileOperation;
}): Promise<CardProfileView & { result: unknown }> {
  const response = await fetch(
    `/api/card-profile/cards/${encodeURIComponent(input.cardId)}/operations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: input.projectId, deckId: input.deckId, ...input.change }),
    },
  );
  return responseJson(response) as Promise<CardProfileView & { result: unknown }>;
}

export async function loadCardLearningDetail(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  nodeId: string;
}): Promise<{ ok: true; kind: 'memory' | 'skill'; id: string; label: string; content: string }> {
  const response = await fetch(
    `/api/card-profile/cards/${encodeURIComponent(input.cardId)}/operations`,
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

export async function testCardMcp(input: {
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
    `/api/card-profile/cards/${encodeURIComponent(input.cardId)}/operations`,
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
  if (!response.ok) throw new Error(String(body?.error || `card_mcp_test_failed:${response.status}`));
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

export async function connectCardMcpOAuth(input: {
  projectId: string;
  deckId: string;
  cardId: string;
  serverName: string;
  signal: AbortSignal;
  authorizationWindow: Window;
}): Promise<CardProfileView & { toolCount: number }> {
  const authority = {
    projectId: input.projectId,
    deckId: input.deckId,
    cardId: input.cardId,
  };
  const started = await applyCardProfileOperation({
    ...authority,
    change: { method: 'mcp.servers.oauth.start', params: { name: input.serverName } },
  });
  const startResult = started.result && typeof started.result === 'object'
    ? started.result as Record<string, unknown>
    : {};
  const sessionId = String(startResult.session_id || '').trim();
  const authUrl = String(startResult.auth_url || '').trim();
  if (!sessionId || !authUrl) throw new Error('card_mcp_oauth_start_invalid');
  let approved = false;
  try {
    const parsedAuthUrl = new URL(authUrl);
    if (!['http:', 'https:'].includes(parsedAuthUrl.protocol)) {
      throw new Error('card_mcp_oauth_url_invalid');
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
    ) throw new Error('card_mcp_oauth_callback_invalid');
    input.authorizationWindow.opener = null;
    input.authorizationWindow.location.replace(parsedAuthUrl.toString());
    const deadline = Date.now() + 360_000;
    while (Date.now() < deadline) {
      if (input.signal.aborted) throw new DOMException('MCP OAuth cancelled', 'AbortError');
      await waitForOAuthPoll(input.signal);
      const polled = await applyCardProfileOperation({
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
        throw new Error(String(pollResult.error_message || 'card_mcp_oauth_failed'));
      }
      if (status !== 'pending') throw new Error('card_mcp_oauth_status_invalid');
    }
    throw new Error('card_mcp_oauth_timed_out');
  } finally {
    if (!approved) {
      await applyCardProfileOperation({
        ...authority,
        change: {
          method: 'mcp.servers.oauth.cancel',
          params: { name: input.serverName, session_id: sessionId },
        },
      }).catch(() => undefined);
    }
  }
}
