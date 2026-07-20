# LiquidAIty Architecture

## Product

LiquidAIty is a user-owned agentic engineering and research workbench. Main Chat steers work; saved
cards define agents and tools; the canvas shows card topology; Python rails run model/team logic; and
three graph authorities retain reasoning, sourced knowledge, and code structure.

The repository rule is:

```txt
TypeScript = transport and pixels
Python rails = execution and data rails
models = reasoning
```

There is no Runtime Observatory or RunManifest subsystem. Development proof comes from focused tests,
runtime responses, durable job artifacts, and direct inspection of the real authorities.

## Runtime topology

`npm run dev` performs a guarded fresh restart. `npm run dev:all` starts or reuses the five normal
development processes:

| Process | Port | Owner | Start command |
| --- | ---: | --- | --- |
| Vite frontend | 5173 | `client/` | `npm run dev:frontend` |
| Express backend | 4000 | `apps/backend/` | `npm run dev:backend` |
| KnowGraph API | 8001 | `services/knowgraph/` | `npm run dev:knowgraph` |
| AutoGen/Mag One rails | 8003 | `apps/python-models/` | `npm run dev:autogen` |
| OpenClaude-derived gRPC Harness | 50051 | `localcoder/` | `npm run dev:grpc` |

PostgreSQL normally listens on 5433 and owns projects, saved decks, and conversations.
Neo4j normally listens on 7474/7687 and owns KnowGraph. ThinkGraph is SQLite/Engraphis. CodeGraph is
the CBM index. Startup guards reuse only verified healthy LiquidAIty processes and refuse unknown port
owners.

## Current working workflow

```txt
Main Chat
→ backend OpenClaude session route
→ persistent gRPC Harness session
→ saved Main card provider/model/tools
→ optional saved sub-agent/tool calls
→ streamed answer and durable conversation

Approved team work
→ saved Magentic-One card plus magentic_option-connected worker cards
→ backend transport
→ Python AutoGen/MagenticOneGroupChat
→ native team execution and task-ledger artifact
→ result and job-folder artifacts
```

The current ADMIN deck readback on 2026-07-20 contained six cards and six edges. Its Main card used
OpenRouter `z-ai/glm-5.2`; Magentic-One used OpenRouter `openai/gpt-5.1-chat`; and Local Coder used
OpenRouter `z-ai/glm-5.2`. Provider/model authority is per saved card, so these values can change when
the owner edits the deck. Source seeds are defaults and compatibility anchors, not proof of current
persisted state.

## The two coding paths

### Direct OpenClaude Code console

The Code Console is an interactive persistent local process. The backend owns its `node-pty` session,
transcript stream, input, resize, interrupt, and stop lifecycle. The client renders the session with
xterm. It is bound to `C:/Projects/main` and runs with the machine's permissions; it is not a sandbox.

The intended product position is directly below Main Chat. Current source mounts the console as an
absolute right-side overlay opened from the workspace rail. The under-chat pull-up currently renders a
Hermes-labelled development child stream. This is a bounded placement mismatch; it does not invalidate
the working PTY/session and should be repaired as a focused UI change.

Primary landmarks:

- `client/src/features/agentbuilder/console/OpenClaudeConsolePanel.tsx`
- `client/src/features/agentbuilder/console/XtermView.tsx`
- `apps/backend/src/coder/openclaude/console/consoleSession.ts`
- `apps/backend/src/routes/coder.routes.ts`
- `localcoder/src/grpc/server.ts`

### Local Coder card

Local Coder is a separate bounded coding path. The `card_local_coder` saved card selects its
provider/model/tool configuration. Python `run_local_coder` calls
`/api/coder/localcoder/run`; the backend injects the trusted filesystem root and run identity; the
LocalCoder service invokes the configured OpenClaude CLI; and success requires a validated
CoderReport.

Primary landmarks:

- `apps/backend/src/coder/localcoder/adapter.ts`
- `apps/backend/src/coder/localcoder/service.ts`
- `apps/backend/src/cards/localCoderController.ts`
- `apps/python-models/app/python_models/tool_registry.py`
- `client/src/features/agentbuilder/deck/deckSeed.ts`
- `repo-intake/localcoder-boundary.md`

The console is interactive and session-oriented. Local Coder is bounded and report-oriented. Neither
is a fallback for the other, and neither should be replaced with another generic adapter layer.

## Cards, prompts, bindings, edges, and decks

The saved deck document is runtime authority. A card carries its stable ID, template, prompt,
`runtimeType`, optional `runtimeBinding`, provider/model options, tool grants, and other typed runtime
options. Edges carry source/target IDs, handles, and an edge type.

Important edge meanings:

- `magentic_control`: Main controls the Mag One entry point.
- `magentic_option`: a saved worker card is eligible for Mag One participation.
- `flow`: a product/data-flow relationship; it does not silently activate a Mag One worker.
- `hermes_observe`: the current source-seed Main-to-Hermes pre-integration relationship; it is not
  proof that an external Hermes process ran.

Default templates and the initial source topology live in
`client/src/features/agentbuilder/deck/deckSeed.ts`. Client hydration/normalization lives in
`deckDocument.ts`; backend persistence and normalization live in `apps/backend/src/decks/store.ts`;
shared runtime resolution lives in `apps/backend/src/cards/runtime.ts`; and Python validates the
received card graph before creating AutoGen participants.

The current ADMIN persisted deck does not contain the source-seeded Hermes card/prompt/edges or the
source-seeded ThinkGraph/KnowGraph/CodeGraph cards. Git recovery cannot restore that database state.
Any repair must be a separate explicit database migration or reviewed deck save with readback.

## Mag One

Mag One is real Microsoft AutoGen/Magentic-One on Python rails. The backend transports saved cards,
edges, and mission input; Python builds the native participant set; bus connectivity decides
eligibility; and the native orchestrator produces team work and the task-ledger artifact.

Keep:

- `MagenticOneGroupChat` and the vendored AutoGen line;
- saved worker-card selection;
- parent/child execution and job-folder returns;
- real task-ledger facts, plan, team, and full ledger;
- loud failures when a selected model, tool, card, or service is unavailable.

Do not add TypeScript planning logic or a fake Mag One fallback.

## Hermes boundary

Actual Hermes is not implemented in this repository today. The useful pre-integration boundary is:

```txt
source Hermes card + prompt + intended Main edge
→ inherited Main context and saved tool grants
→ one future real installed-process adapter
→ a separate Hermes terminal/UI
```

The source has Harness sub-agent selection and Hermes report/memory/graph seams, but a generic Harness
agent named Hermes is not the installed Hermes runtime. The former enabled
`hermes_review_completed_job` tool, which only returned not-implemented, was removed. Do not restore
Observatory/RunManifest, create another fake reviewer, or claim runtime proof until the real
executable, session behavior, working directory, input/output, and MCP/tool surface are proven.

## Graph authorities

### ThinkGraph

ThinkGraph is project reasoning and operational state in SQLite/Engraphis. Python rails own its
bounded reads and writes. It is not Neo4j and not AGE.

### KnowGraph

KnowGraph is sourced knowledge and provenance in Neo4j. Python ingestion/research owns writes. The
current KnowGraph route and `services/knowgraph` API expose retrieval and analysis without merging AGE
results.

### CodeGraph

CodeGraph is repository structure from Code-Based Memory. The CBM indexer is the only writer. Product
code uses thin MCP calls for status/search; developers use the canonical
`skills/codebasedmemory.md` workflow. Direct source and tests win when graph memory disagrees.

### KnowledgeGraphFramework

`client/src/components/knowledge/KnowledgeGraphFramework.tsx` is the unified graph workspace shell.
It selects and renders the current ThinkGraph, KnowGraph, and CodeGraph surfaces without becoming a
fourth data authority.

### Future AgentGraph

Apache AGE is reserved for a future AgentGraph. It is not mounted as a current product graph, must not
be merged into KnowGraph, and must not be built during ordinary cleanup.

## Trading and retained specialists

The trading surface and specialist systems are retained boundaries, not cleanup residue:

- `client/src/pages/tradingui.tsx` and Python Alpaca read-only market tools;
- `worldsignal/` plus its backend/client bridge;
- the protected `Kronos-main` submodule and model-adapter boundary;
- `services/esn_rls/`;
- `services/energyplus-runner/`;
- EDGAR/SEC ingestion, evidence, and cached source data.

Mock balances, fake signals, synthetic proof, and duplicate panels are deletable when individually
proven dead. The actual source, data, tests, and adapter boundaries are protected.

## Ownership by language

- React/TypeScript client: canvas, chat, console rendering, graph/trading surfaces, editors, and
  typed transport.
- Node/TypeScript backend: HTTP/SSE transport, saved-deck/conversation access, model/tool resolution,
  process/session ownership, security boundaries, and Python/gRPC bridges.
- Python rails: AutoGen/Mag One, single-card agents, tool execution, graph/data rails, and specialist
  computation.
- Vendored runtimes: `localcoder/`, `autogen-main/`, `worldsignal/`, and `Kronos-main` retain their
  upstream boundaries and are not ordinary cleanup targets.

## Adding a card

1. Decide whether it is a real runnable agent, a controller, or a UI/data card. Do not create a card
   for a speculative service.
2. Add/update the typed template and default instance in `deckSeed.ts` only when new projects need it.
3. Keep stable IDs and update matching client/backend runtime types and normalizers.
4. Add an explicit saved prompt, provider/model, binding, and only the tools it may call.
5. Add the intended edge with real source/target handles. Use `magentic_option` only when the card
   should participate in Mag One.
6. Prove hydration, save/readback, persisted-data compatibility, canvas rendering, and the focused
   runtime path. Existing decks require an explicit reviewed migration; a seed edit alone does not
   update them.

## Adding a runtime

1. Prove the real executable/service and its invocation, session, cwd, input/output, cancellation,
   tool, and failure behavior first.
2. Put reasoning/execution on Python rails unless it is specifically a backend-owned local process
   boundary such as the existing PTY.
3. Extend the existing synchronized runtime type/binding fields; do not create a parallel card or job
   schema.
4. Resolve provider/model/tool grants from the saved card and fail closed when any are missing.
5. Wire one route and one owner. Do not add a silent fallback or generic substitute.
6. Add focused source tests, transport tests, persistence readback, and a real runtime smoke before
   calling it working.

## Validation

Run checks separately so failures retain their owner:

```powershell
npm --workspace apps/backend run typecheck
npm --workspace apps/backend run typecheck:spec
npm --workspace client run typecheck
npm --workspace client run typecheck:spec
npm --workspace apps/backend run build
npm --workspace client run build
npx vitest run
apps/python-models/.venv/Scripts/python.exe -m pytest apps/python-models/app/python_models
services/knowgraph/.venv/Scripts/python.exe -m pytest services/knowgraph
npm run mcp:check
```

Use narrower focused suites first when changing one boundary. A live full-stack probe additionally
requires PostgreSQL, Neo4j, all five processes, provider credentials, and acceptance of real model
cost.

## Intentionally unavailable or incomplete

- Actual Hermes process integration and its separate UI.
- Persisted ADMIN Hermes/graph cards and edges; source seed presence is not database recovery.
- Literal below-chat placement of the working OpenClaude console.
- Full Main → actual Hermes → approved Mag One end-to-end proof.
- Future Apache AGE AgentGraph.
- Runtime Observatory and RunManifest; both are intentionally absent.

These states must remain explicit. Do not hide them with placeholders, fake success, generic model
substitution, or deterministic prose repair.
