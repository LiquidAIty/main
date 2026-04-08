import React, { useState } from "react";

export default function BossAgent() {
  const [goal, setGoal] = useState("say hello in 5 words");
  const [res, setRes] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  const run = async () => {
    setLoading(true);
    setErr("");
    setRes("");
    try {
      const r = await fetch(`/api/sol/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const j = await r.json();
      setRes(j?.combined ?? JSON.stringify(j));
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", fontFamily: "inter, system-ui, sans-serif" }}>
      <h1>🎯 Boss Agent (SOL quick test)</h1>
      <label style={{ display: "block", marginBottom: 8 }}>Goal</label>
      <input
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
      />
      <button
        onClick={run}
        disabled={loading}
        style={{ marginTop: 12, padding: "10px 16px", borderRadius: 8 }}
      >
        {loading ? "Running..." : "Run"}
      </button>

      {err && (
        <pre style={{ color: "#b00020", background: "#fff5f5", padding: 12, borderRadius: 8, marginTop: 16 }}>
          {err}
        </pre>
      )}
      {res && (
        <pre style={{ background: "#f7f7f9", padding: 12, borderRadius: 8, marginTop: 16 }}>
          {res}
        </pre>
      )}
    </div>
  );
}
