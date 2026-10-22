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
| Saved Card system | `saved_card_contract.py`, `saved_cards.py`, `card_invocation_authority.py`, `card_invocation_tools.py`, `card_invocation_preparation.py`, `card_run_preparation.py`, `card_run_inputs.py`, `card_run_readback.py`, `card_run_graph_references.py`, `card_run_execution.py`, `card_run_settlement.py`, `card_run_selection_context.py`, `card_run_jev.py`, `card_run_auto_tools.py`, `card_run_auto_model.py`, `agentgraph_query.py`, `agentgraph_topology.py`, `agentgraph_run_observations.py`, and `agentgraph_inspection.py` under `apps/python-models/app/python_models/` | Separate literal owners for saved identity/runtime validation, Project/deck/Card revisions, invocation authority, effective tools, graph selection and IDF preparation, Run acceptance/preparation, canonical input retention, exact provider-reference evidence, readback/projection, execution progress, terminal settlement, bounded Jev context/transport, saved-ceiling AutoTools, same-provider AutoModel, AGE query/topology/observations, and read-only AgentGraph inspection |
| Canonical Run input | `idf.py`, `idf_contract.py`, `idf_graph_records.py`, and `idf_projection.py` under `apps/python-models/app/python_models/`; sole constructor `idf.py::materialize_idf` | Literal contract, bounded graph-record construction, inspection/model projections, and one materializer which writes and rereads one UTF-8 `in.idf` before execution |
| Card Python Script | `apps/python-models/app/python_models/card_script.py`, the existing Card editor transport, and `HermesLatest/agent/{card_turn_tools,card_script_tool}.py` | Saved Card-owned source, structural compilation, live selected-tool validation, one immutable turn contract, and execution through Hermes' existing child Python runner against profile-loaded tools; no TypeScript executor or application callback tool protocol |
| Browser transport | `client/src` | Rendering, input controls, SSE/HTTP consumption, unified Think/Know/Code visual-layer controls, and no semantic routing |
| Application HTTP transport | `apps/backend/src/routes` | Authentication, saved-scope checks, Hermes request/event translation, and Python-rails calls; it does not own Hermes processes or sessions |
| Hermes runtime | `HermesLatest/` | Hermes inference, profiles, sessions, tools, memory, delegation, task/dependency dispatch, Gateway, TUI, desktop, and direct-agent messaging |
| Magnetic TaskGraph | `magnetic_taskgraph_authority.py`, `magnetic_taskgraph_submission.py`, and `magnetic_taskgraph_readback.py` under `apps/python-models/app/python_models/`, with the exact invocation owner in `apps/python-models/app/mag_one_operation.py` | Literal owners for saved profile/worker authority, headless root staging and outer-Run binding, redacted status/final-result observation, and invocation-scoped waiting/progress/terminal outer-Run settlement against Hermes' existing SQLite task/dependency APIs; Card Run reads never reconcile or settle execution |
| Tool contracts and execution | `application_operation_catalog.py`, `main_worldview_operations.py`, `mag_one_operation.py`, `agent_canvas_card_operations.py`, and `backend_operation_transport.py` under `apps/python-models/app/`; `operation_definition.py`, literal contributor modules, `tool_registry.py`, and `tool_catalog.py` under `apps/python-models/app/python_models/` | One ordered application-operation catalog, literal application handler/schema owners, generic loopback transport mechanics, one authored operation shape, exact Python/provider handlers, live lookup, and deterministic model-facing projection |
| Official MCP host | `apps/python-models/app/{mcp_host,mcp_auth,mcp_catalog_runtime,mcp_catalog_projection,mcp_provider_operations,mcp_observability,mcp_request_dispatch,mcp_transport}.py` | One SDK transport/dispatch host with literal owners for authentication, process-wide frozen catalog lifecycle, stateless SDK/provider projection, provider publication/calls, request dispatch, transport, and diagnostics; external clients and Hermes profile MCP connections consume the same canonical definitions |
| CodeGraph | Official Codebase Memory MCP through the application host | Repository structure and source relationships; CBM is the sole graph writer |
| ThinkGraph | Engraphis through `engraphis.py` and the responsibility-specific `engraphis_operations.py`, `thinkgraph_projection.py`, `thinkgraph_completed_pair_extraction.py`, `thinkgraph_completed_pair_preparation.py`, `thinkgraph_completed_pair_settlement.py`, `thinkgraph_relationship_vocabulary.py`, `thinkgraph_relationship_classification.py`, and `thinkgraph_relationship_settlement.py` modules in `apps/python-models/app/python_models/` | Project reasoning, canonical entities, the exact saved-Card structured extraction contract, completed-pair identity/dedup/non-writing preparation, append-only Engraphis episodic Think settlement, project relationship vocabulary/promotion, Jev source-pair classification/provenance, accepted-decision graph settlement, structured-extractor incidence, and the sole persistent ThinkGraph store |
| KnowGraph | Controlled `GraphitiLatest/` fork plus `services/knowgraph` and the Python provider adapter | Sourced Entity Knows, citations, exact structural `ABOUT` attachment, Graphiti Relationships, Communities, Sagas, provenance, queued ingestion, exact reads, and exact episode removal |
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
remain the owners; LiquidAIty applies no Docker policy. The 2026-10-14 loaded pass proved the existing
Builder terminal identity and one harmless no-tool response; newer source still requires reload.

Each independently invoked saved Card owns its own root Run and IDF. Hermes temporary children remain
inside their owning Hermes Card. A Hermes Team is one root boundary: Hermes owns decomposition,
worker prompts, retries, synthesis, and child context, so LiquidAIty does not manufacture per-worker
IDFs from Hermes child IDs.

The Card Python editor/compiler/executor is preserved. Current behavior is one saved Script in
`tool_recipe` mode, not generalized Hooks. The valid enabled Script path uses Hermes' existing child Python
runner and exact tools already loaded by the profile, with no application callback executor; blank, invalid,
or disabled source is inert. General hook points remain future work. No synthetic Script result is accepted.

## Application routes

`apps/backend/src/routes/index.ts` mounts each domain once. Browser-facing routes use normal user
authentication. The official Python MCP host's `/api/mcp` Project/profile context, exact active saved-Card
profile/Run context, Card-editor projection, and Hermes' `/api/card-turn` receiving-Card lifecycle use the existing process-secret
boundary and are mounted separately from browser authentication.

| Route family | Current responsibility |
| --- | --- |
| `/api/cards` | `cardOptions.routes.ts`, `cardRunRead.routes.ts`, and `cardScript.routes.ts` own Card editor options, Script validation, and read-only `POST /runs/read` latest/history/status projection; none executes a Card |
| `/api/card-turn` | Process-authenticated preparation/start/finish for a receiving Card turn; it delegates to the existing Python Run/IDF owners and stores no session, queue, scheduler, or second transcript |
| `/api/idd` | `builderIdd.routes.ts` owns Builder/editor-only IDD fields, deterministic live-catalog tool projection, and Script-header projection |
| `/api/mcp` | `mcpInternal.routes.ts` owns process-authenticated Project/profile context, exact active saved-Card profile/Run grant readback, and the configured-model/IDD projection used by Hermes profile MCP tools |
| `/api/thinkgraph` and `/api/knowgraph` | Engraphis and Graphiti projections/operations without merging authority |
| `/api/codegraph/read` | One fixed-purpose authenticated request for Repository-scoped CodeGraph projection/file/source reads; the server injects `deck_builder`/`builder`, Python reloads that persisted Card revision, and the official MCP host enforces its live read-only CBM grants |
| `/api/projects` | Project and deck transport |

CodeGraph remains reached through the saved Card's granted CBM operations in the canonical tool catalog.
The browser's one fixed-purpose read route does not expose a generic MCP caller, provider operation,
raw Cypher, alternate catalog, cache, or graph owner; it enters the same short-lived materializer-read
principal for the persisted Builder Card and returns honest unavailable/partial outcomes.

Route names are transport addresses, not agent identities or separate runtimes. The retired generic
Card-runtime and loopback Hermes Card-tools routes remain absent.

## Current co-located loopback launch

The launch target is one supervised local process graph. Internal services do not bind publicly:

| Surface | Loopback owner |
| --- | --- |
| Client development / preview | `127.0.0.1:5173` / `127.0.0.1:4173` |
| Backend HTTP and Card-terminal upgrade | `127.0.0.1:4000` |
| Python rails | `127.0.0.1:8003` |
| KnowGraph | `127.0.0.1:8001` |
| Application MCP host | `127.0.0.1:8765` |
| Hermes Gateway, sessions and PTY | `127.0.0.1:9119` |
| WorldView provider | `127.0.0.1:4174` |
| WorldSignals backend / frontend | `127.0.0.1:8000` / `127.0.0.1:3000` by default |

The browser reaches the backend and companion applications only through same-origin client proxies.
The backend and supervised Hermes/Python processes hold the internal process secret; the browser does not.
Card terminals use the authenticated backend WebSocket upgrade; the browser never receives a reusable Hermes
token or direct PTY URL. Each saved Card profile's reserved `liquidaity` MCP connection stays on loopback and
uses a short-lived signed bearer plus the current Project, deck, profile, and Run identity. The backend rereads
the exact active saved Card and Run and validates the server-issued conversation identity against its AgentGraph
Run observation before the MCP host projects or dispatches that Card's grants. The optional
ngrok MCP publication is a separate OAuth-protected external resource and exposes
only the MCP host, never the internal backend routes. A separated private-service deployment remains future
work and requires a separately approved authenticated TLS topology.

## HermesLatest application boundary

One independently supervised `hermes serve` process starts from the root `dev:hermes` Node package
script. The
backend connects through HermesLatest's shipped JSON-RPC client. It does not launch a per-Card
process, own a session registry, kill Hermes when a client disconnects, supervise retries, or open a
second Bot/terminal execution path.

The restored Main doorway is `apps/backend/src/routes/mainSession.routes.ts`, mounted with browser
authentication at `/api/main/session`. It persists user messages before Python Run preparation and
transports Hermes events and completions. Unaddressed chat uses the saved Main profile and its
exact Project-scoped Hermes session. The adapter materializes only Main's reachable orange closure, or Main
plus the resolved recipient and that recipient's reachable orange closure for an explicit direct turn. Each
orchestrator receives only its exact outbound orange roster and target-session map. An explicit `@Card` still enters Main first and must use Hermes
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
| KnowGraph research | Saved `card_knowgraph`/profile `knowgraph`, its exact orange caller, and Hermes `kanban.task_mode: team` | One saved-Card Run bound to an AutoTeam root; read-only Web candidate workers feed one root-owned verified Graphiti synthesis |
| Magnetic | Saved `card_magentic`, exact blue topology, and `magnetic_taskgraph_*` Python owners | One approved mission and exact saved worker ceiling; the same Magnetic root orchestrates dependency rounds and supplies the final result |

The internal Team workflow marker remains `auto-team-v1`; it names the one existing generic Hermes
decomposition/review/synthesis implementation. Both the Team Card and KnowGraph can use that capability
through their own saved profiles without routing KnowGraph through the Team Card. Candidate workers cannot
open a nested Team, leaf, or recursive delegation tree. KnowGraph decomposition and candidate steps omit
profile MCP connections; only its synthesis root receives the exact target Card Run context and saved grant
ceiling. Magnetic may assign the saved Team Card as one blue worker. When Team is the only exact blue worker,
current source deliberately stages that Team root directly; the KnowGraph research binding does not alter
Magnetic's topology or collapse these saved-Card authorities.

## MCP and Codebase Memory

`apps/python-models/app/mcp_host.py` is the one official MCP composition/launch boundary;
`mcp_transport.py` owns its official SDK transports and `mcp_request_dispatch.py` owns authenticated
request dispatch. Together they derive one MCP projection from the canonical definitions, preserve provider-owned tool schemas, and dispatch to the existing Python owners. External
account access uses the configured OAuth resource boundary. Main and every other Card are Hermes profiles.
Their exact saved application-tool selection is an include filter on the profile's internal loopback
`liquidaity` MCP connection; it does not use the public GPT/plugin URL or require an external OAuth token.
Hermes signs the current Card turn, and the MCP host accepts a call only after backend readback confirms the
exact Project, deck, profile, active Run, and current saved grants. A Card's separately saved Hermes Tools
selection controls its ordinary Hermes toolsets: Builder currently retains web, browser, terminal, file,
code-execution, and vision, while an empty ordinary-tool selection never removes that Card's `liquidaity`
toolset. Saved external MCP references remain separate profile servers. External web-user OAuth Project grants
authorize only external account access; the saved Card whitelist remains the agent capability ceiling. Main does not
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

Product CodeGraph reads use granted `cbm.*` MCP tools. Builder and other authorized Cards call the
official CBM provider through the application MCP host; saved Card grants remain the ceiling. The
Agent Builder Graphs workspace may request only the application-owned `projection`, `file`, or `source`
purpose through `/api/codegraph/read`. Backend authentication canonicalizes the Project and injects
`deck_builder`/`builder`; Python rereads that saved Card and the MCP host remains the final live schema,
access, and grant authority. The route cannot accept browser-authored tools, queries, provider identity,
MCP location, Card identity, or deck identity.

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
ownership. A completed ordinary Main Run preserves its ordered conversation-message references as Run
evidence, executes the exact authorized saved ThinkGraph Card through the repo-owned Hermes adapter, and
submits that structured output to the existing Python preparation and settlement owners exactly once.

Engraphis owns Entity identity, memory/entity incidence, bi-temporal fields, provider evidence, graph scene
projection, and its existing force/galaxy vocabulary. One portable ThinkGraph unit is a **Think**: one
Entity-specific append-only Engraphis `EPISODIC` Memory whose semantic authority is
`structured_extraction.think`. Its compact `summary` is the card face and its optional unbounded technical
`detail` is the same Think's **More** disclosure. Engraphis owns entry time and saved-Card/run provenance.
An Entity's Thinks are resolved only through direct `memory_entities` incidence with
`source_kind="structured_extractor"` plus a validated Think payload, newest-first by Engraphis time.
The Card chooses proposed Entity names, endpoints, direction, and free-form Relationships. Jev
independently chooses the canonical edge winner, full distribution, and relationship strength. The
all-classifications-before-mutation transaction prevents unclassified endpoint persistence; Jev does not
semantically choose or authorize the endpoints themselves. Thinks are excluded from Engraphis semantic
distillation, retention archival, and profile consolidation. The old automatic proxy/replay and regex-first
paths remain removed; there is no candidate system, approval state, shadow graph, second extractor, direct
model edge writer, or whole-graph reclassification loop. This lifecycle does not write KnowGraph.

### Current graph context

Model-facing graph context includes exact provider Data Anchors plus one automatically supplied,
identity-and-Relationship-only canonical Entity map for Main, Builder, ThinkGraph, and KnowGraph. Python
implements `project_graph.list_entities` and `project_graph.read_entity_context`. Main additionally receives
ThinkGraph-only current-request grounding; Builder retains the wider ThinkGraph-and-KnowGraph construction
packet. Those grounding paths use provider retrieval followed by one non-persisting Jev relevance distribution,
select the highest-probability record, and exclude the Recent record from those candidates. Automatic
ThinkGraph completed-pair extraction and KnowGraph research receive no prior Think/Know bodies: each uses the
Entity/Relationship shape and deliberately reads deeper only for its actual task. Main's default packet is:

```text
current user request
+ complete exact Entity/Relationship map
+ one most Relevant Think + one distinct most Recent Think
```

Thinks are selected for the strongest faithful optimistic steelman of the user's current idea. Each current
Know is one verified sourced observation with a separate bounded interpretation and may support, challenge,
or contextualize an explicit proposition. Balance is a property of research coverage and synthesis, not a
fixed ratio implied by equal record counts. Missing provider records shrink the packet honestly; Jev never
creates graph content, truth, authority, or write permission. Jev failure leaves relevance unavailable and
never relabels recency as relevance.

The exact Entity inspector does not perform that relevance-read flow. It shows at most two current
provider-projected attached Thinks or Knows, with KnowGraph as the landing authority when an Entity has both;
ThinkGraph remains the left tab and KnowGraph the right tab. Search/Results and a Relevant/Recent switch are
not current UI. Main/Builder's automatic grounding remains a separate bounded contract.

One current Know is one first-class `Episodic:Know` Graphiti object:

```text
one verified source URL/redirect + document identity/date + exact evidence passage
+ one self-contained observation
+ one separately labeled bounded interpretation
+ optional supports/challenges/context direction for one explicit proposition
= one Know attached to exactly one Entity
```

The saved KnowGraph root applies its always-on evidence gate to actual `web_search` / `web_extract` results:
discovery snippets are not documents, the final or resolved URL is copied from successful retrieval, and the
exact evidence passage must occur in fetched page text before an accepted write. Python rails projects
`graphiti.add_know` as the strict
Project-scoped model-facing schema and preserves those citation fields without operating a competing web
retriever or citation ledger. Graphiti stores the citation on the Know, keeps a plain-text episode for
extraction and hybrid retrieval, and derives a deterministic local Know UUID plus portable content hash so
repeated identical intake is idempotent. Only Entities render as Project graph nodes. Thinks, Knows,
citations, provider references and supporting episode IDs remain attached properties/evidence/provenance.
Mere intake acceptance creates no conversation evidence link. A successful exact `graphiti.get_know` readback
under the authenticated Card Run records one ordinary Run artifact with the Graphiti episode/entity IDs and
content hash. The completed conversation stores those episode IDs in `linkedEvidenceIds`; its compact Know
control opens the exact episode ahead of the inspector's ordinary two-record recency window without copying
Know content or changing layer visibility.

The unified canvas shows the blue **Think** and orange **Know** visual layers by default. The green **Code**
layer is hidden and unloaded until explicitly enabled from the graph-design inspector, where it remains marked
Repository-scoped until real open-Project filtering is proven. Each color-key control changes only its own
visual layer, and the explicit layer reset restores Think on, Know on, and Code off. Clicking renderer
background clears the selected node or edge and returns the inspector to the combined currently visible layers
without changing their visibility. ThinkGraph, KnowGraph, and CBM retain separate identities, relationships,
and writers; the shared canvas creates no cross-authority relationship. Know defaults to Graphiti evidence
and Think retains the existing Engraphis Focus behavior, while the detailed graph-design inspector retains the
provider renderer's layout choices. Entity radius linearly normalizes the complete
attached Think-and-Know word count from least to most. That transient visual metric never changes Jev edge
probability, gravity mass, retrieval, or stored graph meaning.

KnowGraph may use selected Thinks only as research framing. Sourced Knows remain Graphiti evidence.
Its dedicated `add_know` intake path reuses the exact supplied UUID/name Entity, reuses an exact-name Entity
when no UUID is supplied, or creates the missing Entity. It then writes one structural `ABOUT` edge, leaves
extraction-owned `MENTIONS` independent, updates Graphiti communities by default, and accepts Graphiti Saga
continuity. `get_know` reads the exact UUID returned at intake, `search_knows` reuses Graphiti episode BM25 plus cross-encoder reranking, while
`get_entity_knows` follows only the exact `ABOUT` attachment. The public generic `add_memory` behavior remains
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

Canonical development startup is `npm run dev:fresh`. It starts and waits for the root PostgreSQL/AGE and
Neo4j Compose services, starts the supported application process graph, and exposes the frontend only after
Python rails and the complete MCP catalog are ready. It resolves the current official CBM command from PATH
and validates its bundled MCP server identity. No cleanup task may launch an extra CBM frontend, restart the
daemon, or partially replace the supervisor.

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
| `NousResearch/hermes-agent` `0.21.5`, tag `v2026.9.24`, source commit `f97608f178d1ffeca59860195ab7da295f7c8e5f` | The bounded families inventoried by file and symbol in `HermesLatest/LIQUIDAITY_PATCHES.md` | Retained Hermes extensions are governed only by that register and current source. Hermes keeps profile creation, execution, sessions, Bot delivery, learning, its upstream internal scheduling, task ledger, PTY, MCP transport, and child Python execution. LiquidAIty submits only an idle Main prompt or an invisible active-turn steer and never requests, exposes, or accepts an upstream busy-prompt queue state. Local hunks add Project roster/session/target-Card inputs, receiving-Card Run context, exact process/task/Run correlation, exact completed-task result delivery into the existing owner session while retaining compact status presentation, profile-MCP request headers and signed loopback authorization, content-aware profile-configuration cache invalidation, preservation of enabled profile MCP servers beneath an empty ordinary-Hermes-tool pin, Card Script presentation, saved-Card-bound AutoTeam synthesis with read-only candidate workers, and the existing Team/Magnetic authority constraints without another runtime. | The overlay register records focused tests, mechanical compatibility decisions, exclusions, apply-check procedure, update cost, and rollback. Application residue checks prohibit the old target opener, process/session owners, per-turn application tool callback, IDD tool authority, Builder Docker policy, custom PTY/voice work, and alternate Codex App Server paths. |
| Same Hermes baseline | `HermesLatest/hermes_cli/taskgraph_adapter.py::{validate_profiles,stage_root,activate_root,read_root,main}`; focused adapter tests | Provide one generic, JSON-serializable public process boundary over Hermes's existing profile and Kanban APIs so another co-located runtime can stage, activate, and read the same task root without importing Hermes internals or mutating process-global Python module state. Hermes retains its database, dispatcher, attempts, workers, dependencies, authority events, and synthesis. | External alternative check: shipped CLI/Gateway do not expose exact allowed-assignee, authority-event, blocked-stage/activate, or whole-root readback contracts; Python-rails and Hermes package pins conflict. Proof requires adapter unit tests plus application Magnetic tests and one loaded same-root mission. Fork cost is one additive module; rollback removes it and disables the dependent Magnetic adapter without migrating task data. |

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

The controlled ShadowBroker import has this bounded local divergence:

| Upstream/version | Local file and symbols | Purpose and preserved behavior | Proof, fork cost, rollback |
| --- | --- | --- | --- |
| `bigbodycobain/Shadowbroker` local package `0.9.83`; exact imported upstream commit not recorded | `agent-products/shadowbroker/backend/{routers/mesh_oracle.py,services/mesh/mesh_oracle.py,services/data_fetcher.py,services/oracle_service.py,services/fetchers/news.py,main.py}`; Oracle/privacy tests and duplicate baseline; `frontend/{package.json,package-lock.json,Dockerfile,src/app/page.tsx,src/components/MaplibreViewer.tsx,src/components/PredictionsPanel.tsx,src/components/InfonetTerminal/{MarketView,InfonetShell,AIQueryView,LiveActivityLog,TerminalDashboard}.tsx}`; release metadata, CI, README/attribution, and OpenClaw skill files | Make the existing Oracle testnet publishable through its existing router, opt-in, signed-write, ledger, and Compose boundaries: one canonical route owner; bounded local-operator provider search; exact market/outcome identity; no probability-as-settlement mutation; synchronized atomic persistence at the existing JSON path; honest unavailable threat state; one reachable human prediction surface; truthful agent/privacy/release claims. Move the self-hosted frontend to fixed Next.js/MapLibre releases, use MapLibre's supported v6 missing-image resolver, and declare the embed-build plugin so a clean container does not depend on the parent workspace. **EXTERNAL ALTERNATIVE CHECK:** configuration or an upstream adapter cannot repair duplicate in-process FastAPI routes, unsafe settlement inference, an unmounted local surface, or undeclared build inputs; official fixed dependency releases are used rather than a local security fork. The change reuses existing extension points and adds no runtime, scheduler, database, authority, or fallback. Existing endpoint paths, signed-write/admin gates, public redaction, provider opt-in, `/app/data` persistence, saved ledger schema, map/news surfaces, and Web/Docker deployment remain preserved. | The backend affected release gate passed 151 tests; the post-migration Oracle/CSP frontend gate passed 55 tests; production dependency audit is zero; strict production-source type checking, Next standalone, Vite embed, Compose parsing, and clean backend/frontend image builds passed. Loaded local containers are healthy at version 0.9.83 with MKT disabled and the expected provider-search refusal. Provider-opted-in Oracle reads, signed prediction/settlement, restart persistence, final-lock image rebuild, and owner visual acceptance remain separate. Fork cost is the listed Oracle/release hardening, dependency migration, and truthful metadata. Roll back these files together to the imported baseline; no automatic data migration/reset is introduced, but rollback would restore known vulnerable dependency versions, the unsafe probability resolver, and duplicate Oracle routes and is therefore not a supported operational downgrade. |

The controlled upstream globe import has this bounded local divergence:

| Upstream/version | Local file and symbols | Purpose and preserved behavior | Proof, fork cost, rollback |
| --- | --- | --- | --- |
| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `agent-products/gods-eye-view/src/app/{application,viewer,viewport,directApplication,mount,directBridge}.js`; `src/runtimeUrl.js`; `src/voice/{gevRealtime,realtimeProtocol,realtimeViewport}.js`; `src/data/contextStore.js`; `client/src/components/worldsignal/GodsEyeSurface.tsx`; `client/src/features/worldview/WorldViewSurface.tsx`; `client/vite.config.ts` | **UPSTREAM CURRENT:** retain the modular application lifecycle, Cesium viewer, complete visual/control surface, live data managers, scene context, selected-entity context, Realtime action runner, and image grounding. **LOCAL KEPT:** retain the supervised camera-stability rules, WorldView presentation wording, Project source readback, selection projection, and credits. **MERGED:** both standalone and LiquidAIty use the same lifecycle and full controller graph. **LIQUIDAITY-SPECIFIC:** React supplies one caller-owned pane, scoped CSS/container sizing, same-origin provider transport, direct callbacks, and serialized teardown/remount. The removed iframe/postMessage bridge is not a fallback. Realtime image grounding accepts only the Cesium canvas contained by the currently mounted WorldView root, records root/canvas/image bounds, and invalidates retained images on stop or unmount. Under the shared hybrid Main layout, capture intersects that stable canvas with the actual exposed companion viewport and crops the source pixels to those visible bounds; it never captures the covered portion or the LiquidAIty page. | Focused vendor tests cover URL scoping, annotations, context reset, Realtime protocol, pane-bounded and exposed-pane-cropped capture, retained-image deletion, and teardown invalidation; focused React tests cover one mount, direct commands, callbacks, and cleanup; vendor/client production builds cover both bundles. A visible Trading Project Preview proved one iframe-free 795×720 mount/canvas inside a 1280×720 page, current satellite/mission feeds, a completed camera reset, a real Launch Library selection with source metadata, and complete removal followed by one clean remount with idle voice and no selected mission. Live AI question/answer acceptance remains blocked honestly because the supervised provider has no configured `OPENAI_API_KEY`; the port is not declared parity-complete until those turns and the resulting viewport-capture diagnostics run. Fork cost is the bounded lifecycle/root/capture seam plus focused tests. Roll back this row's files together; no graph, Project, Card, user, or source data is migrated. |
| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `agent-products/gods-eye-view/src/app/directBridge.js::setLayerVisibility,executeAction`; `src/data/manager.js::isExplicitLayerIntentOrigin`; `src/voice/gevActions.js::set_layer_visibility` | Carry an internal `restore` origin through the existing God’s Eye layer manager and a distinct `worldview_card` origin through its existing action runner. This preserves the one God’s Eye Data Layers control, source lifecycle, provider readback, and standalone voice behavior; it does not create a second layer switch or runtime. | Focused `directBridge.test.mjs` and `gevActions.test.mjs` pass. Fork cost is three origin handoffs at existing interfaces. Roll back these hunks with the Project-origin integration if that seam is retired; no saved source or scene data is rewritten. |
| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `agent-products/gods-eye-view/src/app/mount.js::attachInspectorControls,selectInspectorTab`; `src/ui.js::StyleManager` panel-layout guards; `client/src/features/worldview/{WorldViewSurface.tsx,worldviewInspector.css}` | In the supervised presentation only, move the original God’s Eye control elements (not copies or replacement switches) into tabs inside LiquidAIty's existing right-edge Inspector. The vendor's standalone layout, control handlers, layer manager, presets, cameras, scenes, context, cockpit behavior, and globe remain owned by their existing code. The mounted control bridge is needed because the existing action API cannot relocate already-bound DOM controls without cloning them. Teardown restores each element to its original anchor before the viewer is destroyed. | Focused React bridge/Inspector tests and vendor panel/Cockpit/Context tests pass; client typecheck and production build pass. Loaded visual/control acceptance remains for owner inspection in Preview. Fork cost is one reversible mount-time DOM placement seam and two panel-layout guards. Roll back those hunks with the Inspector adapter; no Project, Card, graph, source, or scene data is migrated. |

| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `agent-products/gods-eye-view/src/data/satellites.js::setParams,setLabelFocus,getLabelFocus,_syncFocusOverlay,getDetectableObjects`; `src/data/detection.js::_drawOverlay`; `src/data/layerState.js` satellite option; `src/ui.js` Labels control; `src/voice/gevActions.js::focus_satellites`; `src/app/directBridge.js` satellite params/action projection | Focus-only satellite names by default, with explicit All restored through the existing layer-state coordinator. A transient exact-NORAD set of at most 50 renderable objects uses the existing overlay host and action runner; replacement/clear removes only its names, and tracked/selected readouts retain ownership. The public layer-param and action interfaces are the integration seams; ambient label gating and ISS suppression require this small God’s Eye fork change. Satellite points/brackets, catalogs, TLE/SGP4 positions, orbit paths, God’s Eye selection/tracking, Space Missions, providers, Earth and camera behavior are preserved. Backend/Python transport retains saved Card/Run authentication and the Project source OFF guard; there is no new renderer, agent or research store. | Focused God’s Eye label lifecycle, saved-mode roundtrip, DENSE/detection, action/bridge and backend/Python contract tests cover immediate suppression, replacement/clear, disabled-source refusal and atomic invalid-focus preservation. Client/vendor builds and loaded control/action proof are separate from owner visual acceptance. Fork cost is one additive enum, one bounded transient label source and gates at existing label/action seams. Roll back only these label-policy hunks and their transport/schema counterparts together; no saved data migration or reset is required. |

| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `agent-products/gods-eye-view/src/data/satellites.js::_handleSatelliteClick,_installClickHandler`; `src/data/satellitesClickSelection.test.mjs` | When the current tracked marker is the top Cesium pick, use Cesium `drillPick` to inspect the first distinct hit instead of ignoring a different satellite underneath it. Ordinary frontmost picking, sibling-layer ownership, current-only no-op, empty-click clear, tracking, labels, catalogs, orbital propagation and rendering stay on their existing paths. No public adapter can resolve this God’s Eye click-handler early return. | The production callback regression covers ordinary and occluded A-to-B switching plus current-only, sibling and empty-click behavior. A mounted WorldView second click changed tracking from NORAD 45358 to 28474 and showed the new God’s Eye readout. Fork cost is one conditional deeper pick and a test seam; remove these hunks when upstream supplies equivalent click resolution. No saved data or runtime configuration is migrated. |
| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `agent-products/gods-eye-view/src/data/traffic.js::disable,destroy`; `src/data/trafficTiming.test.mjs` | Make traffic teardown idempotent when serialized React/God’s Eye remount cleanup reaches an already-removed point collection. The existing application lifecycle and DataLayerManager remain the owners; the guard creates no second teardown path, viewer, layer state, or fallback. | A loaded WorldView remount reproduced the null point-collection write through the real DataLayerManager teardown. The focused God’s Eye test destroys traffic twice after initialization and requires no error while retaining the traffic timing invariants. Fork cost is one null guard plus the regression assertion. Roll back both together when upstream teardown becomes idempotent; no saved Project, camera, layer, graph, or source state is migrated. |

The vendored Graphiti fork has this bounded additive divergence:

| Upstream/version | Local file and symbols | Purpose and preserved behavior | Proof, fork cost, rollback |
| --- | --- | --- | --- |
| `getzep/graphiti` core `0.30.2` / MCP `1.1.0` at `eaa4128681bc53487138a4bbc22d58336ebe70d2` | `GraphitiLatest/graphiti_core/{knows.py,graphiti.py,graph_queries.py}`; episode-search label filtering in `search/{search_filters.py,search_utils.py}` and Neo4j/FalkorDB/Neptune search operations; `mcp_server/src/{graphiti_mcp_server.py,models/response_types.py,services/queue_service.py}`; MCP/core Know tests and MCP README; MCP-v2 `pyproject.toml` and transport port retained from the repository's prior accepted Graphiti compatibility work | **PURPOSE:** add one first-class, cited `Episodic:Know` that uses ordinary `add_episode` extraction, hybrid episode retrieval, temporal fields, Communities and Saga edges, then adds exactly one caller-owned `ABOUT` Entity attachment while leaving extracted `MENTIONS` independent. Exact UUID/name Entities are reused; an absent Entity is created without fuzzy target substitution. `get_know` reads the exact intake UUID; `search_knows` uses Graphiti BM25 plus cross-encoder reranking; `get_entity_knows` follows exact `ABOUT`. Citation and reasoning are typed node properties and episode content is plain text, never a JSON Know envelope. **EXTERNAL ALTERNATIVE CHECK:** upstream `add_episode` supplies extraction/retrieval/Saga behavior but has no first-class Know type or exact one-Entity attachment, and an application adapter cannot add those provider-owned graph semantics. Existing generic tools and records are unchanged. The product uses Neo4j; the additive Know path explicitly refuses deprecated Kuzu rather than pretending parity. | Focused core tests cover exact Entity reuse/create, plain-text ingestion, one-Entity enforcement, Saga forwarding and filtered hybrid search; MCP tests cover v2 catalog shape, the shared per-group queue and argument parity; Python adapter/UI tests cover verified typed citations, exact reads and display. Loaded Neo4j/agent persistence remains a separate proof tier. Fork cost is one additive model/edge contract, four additive MCP tools, episode-label filtering, and the retained MCP-v2 compatibility port. Rollback removes those additions and returns to upstream episodes without first-class Know retrieval; existing upstream Entity, episode, fact, Community and Saga behavior requires no migration. |

The installed Engraphis runtime and the separately retained browser-renderer fork have these bounded local divergences:

| Upstream/version | Local file and symbols | Purpose and preserved behavior | Proof, fork cost, rollback |
| --- | --- | --- | --- |
| `Coding-Dev-Tools/engraphis` `1.7.9` from upstream `main` at `619f49860f293ab1826aaf4e11a158bc22f03fcf` | `EngraphisLatest/pyproject.toml`, `requirements.txt`; `engraphis/mcp_server.py::{classic_mcp,smart_mcp,_safe_run_stdio_async}`; `engraphis/{mcp_http_cli,dashboard_app}.py`; `integrations/prime_agent/src/engraphis_prime_agent/mcp_client.py`; corresponding MCP/HTTP/package/Prime tests | Port Engraphis's MCP binding and bundled client from SDK v1 `FastMCP`/`ClientSession` to official SDK v2 `MCPServer`/`Client(mode="auto")`. Preserve all 40 Classic handlers, the Smart 10 handlers, memory/Think semantics, schemas, storage, consent, authentication, stdio wire isolation, and HTTP DNS-rebinding protection. LiquidAIty publishes the Smart surface; advanced Classic actions remain reachable through Engraphis's own discover/execute gateway. | Upstream MCP, HTTP, consent, dispatch, packaging, contract, annotation, and Prime client tests pass; direct disposable modern (`2026-07-28`) and legacy (`2025-11-25`) clients list the same Smart 10 and complete remember/recall/get/update/discovery/read/conflict/session flows. Fork cost is one mechanical SDK-major port. Remove this row and return `apps/python-models/requirements.txt` to upstream Engraphis when upstream ships the equivalent v2 port; no memory database or saved Card migration is required. |
| Same Engraphis baseline | `EngraphisLatest/engraphis/mcp_server.py::resolve_capability`; `apps/python-models/app/python_models/engraphis_operations.py::_invoke_tool` | Promote the existing capability-ID/schema-digest resolver to a public function so the authenticated Project adapter can inspect the exact discovered Smart action schema and inject `workspace` only when that action declares it. The resolver body, TTL/HMAC validation, availability gate, LRU refresh, action selection and execution remain unchanged. | Required proof is the focused Engraphis Smart discovery/execute suite plus the application operation/catalog contract. Fork cost is one identifier/API promotion suitable for an upstream PR. Remove the application dependency when upstream exposes an equivalent public capability-inspection API; never copy or reimplement its capability index. |
| Same Engraphis baseline | `EngraphisLatest/engraphis/mcp_server.py::smart_tool_catalog`; `EngraphisLatest/engraphis/backends/extractor.py::StructuredLLMExtractor.extraction_contract`; `apps/python-models/app/python_models/engraphis_operations.py`; `apps/python-models/app/python_models/thinkgraph_completed_pair_extraction.py` | Expose two read-only integration contracts that Engraphis already owns: the exact registered Smart MCP Tool models for synchronous host composition, and the exact structured-extraction prompt/schema for a saved Card that performs the model call. The application no longer reads MCPServer's private `_tool_manager` or extractor-private prompt/schema helpers, and it does not copy either contract. | Focused Smart MCP and extractor tests require each public result to equal the actually served/generated contract; application ThinkGraph and operation tests cover the consumers. Fork cost is two additive public methods suitable for upstream submission. Retire either method when upstream exposes an equivalent supported API. |
| Same Engraphis baseline | `EngraphisLatest/engraphis/core/engine.py::remember_entities`; `engraphis/service.py::remember_entities`; `engraphis/mcp_server.py::engraphis_remember_entities`; generated MCP contracts, bundled integrations, docs, and tests | Add one exact Entity-memory batch operation. Each Fact has exactly one caller-declared Entity incidence; an existing explicit ID/name mismatch fails, new exact Entities and their memories/incidences settle atomically, and automatic text-derived incidence is disabled for this path. Existing generic remember, extraction, graph, and Smart discovery behavior is unchanged. | Engine rollback and incidence tests, Smart/classic inventory and dispatch tests, generated-contract checks, bundled integration tests, and application settlement tests cover the path. Fork cost is one additive service/Smart/Classic operation suitable for an upstream PR. Rollback removes that operation and returns ThinkGraph to no exact Entity attachment; existing Engraphis data needs no migration. |
| Browser renderer fork originally copied from Engraphis 1.7.1 `dashboard_assets/engraphis-graph.js` | `client/src/vendor/engraphis/engraphis-graph.js`: existing semantic physics/material/click helpers plus `explicitVisualSizeWeight`, `linearVisualNodeRadius`, the `CODE_MATERIAL` joined-cyber palette branch, and their render call sites | Preserve Jev relationship width/spring/distance and gravity/centrality while accepting one optional transient normalized size weight. Entity radius then scales linearly from least to most attached Think-and-Know words without rewriting `gravity_mass`, relationship probability, storage, or retrieval. The additive Code material makes the Repository-scoped visual layer green in the shared canvas without changing CBM identity, edges, or graph authority. Existing styles—including the work-in-progress Solarpunk material—presets, palettes, graph scene, inspectors, Galaxy Focus physics, controls, and layout engine remain unchanged. | `EngraphisRenderer.spec.ts` exercises real renderer relationship physics, exact linear sizing, and the isolated green Code palette; focused projection/surface tests prove all-history word aggregation, combined sums, visual-layer isolation, and the attached-record inspector. Fork cost is two pure radius helpers plus two small render branches. Rollback removes the optional field handling and Code palette branch, restoring provider degree/mass sizing and generic cyber colors without changing graph data. |

## Current proof limits

### NRGSIM modeling boundary

The rejected persistent-session/Pascal/Docker prototype is not current architecture. The restored
Three.js workspace mounts through the existing Agent Builder page and shared inspector. Its floating
tree contains only actual Building/Story/Space/Surface/opening relationships. Main chat and saved Card
authority remain separate. Only the owner-authorized Modeler contract/grants have been migrated.

`agent-products/nrgsim/services/routes.py::execute` serializes the authenticated Project's operations
on Python rails. `apps/backend/src/routes/nrgsim.routes.ts` checks ownership and forwards to that owner;
the browser submits typed case/revision/control values, not file paths, commands or Card credentials.
`workspace_operations.py` stages and reopens candidates using the installed native Windows SDK/MCP
environment. Sessions are transaction-scoped; saved OSM bytes in the existing ignored
`.local/projects/<project-id>/inputs/` directory own engineering state. Local config selects the
installation and enabled Project. There is no new Docker dependency, persistent provider session or
second engineering store. Derived state caching cannot override a saved OSM revision.

`input_controls.py` publishes explicit SDK getters/setters with units, bounds, choices and object
scope. `floor_geometry.py` operates on native Stories, Spaces, zones and matched surfaces; the initial
core/perimeter layout does not become a fixed zone schema. Existing-vertex transforms retain identities,
and copied upper faces have explicit lineage. The viewport projects saved SDK geometry directly into
Three.js; it is not an independently edited model. Unsupported controls are not manufactured from
generic introspection.

Each native simulation receives a frozen OSM and retains actual weather/version/diagnostic/output
evidence. SQL is read-only. Historical-run inspection checks frozen-model bytes against the recorded
revision; comparisons keep output keys, units, frequency, environment, interval time and missing data.
Building-energy sums retain their source keys. Floor-area normalization is separate from total energy;
an area-driven change is not labeled an efficiency saving.

The bounded packaged DX test calls the installed System 3 recipe and verifies the resulting equipment.
Its observed mixer/coil/fan order requires an explicit public-SDK correction in `packaged_rooftop.py`;
upstream source is unchanged. Recurring native coil-frost diagnostics remain a model-quality gap, not
successful performance acceptance. The owner has authorized a later genuine multizone increment.
The current EPW sizing option stores native OSM weather-period fields; an owned EnergyPlus measure
bridges SDK 3.11's observed forward-translation omission through the existing public MCP OSW runner.
It retains design days and verifies the exact native periods in the executed IDF. It is not another
solver, upstream patch or invented weather generator.

The saved Modeler now selects two domain-owned code operations in the existing MCP catalog.
`modeling_tools.py` forwards grant-checked, Project-injected reads and edits to the same Python rails
HTTP entry; it does not import its process-local lock or hold another OSM. Native SDK bindings are
the common human/agent control definitions. Existing Main completion callbacks request a model
refresh without overwriting a pending human draft. Direct SDK/MCP tests, saved grant readback and
human edits still do not prove loaded Modeler tool discovery/execution.
Construction choices use actual surface categories and a deliberately selected installed OpenStudio
library. A native IDF-object reference closure avoids loading all unrelated library sets. Imported
assemblies retain source provenance; R values exclude films/bridges, and PCM assemblies reject the
generic R adjustment. This is not a whole-building standards transformation.
`PLAN.md` and `agent-products/nrgsim/CoderReport.md` record current proof and the explicit remaining gaps.

- Source, focused tests, typechecks, a loaded service, a real saved-Card turn, an external MCP call,
  and owner visual acceptance remain separate proof tiers.
- The 2026-10-14 loaded pass completed ordinary Main, consultation, five direct Card targets, refresh
  retention, and the Builder terminal. The 2026-10-15 cleanup then passed 420 first-party Python tests,
  389 TypeScript tests with one intentional skip, all TypeScript checks, both production builds, a zero-
  vulnerability production npm audit, loaded health/source-current readback, and the Entity/Know inspector
  visual regression. It did not repeat a model turn. External OAuth, enabled Script, Team, Magnetic,
  graph-write, external-client, and final owner visual acceptance remain separate.
- Team and Magnetic preparation must resolve through HermesLatest. Team execution and an actual Mag One
  mission remain separate user-authorized acceptance; this repair does not launch a Magnetic mission.
- Actual child provider/model, Bot delivery, graph attention, external-provider calls, terminal attachment,
  and exact Run/Stop correlation require their own observed receipts. Saved or projected configuration is
  not execution proof.
- Voice is outside the current acceptance pass and remains standard Hermes behavior. WorldView, trading,
  and broader graph semantics retain their existing independent acceptance boundaries.
