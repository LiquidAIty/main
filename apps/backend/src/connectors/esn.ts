// ESN-RLS microservice client
// ESN-RLS is an online learner—later we can add Prophet/Chronos/ARIMA as parallel models

const ESN_SERVICE_URL = process.env.ESN_SERVICE_URL || 'http://localhost:5055';
const ESN_TIMEOUT_MS = Number(process.env.ESN_TIMEOUT_MS ?? 5000);

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeout = ESN_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fitPredict(params: {
  series: Array<[number, number]>; // [[timestamp, value], ...]
  horizon: number;
  rls_lambda?: number;
  leak_rate?: number;
}): Promise<{
  forecast: Array<{ t: number; v: number }>;
  feature_importance?: Record<string, number>;
  metrics?: { mse?: number; mae?: number };
}> {
  try {
    const response = await fetchWithTimeout(`${ESN_SERVICE_URL}/fit_predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      throw new Error(`ESN service error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[ESN] Service unavailable:', error);
    // Graceful fallback: return empty forecast
    return {
      forecast: [],
      metrics: { mse: -1, mae: -1 }
    };
  }
}

export async function pingEsn(): Promise<'up' | 'down'> {
  const url = process.env.ESN_HEALTH_URL ?? 'http://127.0.0.1:8000/health';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok ? 'up' : 'down';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}
