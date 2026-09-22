function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildPythonRailsBaseUrls(): string[] {
  const configured = trimBaseUrl(String(process.env.PYTHON_RAILS_URL || '').trim());
  if (!configured) {
    throw new Error('missing_required_config: PYTHON_RAILS_URL');
  }
  return [configured];
}

function isRetryablePythonRailsError(error: any): boolean {
  const code = String(error?.cause?.code || error?.code || '').trim();
  return code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
}

/** Transport-only request to the long-lived Python rails service. */
export async function requestPythonRailsJson(
  endpointPath: string,
  init: RequestInit,
  options: { timeoutMs?: number } = {},
): Promise<unknown> {
  const controller = new AbortController();
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? requestedTimeout
    : 120_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    if (lastError && isRetryablePythonRailsError(lastError)) {
      console.error('[PYTHON_RAILS]', {
        runtime: 'failed_missing_python_rails',
        checkedBaseUrls: baseUrls,
        error: String(lastError?.message || lastError || 'unknown'),
      });
      throw new Error(`PYTHON_RAILS_UNAVAILABLE: checkedBaseUrls=${baseUrls.join(',')}`);
    }
    throw lastError || new Error('PYTHON_RAILS_UNAVAILABLE');
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
  args: {
    projectId: string;
    deckId: string;
    discoveredToolNames: string[];
    discoveredToolCatalogState: 'available' | 'unavailable';
    unavailableToolCatalogFamilies: string[];
  },
  request: typeof requestPythonRailsJson = requestPythonRailsJson,
): Promise<DescribeConnectedAgentsResult> {
  const projectId = String(args.projectId || '').trim();
  const deckId = String(args.deckId || '').trim();
  if (!projectId || !deckId) throw new Error('projectId_and_deckId_required');
  const result = await request(
    `/domain/mag-one/${encodeURIComponent(projectId)}/${encodeURIComponent(deckId)}/agents`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discoveredToolNames: args.discoveredToolNames,
        discoveredToolCatalogState: args.discoveredToolCatalogState,
        unavailableToolCatalogFamilies: args.unavailableToolCatalogFamilies,
      }),
    },
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

/** Read one bounded native Engraphis neighborhood without reshaping it in TypeScript. */
export async function fetchThinkGraphNeighborhood(
  projectId: string,
  canonicalId: string,
): Promise<unknown> {
  const query = new URLSearchParams({ projectId, canonicalId });
  return requestPythonRailsJson(`/thinkgraph/neighborhood?${query.toString()}`, { method: 'GET' });
}
