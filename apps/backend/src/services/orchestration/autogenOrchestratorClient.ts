import type { ContextPack, OrchestratorRunResponse } from './contracts';

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildSidecarBaseUrls(): string[] {
  const configured = [
    String(process.env.AUTOGEN_ORCHESTRATOR_URL || '').trim(),
    String(process.env.PYTHON_MODELS_URL || '').trim(),
  ]
    .filter(Boolean)
    .map(trimBaseUrl);

  const defaults = ['http://localhost:8001', 'http://python-models:8001'];
  return Array.from(new Set([...configured, ...defaults].filter(Boolean)));
}

function isRetryableSidecarError(error: any): boolean {
  const code = String(error?.cause?.code || error?.code || '').trim();
  return code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
}

function readTimeoutMs(): number {
  const raw = Number(process.env.AUTOGEN_ORCHESTRATOR_TIMEOUT_MS ?? 120_000);
  if (!Number.isFinite(raw)) return 120_000;
  return Math.max(2_500, Math.min(300_000, Math.floor(raw)));
}

export async function runSidecarOrchestrator(context: ContextPack): Promise<OrchestratorRunResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), readTimeoutMs());
  try {
    let lastError: any = null;
    for (const baseUrl of buildSidecarBaseUrls()) {
      try {
        const response = await fetch(`${baseUrl}/autogen/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(context),
          signal: controller.signal,
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : null;
        if (!response.ok) {
          const message = String(data?.detail || data?.error || response.statusText || 'autogen_orchestrator_error').trim();
          throw new Error(`autogen_orchestrator_http_${response.status}:${message}`);
        }
        return data as OrchestratorRunResponse;
      } catch (error: any) {
        lastError = error;
        if (!isRetryableSidecarError(error)) {
          break;
        }
      }
    }
    throw lastError || new Error('autogen_orchestrator_unreachable');
  } finally {
    clearTimeout(timeout);
  }
}
