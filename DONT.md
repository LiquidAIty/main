# DONT.md — read this before you write code here

This codebase has been cleaned of ~16,000 lines of layered spaghetti more than once. It came
back because agents kept **adding** a new approach without **deleting** the old one, and then
mimicked the mess they saw. These rules exist to break that loop. They override any instinct,
any inherited prompt, and any pattern you observe in surrounding code.

## The one rule that matters most

1. **When you change approach, DELETE the abandoned path in the same change.** Never layer the
   new over the old. A new thing that "works" while the old thing still exists is **not done** —
   it is debt you just created. Deletion is the work, not a cleanup for later.

2. **"Looks done" is not done.** Before you call something finished: did you remove what it
   replaced? Search for the old symbols and confirm zero callers. If you can't delete it because
   something still uses it, the job isn't finished — say so.

3. **Do NOT mimic the surrounding code.** If a file looks like a hairball, that is a bug to fix,
   not a style to copy. Follow these rules, not the mess.

## What is allowed to exist

4. **Membership test.** If a thing is not (a) bound by an agent, (b) controlling/visualizing an
   agent on the canvas, or (c) knowledge — it does not belong here. Delete it.

   **The ONLY system is:** ReactFlow agent cards on the canvas + AutoGen/Mag One (Python) under
   them + the Harness + MCP-based graph connections. The ONLY two orchestrators are (1) the
   vendored OpenClaude/coder stack and (2) Mag One (Python, thin TS transport on top). Storage
   authority: **KnowGraph = Python + Neo4j** (research agents write it natively); **ThinkGraph =
   the MCP write tool** (chat writes via `apply_delta`). Therefore any TS that ingests, extracts,
   chunks, plans, scores, researches, or runs an agent/tool framework is poison — it is not bound
   to a card, it is not the canvas, it is not the Harness, and it is not Python. Delete it.

## TypeScript is rails, not a brain

5. **No logic in TypeScript. None.** No calculation, classification, planning, reasoning, regex
   intent-routing, or model selection. TS only: MCP transport + tool registration, request/
   session/project identity, strict input validation, fail-closed integrity checks, thin
   read/persistence adapters, streamed UI events, resolving stable graph refs into bounded slices.
6. **The UI (agentbuilder, client) is a UI, not a calculator.** All calculation is Python + models.
   If you'd have to *read* a `.tsx`/`.ts` file to understand a decision the system makes, that
   decision is in the wrong language — move it to Python or the model.

## The graphs

7. **A plan is data, never a planner.** A Plan = a prompt + stable graph pointers (think:/know:/
   code:), handed to Mag One via `execute_visible_flow`. Mag One plans natively (its own Task
   Ledger). NEVER rebuild PlanFlow / Mission / a TS planner / planFlowTaskObjects.
8. **The graph is the source of truth — pass pointers, not copies.** Do not pass graph data around
   to be mutated. Refs in, refs out.
9. **One authority per graph.** Harness writes ThinkGraph only (via `thinkgraph.apply_delta`).
   Research agents write KnowGraph only. The CBM indexer writes CodeGraph only. No cross-writes,
   no second writer, no UI→DB graph write.
10. **Files for how-to, graphs for what-is.** Skills/docs are files. CodeGraph/KnowGraph/ThinkGraph
    are graphs. Don't smear one into the other (e.g. SkillGraph nodes must never leak into KnowGraph).

## Forbidden, always

11. **No fallbacks.** Succeed on the real path or fail honestly and report. No `a || b` legacy, no
    try-real-catch-degraded, no timeout→stand-in, no silent graph blending.
12. **No fake success.** No `{id, ts}` no-op events, no success-shaped payloads that no listener
    applies, no "completed" without real proof.
13. **No hidden surfaces.** No debug routes, sidecars, pollers, schedulers, second MCP hosts, or
    second renderers. If information matters, surface it in-loop (on the canvas), not a hidden route.
14. **Extract, don't absorb.** Never dump a whole external repo into this tree. Lift the one useful
    skill/persona/pattern into the curated set; the source stays out (gitignored/Downloads).

## Proof

15. **Proof = real runtime + the build the dev server uses.** Typecheck + the touched tests must be
    green, and you must say what you did NOT verify. "It compiles" is not "it works."

## Purge log

- **2026-06-30 — ~10,650 lines of TS-logic poison removed** (67 files deleted; backend + client
  `tsc` green throughout; backend boots clean on :4000). Removed: the `agents/` TS tool framework
  (`registry` + `tools/*` + `connectors/*` + `mcp-controller`/`mcp-tool-registry`) and its
  `tools`/`mcp.catalog`/`mcp-tools` routes (~2,040 lines) · TS KG-ingest/extraction in `kg.routes`
  (`/ingest_chat_turn`, `/research`, the queue/chunking/neo4j-sink) · `researchService` +
  `autogenResearchClient` (TS research planning) · `slmGraph/` (alternate TS graph-search/KG-write)
  · `contracts/scoring.ts` + `deckScoring.ts` · the `orchestrator/` TS planner + webhook stub ·
  the `sentiment`/`report`/`memoryRetrieval`/`dispatcher` cluster · the dead CodeGraph
  view-contract pipeline + `structuredPlan`. **Kept:** `kg.routes` `/query`+`/status` (canvas KG
  reads), `agents/mcp/*` (live MCP client), `AgentManager` (canvas card inspector), tavily
  (reserved capability). **Still TODO:** `agentbuilder.tsx` graph-merge/flow-connectivity
  calculators (logic in the UI).

- **2026-07-05 — running tally: 185 app-owned source files deleted, ~58.7k lines of TS/Python
  ripped out in 21 days** (client 56 · backend 115 · Python 14), ~107k lines deleted tree-wide across
  59 commits. Every one of these "worked" before it was deleted. This session's cuts:
  - **Pair system** — `processThinkGraphPair` (+spec), its route, Python `process_conversation_pair`,
    the `thinkgraph_pair` write authority, and the model-facing `thinkgraph.apply_live_patch`.
  - **Mag One poison** — the `runApproved`/`runTaskClicked`/`noExecutionBeforeRunTask` approval gate;
    `taskLedgerOutputContract` + the client OWL output contract (`OWL_SHAPED_OUTPUT_CONTRACT` …); the
    `executeVisibleFlow`/`renderPlan`/`missionSpec` visible-flow wrapper (→ clean `run_mag_one`); the
    `MAGONE_CODER_CONSOLE_BLOCKED` gate; the client Run-Task/mission UI.
  - **TS→Neo4j graph writes** — `semanticLanguage.ts` validator, `neoSafeProperties.ts`,
    `buildSemanticSeedRecords`, `runKnowGraphSemanticSeed` (`MERGE :SemanticRecord`), the EDGAR TS→Neo4j
    bridge. (Graph writes are Python + the KnowGraph card ONLY — rule 9.)
  - **Dead TS-brain** — `evoselector.ts`, `embedding.ts`, `ontology.ts`, `modelCascadePlan.ts`,
    `contractMaker.ts`, `timeseries.ts`, `knowGraphEvidenceRetrieval.ts`, `agentCardRegistry.ts`
    (orphaned card catalog/classifier), and Python `autogen_research.py` (banned-AgentChat stub).
  - **EDGAR ontology extractor** — `edgar_graph_extraction.py` (hardcoded `EDGAR_ALLOWED_CLASSES`/
    `RELATIONS`/`PATTERNS`), a dev CLI that only existed to feed a hardcoded ontology to the model.
  - **The wrong way to run a local model** — `gemma_chunker.py` + `gemma_graph_extractor.py` +
    `research_memory_delta.py`: a bespoke `urllib` transport to the DMR endpoint (duplicating the shared
    model client that already exposes local Gemma as a card provider) + Python being the brain
    (`enforce_ontology`/`_classify_unit`) + Cypher `MERGE` writes duplicating the `neo4j_graphrag`
    `ingest.py` pipeline. Local models stay fully supported via the provider/card model selector and the
    kept embedding rail (`embeddinggemma.py` + `assertion_vectors.py`).
- **2026-07-05 (later) — the Mag One / coder brain + broken console dispatch, end-to-end (15 files,
  +46 / -2148).** Bus connectivity (`magentic_option` edges) is now the ONLY activation; connect =
  active. Removed both the TS twin and the Python twin of the same disease:
  - `runtime.ts` — `resolveMagOneAgentRole` (title/template substring classifier), `buildMagOneRoutingDiagnostics`,
    `buildMagOneRoutingManifest`, `roleCapabilities`, `priorityByRole`, `requiredGates`; the coder tool-gate
    throw (`coder_console_tool_requires_local_coder_card`) + auto-injection; the invented participant `role`
    + `templateId` classifier; `routingManifest`/`routingDiagnostics` payload fields.
  - `runtimeContracts.ts` — `MagOneRoutingAgent`/`Diagnostics`/`Manifest`/`CodingWorkflowPacket` types + the
    `coder_console_task` ToolSpec.
  - Python — `orchestration_contracts` `role`/`routingManifest`/`codingWorkflowPacket`; and the entire
    `tool_registry.py` coder-console block (325 lines): `_participant_role` (Python title classifier),
    `coder_console_task` FunctionTool, `MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE` gates, `_post_console_task`
    (POSTed to a route that no longer exists). Its `set_current_coder_tool_context` binders had **zero callers**
    — it could never get context, so it never worked.
  - The console **dispatch** chain: `coder.routes.ts` `console/task` + `run_approved_task` + `result_feedback`
    + `runs/:id`, plus `consoleTaskRouter.ts` + `codingRunLifecycle.ts` (+specs). **Kept** the console
    **terminal** (`consoleSession` + `console/sessions*`) to wire properly later, the coder card, `cbmScopeGate`
    (used by the live local-coder service), and `resolvedMagenticOptions` (bus eligibility).
  Lesson: the coder is a normal bus card that Mag One instructs; "coder is special" spawned a TS classifier,
  a Python classifier, a gate chain, and a dispatch route that **never worked** — four layers for zero function.

## Patterns that keep coming back — do NOT write these

Every one of these was written, shipped, "worked," and got ripped out. If your diff resembles any of
them, stop and delete instead.

- **Title/template substring classifier.** `if (card.title.includes('coder')) role = 'local_coder'`.
  TS deciding what an agent *is* from its name, then gating tools/capabilities on it. Identity comes from
  the saved card config + the model — never a string match in TypeScript.
- **Hardcoded ontology / allow-lists.** `EDGAR_ALLOWED_CLASSES = [...]`, `enforce_ontology(...)`,
  `owlClass → role` tables that decide meaning. Entity classes and relations are the model's job over the
  graph, not a Python/TS constant.
- **Bespoke transport to a model.** A hand-rolled `urllib`/`fetch` to a model endpoint with its own prompt
  and parsing, parallel to the one shared model client. "Use a local model" = *select it as a provider on a
  card*. That is the whole feature.
- **A second pipeline beside the real one.** Custom chunking/extraction/graph-writes next to the
  `neo4j_graphrag` `ingest.py` pipeline. One writer per graph (rule 9); one pipeline per job.
- **Approval / mission / task gates.** `runApproved`, `missionSpec`, `noExecutionBeforeRunTask`, forced
  `taskLedgerOutputContract`. Mag One plans natively — do not build a TS workflow engine on top of it.
- **Scoring / ranking / priority in TS.** `priorityByRole`, `deckScoring`, `scoring.ts`. Ranking is
  reasoning; it belongs to the model or Python, never a TS lookup table.
- **"Routing" / "selector" / "cascade" / "dispatcher" modules.** Almost always a TS brain wearing a
  plumbing name. Bus eligibility is graph edges; which agent acts is the orchestrator's call, not TS's.
