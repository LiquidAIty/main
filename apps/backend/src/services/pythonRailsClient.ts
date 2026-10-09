function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function pythonRailsBaseUrl(): string {
  const configured = trimBaseUrl(String(process.env.PYTHON_RAILS_URL || '').trim());
  if (!configured) {
    throw new Error('missing_required_config: PYTHON_RAILS_URL');
  }
  return configured;
}

function isRetryablePythonRailsError(error: any): boolean {
  const code = String(error?.cause?.code || error?.code || '').trim();
  return code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
}

export class PythonRailsHttpError extends Error {
  readonly code: string;

  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    const code = `python_rails_http_${status}`;
    super(detail, { cause: { code, status } });
    this.name = 'PythonRailsHttpError';
    this.code = code;
  }
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
    const baseUrl = pythonRailsBaseUrl();
    try {
      const response = await fetch(`${baseUrl}${endpointPath}`, { ...init, signal: controller.signal });
      const text = await response.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (error) {
          if (response.ok) {
            throw new Error('python_rails_response_invalid_json', { cause: error });
          }
        }
      }
      if (!response.ok) {
        const detail = String(
          (data as any)?.detail || response.statusText || 'python_rails_request_failed',
        ).trim();
        throw new PythonRailsHttpError(response.status, detail);
      }
      return data;
    } catch (error: any) {
      if (!isRetryablePythonRailsError(error)) throw error;
      console.error('[PYTHON_RAILS]', {
        runtime: 'failed_missing_python_rails',
        baseUrl,
        error: String(error?.message || error || 'unknown'),
      });
      throw new Error(`PYTHON_RAILS_UNAVAILABLE: baseUrl=${baseUrl}`, { cause: error });
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Read one Engraphis project projection without reshaping it in TypeScript. */
export async function fetchThinkGraphProjection(
  projectId: string,
): Promise<unknown> {
  const query = new URLSearchParams({ projectId });
  return requestPythonRailsJson(`/thinkgraph/projection?${query.toString()}`, { method: 'GET' });
}

/** Read one bounded Engraphis neighborhood without reshaping it in TypeScript. */
export async function fetchThinkGraphNeighborhood(
  projectId: string,
  canonicalId: string,
): Promise<unknown> {
  const query = new URLSearchParams({ projectId, canonicalId });
  return requestPythonRailsJson(`/thinkgraph/neighborhood?${query.toString()}`, { method: 'GET' });
}

/** Read the bounded Graphiti projection without reshaping it in TypeScript. */
export async function fetchKnowGraphProjection(
  projectId: string,
  limit: number,
): Promise<unknown> {
  const query = new URLSearchParams({ projectId, limit: String(limit) });
  return requestPythonRailsJson(`/knowgraph/projection?${query.toString()}`, { method: 'GET' });
}

/** Read one bounded Graphiti neighborhood without reshaping it in TypeScript. */
export async function fetchKnowGraphNeighborhood(
  projectId: string,
  nodeId: string,
  limit: number,
): Promise<unknown> {
  const query = new URLSearchParams({
    projectId,
    nodeId,
    limit: String(limit),
  });
  return requestPythonRailsJson(`/knowgraph/neighborhood?${query.toString()}`, { method: 'GET' });
}
