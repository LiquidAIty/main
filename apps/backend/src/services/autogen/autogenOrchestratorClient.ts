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

export type AutoGenOrchestratorRequest = {
  session: AutoGenOrchestratorSession;
  userText: string;
  priorAssistantText?: string;
  systemPrompt?: string;
  // Structured Run Task approval gate; chat submit is planning only (false).
  runApproved?: boolean;
  blackboard?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  thinkGraph?: Record<string, unknown>;
  knowGraph?: Record<string, unknown>;
  attachments?: Array<Record<string, unknown>>;
  maxResearchTasks?: number;
  workspaceObjectContext?: Record<string, unknown> | null;
  cardRuntime?: Record<string, unknown>;
};

export type LedgerTrace = {
  source: 'python_magone';
  referenceFiles?: string[];
  referenceClasses?: string[];
  referenceMethods?: string[];
  promptConstants?: string[];
  canvasTeamCompiled?: boolean;
  taskLedgerFactsPromptUsed?: boolean;
  taskLedgerPlanPromptUsed?: boolean;
  taskLedgerFullPromptUsed?: boolean;
  taskLedgerProduced?: boolean;
  planCanvasProjected?: boolean;
  runTaskClicked?: boolean;
  progressLedgerStarted?: boolean;
  progressLedgerPromptUsed?: boolean;
  agentCanvasProjected?: boolean;
  noExecutionBeforeRunTask?: boolean;
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
  const raw = Number(process.env.AUTOGEN_ORCHESTRATOR_TIMEOUT_MS ?? 20_000);
  if (!Number.isFinite(raw)) return 20_000;
  return Math.max(2_000, Math.min(90_000, Math.floor(raw)));
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
        const finalResponseText = String((data as any).finalResponseText || '').trim();
        if (!finalResponseText) {
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
