import React, { useEffect, useState } from "react";
import { listUPlaybooks, runUPlaybook } from "../../lib/api.uPlaybooks";

export function PlaybookPanel() {
  const [pbs, setPbs] = useState<{ id: string; title: string; description?: string }[]>([]);
  const [sel, setSel] = useState<string>("");
  const [params, setParams] = useState<string>("{}");
  const [out, setOut] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const items = await listUPlaybooks();
        setPbs(items);
        if (items[0]) setSel(items[0].id);
      } catch (error) {
        console.error(error);
      }
    })();
  }, []);

  async function run() {
    setBusy(true);
    setOut(null);
    try {
      const parsed = params.trim() ? JSON.parse(params) : {};
      const res = await runUPlaybook(sel, parsed);
      setOut(res);
    } catch (error: any) {
      setOut({ ok: false, error: String(error?.message || error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select value={sel} onChange={(event) => setSel(event.target.value)}>
          {pbs.map((pb) => (
            <option key={pb.id} value={pb.id}>
              {pb.id}
            </option>
          ))}
        </select>
        <button onClick={run} disabled={!sel || busy}>
          {busy ? "Running…" : "Run Playbook"}
        </button>
      </div>
      <textarea
        value={params}
        onChange={(event) => setParams(event.target.value)}
        placeholder='{"ticker":"TGT"}'
        rows={5}
        style={{ width: "100%", marginTop: 8 }}
      />
      {out && (
        <div style={{ marginTop: 8 }}>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(out, null, 2)}</pre>
          {out?.data?.results && (
            <table style={{ width: "100%", marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Tool</th>
                  <th>ms</th>
                  <th>ok</th>
                </tr>
              </thead>
              <tbody>
                {out.data.results.map((row: any, index: number) => (
                  <tr key={index}>
                    <td>{row.step}</td>
                    <td>{row.tool}</td>
                    <td>{row.ms}</td>
                    <td>{String(row.ok)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
