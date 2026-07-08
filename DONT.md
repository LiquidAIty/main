# DONT.md — read this before you write code here
This codebase has been cleaned of well over
**200,000 lines** of layered spaghetti more than once. It came
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

- **2026-07-05 (later still) — one team-run entrypoint + CBM-is-not-a-gate (2 commits, ~-812 lines).**
  - **Deleted `executeDeck` + the whole mission chain.** `executeDeck` was a SECOND Mag One team-run
    path — it called the same `runCardWithContract(magentic_one card)` as `run_mag_one`, just wrapped in
    `mission` metadata. There is ONE team-run entrypoint: `run_mag_one` (Harness-authored Markdown prompt).
    The deck-run route is now Canvas Single Assist ONLY. Removed the entire dead mission + `WorkspaceHarness`
    type cluster (`MissionSpec`/`MissionRun`/`MissionDeckPatch`/`MissionRunStatus`/`DeckRunMissionMetadata`/
    `OpenMissionMessage`/`WorkspaceHarness{Provider,Operation,Permission,Request,Result}`/`run_approved_mission`)
    + mission fields on DeckRun/Request/Response — used by only two files, no product sender ever populated them.
  - **CBM is a capability, not a gate.** `cbmScopeGate` ran `index_repository` and blocked a coder run on
    stale/missing index, missing required-files, or excluded-files — i.e. "you must have a fresh CBM index to
    code." Gutted to a STRUCTURAL check only (valid project root, real directory). A stale/unavailable CBM
    index NEVER blocks the coder; it inspects normally and reports honestly.
  Lesson: two run paths that both call the same function is one path too many; and a "freshness gate" on a
  local index is an invented guardrail that stops work for zero safety.

- **2026-06-01 through 2026-07-05 (full audit from git log) — running tally from the actual commit
  record: 5,963 files changed, +175,192 / -182,915 lines across ~90 commits.** The DONT.md entries above
  come from studying every deletion commit >500 lines to extract reusable anti-patterns. Major deletion
  events not individually itemized above but informing the rules:

  - **Spec sprawl removal** — `.specify/` spec-kit toolchain (149 files, spec/plan/tasks/checklist
    generators in PowerShell and bash), 14 speckit skill files, 10 `.skills/` duplicates, `.codex-smoke/`
    import probes, `analysis.txt`, `cbm_search.txt` root scratch. ~32,000 lines of tooling that generated
    markdown nobody read.
  - **Versioned directory collapse** — `apps/backend/src/v3/` (1,895-line runtime, 525-line spec, 252-line
    execution plan, 189-line deck route, 65-line card route) and `apps/backend/src/routes/v2/` (372-line
    config route, 159-line projects route). 5,627 lines of duplicate runtime paths.
  - **Graph visualization shitcode** — KnowGraph viz (loaders, neighborhood/normalize/precedence/
    source-label calculators, `/explore` lens, dossier), Cytoscape foundation experiments, legacy TS
    graph brain. ~21,000 lines of working visuals with zero product function.
  - **Repo eating** — `quant-mind-master/` entire external project committed as subdirectory.
    13,376 lines.
  - **Agentbuilder split-turds** — extracted workspace shell components never wired back,
    admin board recovery patches. ~6,000 lines.
  - **Rescue/panic patches** — `_rescue_branch_work.patch` (3,958 lines), `_rescue_uncommitted_work.patch`.
  - **WIP checkpoint commits** — 13 commits titled "checkpoint", "WIP", "save current work",
    "stop point before X". ~25,000 lines of dead-end code cleaned up later.

  Full tally of the 2026-07-05 DONT.md audit (the items already recorded above) was 74 files / ~9,248
  lines. The git log reveals the true scale across the whole period was ~10x larger — the patterns above
  are what produced those 182,915 deleted lines.
  - `85a948e1` (17 files, −2025) — **agent-builder split-turds + LangChain stub.** The GPT "your 15k-line
    agentbuilder is too big, I'll break it up" split left orphans that were never wired back:
    `graphContextPacket.ts` (365-line TS graph-context comparator), `taskContextSlice.ts` (a dead "graph slice"
    keyed on `task-ledger`/`approved-workflow` — both already removed), `knowGraphRoles.ts` (TS graph-semantics),
    `projectAgentsApi.ts` (250-line dead CRUD client), dead `types/agentBuilder.ts`+`plan.ts`, dead UI
    (`DeckEdgeInspector`, `DeckQuickAddPanel`, `chat-interface.tsx`) — each propped up only by its own spec. Plus
    the LangChain leftover: `agents/mcp/mcpClient.ts` (every function only ever `throw`ed "not yet implemented
    after LangChain removal") + its `/mcp/tools`+`/mcp/refresh` route (always 500) + a permanently-failing `mcp`
    probe in `/health`.
  - `55ff1932` (33 files, −3740) — **the old agent-builder REST subsystem + orphan services/connectors.**
    `agentBuilder.routes.ts` (404-line route that wasn't even mounted) + `projectAgentsStore` + `agentBuilderPrompt`
    + `contextPack` + `runtime/chain`, all superseded by decks/cards. Plus 0-importer services/connectors:
    `marketDataService.ts` (sloppy TS Alpaca — redo in Python), `mediaService`, `ingestStatusStore`, `jsonStore`,
    `cache`, `logger`, `validation`, `connectors/mcpClient` (dead MCPClient), `graphlit.mcp`/`infranodus.mcp`
    (never-wired external MCP connectors), `neo4j.users` (old user store; live auth is `auth/userService`),
    `contractMaker`, `sol.controller`, `receiptCapture`/`receiptParser`, `openrouterEmbeddings` (embeddings are
    Python), `ragsearch.tool`/`rag.search`, `middleware/projectOwnership`, `security/password` (dup), dead types.
  - `4ad99b56` (24 files, −3483) — **knip audit: scratch, dead configs, .mjs, orphan source.** Root scratch
    (`dump.cjs`/`dump.ts`/`dump_pg.ts`/`test_playwright.cjs`/`test_run.cjs`); the entire dead jest config set
    (`jest.config.js` was a literal `{{ ... }}` placeholder GPT never filled — the repo runs **vitest**); five
    nx-invisible `scripts/*.mjs`; orphan backend source (`llm/client`+`responses`, `messages/store`,
    `services/stream`+`types/agent`, `types/kg`, `research/types`, `utils/urlGuard` — a **duplicate** of the live
    `security/urlGuard` — `agents/mcp/tavilyClient`); dead `pages/agentpage.tsx`.
  Lesson, quantified: **74 files and ~9.2k lines that all "worked," produced by exactly two habits** — (a) a big
  file gets "split up" and the pieces are never deleted or rewired, and (b) a config/service/script is scaffolded
  "for later" and later never comes. Do not create either. If you split a file, delete the original and prove
  every piece has a live importer. If you scaffold, wire it now or don't write it.

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
- **A file "split out" and never wired back.** The "this file is too big, I'll break it up" move: the extracted
  modules end up imported by nothing but their own spec. A split is not done until the original is deleted and
  every piece has a live importer. Zero-importer + has-a-spec = the spec is life support for a corpse; delete both.
- **A duplicate of a live file.** `utils/urlGuard.ts` beside the real `security/urlGuard.ts`; `agents/mcp/mcpClient.ts`
  beside `connectors/mcpClient.ts`. Two files with the same name/job means one is dead — find the live one, delete
  the other. Never "make a copy to be safe."
- **A stub that only `throw`s, left wired.** `mcpClient.ts` had three exported functions each `throw`ing "not
  implemented after LangChain removal," wired into a live route + health probe that therefore always failed. A
  not-implemented stub is a landmine, not a placeholder — delete it and its callers in the same change.
- **Placeholder configs + wrong-runner configs.** `jest.config.js` shipped as a literal `{{ ... }}` token that
  never compiled, in a repo that runs **vitest**. Fill a generated config or delete it; never commit a `{{ }}`
  placeholder, and never add jest configs to a vitest repo.
- **`.mjs` scripts and root scratch files.** nx/tooling can't see `.mjs`, so they rot invisibly; `dump.*` /
  `test_*.cjs` at the repo root are throwaway code committed as product. Write `.ts`, run it, delete it — don't
  leave scratch in the tree.
- **Versioned directory paths.** `v2/`, `v3/` directories inside `src/` or `routes/`. Version the API contract
  if you must, not the directory name. If a rewrite is needed, delete v1 and move forward — never keep v1, v2,
  and v3 side by side with different implementations of the same thing. `apps/backend/src/v3/` (1,895-line
  runtime duplicate, 189-line deck route duplicate) and `apps/backend/src/routes/v2/` (372-line config route,
  159-line projects route) were deleted because the non-versioned paths already had the working code.
- **Spec toolchain sprawl.** `.specify/`, `.agents/skills/speckit-*`, `.codex-smoke/` — meta-tooling
  that generates spec files, task files, checklists, and workflow YAMLs from templates. The active CoderPacket
  prompt IS the spec. Skills live in `skills/*.md`. Everything else is an indirection layer that produces
  markdown nobody reads and PowerShell scripts nobody runs. The `.specify/` directory alone was 149 files
  (extensions, git hooks, PowerShell/bash scripts, workflow YMLs). Speckit was 14 skill files that duplicated
  the real skill system. Deleted: `.specify/` (149 files), `.agents/skills/speckit-*` (14 files), `.skills/`
  (parallel skill directory, 10 files with a README that treated skills as a hidden dotfolder), `.codex-smoke/`
  (import probes that were never run).
- **Parallel skill directories.** `.skills/`, `.agents/skills/` alongside the real `skills/`. One skill
  directory. One skill format. Multiple directories mean multiple conventions — the `.skills/` README treated
  them as reusable templates for a different agent, not the same skill system `skills/*.md` defines.
- **Rescue / panic patches committed to the repo.** `_rescue_branch_work.patch` (3,958 lines),
  `_rescue_uncommitted_work.patch` — git patch files dumped at the repo root as a panic-save. A patch file
  is a temporary escape hatch, not a product artifact. If you need it, apply it, then delete the .patch file
  in the same commit.
- **Graph visualization without product function.** A beautiful 3D/Cytoscape/ReactFlow visualization that
  renders nodes and edges but serves zero product function — no feature selection, no context loading, no
  coding handoff. The KnowGraph viz was removed (loaders, neighborhood/normalize/precedence/source-label
  calculators, `/explore` lens, dossier — 11,720 lines of working visual code) because it was a standalone
  art project, not a product feature. Visualization is a UI feature wireable to real data through a real
  product path; do not build "graph explorer" as a standalone.
- **Repo eating — dumping an external repo into the project tree.** `quant-mind-master/` (entire external
  project, 13,376 lines committed as a subdirectory). Extract the one useful pattern, skill, or persona
  into the curated set; the external source stays out (gitignored or in Downloads). Never commit another
  project's full tree into this one.
- **"Stop point" / WIP checkpoint commits.** Commits titled "checkpoint", "WIP", "save current work",
  "stop point before X" that leave half-finished dead-end code in the tree. A checkpoint is a git stash or
  a branch — not a commit to main that someone else has to clean up later. The `checkpoint` commits
  deleted in the cleanup passes contained dead code that was never going to ship: dangling ThinkGraph
  rewrite attempts (7,759 lines), chat recovery dead-ends (2,591 lines), Cytoscape foundation experiments
  (4,049 lines), and the massive "stop point before quantmind repo eating" (13,376 lines of external repo
  committed as a panic-save). If you need a checkpoint, use a branch. If you committed one, delete it
  before merging.
