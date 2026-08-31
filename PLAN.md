# LiquidAIty Core v0 Plan

This is the current product plan. It describes what the repository owns now, what must remain
separate, and the smallest proof required before live model testing. Historical migrations belong in
Git history, not active Markdown.

## Core v0

```text
Chat / GPT plugin
  → Main Chat Card (Hermes, profile liquidaity-main)
     ├─ flow → Agent Builder Card (Hermes delegate, profile liquidaity-agent-builder)
     ├─ flow → Graph Agent Card (Hermes delegate, profile liquidaity-hermes-steward)
     ├─ native delegate_task(team) → headless Auto-Team inside Main's existing Card Run/session
     └─ magentic_control → automatic or optionally reviewed Card handoff → native AutoGen Magentic-One
        └─ magentic_option → Local Coder Card (Hermes delegate, profile coder)

Direct Assistant Card
  → native AutoGen AssistantAgent

Every shared tool
  → one official Python HTTP MCP host
```

OpenClaude, the removed standalone LocalCoder runtime, and Bun are absent from the dependency graph.
`card_local_coder` and `template_local_coder` now identify the Hermes-backed user-facing Local Coder;
they do not select a runtime implementation.

## Current versus unproven

### Current source contracts

- Saved Cards own identity, prompt, provider/model/profile, runtime binding, enabled state, and grants.
- Each saved Hermes Card also owns a desired bounded-subagent model. Run start materializes that
  selection into the same native profile, reads it back, and records actual child provider/model plus
  fallback state without rewriting the parent model. Memory-provider choice remains native profile
  configuration; only Main exposes the bounded Honcho setup/status control.
- `runtime.kind` plus `runtime.mode` selects Hermes Main/delegate, AutoGen Assistant, or native
  Magentic-One. Card names and template text do not select runtimes.
- Main, Agent Builder, Local Coder, and Graph Agent are separate saved Hermes Cards with separate profiles
  and runtime homes.
- Any authorized ordinary Hermes Card may use native `delegate_task(role="team")` as a headless
  capability. Each saved Hermes Card owns a small Team policy: Off/Auto, maximum workers, retry limit,
  worker model, and one Team-lead model for decomposition and final synthesis. Auto authorizes Hermes
  to decide whether to call the native tool; it does not launch Team when a Card Run starts. The
  Subagents tab edits that saved policy and projects the current or last Card Run plus bounded native
  activity. It is not a board, task editor, receipt product, or runtime authority. Main's existing
  `leaf` delegation remains available independently; native recursive delegation remains internal and
  has no new product control.
- Main delegates only across saved AGE/ReactFlow relationships.
- The official Python MCP host is the shared tool doorway. Its catalog is discovered dynamically;
  documentation and tests must not promise a permanent numeric tool count. The external GPT connector
  publishes each IDD `external-mcp` operation once under its canonical unprefixed ID. LiquidAIty is the app
  name and is not injected into server tool IDs; ChatGPT owns its client-side app namespace. Public,
  Card/catalog-reader, and stdio dispatch all use the same canonical IDs without aliases or duplicate handlers.
  Source/SDK proof is not a substitute for a loaded-process readback and a genuinely fresh selected-plugin
  conversation.
  The MCP host owns OAuth/resource metadata and readiness; canonical startup launches ngrok directly as
  transport and does not place catalog or application policy in a tunnel helper.
- The published catalog preserves disabled/unavailable tools. `all_healthy` grants broad healthy
  read/search/discovery access while every write/effect remains an explicit saved Card grant with its
  confirmation contract. That broad read set is Script authorization, not default model presentation:
  explicitly saved tools remain `AGENT` by default, implicit healthy reads remain `OFF` unless the saved
  Script claims them as `SCRIPT` or `BOTH`.
- IDD supplies composable builder types, objects, templates and effect annotations, not runtime
  authentication or a second IDF validator. After user agreement, Main directs only the dedicated
  Agent Builder Card to compose existing templates or custom Cards. Local Coder never receives the
  full palette. This interaction awaits live proof.
- Hermes is the runtime platform; LiquidAIty composes native capabilities and contextualizes Runs.
  Native catalogs, profiles, tools and worker lifecycle remain Hermes-owned.
- Every Card has one saved Python Script field and the same Monaco editor in Agent Builder. IDD and the
  effective Tools-tab selection supply exact autocomplete/schema contracts. A valid Hermes Script wraps
  only its literal `tools.call()` handles behind one compact tool and runs through Hermes' existing
  child-process Python/tool-RPC path; unwrapped selected tools remain ordinary MCP tools. Blank/invalid
  source keeps exact selected MCP schemas. A runtime failure before any operation begins may restore only
  the Script's pre-registered wrapped handles for the current model iteration; a failure after any tool
  operation begins is terminal and cannot replay through the model. The active version/hash is immutable during a Run.
  AutoGen Cards retain the editor but cannot activate this Hermes-native execution path.
- The Card Inspector has exactly five top-level surfaces: CLI, Prompt, Context, Tools, and Script. Prompt
  contains the existing prompt plus provider/model/runtime controls; Context contains the existing graph,
  memory, selected references, and native skills/learning controls. This is presentation consolidation,
  not another persistence owner or execution path. Optional ThinkGraph and KnowGraph Script examples call
  only the canonical `constellation.*` and `graphiti.*` operations and remain inactive until explicitly inserted.
- After the repaired host-Script boundary is loaded, the first real Agent Builder Script acceptance should
  be one small graph-context recipe: leave unrelated authorized reads `OFF`, claim only the most useful
  bounded native graph reads, and assemble their native references into context for one ordinary Hermes
  turn. The recipe may wrap repeatable sequencing but cannot create a graph owner, widen grants, or run
  before the Card's explicit CLI/Run task starts.
- Python rails own deterministic runtime work, AutoGen, Magentic-One, native tools, and graph adapters.
- Python rails own the one Constellation child and database adapter. The official MCP host proxies its
  Constellation calls through that existing owner and never starts another engine process or database.
- ThinkGraph, KnowGraph, CodeGraph, and AgentGraph have separate owners and never become one copied
  graph.
- KnowGraph UI reads are deterministically bounded and exclude embedding-vector properties; native IDs,
  provenance, and Graphiti's separate bounded semantic reads remain available.
- Reveal renders compact native attention events. It never infers hidden reasoning or writes graph
  meaning.
- The Agent Builder Graphs workspace uses the embedded CodeGraph renderer with bounded native CBM
  projections. The removed standalone CBM demo/package shell is not part of the product.
- Every Hermes-profile Card reads its real native Learning Journey/SkillGraph in the Context tab. The
  graph is a projection of profile skills, usage and curated-memory chunks, not another store.
- Eligible completed Hermes Runs may launch one deduplicated, asynchronous native background review.
  The owning Card's subagent selector configures both native delegation and this review; new Hermes
  Cards default to account-backed `gpt-5.6-luna`. It can patch only the owning profile's native
  memory/skills and may legitimately make no change.
- Main context routing is mutually exclusive: contextualized external-plugin turns keep Honcho tools
  callable but bypass automatic Honcho inject/observe/write; direct native Main turns use Main-only
  Honcho fail-open. Workers and background-review children receive neither Main Honcho context nor sync.

### Still requiring live proof

- Native Main-to-Agent-Builder delegation with truthful child Run, tool, native-reference, and AGE lineage.
- Automatic and optionally reviewed one-IDF handoff to one native Magentic-One run.
- End-to-end Reveal pacing for graph consumption, traversal, handoff, and writes.
- A canonical reload must load the saved subagent selector chain, child receipt migration,
  Constellation operation route, bounded KnowGraph/profile readback, and the corrected Main-only Honcho
  Inspector status. Local proof must record the startup-specific catalog count/hash and retain one actual
  account-Luna child receipt without issuing a duplicate paid call.
- The new Card Script path still requires one canonical loaded-process proof: saved Main, the Hermes helper and
  Agent Builder Scripts must retain their normal prompts/profiles/grants, one real account-backed Luna
  turn must return the compact Script/native receipt, and blank/broken exact-selected MCP fallback must
  be observed without a catalog-wide leak.
- Direct Main routing and fail-open completion are live-proven. Actual Honcho recall/write success remains
  unavailable until the intended service and account credential/base URL are present.

Live proof already completed before this integration pass: one direct saved Main account/model response;
one saved Local Coder account-backed Run; a real Holographic add/search/remove lifecycle with zero retained
test facts; and one deduplicated asynchronous Luna background-review child whose valid result was no new
skill. The prior child does not by itself prove the new saved-Card selector and actual-model receipt chain.
Native headless Team is now additionally live-proven through the fresh persistent-Main doorway: parent Run
`req_f4dc226f` bound before inference, allocated child Run
`hermes_child_ca3d74c5-0e66-4e9a-88f3-cb543946f36b`, attached native root `t_0c8618b6`, completed exactly
two Luna workers (`t_0a5610dc`, `t_91562520`), ran one Terra synthesis, and appended it once to originating
session `20260830_170231_2b1e6f`. No provider fallback, duplicate root/child/message, nested delegation or
acceptance retry occurred.

Structural tests are not substitutes for these live proofs.

## Authority model

```text
effective capability
  = saved Card capability ceiling
  ∩ installed native availability
  ∩ exact Run grants
  ∩ current input selections and native references
  ∩ saved AGE/ReactFlow relationship
  ∩ explicit user approval where required
```

Routing metadata, sender/target Card IDs, Run IDs, conversation IDs, and correlation IDs stay outside
the transient Card call. The call carries task meaning and selected context, not runtime control.

## Runtime roles

### Main Chat

- Card: `card_main_chat`
- Hermes mode/profile: `main` / `liquidaity-main`
- Owns the persistent conversation front door and approval of downstream work.
- May use only its saved tools and its saved outgoing relationships.

### Agent Builder

- Card: saved dedicated Agent Builder identity
- Hermes mode/profile: `delegate` / `liquidaity-agent-builder`
- Owns approved Card creation/configuration, canvas wiring, agent UI, IDD, Agent Maker, and CBM work.
- Its saved CBM surface is the selected structural recipe only: `cbm.search_graph`, `cbm.trace_path`,
  and `cbm.get_code_snippet`. Projection coverage and working-tree change detection remain Local Coder
  concerns and are not implicit Agent Builder reads.
- Has no Magentic-One connection and receives no Local Coder state.

### Local Coder

- Card: `card_local_coder` (user-facing name is Local Coder)
- Hermes mode/profile: `delegate` / `coder`
- Owns bounded work against an explicitly selected local repository.
- Uses CodeGraph/CBM first, then direct source and focused proof.
- Remains a Magentic-One worker option and has no direct Main flow.

### Graph Agent

- Card: `card_hermes_steward`
- Hermes mode/profile: `delegate` / `liquidaity-hermes-steward`
- Owns planning, research, memory, and KnowGraph work within its grants. It is an ordinary Card, not
  the execution authority for Team; like other authorized Hermes Cards it may use the headless native
  Auto-Team capability internally.
- Has separate saved-Card identity, prompt, model, grants, stable native session, and native profile home.
  Its existing identity and saved history are preserved while its later graph boundary remains unsettled.
  Migration `031_graph_agent_continuity.sql` creates a new current revision for an existing
  `card_hermes_steward` instead of rewriting historical revisions or Runs; only the product title and
  current runtime mode change.
  Main, Coder, and Graph Agent keep separate native memory and sessions. The ACP adapter reuses a process
  owner per profile; shared integration code does not imply a shared memory database.

### AutoGen

- The checked-in first-party `autogen-main` fork is pinned to official Python AutoGen 0.7.5 and is
  the sole installed source for `autogen-core`, `autogen-agentchat`, and `autogen-ext`. Its upstream
  base is frozen; LiquidAIty maintains it instead of adopting later Microsoft versions.
- `AssistantAgent` is the direct single-Card rail.
- `MagenticOneGroupChat` is the native team rail.
- A saved Magentic-One Card with `openai` + `chatgpt-account` uses the official Codex app-server only
  as its `ChatCompletionClient`: one owned process per Run, one ephemeral tool-free thread per model
  completion, exact saved-model preflight, and no OAuth-token handling or provider fallback.
- Task and Progress Ledgers remain private AutoGen state.
- Saved `magentic_control` and `magentic_option` edges define control and worker eligibility.

## Graph and attention plan

```text
ThinkGraph  = Constellation Engine project reasoning and memory
KnowGraph   = Graphiti/Neo4j sourced knowledge and provenance
CodeGraph   = native CBM repository structure
AgentGraph  = Cards, relationships, Runs, delegation, references, tools, and artifacts in AGE
```

The current ThinkGraph MVP uses the Python-owned Constellation projection route, the renderer-neutral
`GraphProjectionV1` DTO, one disposable in-memory Graphology `MultiDirectedGraph`, and Sigma v3 WebGL.
Graphology and Sigma are view state only. Attention decorates exact IDs already returned by Constellation;
it cannot create substitute nodes. Empty native results render an honest empty state. A later 3D mode may
consume the same DTO but is not part of the current renderer.

The foreground graph starts empty and reveals only native objects actually returned, selected,
consumed, traversed, handed off, or written. Inspector detail may show technical receipts. Card faces
may show correlated tool activity, but Card animation is not a substitute for graph attention.

Constellation uses pinned engine `1.0.5` at revision
`ac460489f1cd3cd629fa96f2730e5ae9daa4326c` and one database/process owner. Its catalog exposes bounded
topology reads/writes, BGE-M3 semantic start/status/stop/context/remember, cancellable re-embedding,
preview-confirm-readback identity mutation, explicit bounded autonomy controls, edge review/pair
operations, launcher outbox status/notify, and message injection. `kickoffSeedExpansion`,
`draftSoulCore`, and `rememberRaw` remain disclosed as unavailable until their exact upstream
provider/worker/timeout contracts are satisfied; no second runtime or database substitutes for them.

KnowGraph UI projection selects at most 500 project-scoped nodes and 1,000 in-window relationships and
does not transport embedding arrays. Graphiti remains the only native KnowGraph semantic/search authority.

## Stable prompt and procedure recommendations

These are recommendations for later saved-prompt review, not grant changes or catalog pruning:

- Main should begin with its exact server context, use ThinkGraph/Constellation for project reasoning,
  and call downstream Cards only through saved topology. Contextualized plugin turns should keep the
  Honcho bypass marker; direct Main should retain native Main-only Honcho fail-open behavior.
- Memory use should stay deliberate: profile history and curated memory, then the profile's native
  external provider when explicitly configured, then a relevant native skill, followed by selected ThinkGraph/KnowGraph/CodeGraph reads. Do
  not inject all authorities or pass credential/receipt tokens between agents.
- Agent Builder should follow `IDD/catalog inspect -> select existing object/tool -> preview exact saved
  change -> save -> native/readback verification`. It may use CodeGraph for this repository but should
  not send the whole IDD palette to ordinary Cards.
- Local Coder should follow `cbm.search_graph -> cbm.trace_path -> cbm.get_code_snippet -> complete direct
  source read -> inverse caller/residue audit -> focused tests/typecheck`. Literal `search_code`/`rg`
  remains the fallback for imports, configuration, ignored files, and coverage gaps.
- Graph Agent should use native Hermes task/history state for its current planning and KnowGraph/Graphiti bounded
  reads for sourced knowledge. Any Graphiti write remains an explicit saved grant and confirmed effect.
- Any Card may use healthy read/search/discovery tools when the saved `all_healthy` policy permits them;
  prompts should name the desired authority and ask for native IDs/provenance instead of copying graph
  schemas or passing receipt/token keys.
- Native skills should carry reusable tool-use knowledge. Promote an ordered procedure into a recipe only
  after repeated real lifecycle proof shows stable inputs, receipts, cleanup, and failure handling; do not
  create another skill/recipe engine.

## Supported repository commands

Node is pinned by `.nvmrc`, `engines`, and `packageManager`. Dependency lifecycle scripts are disabled
by `.npmrc` and must also be disabled explicitly during install.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run prisma:generate
npm run typecheck:all
npm --workspace apps/backend run build
npm --workspace client run build
npm test -- --run <focused-specs>
npm run dev:fresh
```

Python services keep separate existing virtual environments and requirement owners:

```powershell
apps\python-models\.venv\Scripts\python.exe -m pip install --no-cache-dir -r apps\python-models\requirements.txt
services\knowgraph\.venv\Scripts\python.exe -m pip install --no-cache-dir -r services\knowgraph\requirements.txt
apps\python-models\.venv\Scripts\python.exe -m pip check
services\knowgraph\.venv\Scripts\python.exe -m pip check
```

Ordinary startup is exactly `npm run dev:fresh`. It owns frontend, backend, Python AutoGen rails,
KnowGraph, official MCP, and readiness-gated ngrok. Component scripts are implementation details, not
alternate startup instructions.

## Ordered delivery

1. Keep cold install, typecheck, build, focused tests, and static startup proof green.
2. Prove Main alone with one bounded, explicitly approved model call.
3. Prove Main → Agent Builder and truthful child lineage.
4. Prove one ordinary Card's headless Auto-Team with Terra decomposition, two to four Luna workers,
   separate Terra review/synthesis, exact same-session result delivery, and durable rejoin.
5. Prove transient Mag One Card input → native Magentic-One.
6. Prove native graph attention and Reveal from real read/write events.
7. Complete the loaded Card Script/selector/receipt proof, rebuild the canonical IDD/application/MCP
   catalogs, preserve disabled entries, and prove real local read/write/readback lifecycles before the
   separate external GPT-plugin acceptance.
8. Only then consider prompt/skill/recipe recommendations and later catalog reduction; recommendations
   do not change grants or remove tools.

## Core v0 acceptance

- One Card authority, one IDD, one transient Python call materializer, one official Python MCP host.
- One canonical `dev:fresh` tree and one root npm workspace lock.
- Hermes Main/Agent Builder/Local Coder/Graph Agent, the per-Card headless Auto-Team capability,
  AutoGen Assistant/Mag One, and four graph authorities remain distinct.
- Memory projections are named honestly: Learning Journey/native SkillGraph, episodic labels,
  attention, and Run artifacts do not become duplicate stores.
- No OpenClaude/standalone-LocalCoder/Bun implementation, package root, lock, fallback, or downloader.
- No fake graph activity, provider substitution, automatic embeddings, or product-data reset.
- Regression Ratio for every accepted change is `0.000`.
