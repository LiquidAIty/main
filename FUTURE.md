# FUTURE.md — LiquidAIty product vision & deferred work

This file holds the **aspirational product vision** and **deferred features**. It was split out of
`PLAN.md` on 2026-07-05 so that PLAN.md leads with the *actual* wired architecture primitives.
Nothing here is load-bearing today — build the primitives in [PLAN.md](./PLAN.md) first, then pull a
capability from here only when the primitive it depends on is proven. Same law applies:
[DONT.md](./DONT.md) and [AGENTS.md](./AGENTS.md) govern; no fakes, one writer per graph,
TS on Python rails with AI brain.

Repo state (2026-07-09): cleaned to Launch core. Non-core experiments removed (~200K lines
deleted). DONT.md encodes lessons from the purge. The three-graph system (ThinkGraph, KnowGraph,
CodeGraph) and trading wedge (WorldSignals, Kronos, Alpaca, SEC filings) are wired. Hermes
integration is the current Fable 5 target — completing the loop with verification, persistence,
and context compounding.

---

## Work-In-Progress Inventory (2026-07-09 deep clean)

Every parked or half-done piece, named so it is documented instead of sprawled. Nothing below is
part of the active research loop until its own pass wires it in.

- **Trading research tool (launch wedge, active WIP)** — `client/src/pages/tradingui.tsx` (TradingView
  surface), `card_trading_workbench` (parked card), Alpaca read-only rails
  (`apps/python-models .../market/`: snapshot, bars, paper-account readiness),
  `Kronos-main` submodule (uninitialized) + `market/model_adapters/kronos_adapter.py` + forecast
  contract. Kronos/Cronos work resumes later by explicit decision.
- **WorldSignals (parked signal primitive)** — vendored `worldsignal/` service, `worldsignal.routes.ts`,
  `card_worldsignals_agent` (disconnected), one Playwright spec in `e2e/`. Not in the research loop.
- **Coder / LocalCoder / OpenClaude (parked code executor)** — vendored `localcoder/` (gRPC Harness
  engine), `card_local_coder` (disconnected), Code Console UI, `coder-workspace/` job folders,
  `.openclaude-profile.json` (consumed by localcoder provider profile). Deferred: Coder terminal
  canvas, connected-agent rail entries, workspace capability grants, [RENAME.md](./RENAME.md) pass.
- **CodeGraph view (wired but dormant)** — `client/src/components/codegraph/*` renders through the
  vendored `client/src/vendor/codebase-memory-ui` server via the vite `/rpc` + `/api/layout` proxies
  to `127.0.0.1:9749`; that server must be running or the proxies log ECONNREFUSED (harmless).
  `card_codegraph_agent` stays disconnected until code context joins the loop.
- **Plan Agent** — parked card; the Plan object vision lives below in this file.
- **e2e layer (barely started)** — `e2e/playwright/worldsignal.spec.ts` + `playwright.config.ts` +
  `@playwright/test`. One spec for a parked surface; grow or cut in a dedicated pass.
- **Auth on Prisma, agent runtime on raw Postgres/graph stores** — login/signup →
  `auth/userService` + `auth/sessionStore` → `services/database.ts` (Prisma) is the correct, deliberate
  split: Prisma owns auth/session; ThinkGraph/KnowGraph/CodeGraph/deck state use `pg`/AGE/Neo4j directly
  for active agent context. Not debt, not scheduled for consolidation — leave as-is unless it is
  confusing or broken in a specific reported case.
- **Hermes activity durability** — the under-chat feed buffer is RAM-only (wiped on backend restart);
  move to a store when Hermes history must survive restarts.
- **Card model authority is per-card, by design** — `card_magentic` runs `openai/gpt-5.1-chat-latest`;
  other cards carry their own saved provider/model (e.g. `openrouter/z-ai/glm-5.2`). Mixed models
  across cards are correct when the live card configs say so — never normalize all cards to one
  provider/model, and never let a caller override a card's own config. Service-only model calls
  (embedding/rerank/extraction) are allowed but must never masquerade as a card-agent call.
- **Card prompts: runtime source of truth is the persisted live card prompt/config**, not the
  backend/client seed template. Seed templates are defaults for creating/resetting decks only. If a
  seed template prompt changes and an existing project must pick it up, that requires an explicit live
  deck migration/readback (as done for `card_main_chat` via the deck PUT API) — never assumed. Report
  duplicated prompt sources if found; do not delete card prompts.
- **Object-aware chat (planned, not residue)** — intended future wire: selected node/card/object →
  active object context → Main Chat/Harness → Hermes context → Mag One RunPacket. The graph node
  inspector (`KnowledgeGraphFramework.tsx`) is the first half of this; it does not yet feed chat/agent
  context. Do not implement this wire or remove inspector/selection code as dead until a SPEC
  explicitly asks for it.
- **Deck/conversation JSONB is app persistence for canvas/card/deck state only** — not AutoGen memory,
  not ThinkGraph, not KnowGraph, not CodeGraph. Not scheduled for replacement in cleanup passes; report
  only if it causes a real bug.
- **Deferred maintenance** — dependency security upgrades; eslint warnings on owned code.

## Product Objects (vision)

### One Plan

There is one user-facing **Plan**. While being created or revised it is awaiting user approval. The
internal persistence field may stay `planDraft` for compatibility, but UI/prompts/docs call it **Plan**.

```txt
drafting → awaiting approval → approved → executing → needs review → reviewed
meaningful revision → awaiting approval again
```

The user-approval transition is the handoff from planning to execution.

```txt
Plan creation or revision            → no execution
User approves the current revision   → it becomes the active executable intent
Agents run bounded approved steps    → results/evidence/artifacts/reviews attach to those steps
A meaningful Plan revision           → becomes a new revision awaiting approval
```

A Plan is not automatically accepted project truth because a model wrote it. Until approval, ThinkGraph
may link the proposal to the request and open questions, but must not promote its contents as accepted
decisions.

### Plan Canvas

The Plan canvas is the durable, editable work surface. Canvas cards stay compact (step number, short
title, one-line summary, state); the Inspector owns full details (objective, detail, expected outcome,
acceptance criteria, constraints, dependencies, open questions, source request, approval state, runs,
artifacts, evidence, review verdict, next decision, provenance).

The chat steers. The Plan holds durable executable intent. The Inspector explains. The graph links.
The skills compound.

### Conversation History

Conversation is durable user-visible history: reload, scroll, reply to an earlier message, branch from
that point. Old messages are retired from active prompt context but never deleted.

```txt
saved message graph  ≠  full model prompt  ≠  automatic graph memory
```

A conversation can link to plans, steps, runs, evidence, artifacts, and reviews. Raw transcript text is
not automatically copied into ThinkGraph or KnowGraph.

## Graph Model (full vision)

### User Scope, Project Lenses

ThinkGraph and KnowGraph are scoped to the **user**. Projects provide context, permissions,
organization, and an active lens — they do not silo the graph. Every graph record preserves owner/user
scope, provenance, created/updated times, optional project/plan/step/run/review references, and
confidence/status where relevant. Retrieval starts from the active Plan/step + project lens, then
traverses user-owned linked records only when relevance and provenance justify it. Never dump the whole
user graph into a prompt.

### ThinkGraph (curated project reasoning)

Stores references and curated facts: approved Plan revisions, requested outcomes, accepted decisions,
superseded/rejected decisions, constraints, open questions, plan/step/conversation references, runs,
artifacts, Outcome Reviews, blockers, next decisions. Not raw chat; not auto-promoted model suggestions.

### KnowGraph (grounded evidence)

Stores source records + metadata, publication/observation/retrieval times, chunks, entities,
source-backed claims, evidence links, confidence, contradictions, citation/provenance. A claim can be
reused across projects, but each project/step carries its own explicit link/question/interpretation.
No model statement becomes KnowGraph fact without source provenance.

### SkillsGraph

`skills/*.md` are human-readable durable procedures; SkillsGraph is the retrieval layer connecting
skills to systems/files/tasks/proof-commands/traps/success/failure. A skill is created/updated only
after real work produced proof worth preserving.

## Context Policy (vision)

The Context Pack is the controlled input to a model/agent. A normal turn receives only the relevant
bounded slice: active conversation-branch tail, selected reply anchor, active Plan + selected step,
scoped ThinkGraph, scoped KnowGraph evidence, scoped CodeGraph/CBM when code matters, relevant skills,
linked prior runs/artifacts/reviews. Each item carries source, reference, timestamp, relevance reason.

Excluded by default: entire chat history, retired unrelated messages, entire user graph, raw hidden
reasoning, raw tool payloads, secrets, unverified model claims, unrelated skills, whole repositories.
The system states honest emptiness when grounded context is unavailable.

## Runtime Roles (full vision)

- **Harness** — the fast, persistent, interactive front door: conversation, Plan creation/revision,
  user-judgment questions, bounded context assembly, fast tool use, ordinary single-agent work, native
  worker/subagent calls, review/evaluator calls. The default interactive runtime.
- **Python Tools** — first-class capability layer. Proven Python evidence/data capabilities callable
  through narrow auditable bridges without forcing a full team run (trading, research, documents, graph).
- **Mag One / Agent Fabric** — a valued specialist team fabric, *not* the default for ordinary chat.
  Deferred until the graph/context/worker foundation is proven, then used when genuine multi-agent
  structure is worth the cost (multi-specialist research, visible team collaboration, graph/data/sim
  work, deliberate team planning, long-running missions). The bus must ultimately distinguish
  installed/resident · eligible-on-a-bus · selected-for-a-mission · actively-running · watching-on-trigger.
  Connected does not mean forced into every request.

## The Core Controlled Loop (target)

```txt
user request or selected Plan step
→ bounded Context Pack
→ Plan creation/revision or approved-step mission
→ agent work
→ real artifacts/evidence
→ separate evaluator checks requested outcome against actual evidence
→ Outcome Review: matched | partial | contradicted | unknown
→ ThinkGraph / KnowGraph / Plan links update
→ concise chat pointer
→ next decision or bounded next step
```

The generator never grades itself; the evaluator does not accept prose as proof
(`generator output ≠ verified result`). The first repair loop is bounded: one worker attempt →
evaluator → at most one concrete repair → evaluator → stop for human review. No infinite retry, no
silent boundary escalation, no auto-merge/deploy/real-trading.

## First Vertical: Trading Research & Decision Support

Trading is the first complete proof vertical while the core stays domain-neutral.

```txt
thesis/request → Plan awaiting approval → approved research steps
→ source-backed SEC / market / KnowGraph evidence
→ bounded Harness research using proven Python tools → evidence evaluation → Outcome Review
→ bull/base/bear or directional-uncertainty thesis → paper/simulated proposal only
→ explicit human approval before any future real-order pathway
```

Every trading record needs time (`sourcePublishedAt`, `observedAt`, `asOf`, `retrievedAt`, staleness
policy). Every output separates supported-by-current-evidence · supported-by-older-evidence ·
contradicted/competing · unknown · model-interpretation. Never present generated market opinion as fact.

## Deferred features (base functions first)

- **No graph access for the Orchestrator (Mag One).** It runs a Harness-authored prompt and has no
  direct graph tools; the Harness owns graph reads and distills what a run needs into the prompt.
- **ThinkGraph slicing/filtering tool for chat.** For now the Harness reads the graph plainly; a
  bounded filtered "slice" tool (richer than `thinkgraph.get_graph_slice`'s current plain read) is later.
- **Durable run-folder layer around the coder.** The coder seam is wired (`run_local_coder`, server
  root); the Run Packet → agent folders → review → KnowGraph-ingest → ThinkGraph-continuation layer is
  the later greenfield build.

## Near-Term Route (detailed batches)

### Batch A — Graph Truth and Context
1. Audit and freeze a real baseline. 2. Wire user-scoped ThinkGraph records for Plan/revision refs,
requested outcomes, constraints, open questions, run/review links. 3. Wire user-scoped KnowGraph
source-backed retrieval + explicit Plan-step links. 4. Feed scoped ThinkGraph + KnowGraph into the live
Harness Context Pack. 5. Prove a fresh turn uses real graph context without full chat history.

### Batch B — Contextual Capabilities
1. CodeGraph/CBM scoped retrieval for code steps. 2. Deliberate SkillsGraph retrieval. 3. Extend Context
Pack with code/skills only when relevant. 4. Prove stale CBM blocks code-edit context rather than guessing.

### Batch C — Bounded Harness Work and Review
1. Minimal agent contracts. 2. One approved Plan step through a fast Harness worker. 3. Real
artifacts/evidence + Run records. 4. Separate evaluator. 5. Persist Outcome Review + attach to
Plan/ThinkGraph/KnowGraph. 6. Prove one paper-only trading research loop.

### Batch D — Mag One Reassessment (only after A–C)
1. Compare native Magentic-One vs. thin adapter vs. full bus/card. 2. Measure streaming, participant
selection, Task Ledger overhead, quality gain. 3. Escalation rules. 4. Keep Mag One where team structure
demonstrably adds value.

## Hard Product Law

Do not fake AI work, graph truth, evidence, execution, or success.

Forbidden: fake plans · fake task/run cards · fake artifacts · fake completed statuses ·
backend/frontend-authored pretend AI answers · chat text silently converted into executable work · raw
model output promoted to graph truth · raw model opinion stored as KnowGraph fact · deterministic keyword
routers · regex intent classifiers · sanitizer/rewrite logic pretending to be planning · mocked success
on live routes · hidden prompt spaghetti · whole-graph/whole-repo context dumps.

Allowed: real user-approved Plans · real bounded agent work · real source-backed evidence · real
artifacts · real test/proof results · real missing-state reporting · real evaluator verdicts · real graph
links and provenance · real skills created after proof.

If proof is missing, say so. If evidence is unavailable, say unknown. If a route is unwired, fail closed.
If the user has not approved the Plan revision, do not execute it.

## Final Rule

LiquidAIty should show real work and real knowledge relationships, not status theater.

```txt
The user owns the intent.
The Plan holds approved direction.
The chat steers.
The graph connects and remembers.
The evidence grounds.
The workers act within bounds.
The evaluator can say no.
```
