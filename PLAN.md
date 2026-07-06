# LiquidAIty PLAN.md — the actual architecture

LiquidAIty is a **user-owned agent workbench for serious, long-lived work** — a durable space where
plans, evidence, decisions, skills, code context, agents, and reviews stay connected and remixable over
time. It is not a chat app, a dashboard generator, or a pile of markdown task files.

**This file is the real architecture: the primitives that exist and are wired today.** The full product
vision — the Plan object + canvas, the evaluator loop, the trading vertical, context policy, the skills
snowball — lives in [FUTURE.md](./FUTURE.md). Build the primitives first; pull a capability from FUTURE
only when the primitive it depends on is proven.

Law in one breath: **TS = transport/pixels, Python = rails, models = brain.** Bus edges are the only
activation signal. No TS brain, no fallbacks, no fake success. Full rules: [AGENTS.md](./AGENTS.md)
(execution law) and [DONT.md](./DONT.md) (what not to write).

---

## The Architecture Primitives (what is actually wired)

### Stack topology

Four services + two DBs — `npm run dev:all` plus `docker start sim-pg neo4j`:

```txt
frontend      :5173    Vite / React / ReactFlow canvas
backend       :4000    Express — transport, MCP bridge, deck store
autogen       :8003    Python AutoGen / MagenticOne
gRPC harness  :50051   localcoder — the chat + coder engine
Postgres      :5433    sim-pg — decks, conversations, ThinkGraph (AGE)
Neo4j                  KnowGraph
```

Failure signatures: blank canvas = backend or DB:5433 down · chat no reply = gRPC:50051 down ·
chat silent = autogen down.

### 1. Harness Chat — the front door

The gRPC harness (`localcoder`) over a persistent session. Client → backend
`/api/coder/openclaude/session/{chat,answer,history}` → harness on :50051. The Harness reads the graphs,
steers the conversation, and authors the Markdown **prompt** (Run Packet) the Orchestrator runs. It is
the only component with direct graph access today.

### 2. The one MCP server — the control surface

`apps/python-models/app/mcp_host.py` (Python) is the single MCP server. Spawned over stdio by backend
`services/mcp/pythonAgentMcpClient.ts`, consumed by the gRPC harness. Tools: `canvas.inspect`,
`card.update_configuration`, `card.assign_runtime_skill`, `card.assign_data_binding`, `canvas.upsert_wire`,
`card.run_assistant_agent`, `run_mag_one`, `mag_one.describe_connected_agents`, `thinkgraph.get_graph_slice`.
There is **no TS MCP server** — TS is only the client. Each tool bridges to a backend
`/api/coder/mcp-bridge/*` handler, so state has one authority.

### 3. Orchestrator (Mag One) — the team run

`run_mag_one({projectId, deckId, promptMarkdown})` → backend `/mcp-bridge/run_mag_one` →
`runCardWithContract(magentic_one card)` → autogen :8003 `MagenticOneGroupChat`. Runs the Harness-authored
prompt with the bus-connected cards as participants. **No direct graph access** — everything it needs is
distilled into the prompt (Orchestrator graph access is deferred; see FUTURE.md).

### 4. Agent cards + the bus

ReactFlow cards on the canvas. **Bus connectivity (`magentic_option` edges → `resolvedMagenticOptions`) is
the ONLY activation signal** — connected = eligible, disconnected = inactive. Participants receive context
from the Orchestrator, not directly. A card's saved config (prompt, provider/model, tools, bindings) is the
source of truth for what a card *is* — never a TS name-match.

### 5. Coder — a normal bus card

`run_local_coder(objective, …)` (Python tool) → backend `/api/coder/localcoder/run` — **the server injects
the trusted filesystem root + run id; never the model** — → `LocalCoderAdapter` → the real coder CLI →
authoritative `CoderReport`. The Coder is not special: it's a bus card the Orchestrator instructs, with full
coding ability + CBM.

### 6. Graphs — one writer each

```txt
ThinkGraph   Postgres/AGE   planning & operational reasoning; Harness writes (MCP card-scoped tools),
                            reads via thinkgraph.get_graph_slice → /thinkgraph/graph-view
KnowGraph    Neo4j          grounded source-backed knowledge; Python research writes; Harness reads
CodeGraph    CBM (SQLite)   repo structure / edit boundaries; the CBM indexer writes
```

One authority per graph. No cross-writes, no UI→DB graph write.

### 7. Card runtime

`runConfiguredCard` = single-card assist (Canvas Run / Task tab). `runCardWithContract` = team run
(Orchestrator). The deck store owns saved cards + wires; provider+model resolve per card; fail closed on
missing model config.

---

## How we build — round-robin

One real capability at a time, top to bottom:

```txt
one capability
→ make it work in isolation
→ prove it with real runtime/data behavior
→ connect it to already-proven capabilities
→ prove the integrated path
→ refactor only when proof exposes a seam failure
→ next capability
```

No giant rewrite. No subsystem is "done" because code exists — it is done when it runs, is proven, and the
old path it replaced is deleted.

## Batch 0 — Codebase Health (cleanup status, 2026-07-05)

The point of the cleanup is **function over form: make it easier to write good code in good code, not
spaghetti-soup.** A legible base is the prerequisite for every capability.

Running tally (see [DONT.md](./DONT.md) purge log for the itemized record): **>100,000 lines** of
dead/spaghetti removed across the project's life. The 2026-07-05 audit sweep alone deleted **74
non-vendored files / ~9,248 lines** in commits `85a948e1`, `55ff1932`, `4ad99b56` — client tsc, backend
tsc, and 372 backend unit tests green throughout. Every deleted file "worked" first.

Verified state: all four stacks build/import clean (backend tsc, client tsc, Python core compile + 25
MCP/coder tests, localcoder gRPC harness tsc); the core seams (`run_mag_one`, `run_local_coder`, Harness
chat) are wired to real handlers, not stubs. One red test remains: a pre-existing live-stack integration
test (`pythonAgentMcpClient` graph-slice) that needs the full running stack.

**The rule this buys us — future agents obey it:** the dead code came from two habits — (1) splitting a big
file and never deleting/rewiring the pieces, and (2) scaffolding a config/service/duplicate "for later."
Do neither. Delete-with-replace; no placeholders, no duplicates, no `.mjs`. Vendored top-level repos are a
free pass (excluded from CBM); everything else stays clean.

Still open (reported, not actioned): ~108 unused npm deps (knip — careful per-workspace review,
hoisting-sensitive), ~392 unused exports/types (finicky — review before cutting), and the broken root
`eslint.config.mjs` (imports uninstalled `eslint-plugin-unused-imports`).

## Near-Term Route

Get the primitives above running end-to-end and legible: **chat → orchestrator → cards → coder**, on real
graph reads, with each seam proven. Then pull the next capability from [FUTURE.md](./FUTURE.md) — starting
with Batch A (graph truth + context). The full batch breakdown and product vision live in FUTURE.md.

## Durable docs

```txt
PLAN.md      this — real architecture + build route
FUTURE.md    product vision & deferred features
AGENTS.md    execution law
DONT.md      what not to write (+ purge log)
skills/*.md  reusable proven procedures
```

Nothing else durable by default. `PLAN.md` is current architecture and route; temporary implementation
prompts are not permanent specs unless explicitly promoted to a skill.
