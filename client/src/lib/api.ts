const BASE = import.meta.env.VITE_BACKEND_URL || '/api';

interface SolResponse {
  ok: boolean;
  text: string;
}

export async function runSol(goal: string) {
  const res = await fetch(`${BASE}/sol/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text}`);
  }
  return res.json();
}

export async function solRun(goal: string): Promise<SolResponse> {
  try {
    const data = await runSol(goal);
    const text = data?.combined ?? data?.results?.__final__ ?? JSON.stringify(data);
    return { ok: true, text };
  } catch (err: any) {
    return { ok: false, text: err.message ?? 'Network error' };
  }
}

export async function solRunQuery(q: string): Promise<SolResponse> {
  try {
    const res = await fetch(`${BASE}/sol/run?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text}`);
    }
    const data = await res.json();
    const text = data?.combined ?? data?.results?.__final__ ?? JSON.stringify(data);
    return { ok: true, text };
  } catch (err: any) {
    return { ok: false, text: err.message ?? 'Network error' };
  }
}
