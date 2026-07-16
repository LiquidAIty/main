type AutoGenOrchestratorSession = {
  sessionId: string;
  projectId: string;
  turnId: string;
  route: string;
  orchestrator: 'magentic_one' | 'graph_flow' | 'assistant_agent';
  modelProvider: string;
  modelKey: string;
  providerModelId: string;
  startedAt: string;
};

const AUTOGEN_ORCHESTRATE_ENDPOINT = '/autogen/orchestrate';
const AUTOGEN_TOOL_MANIFEST_ENDPOINT = '/tools/manifest';

// Read-only capability manifest entry from the Python Mag One tool registry.
// The Python registry is the source of truth; this is transport only.
export type ToolCapabilityManifestEntry = {
  id: string;
  displayName: string;
  description: string;
  agentCompatibility: string[];
  inputSchemaSummary?: string;
};

export type AutoGenOrchestratorRequest = {
  session: AutoGenOrchestratorSession;
  userText: string;
  priorAssistantText?: string;
  systemPrompt?: string;
  blackboard?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  thinkGraph?: Record<string, unknown>;
  knowGraph?: Record<string, unknown>;
  attachments?: Array<Record<string, unknown>>;
  maxResearchTasks?: number;
  workspaceObjectContext?: Record<string, unknown> | null;
  jobHandoff?: { workspaceRoot: string; jobId: string };
  resultFolder?: { workspaceRoot: string; runId: string };
  cardRuntime?: Record<string, unknown>;
};

export type LedgerTrace = {
  source: 'python_magone';
  referenceFiles?: string[];
  referenceClasses?: string[];
  referenceMethods?: string[];
  promptConstants?: string[];
  canvasTeamCompiled?: boolean;
  taskLedgerProduced?: boolean;
  blocker?: string | null;
};

export type AutoGenMessage = {
  source: string;
  type: string;
  content: string;
};

export type AutoGenOrchestratorResponse = {
  ok: boolean;
  // Honest per-stage trace from the real Python Magentic-One path.
  ledgerTrace?: LedgerTrace;
  // Real last AutoGen message text (transport invariant only; not rendered in chat).
  finalResponseText?: string;
  // The real AutoGen run output captured verbatim from run_stream.
  autogenMessages?: AutoGenMessage[];
  autogenEvents?: AutoGenMessage[];
  // The real Task Ledger artifact (facts/plan/full text + model-call proof).
  taskLedgerArtifact?: unknown;
  // Progress Ledger is identify-only in this scope: referenced, never started.
  progressLedgerReference?: unknown;
  // Job-folder handoff run outputs (present only for a handoff run).
  returnsDir?: string | null;
  returnedFiles?: string[];
  returnStatus?: 'return_files_created' | 'no_return_files_created' | null;
  error?: string;
  stopReason?: string | null;
  transcript?: string[];
  metrics?: Record<string, unknown>;
  blackboardEntries?: Array<Record<string, unknown>>;
  plan?: Record<string, unknown>;
  thinkGraph?: Record<string, unknown>;
  knowGraph?: Record<string, unknown>;
  reportBacks?: Array<Record<string, unknown>>;
};

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildSidecarBaseUrls(): string[] {
  const configured = trimBaseUrl(String(process.env.AUTOGEN_ORCHESTRATOR_URL || '').trim());
  if (!configured) {
    throw new Error(
      'autogen_orchestrator_url_missing: set AUTOGEN_ORCHESTRATOR_URL in apps/backend/.env',
    );
  }
  return [configured];
}

function formatCheckedEndpoints(baseUrls: string[]): string {
  return baseUrls.map((baseUrl) => `${baseUrl}${AUTOGEN_ORCHESTRATE_ENDPOINT}`).join(',');
}

function isRetryableSidecarError(error: any): boolean {
  const code = String(error?.cause?.code || error?.code || '').trim();
  return code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
}

function readTimeoutMs(): number {
  // A real multi-agent Magentic-One run — and especially a coder-bearing run that
  // nests a LocalCoder CLI call (its own DEFAULT_LOCALCODER_RUN_TIMEOUT_MS is 300s)
  // plus participant/model overhead — can run past 300s. The old 120s default /
  // 300s ceiling (and the env override of 180s) aborted the outer fetch to the
  // Python rails while the Python run kept going and wrote its artifact, so the run
  // reported "This operation was aborted" despite completing the work. Default and
  // ceiling now exceed the nested LocalCoder budget so coder runs finish instead of
  // aborting; simple requests still return in seconds — this only bounds the worst case.
  const raw = Number(process.env.AUTOGEN_ORCHESTRATOR_TIMEOUT_MS ?? 360_000);
  if (!Number.isFinite(raw)) return 360_000;
  return Math.max(2_000, Math.min(600_000, Math.floor(raw)));
}

export async function orchestrateWithAutoGen(
  payload: AutoGenOrchestratorRequest,
): Promise<AutoGenOrchestratorResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), readTimeoutMs());
  try {
    let lastError: any = null;
    const baseUrls = buildSidecarBaseUrls();

    for (const baseUrl of baseUrls) {
      const endpoint = `${baseUrl}${AUTOGEN_ORCHESTRATE_ENDPOINT}`;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
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
        // A Task-Ledger-only run legitimately has no chat answer
        // (finalResponseText === ''); it is still a successful run because it
        // carries the real Task Ledger artifact. Only an entirely empty result
        // (no answer AND no artifact) is invalid.
        const finalResponseText = String((data as any).finalResponseText || '').trim();
        const hasArtifact = Boolean((data as any).taskLedgerArtifact);
        if (!finalResponseText && !hasArtifact) {
          throw new Error('autogen_orchestrator_missing_final_response');
        }
        return data as AutoGenOrchestratorResponse;
      } catch (error: any) {
        lastError = error;
        if (!isRetryableSidecarError(error)) {
          break;
        }
      }
    }

    if (lastError && isRetryableSidecarError(lastError)) {
      const checked = formatCheckedEndpoints(baseUrls);
      console.error('[AUTOGEN_SIDECAR]', {
        runtime: 'failed_missing_autogen_sidecar',
        checkedEndpoints: checked,
        error: String(lastError?.message || lastError || 'unknown'),
      });
      throw new Error(`PYTHON_AUTOGEN_RAILS_UNAVAILABLE: checkedEndpoints=${checked}`);
    }
    if (lastError) throw lastError;
    throw new Error(
      `PYTHON_AUTOGEN_RAILS_UNAVAILABLE: checkedEndpoints=${formatCheckedEndpoints(baseUrls)}`,
    );
  } finally {
    clearTimeout(timeout);
  }
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), readTimeoutMs());
  try {
    let lastError: any = null;
    const baseUrls = buildSidecarBaseUrls();
    for (const baseUrl of baseUrls) {
      const endpoint = `${baseUrl}${AUTOGEN_RUN_CARD_ENDPOINT}`;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
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
        if (!isRetryableSidecarError(error)) break;
      }
    }
    if (lastError) throw lastError;
    throw new Error(
      `PYTHON_AUTOGEN_RAILS_UNAVAILABLE: checkedEndpoints=${baseUrls.map((b) => `${b}${AUTOGEN_RUN_CARD_ENDPOINT}`).join(',')}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

// Transport-only: fetch the read-only Mag One tool capability manifest from the
// Python rails. No tool definitions are authored here; the Python registry owns
// them. Used to render real capability metadata on the existing card Tools surface.
export async function fetchToolManifest(): Promise<ToolCapabilityManifestEntry[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const baseUrls = buildSidecarBaseUrls();
    let lastError: any = null;
    for (const baseUrl of baseUrls) {
      const endpoint = `${baseUrl}${AUTOGEN_TOOL_MANIFEST_ENDPOINT}`;
      try {
        const response = await fetch(endpoint, { method: 'GET', signal: controller.signal });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        if (!response.ok) {
          throw new Error(`autogen_tool_manifest_http_${response.status}`);
        }
        const tools = Array.isArray((data as any)?.tools) ? (data as any).tools : [];
        return tools as ToolCapabilityManifestEntry[];
      } catch (error: any) {
        lastError = error;
        if (!isRetryableSidecarError(error)) break;
      }
    }
    throw lastError || new Error('PYTHON_AUTOGEN_RAILS_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

const THINKGRAPH_PROJECTION_ENDPOINT = '/thinkgraph/projection';

async function requestThinkGraphJson(
  endpointPath: string,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const baseUrls = buildSidecarBaseUrls();
    let lastError: any = null;
    for (const baseUrl of baseUrls) {
      try {
        const response = await fetch(`${baseUrl}${endpointPath}`, { ...init, signal: controller.signal });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        if (!response.ok) {
          const message = String((data as any)?.detail || response.statusText || 'thinkgraph_http_error').trim();
          throw new Error(`thinkgraph_http_${response.status}:${message}`);
        }
        return data;
      } catch (error: any) {
        lastError = error;
        if (!isRetryableSidecarError(error)) break;
      }
    }
    throw lastError || new Error('PYTHON_AUTOGEN_RAILS_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Transport-only: fetch ThinkGraphProjectionV1 from the Python graph authority
 * and return the body UNCHANGED. No AGE query, no shaping, no labels, no visual
 * classes here — Python owns the projection; a failure throws honestly.
 */
export async function fetchThinkGraphProjection(
  projectId: string,
  limit?: number,
): Promise<unknown> {
  const query = new URLSearchParams({ projectId });
  if (Number.isFinite(limit)) query.set('limit', String(limit));
  return requestThinkGraphJson(`${THINKGRAPH_PROJECTION_ENDPOINT}?${query.toString()}`, { method: 'GET' });
}

export async function fetchUnifiedContext(params: {
  projectId: string;
  conversationId: string;
  role?: string;
  activeGraphViewId?: string;
  knowgraphScope?: string;
  thinkLimit?: number;
  knowLimit?: number;
  codeLimit?: number;
  expansionDepth?: number;
}): Promise<unknown> {
  const query = new URLSearchParams({
    projectId: params.projectId,
    conversationId: params.conversationId,
    role: params.role || 'main_chat',
  });
  if (params.activeGraphViewId) query.set('activeGraphViewId', params.activeGraphViewId);
  if (params.knowgraphScope) query.set('knowgraphScope', params.knowgraphScope);
  if (Number.isFinite(params.thinkLimit)) query.set('thinkLimit', String(params.thinkLimit));
  if (Number.isFinite(params.knowLimit)) query.set('knowLimit', String(params.knowLimit));
  if (Number.isFinite(params.codeLimit)) query.set('codeLimit', String(params.codeLimit));
  if (Number.isFinite(params.expansionDepth)) query.set('expansionDepth', String(params.expansionDepth));
  return requestThinkGraphJson(`/unified/context?${query.toString()}`, { method: 'GET' });
}

export async function fetchThinkGraphScope(projectId: string, limit?: number): Promise<unknown> {
  const query = new URLSearchParams({ projectId });
  if (Number.isFinite(limit)) query.set('limit', String(limit));
  return requestThinkGraphJson(`/thinkgraph/scope?${query.toString()}`, { method: 'GET' });
}

export async function applyThinkGraphPatchOnPython(authority: unknown, patch: unknown): Promise<unknown> {
  return requestThinkGraphJson('/thinkgraph/apply-patch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authority, patch }),
  });
}

export async function persistGraphViewOnPython(view: unknown): Promise<unknown> {
  return requestThinkGraphJson('/thinkgraph/graph-views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ view }),
  });
}

export async function fetchGraphViewsFromPython(projectId: string, conversationId: string): Promise<unknown> {
  const query = new URLSearchParams({ projectId, conversationId });
  return requestThinkGraphJson(`/thinkgraph/graph-views?${query.toString()}`, { method: 'GET' });
}
