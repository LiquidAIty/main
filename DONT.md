# DONT.md — preserve the real product

## 1. Current mandatory prohibitions

Restored at Jeremiah's request on 2026-09-05 after the documentation-system deletion in
`2ddadeeb`. The owner's latest instructions take precedence. This section is current;
the recovered document below is historical evidence, including obsolete paths and old estimates.

1. Do the requested work. Preserve unrelated source, saved Cards, profiles, prompts, grants,
   projects, graph data, sessions, layout, and current dirty work. Never perform a broad restore.
2. Do not copy a nearby implementation because it exists. Trace its real callers, data owner,
   persistence and runtime consumer. A self-supporting test is not a product integration.
3. When replacing an approach, remove its abandoned live callers and duplicate entrance in the
   same completed repair, after proving the retained capability. Do not remove distinct useful work.
4. A Card is one saved agent with its own profile. Hermes internal agents remain within their
   owning Card. Connected saved Cards never share a profile or become child Cards.
5. Use existing Hermes, AutoGen and graph capabilities through their real boundaries. No extra
   runtime, scheduler, graph writer, input format, artifact-ID prerequisite or fake terminal.
6. IDD is the common definition source: a field list in Cards, a dictionary for Builder, and
   dropdown/default definitions for templates. IDF is the actual bounded input for one Run.
   Refer to existing catalogs and executable schemas; do not copy option lists between consumers.
7. No fake graph data, sample records, placeholder activity, simulated success or invented receipts.
   A saved record can still be the wrong data. Prove useful behavior using a real project.
8. Product instructions belong in these documents, never automatic graph inserts or UI banners.
   Do not add explanatory panels, evidence panels or branding to Card controls.
9. Main/Builder's established pull-up behavior is intentional. Preserve their session and input
   ownership. Do not change mounts, polling, panel dimensions or collapse behavior as a side effect.
10. Keep saved tools available without a Script. A Script uses the existing Hermes Python runner
    and saved grants. Do not invent a tool or widen grants to make a proof succeed.
11. CBM is app-owned. Use the published tools and the coverage procedure in
    `skills/codebasedmemory.md`. No direct cache/database access, extra daemon, automatic repair,
    OAuth change or index-freshness gate. Known source and excluded files can be read directly.
12. Required tests/builds may exceed a minute. Poll the existing command; do not duplicate it or
    discard work because it is slow. Source proof, tests, saved readback, loaded runtime and UI
    acceptance are different claims. Report each honestly.
13. Mag One needs System3 ready to supply its mission and usable connected agents. Do not add
    another approval workflow or product gate. A stand-in test does not prove that readiness.
14. Read only relevant reusable procedures, then verify current source and actual runtime evidence.
    Do not restore feature manifests, automatic LLM wiki generation or report-to-graph writes.
15. Keep familiar controls in predictable places with direct, visible effects. Show relevant state
    where the user acts; do not demand acknowledgment of routine activity. Cleanup must preserve
    useful controls, not bury them or replace them with explanations. The owner's design reference is
    [Amber Case's interview](https://www.designwhine.com/amber-case-interview-why-ai-has-it-backwards/).
16. Prompt blocks are independently replaceable. Preserve untouched blocks, headings and whitespace;
    never collapse the prompt into Role or silently hide its other sections. Main and Builder open
    on Prompt without a CLI tab; their existing chat and pull-up CLI remain the input surfaces.

## Documentation roles

- `PLAN.md`: current product direction and unfinished work, clearly distinguished.
- `AGENTS.md`: how agents work and preserve the checkout.
- `ARCHITECTURE.md`: verified implementation owners and separately labelled targets/gaps.
- `skills/*.md`: reusable procedures, applied only when relevant.
- This file: prevention rules and the record of removed failed approaches.

## 2. Failure record

### September 2026 owner corrections

- **Prompt sections swallowed or hidden.** The editor recognized only a small heading set and missed
  hyphenated headings, folding their text into Role. Other saved sections were invisible to editing.
  The repair reads explicit block boundaries and edits only the selected bodies. Tests cover repeated
  headings, code fences, unrelated-byte preservation and reopening. Do not rewrite whole prompts to
  compensate for an editor defect.
- **Unrequested UI and terminal substitutions.** The under-chat CLI was replaced by forms,
  identity/status text and fixed-open behavior. Card expansion, connector presentation and pointer
  capture also changed without the requested scope. This damaged direct use and trust in saved
  Card execution. Preserve the owner's Main/Builder interaction and genuine terminal authority;
  never infer runtime success from a mounted component. Current acceptance remains unproven.
- **Graph and receipt substitutes for useful data.** Persisted implementation notes and oversized
  paragraph labels were presented as knowledge. Source IDs, empty-state tests and acknowledgments
  were treated as proof of useful ingestion. No sample records, policy-note inserts, fake activity,
  artifact-ID prerequisites or child-Card model belong in the requested graph workflow. Hermes
  internal workers roll up under their owning saved Card. Current graph acceptance is unproven.
- **Restrictions and unrelated settings presented as necessary repairs.** Builder restrictions
  barred creation and required a target for every task. A subagent-model update enabled background
  review, and Output expectations edited a memory-policy prompt block. The latter two have focused
  source-test repairs; loaded acceptance is still pending. Builder must use IDD and template
  creation before customization; that complete loop remains incomplete.
- **Overbroad recovery.** Mixed changes and partial restorations made the owner unable to distinguish
  retained progress from regressions. During this documentation recovery, twenty deleted documents
  were initially recreated just because they existed in history. Nineteen were then withdrawn at
  the owner's narrower direction. Keep this failure record; do not restore stale procedures or
  feature manifests automatically. Preserve unrelated dirty files and the owner's Git history.

### Historical record A — before the August 29 deletion

Source: `2ddadeeb^:DONT.md`. The original text below is retained completely. Its commands,
counts, paths, model choices and architecture statements are historical, not current instructions.
Implementation status in this record is what the historical author reported; it is not a new
source or runtime audit. Specific removal reports remain valuable even when their paths are gone.


The following text is preserved from `2ddadeeb^`. Its old tools, architecture claims, model casting,
counts and proof claims have not been re-established by this restoration. Consult it to recognize
failure patterns, not to select today's runtime or overwrite current user decisions.

> Historical recovery from `2ddadeeb^` (before the August 29, 2026 deletion).
> Retained for reference, not current execution instructions or proof. Current user decisions,
> `AGENTS.md`, `PLAN.md`, and current source take precedence. Verify named paths/tools before use.
> This file does not authorize graph writes, service starts, indexing, paid calls, or Mag One execution.

# DONT.md — read this before you write code here

**Measured 2026-07-20 through `2c2e5685`: 164 commits, 3,292,612 cumulative additions, and
759,729 cumulative deletions. That is churn, not proof of product progress.**
**Judge progress by how many user-operable paths survive replacement and pass end to end.**

The 3.9 million deleted lines came from repeating the same patterns:
agents adding new approaches without deleting old ones, scaffolding never wired,
markdown sprawl, TS brains wearing plumbing names, graph viz without function,
external repos dumped into the tree, WIP checkpoints committed to main.

These rules exist to break that loop. They override any instinct,
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

   **The ONLY system is:** saved ReactFlow agent cards and topology + ordinary card-owned Hermes
   Main/delegate/Kanban execution + native AutoGen/Mag One for connected production teams. Storage
   authority: **PostgreSQL = saved-card state, Runs, and artifact metadata**; **AgentGraph = LiquidAIty's
   relationship and execution graph implemented on Apache AGE/PostgreSQL, never runtime control**;
   **KnowGraph = Python + Neo4j**; **ThinkGraph = Constellation Engine through bounded Python tools**;
   **CodeGraph = CBM**. Therefore any TS that ingests, extracts, chunks, plans, scores, researches,
   interprets model meaning, or runs an agent/tool framework is poison. Delete it.

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
9. **One authority per graph.** Granted Hermes/AutoGen Cards write ThinkGraph only through its
   canonical Python tools (including `thinkgraph.apply_delta`).
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
14. **No accidental repo eating.** External source enters this tree only as an explicitly approved,
    deployable vendor or first-party fork with a named ownership boundary, exact upstream provenance,
    canonical install path, tests, and the controlled-fork law in `AGENTS.md`. Otherwise extract the
    useful pattern and keep the source out. Codebase Memory always indexes the checked-in AutoGen fork;
    tracked Hermes may enter only a temporary, explicitly authorized whole-system projection because it
    is too large for routine rebuilds. Indexing never transfers ownership or permits broad vendor
    refactors or silent upstream replacement. `autogen-main` is frozen at its exact 0.7.5 base; do not
    replace or rebase it onto a later Microsoft AutoGen release.
15. **Codex app-server is one narrow Magentic-One model transport, never a LiquidAIty runtime.** Only
    a saved `autogen/magentic_one` Card configured as `openai` + `chatgpt-account` may use one owned
    official `codex app-server` subprocess as its AutoGen `ChatCompletionClient`. AutoGen still owns
    the team, participants, ledgers, cancellation, and Run lifecycle. Each completion uses an
    ephemeral, tool-free thread; the adapter must verify ChatGPT-managed auth and the exact saved
    model, disable inherited MCP/plugins/web/shell capabilities, forbid provider substitution, and
    never read, copy, parse, persist, or expose OAuth tokens. This exception does not apply to an
    AutoGen Assistant Card or to Hermes. Hermes continues to own its conversation loop, prompts,
    saved Card identity, memory, tools, MCP, and native subagents and must never be routed through
    Codex app-server. Do not create a generic Codex harness runtime or dormant fallback.

## Proof

16. **Proof = real runtime + the build the dev server uses.** Typecheck + the touched tests must be
    green, and you must say what you did NOT verify. "It compiles" is not "it works."

## Purge log

### 2026-08-20 repeated-churn checkpoint

The month comparison is Git base `4c756856` (the last commit before 2026-07-20) through `2c2e5685`.
Its 164 commits contain 3,292,612 cumulative additions and 759,729 cumulative deletions. These are the
major build/remove cycles that matter to launch readiness:

- **OpenClaude/LocalCoder:** `e6311567` added 2,242 files and 572,093 lines (plus 141 deletions).
  `1e703e18` later removed the abandoned runtime during the Hermes/AutoGen baseline change; that commit
  deleted 581,981 lines overall, including 574,247 lines under the LocalCoder/OpenClaude path. Current
  product source has no OpenClaude/LocalCoder runtime caller. This was a genuine deletion, not a rename.
- **Duplicate context and orchestration authorities:** the July assignment/context layers accumulated
  competing runtime state. `d93edbc5` removed 789 lines and `24f4ed1b` removed another 1,402 while collapsing
  their callers and routes. Current production source has no `ContextPack`, `DeliveredContextManifest`,
  `routingManifest`, `cardRuntime`, or alternate TypeScript runtime-input owner. Do not recreate them under
  new names.
- **Main context manifest:** `f536a284` added a five-file, 451-line manifest checkpoint. `cd7017cc` replaced
  that direction with the exact transient Card runtime-input boundary and deleted 1,935 lines. Current production
  has no Main-context-manifest symbol or caller. This former path was actually removed.
- **Competing runtime-input materializers:** the August sequence repeatedly interpreted runtime input as a saved object,
  envelope, receipt, or runtime packet. `4269f747` collapsed that surface by deleting 2,899 lines across
  42 files. The surviving owner is Python `materialize_idf`, called by the Card domain to retain and reload
  one canonical graph-first `in.idf` per Card/root Run; old packet fields and the later two-file split are
  rejected at the boundary and have no producer or router.

The surviving keeper authorities are saved Cards/PostgreSQL, one Python materializer, native graph owners,
the official MCP seam, AGE observation, repo-owned Hermes profiles/sessions, and the maintained AutoGen
0.7.5 execution fork. **AutoGen remains because LiquidAIty owns and maintains that execution fork.** Hermes
source size is controlled dependency/runtime cost, not LiquidAIty product complexity and not permission to
rewrite Hermes.

**Direct verdict:** the surviving launch path improved structurally this month because duplicate runtimes,
manifests, and OpenClaude were removed and the six saved Cards now converge on Hermes plus one maintained
AutoGen rail. It did not improve enough operationally: the complete user loop is still not proven until
Main hands a graph-anchored mission through the canonical Card-run path and one native Mag One execution
completes, either automatically or after optional review in the existing Card editor. Until that proof, do
not start another replacement architecture.

**Repo-wide tally (298 commits, from initial commit to 2026-07-09):**
- 4,894,078 lines inserted — total code ever written
- 3,933,698 lines deleted — 44.6% removal rate
- Current core: 64,104 lines — 1.3% survival rate
- Worst months: 2026-07 (85% removed — the cleanup), 2026-03 (50% removed — experimental churn), 2026-06 (48% removed — great purge)

The items below are the major deletion events. Every one "worked" before it was deleted.

- **2026-06-30 — ~10,650 lines of TS-logic poison removed** (67 files deleted; backend + client
  `tsc` green throughout; backend boots clean on :4000). Removed: the `agents/` TS tool framework
  (`registry` + `tools/*` + `connectors/*` + `mcp-controller`/`mcp-tool-registry`) and its
  `tools`/`mcp.catalog`/`mcp-tools` routes (~2,040 lines) · TS KG-ingest/extraction in `kg.routes`
  (`/ingest_chat_turn`, `/research`, the queue/chunking/neo4j-sink) · `researchService` +
  `autogenResearchClient` (TS research planning) · `slmGraph/` (alternate TS graph-search/KG-write)
  · `contracts/scoring.ts` + `deckScoring.ts` · the `orchestrator/` TS planner + webhook stub ·
  the `sentiment`/`report`/`memoryRetrieval`/`dispatcher` cluster · the dead CodeGraph
  view-contract pipeline + `structuredPlan`. **At that checkpoint:** `kg.routes`
  `/query`+`/status` were kept temporarily for canvas KG reads; they were removed later after
  direct reads proved that the mounted route still queried Apache AGE and merged it with Neo4j,
  competing with the current ThinkGraph (Constellation Engine) and KnowGraph (Neo4j) authorities.
  `agents/mcp/*` (live MCP client), `AgentManager` (canvas card inspector), and tavily
  (reserved capability) were kept. **Still TODO:** `agentbuilder.tsx` graph-merge/flow-connectivity
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
    bridge. (KnowGraph writes are Python pipeline operations only — rule 9.)
  - **Dead TS-brain** — `evoselector.ts`, `embedding.ts`, `ontology.ts`, `modelCascadePlan.ts`,
    `contractMaker.ts`, `timeseries.ts`, the deleted KnowGraph evidence-retrieval path, `agentCardRegistry.ts`
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
    `mission` metadata. There is ONE team-run entrypoint: `run_mag_one` (approved transient Card input).
    At that point the deck-run route was reduced to Canvas Single Assist; it was removed completely
    in the later 2026-07-24 runtime cleanup. Removed the entire dead mission + `WorkspaceHarness`
    type cluster (`MissionSpec`/`MissionRun`/`MissionDeckPatch`/`MissionRunStatus`/`DeckRunMissionMetadata`/
    `OpenMissionMessage`/`WorkspaceHarness{Provider,Operation,Permission,Request,Result}`/`run_approved_mission`)
    + mission fields on DeckRun/Request/Response — used by only two files, no product sender ever populated them.
  - **CBM is a capability, not a gate.** `cbmScopeGate` ran `index_repository` and blocked a coder run on
    stale/missing index, missing required-files, or excluded-files — i.e. "you must have a fresh CBM index to
    code." Gutted to a STRUCTURAL check only (valid project root, real directory). A stale/unavailable CBM
    index NEVER blocks the coder; it inspects normally and reports honestly.
  Lesson: two run paths that both call the same function is one path too many; and a "freshness gate" on a
  local index is an invented guardrail that stops work for zero safety.

- **2026-07-23 through 2026-08-02 — context-system archaeology correction.**
  - Git proves that the AGE `AgentContext`, registered-query/GraphView, runtime-assignment/profile,
    claim-token, and delivered-context-manifest implementations were successive experiments, not a
    completed Card/IDD input system. They coupled model context to caller/receiver identity and duplicated
    native graph/runtime state.
  - The cleanup removed substantial detours but incorrectly retained or later restored a smaller
    assignment/claim/begin/finish control core. Commit history is the record; canonical architecture
    must not describe that remainder as a protected runtime contract.
  - Do not restore `ContextPack`, `unified_context.py`, `DeliveredContextManifest`, registered-query
    registries, GraphViews, or assignment authorization merely because they once rendered model text.
    Reuse only individually proven validation/parameterization ideas at the one Card/IDD boundary.
  Lesson: model input is transient by default; there is no automatic save/revision path. IDD describes
  valid input. AgentGraph/AGE may describe
  consumption/production, but no assignment, receiver, claim, or graph write may
  authorize or fail Hermes, Mag One, or Coder.

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

- **Do not revive GraphView or prompt-packet projection.** Native graph references may be selected for
  one transient Card call and related by AgentGraph/AGE lineage. A separate
  projection/manifest/context-pack
  authority is a second prompt system. References point to native authorities; bounded resolved data
  enters the actual model call only when it needs the data.

- **2026-07-30 — Native graph-catalog federation and fake-wrapper purge: 26 files,
  +539 / -1,935 lines before this log entry.**
  - Deleted the handwritten `knowgraph.query`, `knowgraph.ingest`, `codegraph.status`, and
    `codegraph.search` MCP façades, their duplicate backend bridges, and the disconnected
    clean-room KnowGraph hybrid retriever.
  - Federated the complete upstream CBM and official Graphiti MCP catalogs through generated `cbm.`
    and `graphiti.` routing prefixes without copying their descriptors or schemas. Constellation now
    uses three bounded LiquidAIty operations over its native engine contract.
  - Kept tool ownership card-local: Coder defaults to CBM/CodeGraph, Main uses
    Constellation/ThinkGraph, and Hermes defaults to Graphiti/KnowGraph. Destructive native tools
    remain discoverable but are not granted by default.
  Lesson: **a native MCP catalog is the contract. Do not replace a real graph system with four
  friendlier wrapper names and a second retrieval pipeline; namespace the upstream tools
  mechanically, preserve their metadata, and assign them at the saved-card boundary.**

- **2026-07-30 — Native catalog lifecycle and hidden-grant cleanup: 26 files,
  +507 / -441 lines before this log entry.**
  - Deleted the backend deck-loader grant rewriter and the backend/client Coder hydration unions
    that silently changed saved card tools every time a deck was read.
  - Deleted the process-local Coder audit cache, its route, and its self-supporting test; durable
    Coder results already belong to the existing AgentGraph/artifact/CBM authorities.
  - Repaired one persistent native-CBM child lifecycle so a dead child cannot leave cached tool
    metadata behind, and removed the orphan test process after proof.
  - Removed the superseded project-memory namespace, duplicate answer path, and code-memory overlap
    from Main's saved grants when Constellation became the ThinkGraph authority.
  Lesson: **saved-card grants are data, not hydration policy; a native MCP child and its cached
  catalog have one lifecycle; a public namespace is added once, never copied from an upstream
  prefix; process-local audit state is not a substitute for durable graph evidence.**

- **2026-08-06 — Local Coder historical restoration and duplicate doorway purge.**
  - Restored the previously working `run_local_coder` → trusted backend route → LocalCoder/OpenClaude
    CoderReport path and made saved-card Run, Main/external GPT, and Mag One reuse it.
  - Deleted the alternate direct-terminal engine, including its route, console-task runtime,
    audit-only schemas/policies, tombstone, stale tests, classification doc, and unreferenced stale
    tool-registry audit. Main reaches the saved Coder card only through the generic connected-card
    Harness doorway; there is no Coder-specific Main tool or second engine.
  - Kept the persistent interactive OpenClaude console as a separate surface; removed no saved-card,
    AutoGen, Mag One, repository-root, or CoderReport authority.
  - Repaired Hermes Kanban `assign` against installed CLI syntax and made rail activation depend on
    generic directed graph connectivity plus typed runtime bindings. The external Hermes agent
    runtime remains explicitly unproven.
  Lesson: **a caller is not an execution authority. Converge canvas, Main, external GPT, and Mag One
  on the saved-card runtime; when an experiment adds a second route/service/schema stack, delete that
  whole abandoned stack instead of renaming it canonical.**

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
  into the curated set; the external source stays out unless it is explicitly accepted as a deployable,
  versioned product fork with provenance, canonical installation, tests, and an update/rollback owner.
  `autogen-main` is the deliberate first-party exception; it contains only the exact three Python 0.7.5
  packages LiquidAIty executes, not an unowned reference dump.
- **"Stop point" / WIP checkpoint commits.** Commits titled "checkpoint", "WIP", "save current work",
  "stop point before X" that leave half-finished dead-end code in the tree. A checkpoint is a git stash or
  a branch — not a commit to main that someone else has to clean up later. The `checkpoint` commits
  deleted in the cleanup passes contained dead code that was never going to ship: dangling ThinkGraph
  rewrite attempts (7,759 lines), chat recovery dead-ends (2,591 lines), Cytoscape foundation experiments
  (4,049 lines), and the massive "stop point before quantmind repo eating" (13,376 lines of external repo
  committed as a panic-save). If you need a checkpoint, use a branch. If you committed one, delete it
  before merging.


### Historical record B — September 4 corrective decisions

Source: `070bd1518:DONT.md`, recovered from the pre-rollback history. The full original is
retained below. Its claim that rejected graph records were made dormant is historical evidence
of that repair, not approval to hide records now; the owner subsequently requested removal.
Its platform name, subsystem surfaces and mount wording do not override current instructions.

# Build the real system. Never simulate the product.

This is the owner's explicit correction, not a request for another redesign. Read this alongside
`AGENTS.md` and `PLAN.md` before touching the product. These rules belong in documentation, not as
unsolicited banners in the application and not as filler records in its graphs.

## Immediate prohibitions

- Ask before changing the owner's layout, panel positions, viewport, or collapse behavior, including for screenshots or demonstrations.
- The panel beneath Main is the saved Agent Builder Card's real startup-owned Hermes CLI. It must slide freely up and down, collapse completely at the bottom, and remain mounted without restarting its process. It is not Main or Local Coder.
- Do not replace that CLI with a form, Run-status summary, simulated terminal, or a separate conversation. Main's approved handoff and direct terminal access retain the saved Agent Builder authority.
- No road signs: do not add unsolicited headings, instruction banners, profile/workspace/CBM diagnostics, completed badges, or placeholder status text over the terminal. Keep native output and genuine errors truthful.
- Never fabricate activity, controls, data, completion, or proof. Preserve the user's conversation, saved Cards, topology, profiles, and unrelated work.
- For a requested restoration, inspect the exact Git history and restore only the affected surface. Never reset the whole checkout or unrelated changes.
- When the owner says not to inspect or manipulate the browser, use source and focused tests only.
- Never rearrange the owner's Canvas for presentation. Each Mag One worker has its own direct bus connection; a crossing line is not a Card-to-Card edge. Read saved edge direction and authority before claiming a connection or changing it. Do not wire WorldView through WorldSignals merely for visual grouping.

## What Jeremiah is building

LiquidAIty is intended to make substantial open-source software usable through persistent, configurable
agents and useful applications. It is not a collection of screens pretending that those integrations
exist. The value is in connecting working software, real information, and accountable agent execution
without destroying the capabilities that made the underlying projects worth adopting.

The reusable unit is a saved Card. It has an identity, its own configuration and permissions, a real
runtime, and a user-facing application where appropriate. Cards can work independently and can
participate in a connected team. The saved configuration and actual connections determine authority;
their visual arrangement does not.

The approved direction is native Hermes capability for ordinary agent Cards: isolated profiles and
workspaces, sessions, skills, learning, memory, selected tools, and optional bounded internal teams.
Those capabilities must come from Hermes, not local facsimiles with similar names. Existing legacy
runtime bindings must be reported honestly until an authorized migration is actually completed.

Mag One is the outer team manager. It coordinates eligible saved workers through the real native
Magentic-One runtime. It does not replace those workers' Hermes profiles or turn all their capabilities
into generic assistant prompts. A worker's optional internal team and the outer manager are distinct
execution boundaries. Neither is permission to launch unbounded calls.

An imported repository may be a library, a service, a deterministic engine, or an agent system with its
own internal workers. The Card should use the project's existing public capabilities through the
smallest appropriate Python integration. Do not rewrite an upstream agent system merely to make it
look like ours. Preserve what works, keep changes local to the adapter where possible, and document
unavoidable upstream divergences for contribution and maintenance.

For Trading, Hermes is the reasoning agent and LumiBot is the deterministic trading machinery beneath
it. Real lifecycle state, positions, artifacts, and evidence must drive the dashboard. A plausible
chart is not a trading integration. Paper results are not live performance, and neither authorizes
live orders. Saved account-backed provider/model choices remain authoritative; a subsystem must not
silently substitute a provider or make independent AI calls.

Agent Builder is meant to make this process repeatable: discover useful open-source components,
inspect their actual contracts, compose them into approved Cards, prove a bounded operation, and
retain genuinely reusable skills. Writing a long prompt or rendering a construction form does not
prove that an agent can inspect code, implement an adapter, run it, and return evidence.

These are product requirements. They are not a declaration that every part is already live-proven.

## What a knowledge graph is, and what it must mean here

A knowledge graph represents identifiable entities and explicit relationships with meaningful
properties. Its usefulness comes from what those relationships mean and what can be established from
them, not from drawing circles and lines. A graph can represent observations, attributed claims,
hypotheses, and disagreement; it must not quietly promote them all to established facts.

For this product, useful sourced knowledge could identify an organization, a place, an event, a
document, or a measured observation, and preserve the relationship between a claim and its source.
For example, an event record can be connected to the document reporting it and the location mentioned
in that report. That example describes a structure, not permission to insert invented sample records.
An analyst's suggested market implication remains an attributed assessment, not a proven causal edge.

A user or agent should be able to ask: What is this entity? What does this relationship assert? Where
did the assertion come from? When was it observed? Is this a source statement or an agent assessment?
What conflicting or limiting evidence exists? The UI must expose the available answers without
inventing missing provenance, certainty, or timestamps.

The platform's graph responsibilities remain separate:

| Graph | Responsibility | Must not be confused with |
| --- | --- | --- |
| KnowGraph | Graphiti/Neo4j sourced knowledge and provenance | Coding instructions, decorative nodes, or ungrounded claims |
| ThinkGraph | Constellation project reasoning and operational knowledge | A substitute for the sourced domain knowledge in KnowGraph |
| CodeGraph | Native CBM repository structure and relationships | Guessed symbols or an agent's recollection of source |
| AgentGraph | Saved Card relationships and observed execution lineage in AGE | A new runtime controller or invented agent activity |

Native Hermes profile memory and skills also have their own owners. Showing a projection does not
authorize copying them into another graph. References can connect work across authorities without
creating a second store or a second writer.

Project decisions can legitimately belong in project reasoning when deliberately recorded. That does
not justify filling a knowledge surface with developer-policy notes to make it nonempty. The owner
rejected the three implementation notes shown in this incident. Their being persisted records did not
make them useful knowledge for the requested application.

Never manufacture nodes, edges, sources, activity, or apparent density for a screenshot or a demo.
Never automatically turn this document into graph records. Empty results must remain empty. Failed
reads must remain failures. Neither is an invitation to seed reassuring-looking data.

The graph renderer and graph data are different responsibilities. A renderer can display real IDs
and still be unusable because of layout, unreadable labels, or missing interaction. Conversely, a
beautiful graph can be entirely fabricated. Both truthful data and useful interaction are required;
passing one does not excuse failing the other.

Nodes must have concise, identifiable entity or concept labels, with real relationships between them.
Long descriptions, source passages, and reasoning notes belong in inspectable details, not paragraph-sized
labels spread across the canvas. Do not rename a text dump a graph. Do not manufacture short labels with
keyword rules or insert invented records to fill the screen. Useful project-scoped code, system, and
trading knowledge must be grounded in actual sources and written through the appropriate native owner.

## Preserve the product's separate working surfaces

The owner has provided places for different kinds of work. Respect that separation rather than
putting every setting and diagnostic into whichever panel is easiest to modify.

| Surface | Belongs here |
| --- | --- |
| Card/IDF workspace | Agent prompt, model/profile, tools, permissions, skills, runtime policy, selected graph context, dynamic assignment, and saved Script |
| Named subsystem Card tab | The attached project's capabilities, readiness, lifecycle, and integration contract |
| Agent UI | The live working application: domain state, charts, evidence, artifacts, and authorized interventions |
| Agent UI Inspector | Durable structured domain/subsystem settings; not a duplicate agent configuration editor |

For Trading, portfolio history, current P&L, drawdown, Trade Jobs, and candles must represent actual
state with its mode and source visible where needed. Settings can use sliders and structured controls
when appropriate. An intervention control must invoke an authorized real operation or disclose its
unavailability. A disabled capability is not permission to fabricate its result.

The lower panel beneath Main is the saved Agent Builder's startup-owned native Hermes CLI. It is not a
marketing surface, a separate simulated agent conversation, or a completed-Run summary. Its process
must survive closing and reopening the panel. The user must be able to slide it all the way down so
it disappears. Native output stays native; no unsolicited status wrapper sits on top of it.

Agent Builder remains a real saved Card with its own authority. Removing an inappropriate under-chat
presentation does not authorize deleting that Card, its profile, tools, memory, or history.

## What failed in this incident

The under-chat surface had replaced the native CLI presentation with a construction form, fixed
identity/workspace/CBM text, and Run-status presentation. The split-height logic also enforced a
minimum open height instead of permitting full collapse. That violated both the requested interaction
and the identity of the tool occupying the panel.

The graph displayed a small set of implementation-policy notes as large node labels. Their persisted
existence was not proof of meaningful domain knowledge, research ingestion, or a useful graph product.
Showing native node IDs and passing synchronization tests could not establish that the populated
visualization was readable or useful.

The engineering error is treating structural connection as delivered functionality: a component is
mounted, therefore the application works; a record exists, therefore it is the right knowledge; a
test passes, therefore the user's workflow was preserved. Those conclusions do not follow.

The repair must not repeat that error. Removing rejected notes is not proof that knowledge ingestion
works. A running CLI process is not proof of a new model response. Restoring tested collapse logic is
not browser acceptance when the owner has prohibited browser inspection. Report those distinctions.

## What must never be done again

1. Do not replace a real native tool with a form, a transcript imitation, or success-shaped UI and call
   it an integration. Use the real session and execution authority.
2. Do not add filler knowledge or fake activity. Keep fixtures in isolated tests, never in the user's
   operational graph or dashboard. Persist only authorized material through its proper owner.
3. Do not equate decorative movement with thinking, retrieval, traversal, or consumption. Visual
   activity must correspond to an observed operation on actual native objects.
4. Do not silently alter layout, collapse behavior, Canvas placement, or controls. A screenshot request
   is permission to capture the product, not permission to rearrange or redesign it.
5. Do not treat wires as decoration. Read the exact saved relationship, direction, enabled state, and
   effect before changing it. Each worker's bus connection must preserve its own eligibility.
6. Do not solve slowness by discarding useful interaction or knowledge fidelity. Measure the affected
   boundary, preserve the user's workflow, and prove the proposed change on representative real data.
7. Do not claim populated-graph quality from empty-state tests, model execution from a health check,
   or successful work from a transport acknowledgment. Match each claim to the proof it requires.
8. Do not overwrite saved prompts, models, profiles, sessions, grants, or topology to make a test pass.
   No hidden provider fallback, duplicate runtime, or unauthorized model call is acceptable.
9. Do not respond to a narrow correction with a wider restoration, renderer migration, database reset,
   or folder deletion. Verify the exact targets and preserve everything outside them.
10. Do not leave the abandoned implementation live after an authorized replacement is proven. Remove
    its actual callers and obsolete controls, not unrelated functionality with a similar name.

These are engineering and review obligations, not instructions to add another runtime gate, semantic
filter, classifier, scheduler, or banner.

## Evidence before presentation

The permanent integration order is:

```text
repository public contract
→ working adapter
→ real readiness and state
→ one bounded proven operation
→ then named tab, Agent UI, and settings Inspector
```

For an existing working UI, preservation applies throughout that order. Do not break the original
workflow while waiting to prove the replacement. Preserve the actual outputs, failures, source IDs,
and artifacts of the bounded operation. Present them honestly rather than generating frontend data
that resembles what success ought to look like.

Before editing, state the smallest requested change and what must remain working. Inspect the current
source and relevant history, use CBM for structural ownership, and account for unrelated dirty work.
After editing, verify the affected contracts and the removed path's surviving neighbors. Ask before
any materially broader change. Respect an explicit prohibition on browser manipulation or service
restarts even if that leaves a proof gap.

A report must distinguish source inspection, focused tests, persisted readback, actual runtime
execution, and user-visible acceptance. Say what remains unproven. Do not fill that gap with a claim,
a mock, a synthetic graph, or another unapproved call.

## Scope of the current correction

The under-chat construction form and fixed status/diagnostic presentation have been removed from the
Main surface. The native CLI presentation and zero-height collapse behavior have been restored in
source. Focused tests exercise collapse/reopen behavior, preservation of the mounted terminal, native
session attachment, and absence of the removed wrapper; this is not a new provider-backed acceptance.

The three rejected implementation notes were made dormant through the canonical Constellation
operation. They are recoverable, not permanently erased. Readback for the affected project returned
zero active projected nodes and zero edges. No replacement records were inserted.

This correction does not delete the saved Agent Builder Card, restore Engraphis, replace the current
graph renderer, rewrite graph engines, or alter KnowGraph, CodeGraph, AgentGraph, saved wires, or
unrelated work. The graph's visual quality and a useful sourced-knowledge workflow are not declared
fixed. They require their own precisely scoped, authorized work and matching proof.


## 3. Superseded details and implementation status

The two source records are preserved verbatim, including old architecture rules, names, counts,
paths, model assignments, proof receipts and rejected approaches. They are incident evidence.
No historical command in them is a current instruction to execute or recreate code. In particular:

| Historical detail | Status for this recovery | Present rule |
| --- | --- | --- |
| Removed duplicate runtimes, context/materializer layers and versioned routes | Removed according to record A; exhaustive current residue audit not performed here | Verify surviving source before replacement; one existing runtime/input owner |
| Old CBM scope, freshness gates and removed tool names | Superseded procedural details | App-published CBM and current coverage procedure; known source remains readable |
| Old model assignments, Card counts and numerical removal tallies | Historical, not remeasured | Saved selections and current source/readback decide current state |
| Forced-open CLI/form/status wrapper | Rejected in record B; present end-to-end acceptance pending | Preserve genuine terminal, user pull-up/collapse and separate saved Card identity |
| Dormant rejected graph notes | Historical corrective action; later owner rejected hiding | No data operation in this documentation repair; follow exact authorized graph removal later |
| Automatic learning during model materialization | Source repaired with regression tests; loaded proof pending | Changing the subagent model preserves independent review settings |
| Output expectations mapped to memory policy | Source repaired with regression tests; loaded save/reload pending | Existing output-contract field; preserve unrelated prompt bytes |
| Historical commit/stash/branch advice | Superseded authorization advice | Jeremiah owns Git; no mutations without his explicit request |
| Feature manifests, LLM wiki, obsolete research/skill procedures | Not restored as active or historical workspace files | Keep documentation bounded to existing canonical owners |

## 4. Current replacement rules

`AGENTS.md` supplies operating rules and required reading. `PLAN.md` records accepted direction
and remaining work. `ARCHITECTURE.md` identifies verified source owners separately from targets
and loaded proof. Relevant `skills/*.md` supply reusable procedures. This file preserves incidents
and the owner's reasons for prohibiting repetition; it is not a runtime policy or UI content source.

Current user decisions supersede both historical records. Do not silently replace a concrete
incident with generic advice, erase it because its code was removed, or use it to resurrect the
removed implementation. Preserve the incident, mark obsolete details, and verify today's owner
before changing code. No historical incident was omitted or deduplicated in this recovery.

Card runtime bindings are fixed configuration supplied by their construction authority, not
editable kind/mode dropdowns. Mag One remains Mag One. Hermes `delegate_task` roles are separate
settings of the existing agent, never choices that turn it into Main or another runtime.
