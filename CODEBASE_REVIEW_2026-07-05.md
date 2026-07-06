# LiquidAIty — Codebase Review Brief (2026-07-05)

A point-in-time brief to accompany an external review (GPT). It states what the system **is**, what was
**cleaned**, the **verified state**, and the **open questions** where feedback is most useful. Read
[PLAN.md](./PLAN.md) (real architecture), [FUTURE.md](./FUTURE.md) (vision), [DONT.md](./DONT.md) (rules +
purge log), [AGENTS.md](./AGENTS.md) (execution law) alongside this.

---

## 0. TL;DR for the reviewer

- LiquidAIty is a **user-owned agent workbench**: a ReactFlow canvas of agent cards, a Python
  AutoGen/MagenticOne orchestrator, a persistent Harness chat, a real coder, and three graphs
  (ThinkGraph/KnowGraph/CodeGraph), wired over one Python MCP server.
- **Guiding law:** TypeScript is transport + pixels; **Python is the rails**; **the model is the brain**.
  Any decision/logic living in TS is a bug to move to Python/model. Bus edges are the only activation.
- The repo has been aggressively **de-spaghettified** — >100k lines removed over its life; **74 files /
  ~9,248 lines this session alone** — every deleted file "worked" first. See §3.
- **All four stacks build/compile and unit tests pass** (§4). The system is not yet proven end-to-end at
  runtime (needs the 4-service + 2-DB stack up; that's a human test).
- **Please focus review on the non-vendored core** (§6). Many top-level dirs are vendored experiments
  (an "any repo → an agent" idea) and are intentionally out of scope.

## 1. What the system is (the wired primitives)

Full detail in PLAN.md §"Architecture Primitives". In brief:

```txt
Harness chat (gRPC :50051, localcoder)   reads graphs, steers, writes the Run-Packet prompt
      │  backend /api/coder/openclaude/session/{chat,answer,history}
      ▼
Python MCP server (app/mcp_host.py)      ONE control surface: canvas.*/card.*/run_mag_one/
      │  spawned by backend pythonAgentMcpClient.ts   thinkgraph.get_graph_slice
      ▼  each tool → backend /api/coder/mcp-bridge/*  (single state authority)
Orchestrator (run_mag_one)               → runCardWithContract(magentic_one) → autogen :8003
      │                                     MagenticOneGroupChat; NO direct graph access
      ▼
Agent cards on the bus                   magentic_option edges = the only activation signal
      │  Coder is a normal bus card
      ▼
Coder (run_local_coder)                  → backend /localcoder/run (server injects trusted root)
                                           → LocalCoderAdapter → real coder CLI → CoderReport

Graphs (one writer each): ThinkGraph = Postgres/AGE (Harness) · KnowGraph = Neo4j (Python research)
                          · CodeGraph = CBM/SQLite (indexer)
```

Stack topology: `frontend:5173`, `backend:4000`, `autogen:8003`, `gRPC:50051` + `Postgres:5433` (sim-pg)
+ Neo4j. Run: `docker start sim-pg neo4j` then `npm run dev:all`.

## 2. Design decisions worth scrutinizing

1. **One MCP server, in Python.** There is deliberately no TS MCP server; TS (`pythonAgentMcpClient.ts`)
   is only the client that spawns/talks to `mcp_host.py`. The only TS MCP *servers* are inside the
   vendored coder (localcoder: its chrome/computer-use tool servers) — not ours.
2. **The Orchestrator has no graph access (for now).** The Harness reads graphs and distills what a run
   needs into a Markdown prompt. A bounded "slice" tool for chat is deferred (FUTURE.md).
3. **The Coder is not special.** It's a bus card the Orchestrator instructs. A prior design made it
   special and grew a TS classifier + Python classifier + gate chain + dispatch route that *never
   worked* — all deleted (DONT.md purge log, 2026-07-05).
4. **Activation = graph edges, never a name-match.** No `if title.includes('coder')` role logic; a card's
   saved config + the model define what it is.
5. **Server injects the coder's filesystem root.** The model supplies only the logical task; the trusted
   root + run id are injected in `/localcoder/run` — the model cannot pick where code runs.

## 3. What was cleaned this session (2026-07-05)

74 non-vendored files / ~9,248 lines, 6 commits, every stack green throughout:

| Commit | Files | Lines | What |
|---|---|---|---|
| `85a948e1` | 17 | −2025 | agent-builder "split-turds" (orphaned modules from a 15k-line file split never rewired) + a LangChain-removal stub route that always 500'd |
| `55ff1932` | 33 | −3740 | the old agent-builder REST subsystem (unmounted 404-line route + backing store/prompt/chain) + ~20 orphan services/connectors |
| `4ad99b56` | 24 | −3483 | knip audit: root scratch, dead jest configs (repo runs vitest; `jest.config.js` was a literal `{{ ... }}`), nx-invisible `.mjs` scripts, orphan backend source, a duplicate `urlGuard` |
| `c296210e` | 3 | docs | quantified the above + anti-habit rules into DONT/AGENTS/PLAN |
| `aae6a1df` | 3 | docs | PLAN.md → real primitives; vision → FUTURE.md |

Root causes recorded for future contributors (DONT.md): (a) a big file "split up" and the pieces never
deleted/rewired (imported only by their own spec); (b) a config/service/duplicate scaffolded "for later"
that never came.

## 4. Verified state (proof)

- **backend** `tsc -p tsconfig.app.json --noEmit` → clean; `vitest apps/backend/src` → **372 passed**.
- **client** `tsc -p tsconfig.json --noEmit` → clean.
- **core Python** `py_compile` of mcp_host/control_plane/tool_registry → clean; `pytest`
  run_local_coder + thinkgraph_card_tools + harness_mcp_wall → **25 passed**.
- **localcoder** (gRPC harness) `tsc --noEmit` → clean.
- **Seams hand-traced** to real handlers (not stubs): Harness chat, `run_mag_one`, `run_local_coder`.
- **Not verified:** live end-to-end runtime (needs the full stack up) — this is a human test. The one red
  unit test (`pythonAgentMcpClient` graph-slice) is an integration test that *requires* the live stack.

## 5. Known open items (candidates for review, NOT yet actioned)

1. **~108 unused npm dependencies** (knip). Many are declared at the wrong workspace level (root vs.
   `apps/backend` vs. `client`) and are hoisting-sensitive — needs careful per-workspace pruning, not a
   blind delete. `@alpacahq/alpaca-trade-api` is genuinely removable (the sloppy TS Alpaca path was
   deleted; trading is being redone in Python).
2. **~392 unused exports/types** (knip). Finicky and false-positive-prone (Zod schemas consumed via
   `z.infer`, contract types, public API). Recommend per-item review before removal.
3. **Broken root `eslint.config.mjs`** — imports uninstalled `eslint-plugin-unused-imports`; eslint isn't
   wired to an npm script, so it's latent, but it blocks tools like knip until worked around.
4. **`package.json "main": "jest.config.js"`** now dangles (jest configs removed). Harmless (private root
   package), cosmetic fix.
5. **`@grpc/grpc-js` + `@grpc/proto-loader` are unlisted deps** — used by `grpcChatClient.ts` but not
   declared in `apps/backend/package.json` (resolves via hoisting). Should be declared explicitly.

## 6. Scope guardrail for the reviewer — vendored = free pass

Many top-level directories are **vendored experiments** (Jeremiah's "turn any repo into an agent" idea),
excluded from CBM and intentionally out of scope. Do **not** review these for quality; they are
fixable/removable later: `Kronos-main/`, `Understand-Anything-main/`, `autogen-main/`,
`data-formulator-main/`, `gamecanvas/` `motioncanvas/` `spatialcanvas/` `videocanvas/`, `n8n/`,
`worldsignal/`, `telescope/`, `kaiwiki-site/`, `vendor/`, `repo-intake/`, and `localcoder/` (the vendored
coder engine, being rebranded). Client-side vendored surfaces: `client/src/vendor/**`, and the
experiment surfaces `skyview/`, `protein/`, `media/`, `energy/pascal*`, `modelWizard/pascal/`,
`agents/ua/real-dashboard/`.

**The core to review** is: `apps/backend/src`, `apps/python-models/app`, `services/knowgraph`,
`client/src` (excluding the vendored/experiment paths above), and the docs (`PLAN.md`, `FUTURE.md`,
`AGENTS.md`, `DONT.md`).

## 7. Where feedback is most valuable

- Is the **primitive set** (§1) the right minimal spine, or is something still redundant?
- The **Orchestrator-has-no-graph-access** decision — good simplification, or will it force ugly prompt
  bloat later?
- The **one-writer-per-graph** rule and the ThinkGraph(AGE)/KnowGraph(Neo4j)/CodeGraph(SQLite) split.
- Anywhere logic still lives in **TypeScript** that should be Python/model (the core sin we keep fighting).
- The **dep/export** cleanup (§5): safe pruning strategy for a hoisted npm workspace.
