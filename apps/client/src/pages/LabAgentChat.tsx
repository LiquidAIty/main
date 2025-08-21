import React, { useMemo, useRef, useState } from 'react';

// Minimal, dependency-free preview UI that can run in Canvas.
// Default is mock mode (works here). Toggle to Live and set Base URL
// to POST against your backend: POST {baseUrl}/sol/run  { q: string }

export default function AgentChat() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [mock, setMock] = useState(true);
  const [baseUrl, setBaseUrl] = useState('/api');
  const [history, setHistory] = useState<string[]>([]);
  const [combined, setCombined] = useState<string>('');
  const [results, setResults] = useState<Record<string, any>>({});
  const [error, setError] = useState<string>('');
  const listRef = useRef<HTMLDivElement | null>(null);

  async function send() {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError('');
    setHistory((h) => [q, ...h].slice(0, 12));

    try {
      if (mock) {
        await new Promise((r) => setTimeout(r, 600));
        const demo = makeMockResponse(q);
        setCombined(demo.combined);
        setResults(demo.results);
      } else {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/sol/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ q })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || res.statusText);
        setCombined(json?.combined ?? '');
        setResults(json?.results ?? {});
      }
      setQ('');
      // scroll to top of output
      requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const deptEntries = useMemo(() => {
    const r = { ...(results || {}) } as Record<string, any>;
    delete r.__final__;
    return Object.entries(r);
  }, [results]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-neutral-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <span className="text-xl font-semibold">Agent-0 Chat</span>
          <span className={`ml-2 inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full ${mock ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
            <span className={`w-2 h-2 rounded-full ${mock ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            {mock ? 'Mock mode (local)' : 'Live API'}
          </span>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <label className="font-medium">Base URL</label>
            <input
              className="border rounded px-2 py-1 w-56"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={mock}
              placeholder="/api"
            />
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={!mock} onChange={(e) => setMock(!e.target.checked)} />
              <span>Live</span>
            </label>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 grid md:grid-cols-[1fr_280px] gap-6">
        {/* Left: conversation / results */}
        <section className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-3 sm:p-4">
            <div className="flex gap-2">
              <input
                className="border border-neutral-300 rounded-lg px-3 py-2 flex-1 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                placeholder="Ask Agent-0… (e.g., 'summarize NVDA earnings in 3 bullets')"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && send()}
              />
              <button
                onClick={send}
                disabled={busy || !q.trim()}
                className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50"
                title="Ctrl/Cmd+Enter"
              >
                {busy ? 'Running…' : 'Send'}
              </button>
            </div>
            <p className="mt-2 text-xs text-neutral-500">Tip: toggle <kbd className="px-1 py-0.5 border rounded">Live</kbd> to call your backend at <code>{baseUrl.replace(/\/$/, '')}/sol/run</code>.</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3">{error}</div>
          )}

          {/* Combined answer */}
          <div ref={listRef} className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
            <div className="px-4 py-3 border-b bg-neutral-50">Combined answer</div>
            <div className="p-4 whitespace-pre-wrap text-sm leading-relaxed min-h-[96px]">
              {busy && !combined ? <SkeletonLines /> : (combined || <span className="text-neutral-400">No output yet.</span>)}
            </div>
          </div>

          {/* Per-department results */}
          <div className="grid gap-4">
            {deptEntries.length === 0 ? (
              <div className="text-neutral-400 text-sm">No department results yet.</div>
            ) : (
              deptEntries.map(([dept, data]) => (
                <details key={dept} className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden" open>
                  <summary className="px-4 py-3 cursor-pointer select-none flex items-center justify-between">
                    <span className="font-medium">{dept}</span>
                    <span className="text-xs text-neutral-500">click to collapse</span>
                  </summary>
                  <div className="p-4 bg-neutral-50/60">
                    <JsonBlock value={data} />
                  </div>
                </details>
              ))
            )}
          </div>
        </section>

        {/* Right: history */}
        <aside className="space-y-3">
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200">
            <div className="px-4 py-3 border-b bg-neutral-50">Recent prompts</div>
            <ul className="max-h-[60vh] overflow-auto divide-y">
              {history.length === 0 && (
                <li className="px-4 py-3 text-sm text-neutral-400">No prompts yet.</li>
              )}
              {history.map((h, i) => (
                <li key={i} className="px-4 py-3 text-sm hover:bg-neutral-50 cursor-pointer" onClick={() => setQ(h)}>
                  {h}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-4 text-xs text-neutral-600">
            <p className="font-semibold mb-2">How it works</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Default is <b>Mock mode</b> so it works in Canvas.</li>
              <li>Switch to <b>Live</b> to call <code>{baseUrl.replace(/\/$/, '')}/sol/run</code>.</li>
              <li>Backend expected JSON: <code>{`{ ok, executed, results, combined }`}</code>.</li>
            </ul>
          </div>
        </aside>
      </main>

      <footer className="py-6 text-center text-xs text-neutral-500">Agent-0 Chat preview • Tailwind UI • LangGraph backend</footer>
    </div>
  );
}

function SkeletonLines() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-3 rounded bg-neutral-200 w-11/12" />
      <div className="h-3 rounded bg-neutral-200 w-10/12" />
      <div className="h-3 rounded bg-neutral-200 w-8/12" />
    </div>
  );
}

function JsonBlock({ value }: { value: any }) {
  const json = useMemo(() => safeStringify(value, 2), [value]);
  return (
    <pre className="text-xs leading-relaxed bg-white border border-neutral-200 rounded-xl p-3 overflow-auto max-h-[50vh]">
      {json}
    </pre>
  );
}

function safeStringify(v: any, spaces = 2) {
  try {
    return JSON.stringify(v, null, spaces);
  } catch (e) {
    return String(v);
  }
}

function makeMockResponse(q: string) {
  const results = {
    'openai-agent': { note: 'Mocked OpenAI dept response', input: q },
    memory: { note: 'Mocked memory result' }
  };
  const combined = Object.entries(results)
    .map(([k, v]) => `### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}`)
    .join('\n\n');
  return { ok: true, executed: true, results: { ...results, __final__: combined }, combined };
}
