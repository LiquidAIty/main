# Nx

# LiquidAIty — Agentic AI Core

**One backend. Multi‑head frontends. Agent‑0 orchestration. Department agents with tools, memory, and automation.**

This document is the canonical, developer‑focused README for the current system. It covers runtime architecture, agent patterns, math & evaluation, data viz, multi‑head UX, and how to extend every layer without breaking what’s working.

---

## 0) Elevator Pitch

* **Agent‑0 (Supervisor)** plans → fans out to department agents **in parallel** → reduces to a combined answer + per‑dept results.
* **Department Agents** (OpenAI dept live; others templated) each have:

  * an LLM (OpenAI or OpenRouter/DeepSeek),
  * a **toolbelt**: `mcp_call`, `n8n_call_webhook`, `memory_op`, optional `spawn_subagents`,
  * a clear persona and keywords for routing.
* **One backend** (Express + LangGraph) serves **all tools/agents** via `/api/sol/*` and `/api/tools/:id`.
* **Multi‑head UI** (Lab Chat today; Builder/Reader later) talk the same contract: `POST /api/sol/run → { combined, results }`.
* **Data viz** is normalized once (backend) and rendered via Plotly **or** TradingView Lightweight on the client.

---

## 1) Monorepo Layout (Nx)

```
apps/
  backend/                 # Express + LangGraph runtime
    src/
      routes/              # /api endpoints (sol/tools/debug)
      agents/              # Agent‑0, factory, tools, connectors
      config/              # Sol/router configs
  client/                  # React + Vite + Tailwind (Lab head)
    src/                   # pages, app, main, styles
```

**Key contracts**

* `POST /api/sol/run` — Agent‑0 route+execute. Input `{ q }`, output `{ ok, executed, results, combined }`.
* `POST /api/tools/:id` — Call a specific department agent. Body `{ prompt, provider?, n8nWebhook?, threadId? }`.
* `GET /api/sol/tools` — Registry listing & health.

---

## 2) Runtime Flow

```
User → /api/sol/run { q }
  Agent‑0.plan(q) → { depts: [openai, google, ...], handoffs }
  parallel(depts.map(d => d.run(handoffs[d] || { prompt: q })))
  Agent‑0.reduce(results) → { combined, perDept }
  return { ok:true, executed:[...], results: perDept, combined }
```

### Department Agent (via `agentFactory`)

* Builds a LangGraph with:

  * **LLM node** (OpenAI/OpenRouter)
  * **Tools**:

    * `mcp_call(server, tool, args)` — MCP shim; can map to n8n webhooks or real MCP servers.
    * `n8n_call_webhook(url, payload)` — deterministic automations.
    * `memory_op({ op:'put|get|all', key?, value? })` — delegates to the existing memory tool.
    * optional `spawn_subagents(tasks:[{id,prompt}])` — fanned sub‑calls to other tools.

---

## 3) Agent Patterns (ready‑to‑template)

* **Planner → Executor** (default Agent‑0): separate planning from execution.
* **ReAct**: reason → act (tool) → observe → repeat (bounded loops for safety).
* **Toolformer**: autonomous choice of tools when the question demands it.
* **Multi‑Agent Collaboration**: role‑specialized departments with narrow scopes.
* **Memory‑Augmented**: persistent per‑thread or per‑agent facts (KV now; DB later).
* **Self‑Reflective**: post‑hoc evaluator pass for factuality/consistency.

**Blueprint JSON (concept)**

```json
{
  "id": "planner-executor",
  "nodes": [
    { "id": "planner", "type": "planner", "model": "openai:gpt-4.1-mini" },
    { "id": "executor", "type": "tool-executor", "tools": ["openai","google","scraper"] }
  ],
  "edges": [["planner","executor"]],
  "memory": { "kind": "kv", "scope": "agent" }
}
```

---

## 4) Math & Evaluation (pragmatic & pluggable)

### Routing Score (Agent‑0)

* **Keyword score**: `s_kw = matches / total_keywords`.
* **Recency boost** (if `q` mentions time): `s_rec ∈ {0, 0.1}`.
* **Historical success** (future): moving average success per dept.
* **Composite**: `score = 0.7*s_kw + 0.2*s_rec + 0.1*s_hist`.
* Select top‑K (K≤3) departments above threshold τ (default 0.3).

### LLM Inference Hygiene

* Avoid forcing `temperature=0` on models that require default.
* For long outputs, prefer **structured schema** (JSON) + short free‑text summary.
* Use provider‑specific baseURL only when needed (OpenRouter, local servers).

### Time‑Series & Trading (when enabled)

* **Signals**: SMA/EMA, ATR bands, RSI; Bayesian change‑points.
* **Risk**: max drawdown, Sharpe, hit‑rate.
* **Backtest**: walk‑forward; avoid leakage; report MAPE/SMAPE.

### RAG Quality (when enabled)

* Chunking: 512–1024 tokens; overlap 10–20%.
* Embeddings: cosine; top‑k = 5–8; **MMR** optional.
* Evaluate with nDCG\@k / Recall\@k.

---

## 5) Data Visualization (normalized once)

**Backend** builds a normalized payload; **Frontend** renders with Plotly or TradingView Lightweight.

**Chart payload (example)**

```json
{
  "kind": "candles",
  "series": [
    { "name": "NVDA", "values": [{"t": 1719379200000, "o": 100, "h": 104, "l": 99, "c": 102}, ...] }
  ],
  "overlays": [
    { "type": "band", "name": "ATR", "values": [{"t": 1719379200000, "u": 105, "l": 98}, ...] }
  ],
  "annotations": [
    { "t": 1719465600000, "text": "Earnings" }
  ]
}
```

**Templates**

* Candlesticks + probability bands
* Multi‑axis line (price vs. factor)
* Heatmap (sector/alpha buckets)
* Event ribbons (earnings, news, regime changes)

---

## 6) Multi‑Head UI, One Backend

* **Lab Head** (now): `/lab/agent` — chat + per‑dept panes, Mock/Live toggle.
* **Builder Head** (next): create/edit agent **blueprints**; link n8n flows; deploy.
* **Reader Head** (optional): read‑only dashboards/reports.

All heads call the **same** API:

* Chat: `POST /api/sol/run { q }`.
* Admin: `POST /api/agents/*` (blueprints, instantiate, run) — when enabled.

**Streaming** (optional): upgrade `/sol/run` to SSE for token streaming & live tool logs.

---

## 7) n8n & MCP (no vendor lock‑in)

* `mcp_call(server, tool, args)` maps to **n8n webhooks** today; later to real MCP servers.
* `n8n_call_webhook(url, payload)` triggers deterministic flows (scrape, search, python‑exec, memory DB, etc.).
* Agents can **propose** automations (JSON spec) → you approve → backend creates the workflow and returns the webhook URL.

**Safety knobs**

* Only allow privileged operations (create/deploy) when a `SECURITY_TOKEN` matches.
* Log every external call with redacted payloads.

---

## 8) Developer Ergonomics (Windows‑friendly)

* **Run**

  * Backend: `npx nx serve backend`
  * Client: `npx nx run @nx/client:serve -- --open --port=5173 --strictPort`
* **Proxy**: Vite proxies `/api` → `http://localhost:4000`.
* **Nx Daemon**: `npx nx daemon --start` (or set `useDaemonProcess: true`).
* **PowerShell tips**

  * Always set `$base = "http://localhost:4000/api"` before `irm`.
  * Forward Vite flags after `--` when using Nx.

---

## 9) Add a New Department Agent (1 minute)

1. Create `apps/backend/src/agents/tools/<name>.ts`:

```ts
import { createDeptAgent } from "../lang/agentFactory";
export const googleTool = createDeptAgent({
  id: "google",
  name: "Google Search",
  defaultPersona: [
    "You are the Search Department.",
    "Use mcp_call(server:'n8n', tool:'workflow.run', args:{ name:'search', query:'...' }).",
    "Or n8n_call_webhook(url:'/webhook/search', payload:{ query:'...' }).",
    "Store quick facts with memory_op put/get. Be concise, cite sources briefly."
  ].join("\n"),
  matchKeywords: ["google","search","news","web","query"]
});
```

2. Register in `registry.ts` (add to `TOOL_LIST`).
3. Smoke test:

```pwsh
$base = "http://localhost:4000/api"
$b = @{ prompt = "latest on NVDA; cite 3 sources" } | ConvertTo-Json
irm "$base/tools/google" -Method POST -ContentType "application/json" -Body $b
```

---

## 10) Prompts (drop‑ins)

**Agent‑0 (router/supervisor)**

```
You are Agent‑0. Plan briefly, then select up to 3 departments to run in parallel.
Return JSON: { plan, chosen_departments: string[], handoffs: { [id]: any } }.
Do not make up tools. Prefer departments whose keywords match the query intent.
```

**Department template**

```
You are the {department_name} department.
Tools: mcp_call, n8n_call_webhook, memory_op, (optional) spawn_subagents.
Follow Agent‑0 plan. If unclear, ask one clarification question.
Return JSON: { summary, evidence?: any[], next?: string[] }.
```

**MCP autobuilder (to draft blueprints)**

```
Draft a LangGraph blueprint JSON for pattern "{pattern}" using tools {tools}.
Include nodes (with ids/types), edges, and minimal system prompts per node.
Assume model "{model}". Return JSON only.
```

---

## 11) Roadmap (conservative + powerful)

* **Blueprint store**: save/load agent graphs; versioned.
* **Graph trace viewer**: visualize plan → parallel runs → reduction.
* **Streaming & tool logs**: SSE with partials and per‑dept spans.
* **RAG + vector DB**: add embeddings, citations, evaluation.
* **Trading & research agents**: connectors, backtests, risk dashboards.
* **Multi‑tenant**: per‑tenant registries, usage metering, role guards.

---

## 12) Ops & Security

* Do not log secrets. Only log **presence** booleans for env.
* Rate limit external calls; add exponential backoff for flaky providers.
* Add `/metrics` (p50/p95 latency per tool; success/error counters).
* Optional: audit log middleware → DB (tool, duration, status, redacted args).

---

## 13) Quick Troubleshooting

* **5173 404** → missing `apps/client/index.html` or wrong entry import.
* **Invalid URI in PowerShell** → forgot `$base`.
* **OpenAI 400 (temperature)** → don’t override temperature on models that forbid it.
* **Provider 401** → wrong key or wrong baseURL; set `configuration.baseURL` for OpenRouter.
* **/sol/tools missing agent** → not added to `TOOL_LIST` or file unsaved.

---

### You now have: one backend, many agents, multiple heads —

**and a clean path to an Agent Builder without tearing up the core.**


<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

✨ Your new, shiny [Nx workspace](https://nx.dev) is ready ✨.

[Learn more about this workspace setup and its capabilities](https://nx.dev/nx-api/node?utm_source=nx_project&amp;utm_medium=readme&amp;utm_campaign=nx_projects) or run `npx nx graph` to visually explore what was created. Now, let's get you up to speed!

## Run tasks

To run the dev server for your app, use:

```sh
npx nx serve backend
```

To create a production bundle:

```sh
npx nx build backend
```

To see all available targets to run for a project, run:

```sh
npx nx show project backend
```

These targets are either [inferred automatically](https://nx.dev/concepts/inferred-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or defined in the `project.json` or `package.json` files.

[More about running tasks in the docs &raquo;](https://nx.dev/features/run-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Add new projects

While you could add new projects to your workspace manually, you might want to leverage [Nx plugins](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) and their [code generation](https://nx.dev/features/generate-code?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) feature.

Use the plugin's generator to create new projects.

To generate a new application, use:

```sh
npx nx g @nx/node:app demo
```

To generate a new library, use:

```sh
npx nx g @nx/node:lib mylib
```

You can use `npx nx list` to get a list of installed plugins. Then, run `npx nx list <plugin-name>` to learn about more specific capabilities of a particular plugin. Alternatively, [install Nx Console](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) to browse plugins and generators in your IDE.

[Learn more about Nx plugins &raquo;](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) | [Browse the plugin registry &raquo;](https://nx.dev/plugin-registry?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Set up CI!

### Step 1

To connect to Nx Cloud, run the following command:

```sh
npx nx connect
```

Connecting to Nx Cloud ensures a [fast and scalable CI](https://nx.dev/ci/intro/why-nx-cloud?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) pipeline. It includes features such as:

- [Remote caching](https://nx.dev/ci/features/remote-cache?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task distribution across multiple machines](https://nx.dev/ci/features/distribute-task-execution?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Automated e2e test splitting](https://nx.dev/ci/features/split-e2e-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task flakiness detection and rerunning](https://nx.dev/ci/features/flaky-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

### Step 2

Use the following command to configure a CI workflow for your workspace:

```sh
npx nx g ci-workflow
```

[Learn more about Nx on CI](https://nx.dev/ci/intro/ci-with-nx#ready-get-started-with-your-provider?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Install Nx Console

Nx Console is an editor extension that enriches your developer experience. It lets you run tasks, generate code, and improves code autocompletion in your IDE. It is available for VSCode and IntelliJ.

[Install Nx Console &raquo;](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Useful links

Learn more:

- [Learn more about this workspace setup](https://nx.dev/nx-api/node?utm_source=nx_project&amp;utm_medium=readme&amp;utm_campaign=nx_projects)
- [Learn about Nx on CI](https://nx.dev/ci/intro/ci-with-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Releasing Packages with Nx release](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [What are Nx plugins?](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

And join the Nx community:
- [Discord](https://go.nx.dev/community)
- [Follow us on X](https://twitter.com/nxdevtools) or [LinkedIn](https://www.linkedin.com/company/nrwl)
- [Our Youtube channel](https://www.youtube.com/@nxdevtools)
- [Our blog](https://nx.dev/blog?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
