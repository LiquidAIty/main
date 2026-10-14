# LiquidAIty current architecture

This document records the owners and contracts present in the current source tree. It is not a
runtime receipt. `PLAN.md` records the current proof boundary and next ordered work, `FUTURE.md`
contains deferred candidates, `DONT.md` records known failure patterns, and `AGENTS.md` is execution
law.

LiquidAIty's abandoned ACP integration and application-owned AgentTerminal/CardRuntime control stack
are deleted. Hermes' upstream ACP implementation remains part of the vendored project, but it is not
LiquidAIty's Card boundary. The current adapter uses HermesLatest's shipped Gateway, profile, session,
prompt, event, and PTY contracts. Source and static proof remain distinct from a loaded product turn.

## One-line law

```text
TypeScript = transport and pixels
Python rails = runtime and deterministic computation
models = semantic reasoning
saved Cards and graph topology = identity and authority
```

## MVP roles and status vocabulary

The MVP is a persistent Project workbench. A new agent Project attaches six core saved Cards by
their current persisted revisions: Main, Builder, ThinkGraph, Magnetic, Team, and KnowGraph. The
server seed adds Main → Builder as orange `flow` authority and Team ↔ Magnetic as blue
`magentic_option` membership. Optional/domain Cards such as WorldView, WorldSignals, Trading, Analyst,
or Quant exist only when deliberately attached to a saved Project; client examples and historical
screenshots are not universal topology authority.

The core roles are:

- **Main:** fast human-facing Project conversation and bounded orchestration. Its current source-default
  Card has no Hermes Web toolset and no ordinary coding tools. Its saved prompt delegates sustained work,
  grounds replies in both Project reasoning and known evidence, and compares two plausible options with a
  recommendation when a material part is questionable; no deterministic router enforces that prose flow.
- **Builder:** construction Card for PromptSpecs, Cards, applications, UI, code, artifacts, and
  executable missions. Hermes owns its terminal and environment.
- **ThinkGraph:** saved Engraphis reasoning Card.
- **KnowGraph:** saved sourced-research Card with Hermes Web and Graphiti read/queued-write tools.
- **Magnetic:** approved saved-Card TaskGraph over an exact blue roster.
- **Team:** separate Hermes Team/Kanban behavior owned by saved `card_team`/profile
  `team`; it is not ordinary delegation and is not KnowGraph behavior.

Every behavioral statement in canonical documentation is classified as **CURRENT**, **APPROVED
DIRECTION**, or **DEFERRED**. A source-defined operation, seed, test, or UI does not prove loaded or
persisted behavior for an existing Project.

## Source-owner map

For PromptSpec repository work, the Primary uses the Codebase Memory CLI as a bounded directional map,
then reads complete current source. Support scouts receive the resulting anchors and use direct source;
they do not independently operate CBM. Product Cards separately use only their saved granted `cbm.*`
operations. See [`skills/codebasedmemory.md`](skills/codebasedmemory.md) for coverage, source fallback,
and inverse deletion/rename mechanics.

| Concern | Current owner | Contract |
| --- | --- | --- |
| Saved Card system | `saved_card_contract.py`, `saved_cards.py`, `card_invocation_authority.py`, `card_invocation_tools.py`, `card_invocation_preparation.py`, `card_run_preparation.py`, `card_run_inputs.py`, `card_run_readback.py`, `card_run_execution.py`, `card_run_settlement.py`, `card_run_selection_context.py`, `card_run_jev.py`, `card_run_auto_tools.py`, `card_run_auto_model.py`, `agentgraph_query.py`, `agentgraph_topology.py`, `agentgraph_run_observations.py`, and `agentgraph_inspection.py` under `apps/python-models/app/python_models/` | Separate literal owners for saved identity/runtime validation, Project/deck/Card revisions, invocation authority, effective tools, graph selection and IDF preparation, Run acceptance/preparation, canonical input retention, readback/projection, execution progress, terminal settlement, bounded Jev context/transport, saved-ceiling AutoTools, same-provider AutoModel, AGE query/topology/observations, and read-only AgentGraph inspection |
| Canonical Run input | `idf.py`, `idf_contract.py`, `idf_graph_records.py`, and `idf_projection.py` under `apps/python-models/app/python_models/`; sole constructor `idf.py::materialize_idf` | Literal contract, bounded graph-record construction, inspection/model projections, and one materializer which writes and rereads one UTF-8 `in.idf` before execution |
| Card Python Script | `apps/python-models/app/python_models/card_script.py`, the existing Card editor transport, and `HermesLatest/agent/{card_turn_tools,card_script_tool}.py` | Saved Card-owned source, structural compilation, live selected-tool validation, one immutable turn contract, and execution through Hermes' existing child Python runner against profile-loaded tools; no TypeScript executor or application callback tool protocol |
| Browser transport | `client/src` | Rendering, input controls, SSE/HTTP consumption, and no semantic routing |
| Application HTTP transport | `apps/backend/src/routes` | Authentication, saved-scope checks, Hermes request/event translation, and Python-rails calls; it does not own Hermes processes or sessions |
| Hermes runtime | `HermesLatest/` | Hermes inference, profiles, sessions, tools, memory, delegation, task/dependency dispatch, Gateway, TUI, desktop, and direct-agent messaging |
| Magnetic TaskGraph | `magnetic_taskgraph_authority.py`, `magnetic_taskgraph_submission.py`, and `magnetic_taskgraph_readback.py` under `apps/python-models/app/python_models/`, with the exact invocation owner in `apps/python-models/app/mag_one_operation.py` | Literal owners for saved profile/worker authority, headless root staging and outer-Run binding, redacted status/final-result observation, and invocation-scoped waiting/progress/terminal outer-Run settlement against Hermes' existing SQLite task/dependency APIs; Card Run reads never reconcile or settle execution |
| Tool contracts and execution | `application_operation_catalog.py`, `main_worldview_operations.py`, `mag_one_operation.py`, `agent_canvas_card_operations.py`, and `backend_operation_transport.py` under `apps/python-models/app/`; `operation_definition.py`, literal contributor modules, `tool_registry.py`, and `tool_catalog.py` under `apps/python-models/app/python_models/` | One ordered application-operation catalog, literal application handler/schema owners, generic loopback transport mechanics, one authored operation shape, exact Python/provider handlers, live lookup, and deterministic model-facing projection |
| Official MCP host | `apps/python-models/app/{mcp_host,mcp_auth,mcp_catalog_runtime,mcp_catalog_projection,mcp_provider_operations,mcp_observability,mcp_request_dispatch,mcp_transport}.py` | One SDK transport/dispatch host with literal owners for authentication, process-wide frozen catalog lifecycle, stateless SDK/provider projection, provider publication/calls, request dispatch, transport, and diagnostics; external clients and Hermes profile MCP connections consume the same canonical definitions |
| CodeGraph | Official Codebase Memory MCP through the application host | Repository structure and source relationships; CBM is the sole graph writer |
| ThinkGraph | Engraphis through `engraphis.py` and the responsibility-specific `engraphis_operations.py`, `thinkgraph_projection.py`, `thinkgraph_completed_pair_extraction.py`, `thinkgraph_completed_pair_preparation.py`, `thinkgraph_completed_pair_settlement.py`, `thinkgraph_relationship_vocabulary.py`, `thinkgraph_relationship_classification.py`, and `thinkgraph_relationship_settlement.py` modules in `apps/python-models/app/python_models/` | Project reasoning, canonical entities, the exact saved-Card structured extraction contract, completed-pair identity/dedup/non-writing preparation, append-only native episodic Think settlement, project relationship vocabulary/promotion, Jev source-pair classification/provenance, accepted-decision graph settlement, structured-extractor incidence, and the sole persistent ThinkGraph store |
| KnowGraph | Controlled `GraphitiLatest/` fork plus `services/knowgraph` and the Python provider adapter | Sourced Entity Knows, citations, exact structural `ABOUT` attachment, native Relationships, Communities, Sagas, provenance, queued ingestion, exact reads, and native single-record removal |
| AgentGraph | AGE/PostgreSQL through `agentgraph_topology.py` and `agentgraph_run_observations.py` | Saved Card relationships/authorization and truthful Run/reference/artifact observations remain separate writers over one AGE authority |

## Authority chain

```text
saved Card revision
  + current dynamic mission
  + deliberately selected provider references and bounded data
  + effective saved grants
  -> Python materializes and rereads one in.idf
  -> saved runtime binding chooses the exact Hermes mode and profile
  -> HermesLatest executes
  -> PostgreSQL stores Run state and artifact metadata
  -> AGE may observe stable identities and truthful Hermes/provider events
```

Callers do not supply replacement Card definitions. A model cannot enlarge its grants, change its
saved runtime, invent graph data, or choose a provider fallback. TypeScript does not reconstruct a
second model payload.

## Saved Cards, IDF, and Runs

A saved Card is the permanent authority for:

- stable identity and revision;
- prompt;
- provider, model, Hermes profile, and desired Hermes subagent model;
- runtime kind and mode;
- enabled state;
- selected skills, Hermes tools/toolsets, MCP tools, and other capability grants;
- saved topology and presentation attachments.

The sending user or Card supplies only the current task, images, and selected provider references.
`materialize_idf` is the only input materializer. It writes and rereads the exact bounded input before
the runtime sees it. The Run artifact catalog retains the path, byte size, and hash. Receipts,
approval state, provider lineage, AGE observations, and runtime status remain outside `in.idf`.

The Project-owned `projectCodeFolder` selects a portable folder name under that Project's managed
Builder storage. Source resolves it beneath the managed Project directory and supplies it as the
saved Builder Card's Hermes session workspace. HermesLatest's standard terminal/file behavior and PTY
remain the owners; LiquidAIty applies no Docker policy. Loaded Builder product proof is not established.

Each independently invoked saved Card owns its own root Run and IDF. Hermes temporary children remain
inside their owning Hermes Card. A Hermes Team is one root boundary: Hermes owns decomposition,
worker prompts, retries, synthesis, and child context, so LiquidAIty does not manufacture per-worker
IDFs from Hermes child IDs.

The Card Python editor/compiler/executor is preserved. The owner's approved purpose for that surface is
a Hooks IDE, but the restored current UI still presents the existing Script/tool-recipe states; this pass
does not claim those states satisfy the later general hook-point contract. The current valid Script path
uses Hermes' existing child Python runner and exact tools already loaded by the profile, with no application
callback executor; blank or invalid source is inert. No synthetic hook result is accepted.

## Application routes

`apps/backend/src/routes/index.ts` mounts each domain once. Browser-facing routes use normal user
authentication. The official Python MCP host's `/api/mcp` Project/profile context, Card-editor
projection, and Hermes' `/api/card-turn` receiving-Card lifecycle use the existing process-secret
boundary and are mounted separately from browser authentication.

| Route family | Current responsibility |
| --- | --- |
| `/api/cards` | `cardOptions.routes.ts`, `cardRunRead.routes.ts`, and `cardScript.routes.ts` own Card editor options, Script validation, and read-only `POST /runs/read` latest/history/status projection; none executes a Card |
| `/api/card-turn` | Process-authenticated preparation/start/finish for a receiving Card turn; it delegates to the existing Python Run/IDF owners and stores no session, queue, scheduler, or second transcript |
| `/api/idd` | `builderIdd.routes.ts` owns Builder/editor-only IDD fields, deterministic live-catalog tool projection, and Script-header projection |
| `/api/mcp` | `mcpInternal.routes.ts` owns only process-authenticated Project/profile context and the configured-model/IDD projection used by Hermes profile MCP tools |
| `/api/thinkgraph` and `/api/knowgraph` | Engraphis and Graphiti projections/operations without merging authority |
| `/api/projects` | Project and deck transport |

CodeGraph is reached through the saved Card's granted CBM operations in the canonical tool catalog;
there is no separate CodeGraph backend route or graph owner.

Route names are transport addresses, not agent identities or separate runtimes. The retired generic
Card-runtime and loopback Hermes Card-tools routes remain absent.

## HermesLatest application boundary

One independently supervised `hermes serve` process starts from the root `dev:hermes` Node package
script. The
backend connects through HermesLatest's shipped JSON-RPC client. It does not launch a per-Card
process, own a session registry, kill Hermes when a client disconnects, supervise retries, or open a
second Bot/terminal execution path.

The restored Main doorway is `apps/backend/src/routes/mainSession.routes.ts`, mounted with browser
authentication at `/api/main/session`. It persists user messages before Python Run preparation and
transports Hermes events and completions. Unaddressed chat uses the saved Main profile and its
exact Project-scoped Hermes session. The adapter materializes every enabled non-Magnetic Hermes Card's
saved profile and one hidden Project-scoped session, then gives each orchestrator only its exact outbound
orange roster and target-session map. An explicit `@Card` still enters Main first and must use Hermes
`message_agent`; the application observes the exact recipient session and suppresses only the redundant
later Main synthesis notification. An unaddressed model-directed consultation keeps Hermes' completion
notification and continues the same still-open Main Run. Main does not execute or impersonate the target.

Every ordinary receiving Card turn without an already-open application Run calls the process-authenticated
Card-turn endpoint before inference. Python accepts one Run, materializes and rereads that receiving Card's
one `in.idf`, and returns the mechanical Hermes message/model/tool/Script projection. Hermes starts and
settles that same Run around the actual turn. Orange child Runs carry only the parent Run ID into AGE
lineage; transcript text and IDF bytes remain with their existing owners. A Project target with no live
exact session fails without falling through to another CLI session. Profile MCP calls add the exact current
Project/profile/Run headers at call time; saved grants remain the ceiling. A valid Card Script uses only
tools already loaded by that profile, while blank or invalid source remains inert.

Main is the sole headless Card. `cardTerminal.routes.ts` and
`mainSession.routes.ts::cardProjectSession` attach every saved
non-Main Hermes Card to its own Hermes CLI. Builder's lower terminal stays bound to `builder`, mounted,
and initially collapsed. Profile materialization reads saved Card authority; TypeScript remains
transport and pixels. Each Project session opts into Hermes `follow_profile_config`; Hermes owns its
capability epoch and live-agent refresh, and LiquidAIty sends no parallel profile fingerprint.
`AgentTerminalManager` and the retired specialist execution paths remain absent.
Source presence does not establish successful product execution; use the current acceptance evidence.

Fresh Card profiles are created with credential mirroring disabled. Current Hermes provider
authentication remains scoped to the Hermes installation/profile mechanisms; LiquidAIty has not yet
proven distinct per-user provider credentials while two users share one reusable Card profile. Do not
claim that multi-user credential-isolation requirement from the profile/session isolation tests alone.

## Ordinary delegation, Team, and Magnetic

These are separate execution contracts:

| Mechanism | Current owner | Current meaning |
| --- | --- | --- |
| Team | Saved `card_team`/profile `team` plus Hermes `kanban.task_mode: team` | One durable Team root, Hermes decomposition into temporary same-profile workers, review, and synthesis in Hermes SQLite Kanban |
| Magnetic | Saved `card_magentic`, exact blue topology, and `magnetic_taskgraph_*` Python owners | One approved mission and exact saved worker ceiling; the same Magnetic root orchestrates dependency rounds and supplies the final result |

The internal Team workflow marker remains `auto-team-v1`; it names the current generic Hermes Team
implementation and does not authorize rejected KnowGraph AutoTeam behavior. Team workers cannot open a
nested Team, leaf, or recursive delegation tree. Magnetic may assign the saved Team Card as one blue
worker. When Team is the only exact blue worker, current source deliberately stages the Hermes Team root
directly; that bounded integration does not collapse the two mechanisms.

## MCP and Codebase Memory

`apps/python-models/app/mcp_host.py` is the one official MCP composition/launch boundary;
`mcp_transport.py` owns its official SDK transports and `mcp_request_dispatch.py` owns authenticated
request dispatch. Together they derive one MCP projection from the canonical definitions, preserve provider-owned tool schemas, and dispatch to the existing Python owners. External
account access uses the configured OAuth resource boundary. Main and every other Card are Hermes profiles:
their exact saved application-tool selection is an include filter on that profile's Hermes-owned `liquidaity`
MCP connection, while saved external MCP references remain separate profile servers. The web user's OAuth
Project grant authorizes data access; the profile whitelist is the agent capability ceiling. Main does not
inject tools into other profiles, and ordinary Card tools do not use the experimental Dynamic Tools
callback. God’s Eye Project layer visibility never gates a Card's saved tools. Retired
`hermes:tool:*` markers are removed on canonical Card read/save; Hermes profile memory is not represented
as an application tool grant or a LiquidAIty toolset selection. IDD is not runtime authority.
Catalog/readback tests and loaded internal-tool execution are proven separately from external-client live
acceptance.

Codebase Memory is an official MCP dependency of the product host. Canonical startup resolves the current official
`codebase-memory-mcp` command from the machine's normal installed PATH; the repository does not retain a
versioned copy or checksum pin. LiquidAIty owns one long-lived application stdio frontend. Codex Desktop may own one separate
frontend through its official direct registration, independent of LiquidAIty and GPT/plugin availability. Both
join the same upstream per-account daemon/cache/runtime identity outside the repository. Docker, Hermes, Cards,
plugins, and connectors do not launch another frontend. The upstream watcher owns ordinary freshness;
indexing/deletion are explicit application-MCP administrative operations.

Product CodeGraph reads use granted `cbm.*` MCP tools and bounded CBM references selected into the canonical
IDF. There is no separate browser CodeGraph route or catalog. Builder and other authorized Cards call
the official CBM provider through the application MCP host; saved Card grants remain the ceiling.

Codex repository development is a separate consumer. During a PromptSpec, only the Primary uses the
installed one-shot CBM CLI, before dispatching read-only scouts. It uses CBM as a directional map of
symbols and relationships, passes exact anchors to the scouts, and verifies every material claim against
current source. Support agents do not open their own CBM connection. CBM does not decide intent,
architecture, completion, or runtime truth.

The canonical project is `C-Projects-LiquidAIty-main` at `C:/Projects/LiquidAIty/main`.

## Graph authorities and provider observations

```text
ThinkGraph = Engraphis project reasoning and operational knowledge
KnowGraph  = Graphiti/Neo4j sourced knowledge and provenance
CodeGraph  = official CBM repository structure
AgentGraph = AGE Card topology and truthful execution observations
```

Each graph has one authority and one writer. Run-scoped Context Selections may carry bounded provider
IDs, data, and provenance together in `in.idf`; that transport is not another graph and does not copy
ownership. The completed-pair Python preparation and settlement rails remain, but this cleanup leaves
them without a TypeScript agent-execution caller and does not claim the automatic lifecycle is current.

Engraphis owns Entity identity, memory/entity incidence, bi-temporal fields, native evidence, graph scene
projection, and its existing force/galaxy vocabulary. One portable ThinkGraph unit is a **Think**: one
Entity-specific native append-only `EPISODIC` Memory whose semantic authority is
`structured_extraction.think`. Its compact `summary` is the card face and its optional unbounded technical
`detail` is the same Think's **More** disclosure. Native code owns entry time and saved-Card/run provenance.
An Entity's Thinks are resolved only through direct `memory_entities` incidence with
`source_kind="structured_extractor"` plus a validated Think payload, newest-first by native Engraphis time.
The Card chooses proposed Entity names, endpoints, direction, and free-form Relationships. Jev
independently chooses the canonical edge winner, full distribution, and relationship strength. The
all-classifications-before-mutation transaction prevents unclassified endpoint persistence; Jev does not
semantically choose or authorize the endpoints themselves. Thinks are excluded from Engraphis semantic
distillation, retention archival, and profile consolidation. The old automatic proxy/replay and regex-first
paths remain removed; there is no candidate system, approval state, shadow graph, second extractor, direct
model edge writer, or whole-graph reclassification loop. This lifecycle does not write KnowGraph.

### Current graph context

Model-facing graph context includes exact provider Data Anchors plus one automatically supplied,
identity-and-Relationship-only canonical Entity map. Python implements `project_graph.list_entities` and
`project_graph.read_entity_context`. Main, Builder, ThinkGraph, and KnowGraph preparation use native
Engraphis recall and native Graphiti Entity search/exact `ABOUT` hydration to produce bounded candidates,
then ask Jev for one non-persisting relevance distribution per authority. Deterministic code selects the
highest-probability record and excludes the Recent record from those candidates. The default packet is:

```text
current user request
+ complete exact Entity/Relationship map
+ one most Relevant Think + one distinct most Recent Think
+ one most Relevant Know + one distinct most Recent Know
```

Thinks are selected for the strongest faithful optimistic steelman of the user's current idea. Every valid
Know already contains its cited supporting idea and cited counter idea. Equal Think/Know counts therefore
make the prepared content intentionally two-thirds supportive and one-third challenging. Missing native
records shrink the packet honestly; Jev never creates graph content, truth, authority, or write permission.
Jev failure leaves relevance unavailable and never relabels recency as relevance.

The exact Entity inspector performs the same native-read/Jev pattern inside that Entity. It defaults to one
Relevant record; one small arrow swaps the same space to the distinct Recent record. `Search` supplies the
current Entity query and transient `Results` may request 1–12 records for the detailed inspector only.
Main/Builder's automatic packet remains at the one-result default. KnowGraph is the landing authority when
an Entity has both Think and Know data; ThinkGraph remains the left tab and KnowGraph the right tab.

One Know is one atomic `know.v1` Graphiti episode:

```text
idea.body + optional idea.detail + one or more idea.citations
+ counterIdea.body + optional counterIdea.detail + one or more counterIdea.citations
= one Know attached to exactly one Entity
```

Python rails projects `graphiti.add_memory_to_entity` as that strict model-facing schema, canonicalizes the
single JSON episode and exact URL list, then invokes Graphiti's unchanged native queued operation. A missing
side or side without a citation fails validation; a one-sided cited episode is not projected as a Know.
Only Entities render as Project graph nodes. Thinks, Knows, Graphiti episodes, citations, native references,
and supporting episode IDs remain attached properties/evidence/provenance. Each visible body is compact and
each side's optional depth remains inside the same record behind **More**.

The combined view uses one fixed presentation. The ordinary color-key labels **Think** and **Know** select
authority-only projections; clicking renderer background returns to combined. Know defaults to native
Graphiti Community grouping and Think defaults to the existing Engraphis Galaxy layout, while the detailed
graph settings inspector retains the native layout choices. Entity radius linearly normalizes the complete
attached Think-and-Know word count from least to most. That transient visual metric never changes Jev edge
probability, gravity mass, retrieval, or stored graph meaning.

KnowGraph may use selected Thinks only as research framing. Sourced Knows remain Graphiti evidence.
Its dedicated queued `add_memory_to_entity` path writes one structural `ABOUT` edge to an exact Entity in
the same native episode transaction, leaves extraction-owned `MENTIONS` independent, updates Graphiti
communities by default, and accepts native Saga continuity. The public generic `add_memory` behavior remains
unchanged. Quick-Web evidence handoff and a requested-time sorting interaction remain unimplemented and must
not be described as current.

### Jev current boundary

CURRENT Jev responsibilities are bounded and optional:

- classify each saved ThinkGraph Card-proposed directed relationship before graph mutation, choosing
  the canonical edge label, distribution, and strength without choosing the endpoints;
- perform read-only graph focus/reranking only when the explicit focus path is invoked;
- narrow an existing authorized Card tool set only when saved AutoTools is enabled; failure preserves
  the baseline set and Jev never widens the saved ceiling;
- choose only among backend-authored compatible model candidates when saved AutoModel is enabled, with
  no provider or model fallback.

Default Engraphis recall may use its local vector, lexical, and graph retrieval arms, but remote
Jev/LLM retrieval-plan selection is not the default: current calls use planning off and
`jev_assisted=false` unless an explicit path opts in. The source-defined KnowGraph Jev classification
route has no proven production caller, and no current source owner makes Jev a final request-fulfillment
judge, scheduler, graph writer, or endpoint authority.

Visual activity may be driven only by real reads, selections, deliveries, traversals, writes, Run
completion, or failure. There is no compatibility attention graph or generic tool-event
normalizer. AGE may store stable Run/reference/artifact identities, but it does not authorize a
runtime, hold raw IDFs, choose a Card, or control Hermes lifecycle.

## UI and Builder

React/TypeScript renders Main Chat, Agent Canvas, graph views, Card/Run inspection, and Builder's lower
terminal. It may validate structured transport and render status. It may not interpret task meaning,
rank or route agents, merge graph semantics, infer knowledge access from prose, or fabricate provider
activity.

Builder is the saved Card with stable ID/profile `builder`; Agent Builder is the workspace that edits
Cards and shows Builder's terminal. Creation, configuration, and invocation remain separate explicit
operations. Builder receives an ordinary mission and uses only its saved grants. There is no hidden
create/edit mode, PLAN loader, semantic TypeScript router, or alternate prompt envelope.

## Persistence and identity

- PostgreSQL stores saved Cards, decks, revisions, Runs, conversations, and artifact metadata.
- AGE/PostgreSQL stores accepted Card relationships and execution observations.
- Hermes profile homes store Hermes configuration, sessions, memory, skills, and Kanban state.
- Engraphis, Graphiti/Neo4j, and CBM retain their own graph data.
- Durable source-operation identities use repository root plus relative path and content hash, never
  a machine-specific absolute path as the permanent identity.

Cleanup must not delete saved Cards, Runs, profiles, graph data, credentials, or shared state without
an exact owner-authorized target. Historical IDs may remain load-bearing compatibility contracts even
when their wording is old.

## Startup and loaded proof

Canonical development startup is `npm run dev:fresh`. It resolves the current official CBM command from PATH,
validates its native MCP server identity, and starts the supported local service graph. No cleanup task
may launch an extra CBM frontend, restart the daemon, or partially replace the supervisor.

Evidence tiers remain separate:

1. source and inverse-residue inspection;
2. focused contract tests;
3. production typecheck/build;
4. loaded service health and source hashes;
5. a real saved Card input and Hermes output through Gateway/TUI;
6. external connector acceptance;
7. Jeremiah's visual acceptance.

A lower tier never proves a higher one.

## Controlled imported and vendored roots

`HermesLatest/`, `EngraphisLatest/`, `agent-products/gods-eye-view/`,
`agent-products/shadowbroker/`, `agent-products/kronos/`, and other imported systems are controlled
upstream forks or first-party runtime source, not general cleanup targets. Prefer a public API,
protocol, configuration, hook, or existing adapter boundary. A justified vendor edit must record its
exact files/symbols, preserved upstream behavior, tests, fork cost, and rollback.

The source-wired WorldView launcher is `scripts/start-worldview.ps1` (package script `dev:worldview`);
the WorldSignals service is started by package script `dev:worldsignals`. These source paths do not
establish loaded-service or product acceptance.

For Hermes, the retained local extensions are recorded in
`HermesLatest/LIQUIDAITY_PATCHES.md`. Direct-agent delivery remains Hermes-owned. LiquidAIty's TypeScript
adapter creates/resumes exact Project-scoped saved-Card sessions and observes Gateway events, but it does
not execute a target Card, deliver Card-to-Card text, or own a queue. Magnetic changes only assignment authority inside one
explicitly bounded creator tree and leaves ordinary tasks unrestricted. Upstream ACP is not a
LiquidAIty execution boundary. No other Hermes customization is accepted by this document.

| Upstream/version | Local file and symbols | Purpose and preserved behavior | Proof, fork cost, rollback/removability |
| --- | --- | --- | --- |
| `NousResearch/hermes-agent` `0.21.5`, tag `v2026.9.24`, source commit `f97608f178d1ffeca59860195ab7da295f7c8e5f` | The bounded families inventoried by file and symbol in `HermesLatest/LIQUIDAITY_PATCHES.md` | Retained Hermes extensions are governed only by that register and current source. Hermes keeps profile creation, execution, sessions, Bot delivery, learning, queue, task ledger, PTY, MCP transport, and child Python execution. Local hunks add Project roster/session inputs, receiving-Card Run context, exact process/Run correlation, profile-MCP request headers, Card Script presentation, and the existing Team/Magnetic authority constraints without another runtime. | The overlay register records focused tests, mechanical compatibility decisions, exclusions, apply-check procedure, update cost, and rollback. Application residue checks prohibit the old target opener, process/session owners, per-turn application tool callback, IDD tool authority, Builder Docker policy, custom PTY/voice work, and alternate Codex App Server paths. |

The existing Hermes app-server adapter also preserves provider vision input:
`HermesLatest/tui_gateway/prompt_turn.py::_route_turn_images` respects the saved
image/text policy, and
`HermesLatest/agent/transports/codex_app_server_session.py::_coerce_turn_input_items,run_turn`
projects attached pixels into the documented typed App Server input union. Text
projection remains only for input-echo attribution. The pinned upstream base is
the Hermes version above; the existing public `turn/start` protocol is the
extension boundary. Focused Gateway-routing and app-server-session tests cover
image-byte preservation and unchanged explicit text routing. Fork cost is one
bounded protocol projection and removal of one forced-text branch; rollback
restores those two hunks together without changing saved Cards or histories.
The complete current overlay contract is recorded in `HermesLatest/LIQUIDAITY_PATCHES.md`.

The controlled upstream globe import has this bounded local divergence:

| Upstream/version | Local file and symbols | Purpose and preserved behavior | Proof, fork cost, rollback |
| --- | --- | --- | --- |
| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `agent-products/gods-eye-view/src/app/{application,viewer,viewport,directApplication,mount,directBridge}.js`; `src/runtimeUrl.js`; `src/voice/{gevRealtime,realtimeProtocol,realtimeViewport}.js`; `src/data/contextStore.js`; `client/src/components/worldsignal/GodsEyeSurface.tsx`; `client/src/features/worldview/WorldViewSurface.tsx`; `client/vite.config.ts` | **UPSTREAM CURRENT:** retain the modular application lifecycle, Cesium viewer, complete visual/control surface, live data managers, scene context, selected-entity context, Realtime action runner, and image grounding. **LOCAL KEPT:** retain the supervised camera-stability rules, WorldView presentation wording, Project source readback, selection projection, and credits. **MERGED:** both standalone and LiquidAIty use the same lifecycle and full controller graph. **LIQUIDAITY-SPECIFIC:** React supplies one caller-owned pane, scoped CSS/container sizing, same-origin provider transport, direct callbacks, and serialized teardown/remount. The removed iframe/postMessage bridge is not a fallback. Realtime image grounding accepts only the Cesium canvas contained by the currently mounted WorldView root, records root/canvas/image bounds, and invalidates retained images on stop or unmount. Under the shared hybrid Main layout, capture intersects that stable canvas with the actual exposed companion viewport and crops the source pixels to those visible bounds; it never captures the covered portion or the LiquidAIty page. | Focused vendor tests cover URL scoping, annotations, context reset, Realtime protocol, pane-bounded and exposed-pane-cropped capture, retained-image deletion, and teardown invalidation; focused React tests cover one mount, direct commands, callbacks, and cleanup; vendor/client production builds cover both bundles. A visible Trading Project Preview proved one iframe-free 795×720 mount/canvas inside a 1280×720 page, current satellite/mission feeds, a completed camera reset, a real Launch Library selection with source metadata, and complete removal followed by one clean remount with idle voice and no selected mission. Live AI question/answer acceptance remains blocked honestly because the supervised provider has no configured `OPENAI_API_KEY`; the port is not declared parity-complete until those turns and the resulting viewport-capture diagnostics run. Fork cost is the bounded lifecycle/root/capture seam plus focused tests. Roll back this row's files together; no graph, Project, Card, user, or source data is migrated. |
| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `agent-products/gods-eye-view/src/app/directBridge.js::setLayerVisibility,executeAction`; `src/data/manager.js::isExplicitLayerIntentOrigin`; `src/voice/gevActions.js::set_layer_visibility` | Carry an internal `restore` origin through the existing God’s Eye layer manager and a distinct `worldview_card` origin through its existing action runner. This preserves the one God’s Eye Data Layers control, source lifecycle, provider readback, and standalone voice behavior; it does not create a second layer switch or runtime. | Focused `directBridge.test.mjs` and `gevActions.test.mjs` pass. Fork cost is three origin handoffs at existing interfaces. Roll back these hunks with the Project-origin integration if that seam is retired; no saved source or scene data is rewritten. |
| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `agent-products/gods-eye-view/src/app/mount.js::attachInspectorControls,selectInspectorTab`; `src/ui.js::StyleManager` panel-layout guards; `client/src/features/worldview/{WorldViewSurface.tsx,worldviewInspector.css}` | In the supervised presentation only, move the original God’s Eye control elements (not copies or replacement switches) into tabs inside LiquidAIty's existing right-edge Inspector. The vendor's standalone layout, control handlers, layer manager, presets, cameras, scenes, context, cockpit behavior, and globe remain owned by their existing code. The mounted control bridge is needed because the existing action API cannot relocate already-bound DOM controls without cloning them. Teardown restores each element to its original anchor before the viewer is destroyed. | Focused React bridge/Inspector tests and vendor panel/Cockpit/Context tests pass; client typecheck and production build pass. Loaded visual/control acceptance remains for owner inspection in Preview. Fork cost is one reversible mount-time DOM placement seam and two panel-layout guards. Roll back those hunks with the Inspector adapter; no Project, Card, graph, source, or scene data is migrated. |

| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `agent-products/gods-eye-view/src/data/satellites.js::setParams,setLabelFocus,getLabelFocus,_syncFocusOverlay,getDetectableObjects`; `src/data/detection.js::_drawOverlay`; `src/data/layerState.js` satellite option; `src/ui.js` Labels control; `src/voice/gevActions.js::focus_satellites`; `src/app/directBridge.js` satellite params/action projection | Focus-only satellite names by default, with explicit All restored through the existing layer-state coordinator. A transient exact-NORAD set of at most 50 renderable objects uses the existing overlay host and action runner; replacement/clear removes only its names, and tracked/selected readouts retain ownership. The public layer-param and action interfaces are the integration seams; ambient label gating and ISS suppression require this small native fork change. Satellite points/brackets, catalogs, TLE/SGP4 positions, orbit paths, native selection/tracking, Space Missions, providers, Earth and camera behavior are preserved. Backend/Python transport retains saved Card/Run authentication and the Project source OFF guard; there is no new renderer, agent or research store. | Focused native label lifecycle, saved-mode roundtrip, DENSE/detection, action/bridge and backend/Python contract tests cover immediate suppression, replacement/clear, disabled-source refusal and atomic invalid-focus preservation. Client/vendor builds and loaded control/action proof are separate from owner visual acceptance. Fork cost is one additive enum, one bounded transient label source and gates at existing label/action seams. Roll back only these label-policy hunks and their transport/schema counterparts together; no saved data migration or reset is required. |

| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `agent-products/gods-eye-view/src/data/satellites.js::_handleSatelliteClick,_installClickHandler`; `src/data/satellitesClickSelection.test.mjs` | When the current tracked marker is the top Cesium pick, use native `drillPick` to inspect the first distinct hit instead of ignoring a different satellite underneath it. Ordinary frontmost picking, sibling-layer ownership, current-only no-op, empty-click clear, tracking, labels, catalogs, orbital propagation and rendering stay on their existing paths. No public adapter can resolve this native click-handler early return. | The production callback regression covers ordinary and occluded A-to-B switching plus current-only, sibling and empty-click behavior. A mounted WorldView second click changed tracking from NORAD 45358 to 28474 and showed the new native readout. Fork cost is one conditional deeper pick and a test seam; remove these hunks when upstream supplies equivalent click resolution. No saved data or runtime configuration is migrated. |
| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `agent-products/gods-eye-view/src/data/traffic.js::disable,destroy`; `src/data/trafficTiming.test.mjs` | Make traffic teardown idempotent when serialized React/native remount cleanup reaches an already-removed point collection. The existing application lifecycle and DataLayerManager remain the owners; the guard creates no second teardown path, viewer, layer state, or fallback. | A loaded WorldView remount reproduced the null point-collection write through the real DataLayerManager teardown. The focused native test destroys traffic twice after initialization and requires no error while retaining the traffic timing invariants. Fork cost is one null guard plus the regression assertion. Roll back both together when upstream teardown becomes idempotent; no saved Project, camera, layer, graph, or source state is migrated. |

The vendored Graphiti fork has this bounded additive divergence:

| Upstream/version | Local file and symbols | Purpose and preserved behavior | Proof, fork cost, rollback |
| --- | --- | --- | --- |
| `getzep/graphiti` core `0.30.2` / MCP `1.1.0` at `86f1c941bea7bf53fa45fe4e08c03244b4990eee` | `GraphitiLatest/graphiti_core/{edges.py,graphiti.py}`; `graphiti_core/models/edges/edge_db_queries.py`; `driver/kuzu_driver.py`; `utils/{bulk_utils.py,maintenance/node_operations.py}`; `mcp_server/src/{graphiti_mcp_server.py,models/response_types.py,services/queue_service.py}`; exact attachment tests; `apps/python-models/requirements.txt` | Add one structural `ABOUT` edge and one queued `add_memory_to_entity` tool for a caller-declared exact Entity UUID/name. A missing exact Entity may be created in the same native episode transaction; semantic extraction cannot deduplicate it onto a different Entity. `ABOUT` never substitutes for extraction-owned `MENTIONS`. The dedicated tool preserves native episode extraction, facts, provenance, temporal fields, community refresh (on by default), Saga continuity, queue ordering, and native episode removal. Existing `add_memory`, `add_triplet`, search, community, Saga, and deletion behavior remains available and unchanged. LiquidAIty imports the controlled fork directly instead of maintaining a Graphiti replacement. | Core exact-attachment/atomicity tests and MCP queue/signature/parity tests cover the additive path and ordinary no-attachment behavior. Fork cost is one edge type, optional exact-attachment arguments, and one additive MCP tool suitable for an upstream PR. Rollback removes those additions and returns the Python requirement to upstream Graphiti; existing Entity, episode, fact, Community, and Saga data require no rewrite, while records that rely on `ABOUT` would lose only that new attachment view. |

The installed Engraphis runtime and the separately retained browser-renderer fork have these bounded local divergences:

| Upstream/version | Local file and symbols | Purpose and preserved behavior | Proof, fork cost, rollback |
| --- | --- | --- | --- |
| `Coding-Dev-Tools/engraphis` `1.7.9` from upstream `main` at `619f49860f293ab1826aaf4e11a158bc22f03fcf` | `EngraphisLatest/pyproject.toml`, `requirements.txt`; `engraphis/mcp_server.py::{classic_mcp,smart_mcp,_safe_run_stdio_async}`; `engraphis/{mcp_http_cli,dashboard_app}.py`; `integrations/prime_agent/src/engraphis_prime_agent/mcp_client.py`; corresponding MCP/HTTP/package/Prime tests | Port Engraphis's MCP binding and bundled client from SDK v1 `FastMCP`/`ClientSession` to official SDK v2 `MCPServer`/`Client(mode="auto")`. Preserve all 40 Classic handlers, the Smart 10 handlers, memory/Think semantics, schemas, storage, consent, authentication, stdio wire isolation, and HTTP DNS-rebinding protection. LiquidAIty publishes the Smart surface; advanced Classic actions remain reachable through Engraphis's own discover/execute gateway. | Upstream MCP, HTTP, consent, dispatch, packaging, contract, annotation, and Prime client tests pass; direct disposable modern (`2026-07-28`) and legacy (`2025-11-25`) clients list the same Smart 10 and complete remember/recall/get/update/discovery/read/conflict/session flows. Fork cost is one mechanical SDK-major port. Remove this row and return `apps/python-models/requirements.txt` to upstream Engraphis when upstream ships the equivalent v2 port; no memory database or saved Card migration is required. |
| Same Engraphis baseline | `EngraphisLatest/engraphis/mcp_server.py::resolve_capability`; `apps/python-models/app/python_models/engraphis_operations.py::_invoke_tool` | Promote the existing capability-ID/schema-digest resolver to a public function so the authenticated Project adapter can inspect the exact discovered Smart action schema and inject `workspace` only when that action declares it. The resolver body, TTL/HMAC validation, availability gate, LRU refresh, action selection and execution remain unchanged. | Required proof is the focused Engraphis Smart discovery/execute suite plus the application operation/catalog contract. Fork cost is one identifier/API promotion suitable for an upstream PR. Remove the application dependency when upstream exposes an equivalent public capability-inspection API; never copy or reimplement its capability index. |
| Same Engraphis baseline | `EngraphisLatest/engraphis/mcp_server.py::smart_tool_catalog`; `EngraphisLatest/engraphis/backends/extractor.py::StructuredLLMExtractor.extraction_contract`; `apps/python-models/app/python_models/engraphis_operations.py`; `apps/python-models/app/python_models/thinkgraph_completed_pair_extraction.py` | Expose two read-only integration contracts that Engraphis already owns: the exact registered Smart MCP Tool models for synchronous host composition, and the exact structured-extraction prompt/schema for a saved Card that performs the model call. The application no longer reads MCPServer's private `_tool_manager` or extractor-private prompt/schema helpers, and it does not copy either contract. | Focused Smart MCP and extractor tests require each public result to equal the actually served/generated contract; application ThinkGraph and operation tests cover the consumers. Fork cost is two additive public methods suitable for upstream submission. Retire either method when upstream exposes an equivalent supported API. |
| Same Engraphis baseline | `EngraphisLatest/engraphis/core/engine.py::remember_entities`; `engraphis/service.py::remember_entities`; `engraphis/mcp_server.py::engraphis_remember_entities`; generated MCP contracts, bundled integrations, docs, and tests | Add one exact Entity-memory batch operation. Each Fact has exactly one caller-declared Entity incidence; an existing explicit ID/name mismatch fails, new exact Entities and their memories/incidences settle atomically, and automatic text-derived incidence is disabled for this path. Existing generic remember, extraction, graph, and Smart discovery behavior is unchanged. | Engine rollback and incidence tests, Smart/classic inventory and dispatch tests, generated-contract checks, bundled integration tests, and application settlement tests cover the path. Fork cost is one additive service/Smart/Classic operation suitable for an upstream PR. Rollback removes that operation and returns ThinkGraph to no exact Entity attachment; existing Engraphis data needs no migration. |
| Browser renderer fork originally copied from Engraphis 1.7.1 `dashboard_assets/engraphis-graph.js` | `client/src/vendor/engraphis/engraphis-graph.js`: existing semantic physics/material/click helpers plus `explicitVisualSizeWeight`, `linearVisualNodeRadius`, and their render call site | Preserve Jev relationship width/spring/distance and gravity/centrality while accepting one optional transient normalized size weight. Entity radius then scales linearly from least to most attached Think-and-Know words without rewriting `gravity_mass`, relationship probability, storage, or retrieval. Existing styles—including the work-in-progress Solarpunk material—presets, palettes, graph scene, inspectors, Galaxy Focus physics, controls, and layout engine remain unchanged. | `ThinkGraphSemanticPhysics.spec.ts` exercises real renderer relationship physics and exact linear sizing; focused projection/surface tests prove all-history word aggregation, combined sums, isolated views, and Relevant/Recent inspector swapping. Fork cost is two pure radius helpers plus one render branch. Rollback removes the optional field handling and restores native degree/mass sizing without changing graph data. |

## Current proof limits

- Source, focused tests, typechecks, a loaded service, a real saved-Card turn, an external MCP call,
  and owner visual acceptance remain separate proof tiers.
- The MCP v2, Engraphis Smart surface, Graphiti, Card-grant, Project-session, and receiving-Card
  changes require one coordinated loaded-stack acceptance. The 2026-10-14 source checkpoint passed the
  application Python suite, repository TypeScript suite, all TypeScript checks, both production builds,
  and the affected Hermes tests apart from three enumerated Windows/POSIX-only upstream assertions.
  This recovery has not yet started that loaded stack; source, build, and generated-contract checks are
  not loaded-product or external-client acceptance.
- Team and Magnetic preparation must resolve through HermesLatest. Team execution and an actual Mag One
  mission remain separate user-authorized acceptance; this repair does not launch a Magnetic mission.
- Actual child provider/model, Bot delivery, graph attention, external-provider calls, terminal attachment,
  and exact Run/Stop correlation require their own observed receipts. Saved or projected configuration is
  not execution proof.
- Voice is outside the current acceptance pass and remains standard Hermes behavior. WorldView, trading,
  and broader graph semantics retain their existing independent acceptance boundaries.
