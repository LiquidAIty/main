// ESN-RLS microservice client
// ESN-RLS is an online learner—later we can add Prophet/Chronos/ARIMA as parallel models

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
