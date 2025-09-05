import { useState, useRef, useEffect } from "react";

// Minimal, dependency-free preview UI that can run in any environment.
// Default is mock mode (works here). Toggle to Live and set Base URL
// to POST against your backend: POST {baseUrl}/sol/run { q: string }

function extractFirstText(results: Record<string, any> | undefined) {
  if (!results) return ""
  for (const v of Object.values(results)) {
    // common runner shape: { text: "...", model, provider }
    if (v && typeof v === "object" && typeof (v as any).text === "string") {
      return (v as any).text
    }
  }
  // fallback: show the first result as formatted json
  const first = Object.values(results)[0]
  return first ? JSON.stringify(first, null, 2) : ""
}

export default function labagentchat() {
  useEffect(() => {
    console.log("labagentchat component mounted");
  }, []);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mock, setMock] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [combined, setCombined] = useState('');
  const [results, setResults] = useState<Record<string, { text: string }>>({});
  const listRef = useRef<HTMLDivElement | null>(null);

  async function send() {
    if (!q.trim() || busy) return
    setBusy(true)
    setError("")
    history.push(q)
    setHistory([...history])
    combined ? setCombined(`${combined}\n${q}`) : setCombined(q)
    setQ("")

    try {
      if (mock) {
        // Mock response for testing UI
        await new Promise((r) => setTimeout(r, 600));
        setResults({ r1: { text: "This is a mock response for: " + q } });
      } else {
        const res = await fetch("/api/sol/run", {
          method: "post",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q }),
        })

        if (!res.ok) {
          const text = await res.text().catch(() => "")
          throw new Error(text || `http ${res.status}`)
        }

        const json = await res.json()
        if (!json?.ok) {
          throw new Error(json?.error || "backend returned non-ok")
        }

        const text = extractFirstText(json?.results)
        setResults(text ? { r1: { text } } : { r1: { text: "(empty result)" } })
      }
    } catch (err: any) {
      console.error("send() failed:", err);
      setError(err?.message || "request failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Lab Agent Chat</h1>
      <div className="mb-2 flex items-center gap-2">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={mock} onChange={(e) => setMock(e.target.checked)} />
          <span>Mock Mode</span>
        </label>
      </div>
      <div className="mb-2">
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border rounded w-full p-2"
          placeholder="ask something..."
        />
      </div>
      <button
        onClick={send}
        disabled={busy}
        className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
      >
        {busy ? "thinking..." : "send"}
      </button>
      {error && <div className="text-red-600 mt-2">error: {error}</div>}
      {Object.values(results).length > 0 && (
        <div className="mt-4 border p-2 rounded bg-gray-50">
          <strong>response:</strong>
          <pre className="whitespace-pre-wrap">{Object.values(results)[0].text}</pre>
        </div>
      )}
    </div>
  );
}
