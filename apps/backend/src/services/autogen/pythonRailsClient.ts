type ConfiguredRuntimeSession = {
  sessionId: string;
  projectId: string;
  turnId: string;
  runId?: string;
  parentRunId?: string;
  route: string;
  orchestrator: 'magentic_one' | 'assistant_agent';
  modelProvider: string;
  modelKey: string;
  providerModelId: string;
  startedAt: string;
};

const AUTOGEN_DISPATCH_ENDPOINT = '/autogen/dispatch';

export type ConfiguredRuntimeRequest = {
  session: ConfiguredRuntimeSession;
  idf: import('../../contracts/runtimeContracts').InputDataFile;
  cardRuntime?: Record<string, unknown>;
};

export type NativeRuntimeMessage = {
  source: string;
  type: string;
  content: string;
};

export type ConfiguredRuntimeResponse = {
  ok: boolean;
  runId: string;
  idfId: string;
  resultId?: string | null;
  // Real last AutoGen message text (transport invariant only; not rendered in chat).
  finalResponseText?: string;
  // Bounded transport fields from the native AutoGen run stream.
  autogenMessages?: NativeRuntimeMessage[];
  autogenEvents?: NativeRuntimeMessage[];
  error?: string;
  stopReason?: string | null;
};

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildPythonRailsBaseUrls(): string[] {
  const configured = trimBaseUrl(String(process.env.AUTOGEN_ORCHESTRATOR_URL || '').trim());
  if (!configured) {
    throw new Error('missing_required_config: AUTOGEN_ORCHESTRATOR_URL');
  }
  return [configured];
}

function formatCheckedEndpoints(baseUrls: string[]): string {
  return baseUrls.map((baseUrl) => `${baseUrl}${AUTOGEN_DISPATCH_ENDPOINT}`).join(',');
}

function isRetryablePythonRailsError(error: any): boolean {
  const code = String(error?.cause?.code || error?.code || '').trim();
  return code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
}

export async function dispatchConfiguredRuntime(
  payload: ConfiguredRuntimeRequest,
): Promise<ConfiguredRuntimeResponse> {
  let lastError: any = null;
  const baseUrls = buildPythonRailsBaseUrls();

  for (const baseUrl of baseUrls) {
    const endpoint = `${baseUrl}${AUTOGEN_DISPATCH_ENDPOINT}`;
    try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        if (!response.ok) {
          const message = String(data?.detail || data?.error || response.statusText || 'autogen_dispatch_http_error').trim();
          throw new Error(`autogen_dispatch_http_${response.status}:${message}`);
        }
        if (!data || typeof data !== 'object') {
          throw new Error('autogen_dispatch_invalid_response');
        }
        if ((data as any).ok === false) {
          const message = String(
            (data as any).error || 'autogen_dispatch_failed',
          ).trim();
          throw new Error(message || 'autogen_dispatch_failed');
        }
        const finalResponseText = String((data as any).finalResponseText || '').trim();
        if (!finalResponseText) {
          throw new Error('autogen_dispatch_missing_final_response');
        }
        return data as ConfiguredRuntimeResponse;
    } catch (error: any) {
      lastError = error;
      if (!isRetryablePythonRailsError(error)) {
        break;
      }
    }
  }

  if (lastError && isRetryablePythonRailsError(lastError)) {
    const checked = formatCheckedEndpoints(baseUrls);
    console.error('[PYTHON_RAILS]', {
      runtime: 'failed_missing_python_rails',
      checkedEndpoints: checked,
      error: String(lastError?.message || lastError || 'unknown'),
    });
    throw new Error(`PYTHON_AUTOGEN_RAILS_UNAVAILABLE: checkedEndpoints=${checked}`);
  }
  if (lastError) throw lastError;
  throw new Error(
    `PYTHON_AUTOGEN_RAILS_UNAVAILABLE: checkedEndpoints=${formatCheckedEndpoints(baseUrls)}`,
  );
}

/** Transport-only request to the long-lived Python rails service. */
export async function requestPythonRailsJson(
  endpointPath: string,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const baseUrls = buildPythonRailsBaseUrls();
    let lastError: any = null;
    for (const baseUrl of baseUrls) {
      try {
        const response = await fetch(`${baseUrl}${endpointPath}`, { ...init, signal: controller.signal });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        if (!response.ok) {
          const message = String((data as any)?.detail || response.statusText || 'python_rails_http_error').trim();
          throw new Error(`python_rails_http_${response.status}:${message}`);
        }
        return data;
      } catch (error: any) {
        lastError = error;
        if (!isRetryablePythonRailsError(error)) break;
      }
    }
    throw lastError || new Error('PYTHON_AUTOGEN_RAILS_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

export type ConnectedAgent = {
  cardId: string;
  title: string;
  model: { modelKey: string | null; provider: string | null };
  tools: string[];
  connected: boolean;
  executionReady: boolean;
  readinessState: string;
  readinessReason: string | null;
};

export type DescribeConnectedAgentsResult = {
  projectId: string;
  deckId: string;
  orchestratorCardId: string | null;
  connectedAgents: ConnectedAgent[];
};

/** Thin read transport for the Python-owned Mag One roster. */
export async function describeConnectedAgents(
  args: { projectId: string; deckId: string },
  request: typeof requestPythonRailsJson = requestPythonRailsJson,
): Promise<DescribeConnectedAgentsResult> {
  const projectId = String(args.projectId || '').trim();
  const deckId = String(args.deckId || '').trim();
  if (!projectId || !deckId) throw new Error('projectId_and_deckId_required');
  const result = await request(
    `/domain/mag-one/${encodeURIComponent(projectId)}/${encodeURIComponent(deckId)}/agents`,
    { method: 'GET' },
  ) as Partial<DescribeConnectedAgentsResult> & { ok?: boolean };
  if (
    result.ok !== true
    || result.projectId !== projectId
    || result.deckId !== deckId
    || !Array.isArray(result.connectedAgents)
  ) {
    throw new Error('mag_one_connected_agents_response_invalid');
  }
  return {
    projectId: result.projectId,
    deckId: result.deckId,
    orchestratorCardId: typeof result.orchestratorCardId === 'string'
      ? result.orchestratorCardId
      : null,
    connectedAgents: result.connectedAgents,
  };
}

/** Read one native Engraphis project projection without reshaping it in TypeScript. */
export async function fetchThinkGraphProjection(
  projectId: string,
  limit?: number,
): Promise<unknown> {
  const query = new URLSearchParams({ projectId });
  if (Number.isFinite(limit)) query.set('limit', String(limit));
  return requestPythonRailsJson(`/thinkgraph/projection?${query.toString()}`, { method: 'GET' });
}

export type LiveThinkGraphSource = 'user' | 'assistant' | 'reasoning' | 'tool';

export type LiveThinkGraphProjectionRequest = {
  projectId: string;
  conversationId: string;
  runId: string;
  observedAt: string;
  state: 'active' | 'settled';
  streams: Array<{
    source: LiveThinkGraphSource;
    sourceId: string;
    text: string;
  }>;
  maxNodes?: number;
  maxEdges?: number;
};

/** Transport one bounded current-turn observation request to the pure Python projector. */
export async function projectLiveThinkGraph(
  payload: LiveThinkGraphProjectionRequest,
): Promise<unknown> {
  return requestPythonRailsJson('/thinkgraph/live-projection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
