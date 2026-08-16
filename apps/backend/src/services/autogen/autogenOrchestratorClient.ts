type AutoGenOrchestratorSession = {
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

const AUTOGEN_ORCHESTRATE_ENDPOINT = '/autogen/orchestrate';

export type AutoGenOrchestratorRequest = {
  session: AutoGenOrchestratorSession;
  idf: import('../../contracts/runtimeContracts').InputDataFile;
  cardRuntime?: Record<string, unknown>;
};

export type AutoGenMessage = {
  source: string;
  type: string;
  content: string;
};

export type AutoGenOrchestratorResponse = {
  ok: boolean;
  runId: string;
  idfId: string;
  resultId?: string | null;
  // Real last AutoGen message text (transport invariant only; not rendered in chat).
  finalResponseText?: string;
  // Bounded transport fields from the native AutoGen run stream.
  autogenMessages?: AutoGenMessage[];
  autogenEvents?: AutoGenMessage[];
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
  return baseUrls.map((baseUrl) => `${baseUrl}${AUTOGEN_ORCHESTRATE_ENDPOINT}`).join(',');
}

function isRetryablePythonRailsError(error: any): boolean {
  const code = String(error?.cause?.code || error?.code || '').trim();
  return code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
}

export async function orchestrateWithAutoGen(
  payload: AutoGenOrchestratorRequest,
): Promise<AutoGenOrchestratorResponse> {
  let lastError: any = null;
  const baseUrls = buildPythonRailsBaseUrls();

    for (const baseUrl of baseUrls) {
      const endpoint = `${baseUrl}${AUTOGEN_ORCHESTRATE_ENDPOINT}`;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        if (!response.ok) {
          const message = String(data?.detail || data?.error || response.statusText || 'autogen_orchestrator_http_error').trim();
          throw new Error(`autogen_orchestrator_http_${response.status}:${message}`);
        }
        if (!data || typeof data !== 'object') {
          throw new Error('autogen_orchestrator_invalid_response');
        }
        if ((data as any).ok === false) {
          const message = String(
            (data as any).error || 'autogen_orchestrator_failed',
          ).trim();
          throw new Error(message || 'autogen_orchestrator_failed');
        }
        const finalResponseText = String((data as any).finalResponseText || '').trim();
        if (!finalResponseText) {
          throw new Error('autogen_orchestrator_missing_final_response');
        }
        return data as AutoGenOrchestratorResponse;
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

const AUTOGEN_RUN_CARD_ENDPOINT = '/autogen/run_card';

/**
 * Transport-only: run ONE configured canvas card via the Python single-card
 * runtime (`/autogen/run_card`). Same base-URL/timeout/retry conventions as
 * orchestrateWithAutoGen. An ok:false response is returned as-is (it carries an
 * honest error) — this layer never retries into a fallback or fabricates output.
 */
export async function runSingleCardWithAutoGen(
  payload: AutoGenOrchestratorRequest,
): Promise<AutoGenOrchestratorResponse> {
  let lastError: any = null;
  const baseUrls = buildPythonRailsBaseUrls();
    for (const baseUrl of baseUrls) {
      const endpoint = `${baseUrl}${AUTOGEN_RUN_CARD_ENDPOINT}`;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        if (!response.ok) {
          const message = String(data?.detail || data?.error || response.statusText || 'autogen_run_card_http_error').trim();
          throw new Error(`autogen_run_card_http_${response.status}:${message}`);
        }
        if (!data || typeof data !== 'object' || typeof (data as any).ok !== 'boolean') {
          throw new Error('autogen_run_card_invalid_response');
        }
        return data as AutoGenOrchestratorResponse;
      } catch (error: any) {
        lastError = error;
        if (!isRetryablePythonRailsError(error)) break;
      }
    }
    if (lastError) throw lastError;
  throw new Error(
    `PYTHON_AUTOGEN_RAILS_UNAVAILABLE: checkedEndpoints=${baseUrls.map((b) => `${b}${AUTOGEN_RUN_CARD_ENDPOINT}`).join(',')}`,
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
