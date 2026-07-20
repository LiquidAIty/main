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

Five runtime processes + three storage authorities — `npm run dev:all` plus the required database
containers:

```txt
frontend      :5173    Vite / React / ReactFlow canvas
backend       :4000    Express — transport, MCP bridge, deck store
autogen       :8003    Python AutoGen / MagenticOne
knowgraph     :8001    Python knowledge/provenance API
gRPC harness  :50051   localcoder — the chat + coder engine
Postgres      :5433    sim-pg — projects, decks, conversations
SQLite                 ThinkGraph — Engraphis project reasoning/state
Neo4j                  KnowGraph — sourced knowledge/provenance
```

Failure signatures: blank canvas = backend or DB:5433 down · chat no reply = gRPC:50051 down ·
chat silent = autogen down.

### 1. Harness Chat — the front door

The OpenClaude-derived gRPC Harness (`localcoder`) owns the persistent Main Chat session. Client →
backend `/api/coder/openclaude/session/{chat,answer,history}` → Harness on :50051. Main remains the
principal responder.

The source deck seed defines the Hermes card as a Main sub-agent with inherited-context/tool-grant
boundaries. The current ADMIN persisted deck does not contain that card, prompt, or edge, so source
topology is not runtime proof and database recovery remains a separate reviewed task. When the
persisted topology exists, the Harness can build a generic inherited-context `Agent` from the saved
card; that remains pre-integration plumbing, not proof that the installed Hermes runtime executed.
The missing final seam is one real Hermes process adapter. It may be launched through the OpenClaude
terminal/process boundary if that proves to be the correct installed-runtime interface.

The under-chat terminal slot belongs to OpenClaude Code/Coder. Hermes gets its own terminal or UI
when the actual Hermes runtime is integrated. Current source has the OpenClaude Code Console as a
right-side overlay and the Hermes development child-stream as the under-chat pull-up; that placement
is a known bounded UI mismatch, not the intended product boundary.

### 2. The one MCP server — the control surface

`apps/python-models/app/mcp_host.py` (Python) is the single MCP server. Spawned over stdio by backend
`services/mcp/pythonAgentMcpClient.ts`, consumed by the gRPC harness. Tools: `canvas.inspect`,
`card.update_configuration`, `card.assign_runtime_skill`, `card.assign_data_binding`, `canvas.upsert_wire`,
`card.run_assistant_agent`, `run_mag_one`, `mag_one.describe_connected_agents`, `thinkgraph.get_graph_slice`.
There is **no TS MCP server** — TS is only the client. Each tool bridges to a backend
`/api/coder/mcp-bridge/*` handler, so state has one authority.

### 3. Orchestrator (Mag One) — the team run

The intended path is: actual Hermes prepares the existing
`coder-workspace/handoff/<jobId>/prompt.md`; Main presents the plan; only after explicit user acceptance
may Main call `run_mag_one({jobId, projectId, deckId})`. The Mag One executor and worker-card paths
exist and are tested independently. A full Main → actual Hermes → approved Mag One runtime proof has
not yet happened, so documentation must not present it as complete.

### 4. Agent cards + the bus

ReactFlow cards on the canvas. **Bus connectivity (`magentic_option` edges → `resolvedMagenticOptions`) is
the ONLY activation signal** — connected = eligible, disconnected = inactive. Participants receive context
from the Orchestrator, not directly. A card's saved config (prompt, provider/model, tools, bindings) is the
source of truth for what a card *is* — never a TS name-match.

### 5. Coder — two real surfaces, not substitutes

The persistent OpenClaude console/session is the interactive Coder surface intended below Main Chat.
It owns the real PTY, input/output, resize, stop, and session lifecycle. Current UI placement is a
right-side overlay; moving the already-working surface is a later focused UI repair, not a reason to
replace its runtime.

The Local Coder card is also working and must remain. `run_local_coder(objective, …)` (Python tool) →
backend `/api/coder/localcoder/run` — **the server injects the trusted filesystem root + run id; never
the model** — → `LocalCoderAdapter` → the configured OpenClaude/Coder CLI → validated `CoderReport`.
This bounded card/tool path and the persistent terminal are different useful modes. Neither should be
deleted or replaced with a newly invented run-packet abstraction.

### 6. Graphs — one writer each

```txt
ThinkGraph   SQLite/Engraphis planning & operational reasoning; bounded Python tools write/read it
KnowGraph    Neo4j          grounded source-backed knowledge; Python research writes; Harness reads
CodeGraph    CBM (SQLite)   repo structure / edit boundaries; the CBM indexer writes
AgentGraph   future AGE     not implemented and not a current runtime authority
```

One authority per graph. No cross-writes, no UI→DB graph write.

### 7. Card runtime

`runConfiguredCard` = single-card assist (Canvas Run / Task tab). `runCardWithContract` = team run
(Orchestrator). The deck store owns saved cards + wires; provider+model resolve per card; fail closed on
missing model config.

Do not invent replacement adapter contracts around the working Coder paths. The saved Local Coder
card/tool route and persistent OpenClaude terminal already define the current boundaries. Any future
adapter must reuse the real process/session authority and fail honestly; it must not become a fake
fallback or a second orchestration system.

Guards: every route 403s in production; probes default dry-run; a live call is a REAL single-card
run through the canonical executor (no fake outputs, no minted graph authority); report
verification is deterministic (no LLM grades work). DB roles stay as documented in FUTURE.md:
Prisma = auth/session only; raw pg JSONB = deck/conversation app state; SQLite/Engraphis =
ThinkGraph; Neo4j = KnowGraph; CBM = CodeGraph; AGE = future AgentGraph only; dev telemetry/reports = coder-workspace JSONL, never
product analytics.

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
hoisting-sensitive) and ~392 unused exports/types (finicky — review before cutting). The root
`eslint.config.mjs` works again (verified 2026-07-08 — `eslint-plugin-unused-imports` is installed;
`npx eslint <file>` exits 0).

## Near-Term Route

The primitives run end-to-end: **chat → orchestrator → cards → coder**, with each seam proven.
The repo has been cleaned down to the Launch core: non-core experiments (video, image, energy,
modeling, Understand-Anything, telescope, game/motion/spatial canvases) removed. ~200K lines of
dead code purged across the project's life, lessons encoded in DONT.md.

Next: pull capabilities from [FUTURE.md](./FUTURE.md) in order. The current batch breakdown
and product vision live in FUTURE.md.

### Fable 5 — Actual Hermes Integration (current)

The useful pre-integration chain is retained:

```txt
saved Hermes card + prompt + persisted Main→Hermes authority
→ Harness sub-agent selection
→ inherited parent context + saved tool grants
→ one missing real Hermes process adapter
```

Do not delete that chain and do not rename a generic model call into “Hermes.” The former
`hermes_review_completed_job` not-implemented tool scaffold has been removed: actual review work
begins only when a real runtime adapter and completed-job artifact boundary are ready. First prove
the installed Hermes executable, invocation/session mode, working directory, prompt input,
output/stream behavior, and tool/MCP surface. Then connect exactly one bounded adapter and give
Hermes its own terminal/UI. The OpenClaude Coder terminal remains below Main Chat.

The ADMIN database currently lacks the persisted Hermes card, prompt, and edges because prior cleanup
mutated durable data. Source/seed recovery does not restore PostgreSQL. Restore that data only through
an explicit, reviewed, read-back-proven database recovery step.

### Feature Context Resolver (deferred to Fable 6+)

After Hermes is integrated and ThinkGraph has run data, the Feature Context Resolver
becomes the next foundation:

Its job:

```
explicitly selected wiki/*.md feature manifest(s)
→ fresh CBM anchor resolution (search_graph + trace_path on declared symbols/files)
→ bounded live source, test, and context retrieval
→ Feature Context inserted into the CoderPacket
```

Agent usefulness comes first. Graph UI filtering is a later consumer of the same
resolver output. Do not build visual CodeGraph filtering before feature-context
loading works. Do not create an automatic feature classifier or phrase-based router —
primary and supporting features are selected by the planner, Task Ledger, or current
SPEC, never inferred by the resolver.

## Durable docs

```txt
PLAN.md      current product route and build order
ARCHITECTURE.md current system map and operating boundaries
FUTURE.md    product vision & deferred features
AGENTS.md    execution law
DONT.md      what not to write (+ purge log)
wiki/*.md    feature manifest registry (flat, one file per feature)
skills/*.md  reusable proven procedures
```

Nothing else durable by default. `PLAN.md` is the current route, `ARCHITECTURE.md` is the system map,
and temporary implementation prompts are not permanent specs unless explicitly promoted to a skill.
