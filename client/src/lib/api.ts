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
  return res;
}

export async function solRun(goal: string): Promise<SolResponse> {
  try {
    const res = await runSol(goal);
    const raw = await res.json().catch(() => null);
    const replyText =
      typeof raw === "string" ? raw :
      (raw && typeof raw === "object" && typeof (raw as any).text === "string") ? (raw as any).text :
      (raw as any)?.choices?.[0]?.message?.content ??
      JSON.stringify(raw ?? { error: `HTTP ${res.status}` });
    return { ok: res.ok, text: replyText };
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
