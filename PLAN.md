# LiquidAIty Core v0 Plan

This is the current product plan. It describes what the repository owns now, what must remain
separate, and the smallest proof required before live model testing. Historical failure records belong in `DONT.md`, clearly separated from current architecture.
Git retains exact historical source; old implementation instructions are not current requirements.

## Product boundary

The owner's delivery target is to finish the existing Trading application and freeze that delivery,
then continue the reusable system as a separately named platform. Trading is an application built on
the platform; its brand and domain must not define shared agent, graph, editor, or execution code.
Shared identifiers describe their responsibilities. User-facing labels describe the action or content,
without implementation names or explanatory filler. Application branding belongs in application
presentation and configuration. Existing persisted and public branded identities require a coordinated
migration with data and contract preservation; finishing the current delivery does not authorize a
blanket replacement, a rebuild, or removal of working capabilities.

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
  capability. The existing automatic SQLite ledger owns its configuration and execution. The later
  Card worker-count/retry/model-policy overlay is removed. Team selection authorizes the tool; it
  does not launch Team when a Card Run starts. Recovery uses Git b78b79ac, followed by the owner's
  explicit removal of the added 2–4 task-count clamp; existing dispatcher concurrency remains. Its
  historical acceptance is recorded below; loaded execution after recovery remains unproven. Native Leaf and
  recursive delegation remain internal execution. Exposing their real supported settings in Runtime
  is part of the approved Card target and is not yet complete.
- An enabled outgoing orange `flow` edge authorizes native
  `delegate_task(role="profile", target_profile=...)` to that exact ordinary Hermes Card/Profile.
  Direction is exact; blue Magentic-One edges grant no direct Card call. The receiving Card runs through
  the existing Card Run/IDF owner with its own saved prompt, model, tools, skills, memory, Script, grants,
  session, and optional private Team. The model-facing Card runner is the one native `delegate_task` tool;
  `card.run_assistant_agent` remains only the private canonical execution handler.
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
  authentication or a second IDF validator. Agent Builder is Main's under-chat implementation/coding
  agent and also owns approved Card building; it receives the full palette only when a mission requires
  Agent Builder work. Local Coder never receives the full palette. Main delegation and direct under-chat
  invocation use the same saved Card Run authority; live provider-backed coding execution still requires
  separate acceptance proof.
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
- Ordinary saved Cards may declare validated product-neutral `card-subsystem.v1` attachments. A named
  subsystem Card tab shows only the adapter contract, capabilities, readiness, lifecycle, and native-agent
  policy. The Agent UI renders live domain work, its adjacent Inspector owns durable domain settings, and
  the Card/IDF workspace continues to own agent configuration. The first source implementation attaches
  LumiBot beneath `card_trading_workbench`; no second Trading Card, runtime, scheduler, or broker owner is created.
- Agent Builder repository-backed construction starts with a bounded public-repository search and an
  evidence comparison. It prefers an upstream public API/protocol and records keep/remove criteria before
  code composition. Its exact edit operation can authorize prompt, tools, structured configuration, saved
  Python Script, and subsystem attachments without widening runtime or model authority.
- Ordinary Card Inspectors have CLI, Prompt, Runtime, Memory, and Tools. Main and Builder omit CLI
  and open on Prompt; their established chat and pull-up CLI remain separate. Prompt
  keeps separate Role, Goal, Constraints, IO Schema, and Output expectations fields plus the existing Soul editor.
  Runtime contains parent/subagent model selections and Delegate task, without an added Team policy.
  Memory contains installed skills and the profile learning graph, followed by the existing external-memory control.
  Automatic skill settings and complete save-on-leave persistence acceptance remain incomplete. Tools contains the existing Python Script editor
  below the tool selection. This is presentation consolidation,
  not another persistence owner or execution path. Optional ThinkGraph and KnowGraph Script examples call
  only the canonical `engraphis_*` and `graphiti.*` operations and remain inactive until explicitly inserted.
- After the repaired host-Script boundary is loaded, the first real Agent Builder Script acceptance should
  be one small graph-context recipe: leave unrelated authorized reads `OFF`, claim only the most useful
  bounded native graph reads, and assemble their native references into context for one ordinary Hermes
  turn. The recipe may wrap repeatable sequencing but cannot create a graph owner, widen grants, or run
  before the Card's explicit CLI/Run task starts.
- Python rails own deterministic runtime work, AutoGen, Magentic-One, native tools, and graph adapters.
- Python rails own the one Engraphis 1.7.1 service and database adapter. The official MCP host and exact
  reference hydration proxy through that owner and never open another engine or database.
- ThinkGraph, KnowGraph, CodeGraph, and AgentGraph have separate owners and never become one copied
  graph.
- KnowGraph UI reads are deterministically bounded and exclude embedding-vector properties; native IDs,
  provenance, and Graphiti's separate bounded semantic reads remain available.
- Reveal renders compact native attention events. It never infers hidden reasoning or writes graph
  meaning.
- The Agent Builder Graphs workspace uses the embedded CodeGraph renderer with bounded native CBM
  projections. The removed standalone CBM demo/package shell is not part of the product.
- Every Hermes-profile Card reads its profile Learning Journey/SkillGraph data in the Memory tab. The
  graph is a projection of profile skills, usage and curated-memory chunks, not another store.
- Eligible completed Hermes Runs may launch one deduplicated, asynchronous native background review.
  Review has independent saved profile settings. The source repair now materializes only the
  delegation model and preserves review enabled/disabled/unset state; focused tests pass, but
  loaded acceptance remains pending. Existing creation defaults still require alignment with IDD.
  Review can patch only the owning profile's native
  memory/skills and may legitimately make no change.
- Main context routing is mutually exclusive: contextualized external-plugin turns keep Honcho tools
  callable but bypass automatic Honcho inject/observe/write; direct native Main turns use Main-only
  Honcho fail-open. Workers and background-review children receive neither Main Honcho context nor sync.

### Still requiring live proof

- Native Main-to-Agent-Builder delegation with truthful child Run, tool, native-reference, and AGE lineage.
- Automatic and optionally reviewed one-IDF handoff to one native Magentic-One run.
- End-to-end Reveal pacing for graph consumption, traversal, handoff, and writes.
- A canonical reload must load the saved subagent selector chain, child receipt migration,
  Engraphis operation route, bounded KnowGraph/profile readback, and the corrected Main-only Honcho
  Inspector status. Local proof must record the startup-specific catalog count/hash and retain one actual
  account-Luna child receipt without issuing a duplicate paid call.
- The new Card Script path still requires one canonical loaded-process proof: saved Main, the Hermes helper and
  Agent Builder Scripts must retain their normal prompts/profiles/grants, one real account-backed Luna
  turn must return the compact Script/native receipt, and blank/broken exact-selected MCP fallback must
  be observed without a catalog-wide leak.
- The Trading reference now has canonical saved-deck reconciliation, loaded-process Card/profile/subsystem
  readback, its preserved Magentic-One worker edge, and one authenticated local LumiBot lifecycle whose
  snapshot, SSE events, replay candles and hashed artifacts render in the existing Agent UI. One native
  account-backed Luna Card Run has now exercised the saved `trading` profile and read back its parent model,
  assigned skill and holographic-memory availability without tools, Team, Magentic-One or subsystem execution.
  A real Magentic-One invocation remains a separate explicitly approved proof. Alpaca reports explicit broker
  unavailability; order submission and automatic strategy promotion remain blocked.
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
- Appears beneath Main Chat as a Run-based coding surface and executes explicit implementation missions:
  inspect current source, edit, run commands/tests, and return evidence.
- In normal conversation the same saved profile retrieves ThinkGraph and KnowGraph data directly and
  writes the requested detailed answer, report, plan, or prompt. Writing does not authorize execution.
  Main remains the upper conversation; the lower reader does not switch Main into a terminal mode.
- Also owns approved Card creation/configuration, canvas wiring, agent UI, IDD, Agent Maker, and CBM work.
- Its actual available CBM operations come from saved grants and the live catalog. Follow the
  current CBM discovery procedure; this document does not narrow that catalog.
- Has no Magentic-One connection and receives no Local Coder state.

## Agent Builder product vision

Approved target; complete creation, customization, canonical reload and execution acceptance remain
incomplete. Existing restrictive validation and saved prompts must be repaired through their current
owners before this behavior is described as working.

- Main and Graph Agent prepare intent and useful references. Builder receives the actual dynamic mission.
- Builder reads the IDD dictionary, selects a template, creates a Card, then customizes that Card using
  the same field definitions, supported runtime settings, options and live catalogs used by the editor.
- A new-Card task does not require an existing target. Editing uses the chosen saved Card and preserves
  unrelated Cards, identities, unique profiles and grants. There is no approved AutoGen-only creation
  rule or prompt/tools-only edit rule. Real authorization remains at the existing Card operation boundary.
- Code work uses the actual selected workspace and CBM where covered. Missing index coverage permits
  bounded direct-source discovery; it does not silently switch projects or become an execution gate.
- Python routines use the existing Tools editor and Hermes execution owner. Ordinary Cards receive
  selected values and dynamic input, never the complete Builder dictionary.
- Report created/changed fields and genuine canonical readback. Execution is separately proven within
  the active mission; a saved Card or passing unit test is not proof of a successful agent Run.

### Local Coder

- Card: `card_local_coder` (user-facing name is Local Coder)
- Hermes mode/profile: `delegate` / `coder`
- Owns bounded work against an explicitly selected local repository.
- Uses CodeGraph/CBM first, then direct source and focused proof.
- Remains a Magentic-One worker option and has no direct Main flow.

### Graph Agent

- Card: `card_hermes_steward`
- Hermes mode/profile: `delegate` / `liquidaity-hermes-steward`
- Owns external research and sourced KnowGraph work within its grants. It is an ordinary Card, not
  the execution authority for Team; like other authorized Hermes Cards it may use the headless native
  Auto-Team capability internally.
- Has separate saved-Card identity, prompt, model, grants, stable native session, and native profile home.
  Its existing identity, saved history, model and Team configuration are preserved. It may read
  ThinkGraph references but no longer has ThinkGraph mutation or downstream prompt-staging grants.
  Migration `031_graph_agent_continuity.sql` creates a new current revision for an existing
  `card_hermes_steward` instead of rewriting historical revisions or Runs; only the product title and
  current runtime mode change.
  Main, Coder, and Graph Agent keep separate native memory and sessions. The ACP adapter reuses a process
  owner per profile; shared integration code does not imply a shared memory database.

### ThinkGraph

- The saved `thinkgraph` profile uses Engraphis, with Luna as its parent and native subagent selection.
  Its current delegation selection is off. Graph Agent's SQLite Team is unchanged.
- It maintains observed statements, revisable conclusions, decisions, preferences and summaries with
  source/turn identity and native relationships. Assistant proposals never imply user acceptance.
- Honcho is a behavioral reference for evolving understanding, not another runtime or storage owner.
  Main's native external-memory selection is now disabled; no Honcho data was deleted.
- Worker references locate graph evidence. Agent Builder retrieves that evidence itself before synthesis.

### Cognition implementation status

The project has the new ThinkGraph binding, the existing Graph Agent narrowed to KnowGraph research,
and the existing Builder extended for synthesis. Deterministic preparation verifies their grants and
Main's saved delegation edges without inference. The lower reader displays Builder's actual Run output.
The completed-pair source hook returns Main independently of background delivery. Following the owner's
September 8 correction, Python delivers retained Main input/output only to ThinkGraph through the
existing saved Run doorway. The automatic Graph Agent second stage and copied worker-result hints are
removed; KnowGraph retains sourced findings from research work, not every conversation. Stable
correlation IDs reuse completed results and halt on existing noncompleted children; no child is restarted.
Contract tests cover the sole recipient, duplicate/concurrent delivery,
identity checks and failure stops. This is not live model or graph acceptance.
Delivery queued in process is not restart-durable. Main reading conversation-scoped Builder output still
requires proof. Saved Main, Graph Agent, Builder, and ThinkGraph grants now use native Engraphis names;
Main's existing conversational prompt remains unchanged by this cutover.
Entity/relationship context linking remains unproven. Main context search and injection remain a separate
TODO; existing preload code is not acceptance of its relevance, selection, or data boundaries. Inspect
these pieces one at a time. Do not force a Question/answer workflow or add deterministic semantic routing.
Automatic message/embedding retrieval and latency tuning come last, after this graph-to-synthesis path.
For Main's next context decision, use a bounded prepared view of current attention as the starting
point: active work, pending/completed results and native graph references. AGE supplies observed
activity; ThinkGraph supplies accepted intent/decisions, and KnowGraph supplies sourced findings.
The durable graphs can grow; the context supplied to Main must not grow without bounds. Message and
embedding search may supplement this view. This is the owner's latest direction, not implemented or
latency-proven. The retained Main Run `req_c5b3ced4` took 9m32.6s; its aggregate record does not expose
the token/tool breakdown needed to attribute that delay.

Synthesis is requested through Main's existing profile delegation to Agent Builder, not automatically
rewritten after every conversation pair. Builder reads the native graphs directly and produces a report,
plan or execution prompt. Graph workers return compact references and changes, not recurring reports.
The completed-pair path does not invoke Builder. Its completed Run result remains stable; revisions
are new requested work. Attention preparation, explicit background research and synthesis delegation
form the intended blend; no semantic keyword router chooses between them.

Historical September 7 exploration (the engine choice below is superseded by the September 8 cutover):
Main's retained slow Run records sixteen CodeGraph searches, one
ThinkGraph write and one ThinkGraph read, with no recorded delegated child. That establishes work done,
not the cause of the entire elapsed time. Existing native profile delegation supports explicit
`background: true`; its default is synchronous. Main should retain focused searches for each graph and
delegate substantial research/synthesis without requiring those results before an ordinary reply.
The prior OpenRouter embedding repair from `d97582da` remains in source. September 7 live testing traced
the remaining connection failure to OpenAI 3/httpx2 loading standalone truststore after Databento's
Windows pip-system-certs injection. Pinning Python rails to Graphiti's required OpenAI 2.41.0 restores
the existing httpx transport. Real embedding/search and ingestion now succeed with the same provider,
model, credentials and dimensions; no reindex was performed.

September 7 component acceptance uses useful questions about sourced claims, conflicting evidence,
and graph visualization. ThinkGraph returned actual existing references in Run
`graph-visual-reasoning-20260907-01` (235.967 seconds, including first profile/session setup and a
semantic-search timeout). It launched no orchestrator child. The owner's single-mode comparison
changed only ThinkGraph's delegation selection to `off`; `graph-visual-single-20260907-01` completed
in 23.825 seconds using the same warm session. This is not a controlled orchestrator speed comparison.
Graph Agent's `graph-visual-research-20260907-01` found relevant web/code evidence but only queued
its KnowGraph write; no materialized native records were confirmed. Its saved Sol selection disagreed
with the restored session's actual Luna calls. The adapter repair applies the exact saved parent through
native ACP `session/set_model` before host configuration; native history and profile identity remain.
The separate ThinkGraph/KnowGraph delivery locks now pass a regression test proving slow research
does not block the next pair's reasoning while each stage remains serialized. Graph Agent's subsequent
`graph-visual-retain-20260907-01` used actual Sol and ingested episode
`313e8bb8-17c5-44de-a59f-d270d84a6cf9`; native fact searches return sourced relationships referring to it.
Agent Builder's `graph-visual-synthesis-20260907-01` directly read that episode and ThinkGraph, then
returned a cited proposal. Its unnecessary initial self-handoff read failed honestly; its saved prompt
now directs graph reads to the existing read tools. Main's saved prompt now delegates graph maintenance
to the post-pair workers, keeps compact searches and background research/synthesis, and no longer grants
the superseded ThinkGraph write tools. Other saved models, Scripts, topology and Team configuration remain.

ThinkGraph's `graph-visual-question-20260907-01` created the unresolved visualization question and links,
but the outer MCP 30-second timeout abandoned a still-running semantic write. The model then repeated
the write, creating duplicate links and self-supersession. The bounded semantic operation now receives
its existing native/HTTP allowance through the outer MCP deadline; ordinary read deadlines remain short.
A focused regression failed before this repair and passes after it. Existing affected edges are not
declared repaired: a disposable native forget/recreate experiment revived old links, so that experiment
was not applied to project data.

Connected Run `req_b65d06f4` answered and completed both automatic graph stages. ThinkGraph retained
the assistant's suggestion as an unaccepted proposal; KnowGraph reused the sourced episode instead of
ingesting a duplicate. Main's first response took 56 seconds and completion 73 seconds: not fast enough.
The next Run, `req_27804764`, exposed a real background profile-handoff failure: internal originating
identity was incorrectly supplied as public MCP arguments. Main substituted an ordinary Luna child,
so its claim that Agent Builder was writing was not accepted as proof. The adapter now keeps identity
in authenticated context; Python binds it for background execution. Focused tests reproduce and cover
the failure, forged identity rejection, and existing synchronous behavior. Live retry remains required.

KnowGraph now loads bounded records from its existing native projection endpoint instead of constructing
knowledge nodes from activity UUIDs. Activity decorates matching records; selecting another agent retains
the underlying graph. A real browser exposed two further renderer defects: Strict Mode recreated an empty
renderer while retaining its applied-topology flag, and the DTO's `source: know` was mistaken for an edge
endpoint instead of `from`. Both are repaired with regression coverage. Nine named native records and
eleven relationships were returned; final visual interaction verification follows database recovery.

During connected testing Neo4j reached 620% CPU and Windows had about 500 MB free RAM; queries timed out
while service health endpoints remained responsive. Docker initially could not stop the container. After
it exited, the existing image and native data/log volumes were verified and preserved during recreation.
The health check now uses installed wget to execute HTTP `RETURN 1` and requires an empty error array,
instead of launching Java command-line clients every three seconds. Native database health passed after
recreation. No graph data was deleted or reindexed. Recovered app/connector acceptance remains separate.
One subsequent startup failed the native CBM daemon deadline under severe Windows memory pressure
(121 MB available RAM). Later canonical startup recovered the existing app-owned catalog and watcher;
no direct CBM recovery or index mutation was performed. Native KnowGraph reads and the nine-node,
eleven-edge graph surface have since returned successfully.

The live Main Run `req_112496c0` accepted one asynchronous Builder child,
`external-mcp:7ed33033-e722-4812-aace-2f8f13a78d12`. Main returned before the child finished; native Hermes
delivered the completed result once. Both completed-pair graph workers finished separately. No child
was restarted. Backend focused tests (106), plugin tests including the real native asynchronous registry
(42), and Card-domain tests (95) pass. Main still took 111 seconds to finish its response and received
empty prepared context, so fast/smart acceptance is not complete.

A read-only preview reproduced all three preload sources timing out at about two seconds. Investigation
found roughly one second of unnecessary Windows certificate loading for loopback HTTP and the MCP SDK's
extra result-validation catalog request. Bounded preload now avoids those costs through the public typed
request API; existing non-preload behavior remains. Deadline, partial-result retention and transport
restriction tests pass. A warm loaded preview returned a sourced KnowGraph fact with native provenance;
ThinkGraph, CodeGraph and KnowGraph reads completed in 125, 156 and 562 milliseconds respectively.
Cold initialization can still exceed the two-second budget and correctly yields missing optional context.
Live Main Run `req_e845c33f` streamed first answer text at 39.7 seconds and finished at 42.7 seconds;
its first model call began at 32.2 seconds. Pre-inference startup/selection costs remain unresolved.
That answer incorrectly used irrelevant raw-sentence CodeGraph test matches as supporting evidence.
The automatic raw-sentence CodeGraph preload is therefore removed, including its unused projection branch.
Main's saved focused CodeGraph grants and exact native-reference hydration remain unchanged. Native
retrieval quality must be proven before reintroducing automatic code selection. The combined context,
Card-domain and internal-MCP regression suite passes 117 tests after this correction.

Activity polling now depends on agent IDs instead of the identity of the rendered node array, and unchanged
counts retain their state identity. The regression reproduced ten requests where two were required; all
four activity tests pass after repair. Client typecheck and build pass. The lower Detailed view now requests
the conversation's latest Builder root through existing AGE selection, reads that exact retained Run,
and rejects delayed older results. Two route tests cover scoped and empty selections; three state tests
cover out-of-order completion, terminal-state preservation and unrelated conversations. All 57 backend
route tests and both application typechecks pass. Fifteen frontend tests pass; one unchanged topology
assertion still expects a retired `runtimeOptions.team` template shape absent from unchanged current source.
No Team configuration was restored or changed to satisfy that assertion. Full artifact revision identity
and exact-current-artifact execution remain incomplete. Do not run further
paid acceptance prompts until the remaining latency and context-quality failures are addressed. Defer the long-term automatic
ThinkGraph-to-KnowGraph decision; preserve the current chain and separate web-research path meanwhile.

On September 7 the owner rejected the graph visualization test content and requested its removal.
Graphiti episode `313e8bb8-17c5-44de-a59f-d270d84a6cf9` was removed through the native cascading
episode operation; its dependent entities and facts no longer return. The four active ThinkGraph
test entries were made dormant through Constellation's native forget operation. Both application
projections returned zero nodes and zero relationships afterward. Earlier populated-view results
above are historical rendering evidence, not accepted knowledge quality or current data counts.
The unwanted identity/status/statistics/search panels and decorative backgrounds have been removed
from the graph surfaces. KnowGraph selection now exposes supplied entity summaries and edge claims.
Useful sourced relationship inspection and graph-wide AI summaries still require acceptance with
appropriate data; no replacement records were inserted and no new model run was launched for cleanup.

September 8 Engraphis cutover is PARTIAL. Native 1.7.1, semantic read-only recall, metadata updates,
history-preserving correction mechanics, exact relationship hydration, and the saved tool migration
have focused proof. Four ordinary Main pairs produced four real saved-Luna ThinkGraph records and two
native relationships; paraphrase recall returned the earlier native IDs. One record incorrectly marked
assistant-proposed journal details as a user decision. A claim-attribution prompt repair is saved, but
the follow-up Main Run failed after a 600-second provider timeout, so semantic repair remains unproven.
Current-report research hit a busy Graph Agent profile; Builder synthesis was not accepted. Do not scale
data collection or redesign the graph around these failures. The reusable boundary-testing procedure is
`skills/conversation-graph-acceptance.md`. Research, correction, synthesis, populated UI, and fresh external
GPT-plugin acceptance remain distinct proof obligations. After the canonical reload, all four native
IDs and two relationships remain; exact reads took 10-23ms after a 17.145s first initialization, and the
paraphrase returned the earlier memory first in 336ms. These are read-only persistence measurements,
not fresh agent interpretation or Main-context quality proof. The loaded public catalog publishes twelve
native Engraphis descriptors and no Constellation descriptors; existing conversations may retain old
client descriptors. The automatic KnowGraph second stage is removed, with seventeen delivery-contract
tests and exact saved Main/Graph Agent prompt readback; no new agent turn was run after that correction.

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
ThinkGraph  = Engraphis project reasoning and memory
KnowGraph   = Graphiti/Neo4j sourced knowledge and provenance
CodeGraph   = native CBM repository structure
AgentGraph  = Cards, relationships, Runs, delegation, references, tools, and artifacts in AGE
```

The current ThinkGraph MVP uses the Python-owned Engraphis projection route, the renderer-neutral
`GraphProjectionV1` DTO, one disposable in-memory Graphology `MultiDirectedGraph`, and Sigma v3 WebGL.
Graphology and Sigma are view state only. Attention decorates exact IDs already returned by Engraphis;
it cannot create substitute nodes. Empty native results render an honest empty state. A later 3D mode may
consume the same DTO but is not part of the current renderer.

The foreground graph starts empty and reveals only native objects actually returned, selected,
consumed, traversed, handed off, or written. Inspector detail may show technical receipts. Card faces
may show correlated tool activity, but Card animation is not a substitute for graph attention.

Engraphis is pinned to 1.7.1 and uses the local immutable MiniLM embedding model through one Python-rails
service. The public MCP catalog derives native read/write schemas and IDD publication from that owner;
there are no Constellation aliases. The owner's subsequent recovery direction authorizes removing
obsolete Constellation code and dependency residue now, while product acceptance remains partial. The
old adapter and bridge are removed and cannot act as a fallback. Preserve the
useful `ConstellationSigmaSurface` renderer and durable graph files when that cleanup becomes due.

KnowGraph UI projection selects at most 500 project-scoped nodes and 1,000 in-window relationships and
does not transport embedding arrays. Graphiti remains the only native KnowGraph semantic/search authority.

## Stable prompt and procedure recommendations

These are recommendations for later saved-prompt review, not grant changes or catalog pruning:

- Main should begin with its exact server context, use ThinkGraph/Engraphis for project reasoning,
  and call downstream Cards only through saved topology. Contextualized plugin turns should keep the
  Honcho bypass marker; direct Main should retain native Main-only Honcho fail-open behavior.
- Memory use should stay deliberate: profile history and curated memory, then the profile's native
  external provider when explicitly configured, then a relevant native skill, followed by selected ThinkGraph/KnowGraph/CodeGraph reads. Do
  not inject all authorities or pass credential/receipt tokens between agents.
- Agent Builder should follow `CBM discovery -> complete direct source read -> edit -> focused command/test
  proof -> report`. For Card-building missions it additionally follows `IDD/catalog inspect -> select
  existing object/tool -> preview exact saved change -> save -> native/readback verification`; it does
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

Current owner priority: clean obsolete code, instructions and memory, explain fixed automation and its
data destinations, then establish the graph behavior one boundary at a time. Only completed Main
conversations automatically go to ThinkGraph. Graph Agent receives delegated research and retains
useful sourced findings in KnowGraph. Entity/relationship linking and Main context search/injection
remain separate work; actual-agent acceptance is paused during this cleanup. Do not impose Q&A.
Main stays visible above the pull-up Builder surface: a terminal in Canvas and an output reader
elsewhere. Their configuration Cards open on Prompt with no CLI tab. Mag One receives Main's
user-approved mission and usable connected agents, without an additional product gate.
Product controls should explain themselves through placement and behavior; do not add explanatory panels or filler copy.

Card configuration alignment remains incomplete: IDD must supply the actual editable Card fields, dropdown
options, template composition, and references to live catalogs consumed by both the Card UI and Agent Builder.
The source repair makes `/card-editor/options` and the Builder dictionary read the same IDD field
definitions; focused option tests pass. Team controls and creation/validation still need full alignment.
Complete that work through existing owners; do not
create another dictionary, catalog, runtime validator, or execution owner. IDF continues to combine the saved
Card configuration with real dynamic input and deliberately selected context at execution.

1. Keep cold install, typecheck, build, focused tests, and static startup proof green.
2. Prove Main alone with one bounded, explicitly approved model call.
3. Prove Main → Agent Builder and truthful child lineage.
4. Prove one ordinary Card's headless Auto-Team with its saved native configuration, actual bounded
   workers and synthesis, exact same-session result delivery, and durable rejoin. Do not restore the
   removed task-count clamp or Card-level Team policy overlay.
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

Card runtime bindings are fixed configuration supplied by their construction authority, not
editable kind/mode dropdowns. Mag One remains Mag One. Hermes `delegate_task` roles are separate
settings of the existing agent, never choices that turn it into Main or another runtime.
