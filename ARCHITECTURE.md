# LiquidAIty current architecture

[Plugin contract](plugin.md) · [CodeGraph contract](CODEGRAPH.md) · [Execution law](AGENTS.md) · [Current plan](PLAN.md) ·
[Rejected paths](DONT.md) · [Deferred work](FUTURE.md)

This document describes current source architecture. It does not claim that a running Hermes host has
reloaded the source or that a provider, database, remote connector, or visual workflow passed live
acceptance. plugin.md is the canonical Hermes integration contract.

## One-line law

```text
TypeScript = LiquidAIty pixels and typed transport projection
Python rails = deterministic application operations and graph/data adapters
models = semantic reasoning
saved Cards and Project wires = product identity and authority
Hermes = profiles, sessions, delivery, tools, tasks, PTY, telemetry, and runtime lifecycle
```

No layer may recreate an owner that already exists above.

## Product and status vocabulary

LiquidAIty is its own React UI hosted as a Hermes web-dashboard plugin. It is not Hermes Desktop,
Electron, an iframe, or another runtime.

Current source roles:

- **Main:** human-facing fast boss; understands, delegates, reviews, answers; never builds.
- **Builder:** makes PromptSpecs, prompts, blue worker Cards, blue wires, applications, and code; never
  runs agents or edits protected core Cards.
- **ThinkGraph:** Engraphis-backed Project reasoning and operational memory.
- **KnowGraph:** Graphiti-backed sourced research and provenance.
- **CodeGraph:** CBM-backed repository structure.
- **Magnetic:** saved PromptSpec/taskgraph coordinator whose exact blue wires are its worker ceiling.
- **Team:** protected general wildcard whose same-profile AutoTeam handles a bounded job when no saved
  specialist matches.

Every assertion must be labeled as **CURRENT SOURCE**, **STATIC PROOF**, **LOADED PROOF**,
**LIVE EXECUTION**, **PERSISTENCE READBACK**, **VISUAL ACCEPTANCE**, or **DEFERRED**. A lower tier
never proves a higher one.

## Authority map

| Authority | Current owner | Integration boundary |
| --- | --- | --- |
| UI and product interaction | LiquidAIty React | Runs inside the Hermes dashboard plugin page and keeps LiquidAIty's existing components. |
| Browser host/authentication | Hermes dashboard | Injects host React and authenticated HTTP/WebSocket helpers. |
| Chat/session runtime | Hermes Gateway | Generated JSON-RPC contract/client only; no LiquidAIty session backend. |
| Profiles and Bot roster | Hermes profile service | Project one saved Card and its enabled wires into one stable profile. |
| Direct delegation | Hermes `message_agent` | Exact profile roster; no application delivery or reply waiting. |
| Team/Magnetic execution | Hermes SQLite task/dependency runtime | One plugin admission tool; no copied scheduler or task store. |
| Application operations | LiquidAIty MCP host | One catalog and saved per-profile grants. |
| Per-profile memory | Holographic provider | Selected/configured for every retained Card profile. |
| ThinkGraph | Engraphis | Project reasoning reader/writer and completed-pair settlement. |
| KnowGraph | Graphiti/Neo4j | Sourced Know reader/writer and provenance. |
| CodeGraph | Codebase Memory | Repository structure provider. |
| AgentGraph | AGE/PostgreSQL | Saved topology and truthful execution observations; never runtime control. |

## Source-owner map

| Boundary | Primary source |
| --- | --- |
| Dashboard manifest/API | `apps/hermes-liquidaity-plugin/dashboard/{manifest.json,plugin_api.py}` |
| Native plugin hooks/tools | `apps/hermes-liquidaity-plugin/{plugin.yaml,__init__.py,card_script_runtime.py,navigation_map.py,taskgraph_runtime.py}` |
| Dashboard UI entry/build | `client/dashboard-plugin-public/index.js`, `client/src/hermesDashboardPlugin.tsx`, `client/vite.dashboard.config.ts` |
| Hermes browser host | `client/src/features/hermes/hermesHost.ts` |
| Main session projection | `client/src/features/hermes/useHermesMainChat.ts`, `client/src/components/main/MainProjectChat.tsx` |
| Profile publication | `client/src/features/hermes/hermesProfileClient.ts`, Card editor/save owners |
| Runtime telemetry | `client/src/features/hermes/hermesRuntimeClient.ts` |
| Navigation-map publication | `client/src/features/hermes/hermesNavigationMapClient.ts`, graph surface, plugin map/API |
| Saved Card defaults | `apps/backend/src/decks/defaultProjectDeck.ts` and prompt assets |
| Builder mutation enforcement | `apps/python-models/app/builder_worker_policy.py` plus saved Card/wire owners |
| MCP composition/catalog | `apps/python-models/app/{mcp_host.py,mcp_catalog_runtime.py,mcp_observability.py}` |
| ThinkGraph automatic intake | plugin hook, `conversations.py`, `thinkgraph_automatic.py`, extraction and settlement owners |
| Hermes taskgraph delta | controlled files listed in the divergence register below |

Current source wins over this map whenever it changes.

## Web-dashboard plugin and generated client

The dashboard bootstrap reads `window.__HERMES_PLUGIN_SDK__`, uses its React instance, and registers
LiquidAIty with `window.__HERMES_PLUGINS__`. The built workspace loads inside that registered page.
CSS is scoped to the LiquidAIty dashboard root. There is no iframe or Electron surface.

The browser asks the SDK for an authenticated `/api/ws` URL, then reuses Hermes's generated
`JsonRpcGatewayClient` and generated method/event types. Hermes owns correlation, server requests,
heartbeat, reconnect/replay, session history, prompt admission, streaming, approvals, clarification,
Stop, images, and reply identity. LiquidAIty only maps typed state to pixels.

The lower terminal uses a dashboard-SDK authenticated `/api/pty` URL. LiquidAIty does not spawn or
proxy a TUI.

The deleted `/api/main/session`, `mainSessionClient`, `useAgentBuilderMainChat`, backend Bot
requester, custom SSE protocol, history poller, PTY manager, and Desktop profile bridge have no current
owner and no compatibility fallback.

Hermes's public canonical Bot Chat is profile-scoped. The generated Gateway contract currently exposes
no LiquidAIty Project key for Bot-session lookup. Current source therefore does not claim concurrent
multi-Project Main-history isolation for one stable profile; the retained Trading Project is the v0.1
acceptance scope. LiquidAIty does not compensate with cloned profiles, copied transcripts, a session map,
or UI filtering. The profile-bound navigation-map cache has the same explicit concurrency limit.

## Saved Cards, profiles, skills, and wires

A saved Card is permanent Product authority for identity, revision, prompt blocks, model/provider,
profile binding, enabled state, selected skills/toolsets/MCP operations, optional Python recipe, and
presentation. One saved Card maps to one stable Hermes profile.

Card Save first persists the Card. It then uses public `profiles.create`,
`profiles.describe`, and `profiles.configure` calls and verifies readback. The projection includes:

- compiled SOUL text;
- provider/model;
- exactly one selected custom or existing Hermes skill;
- Hermes toolsets and exact LiquidAIty MCP includes;
- Holographic configuration;
- exact Bot roster for enabled orchestrators;
- Team/Magnetic task mode;
- optional immutable Card Python recipe; and
- categorized profile description plus the exact `[ORCHESTRATOR SKILL]` introduction.

Orange `flow` and blue `magentic_option` wires both grant direct Bot reachability. Blue also enrolls
the target in Magnetic's exact worker ceiling. Wires neither deliver messages nor grant reverse or
orchestrator authority.

Main is source-default orchestrator. Main never edits Cards or wires. Builder is non-orchestrating and
never runs agents. Builder may create/edit only non-core blue workers and their blue Magnetic wires;
Python rejects protected-core, orange, and unrelated unwired mutations. Main tests saved Cards through
native `message_agent`.

`LiquidAIty.idd` is an authoring dictionary for Card fields and choices. It is not runtime input,
an IDF, a prompt envelope, an execution receipt, or a second catalog.

## Direct delegation, Team, and Magnetic

Main uses one direct specialist for bounded matching work. When none matches, Main may call Team
directly. For deliberate multi-agent execution, Builder prepares the exact PromptSpec from relevant
ThinkGraph/KnowGraph and, when needed, CodeGraph context; Main sends that PromptSpec to Magnetic.

The standard Team or Magnetic Bot turn calls `taskgraph_start` once:

- Team creates one auto-decompose root inside the Team profile. Workers are depth-one and the same root
  performs synthesis.
- Magnetic creates one root with `allowed_assignees` equal to the exact configured blue roster.
  Dependencies block that same root until required children finish, then it synthesizes.
- Magnetic may delegate a bounded child to protected Team. Team then owns a separate same-profile
  AutoTeam root.
- Magnetic descendants can narrow their own profile scope; they cannot widen the root ceiling.

Hermes owns task rows, dependencies, attempts, dispatch, worker processes, retries, failure state, and
completion. LiquidAIty does not copy rows or implement a scheduler, board, worker selector, or dispatcher.
The Task tab reads Hermes's bundled authenticated Kanban board/task endpoints and reconstructs only the
exact root creator lineage for the current profile session.

The plugin uses documented `ctx.dispatch_tool("kanban_create", ...)`. Hermes 0.22.7's upstream
`kanban_create` has no structural Team/Magnetic root or mission-scoped assignee ceiling. The controlled
fork below records that exact vendor delta. The external plugin imports no private Kanban modules.
Ordinary Bot Mode remains the delivery path into Team/Magnetic and is not modified.

## Card Python

The saved Card Python editor is retained. An explicit enable control determines whether an immutable
recipe is projected into profile plugin configuration. Blank or disabled source is inert.

The plugin's `card_python` tool executes the recipe in an isolated child of the Hermes plugin host's
Python executable. Source and compiled hashes, JSON input/output schemas, timeout, output bytes, maximum
tool calls, and saved tool scope are enforced. Nested operations use `ctx.call_mcp` against the
Card's existing LiquidAIty grants. Bad code returns a bounded failure; it never becomes a result or
another runtime.

## Graph authorities and visible navigation context

```text
ThinkGraph = Engraphis reasoning and operational knowledge
KnowGraph  = Graphiti/Neo4j sourced Knows and provenance
CodeGraph  = CBM repository Files, calls, imports, and structure
AgentGraph = AGE saved Card topology and truthful observations
```

One authority and one writer remain for each graph. The combined canvas projects real provider records
without merging stores. Think/Know Entities may be visually joined by exact Project identity; Code Files
remain separate. Thinks, Knows, citations, episodes, and supporting IDs are attached detail or provenance.

The UI publishes a compact JSON map matching enabled visible Think/Know/Code layers. It carries bounded
nodes/relationships, provider pointers, and one open-node detail record. The plugin validates and
pre-renders it, then atomically swaps an immutable in-memory tuple. Main, Builder, ThinkGraph, and
KnowGraph receive a constant-time `pre_llm_call` read.

Main Send waits for current-view publication and fails closed on synchronization failure. Reconnect
publishes a new snapshot. The map is navigation context, never a graph, search index, copied subgraph,
automatic relevance engine, or writer. Engraphis, Graphiti, and CBM follow pointers for deeper reads.

The removed IDF, Data Anchor, Card invocation preparation, automatic model/tool selection, and Jev
relevance stack do not return.

[CODEGRAPH.md](CODEGRAPH.md) defines the authored Entity/Relationship overlay, module-cohesion discipline,
agent-authored file rules, and the later bounded repository-to-agent-product workflow. Those authored pairs
explain Feature meaning; CBM remains the independent structural authority.

## ThinkGraph completed-turn intake

Hermes's `on_session_end` hook observes a successful, non-interrupted Main session. Main does not call,
supervise, steer, approve, or settle intake. Its completed turn is only the source event.

The plugin captures the exact Main profile/session and validated loopback Python-rails origin. The Hermes
plugin host schedules the background coroutine with `ctx.spawn_task` and runs blocking I/O through
`asyncio.to_thread`, so Hermes owns task lifecycle and unload cancellation while Main returns.

The hook captures the exact User/Main `state.db` row IDs at the completed-turn boundary and resolves
authenticated Project context. Python rails reads only those rows and refuses an already settled pair.
The registered ThinkGraph auxiliary model returns structured extraction. Engraphis records the pair
outcome, accepts zero or more Thinks, and remains semantic graph owner. There is no minimum Think count,
TypeScript conversation store, caller-supplied copy, history poller, or Python semantic validator.

The raw pair remains source evidence, not another memory graph. Existing preparation, extraction, and
settlement owners remain distinct.

## KnowGraph

KnowGraph uses Hermes Web pinned to Firecrawl and its saved Graphiti operations. Graphiti owns sourced
Know persistence and retrieval. A Know retains one source document, exact evidence passage,
self-contained observation, bounded interpretation, optional proposition direction, and exact Entity
identity. LiquidAIty does not add another web retriever, citation ledger, or graph writer.

Main and Builder may search Graphiti through their saved grants. Only KnowGraph's saved write grants
authorize persistence.

## MCP catalog and grants

`apps/python-models/app/mcp_host.py` is the single application MCP composition boundary. Hermes
profiles connect through Hermes's native MCP client. Saved includes are the capability ceiling.

Source-default grants are:

- Main: Engraphis recall, Graphiti node/fact search, retained WorldView capability.
- Builder: Engraphis/Graphiti search, bounded CBM reads, explicit Card create/update and canvas/blue-wire
  operations, plus saved construction toolsets.
- ThinkGraph: Engraphis hybrid vector/lexical and settlement operations.
- KnowGraph: Graphiti search/write and Hermes Web/Firecrawl.
- Team: saved research/execution surface plus LiquidAIty plugin tools.
- Magnetic: LiquidAIty plugin tools for taskgraph admission.

The only native plugin tools are `card_python` and `taskgraph_start`; ordinary application
operations remain MCP tools. Catalog metadata derives from current source manifests and a source hash.
Source, loaded local catalog, and remote connector metadata are separate proof tiers.

Codebase Memory remains repository-structure authority. Product Cards use only saved `cbm.*` grants.
Repository development uses the installed CLI according to AGENTS.md. Neither consumer opens CBM caches
or launches another indexer.

## Memory

Every retained Card profile selects Holographic. Built-in Markdown memory, user-profile Markdown,
background review, curator behavior, and automatic skill creation are disabled. LiquidAIty does not
render a Hermes Learning Graph.

Holographic stays per profile. Engraphis and Graphiti stay Project authorities. No memory system
absorbs another.

## Backend and plugin API boundaries

LiquidAIty backend routes own Product authentication, saved Project/Card transport, graph projections,
editor options, and deterministic Python-rails operations. They do not own Hermes chat, profiles, Gateway
tickets, PTY, or task execution.

The authenticated LiquidAIty dashboard plugin API only publishes, reads, and clears the navigation map.
Team/Magnetic presentation uses Hermes's bundled Kanban API directly. The plugin API does not submit
prompts, deliver Bots, start a Gateway, proxy a terminal, or duplicate session/task state.

## Deployment and security

LiquidAIty executes inside the authenticated Hermes dashboard origin. The dashboard SDK supplies
authenticated HTTP/WebSocket requests. Profile-scoped Hermes connections remain Hermes-owned.

Each profile's `liquidaity` MCP connection uses the existing signed owner/Project/deck/profile scope.
The MCP host rechecks saved grants. External ChatGPT/plugin publication is a separate OAuth-protected
resource and never exposes internal backend routes.

No source test proves a loaded secret, provider credential, remote connector, or deployed topology.

## Proof tiers

Report separately:

1. source structure and forbidden-residue scan;
2. focused unit/contract tests;
3. complete relevant tests;
4. typecheck and normal/dashboard builds;
5. loaded plugin discovery and health;
6. real Main/Card/Team/Magnetic execution;
7. persistence readback;
8. external connector acceptance;
9. Jeremiah's visual acceptance.

A lower tier never fills a higher tier.

## Controlled imported and vendored roots

`HermesLatest/`, `EngraphisLatest/`, `agent-products/gods-eye-view/`,
`agent-products/shadowbroker/`, `agent-products/kronos/`, and other imported systems are controlled
upstream forks or first-party runtime source, not general cleanup targets. Prefer a public API,
protocol, configuration, hook, or existing adapter boundary. A justified vendor edit must record its
exact files/symbols, preserved upstream behavior, tests, fork cost, and rollback.

The source-wired WorldView launcher is `scripts/start-worldview.ps1` (package script `dev:worldview`);
the WorldSignals service is started by package script `dev:worldsignals`. These source paths do not
establish loaded-service or product acceptance.

The current Hermes divergence has two bounded families: the existing profile-scoped ordered Bot roster
and the Team/Magnetic policy over Hermes's own SQLite task/dependency runtime. Direct Bot delivery,
recipient execution, queues, retries, receipts, PTY, MCP, and ordinary task behavior remain Hermes-owned.
The application projects enabled wires into the profile roster and never maintains target sessions,
delivery queues, task rows, workers, or a scheduler.

`TaskGraph` is the LiquidAIty product name for this bounded use of the upstream SQLite substrate
that Hermes source names Kanban. Application prompts and UI use TaskGraph. Exact vendor files and tests
may use the upstream term. No LiquidAIty layer may copy the ledger, dispatch, retries, workers, or
completion rules.

| Upstream/version | Local file and symbols | Purpose and preserved behavior | Proof, fork cost, rollback/removability |
| --- | --- | --- | --- |
| `NousResearch/hermes-agent` release `v0.22.7`, source `b200f5bc60e31588ba2cb60e288029c4a54ba5fa`; LiquidAIty plugin compatibility floor `0.22.7` | Existing roster: `tools/bot_mode_probe.py::configured_bot_roster,resolve_bot_roster` and profile configure/readback. Taskgraph delta: `hermes_cli/{kanban_team.py,kanban_magnetic.py,kanban_db.py,kanban_db_connect.py,kanban_db_dispatch.py,kanban_db_graph.py,kanban_decompose.py,config_defaults.py}`; `gateway/{session_kanban.py,kanban_watchers_dispatcher.py}`; `tools/{kanban_tools.py,delegate_tool.py}`; focused Team/Magnetic tests. | **PURPOSE:** retain exact profile Bot rosters; add Team auto-decomposition/same-profile synthesis and Magnetic mission-scoped `allowed_assignees`, dependency blocking, creator-tree narrowing, and assignment fences inside Hermes's existing task owner. **EXTERNAL ALTERNATIVE CHECK:** public PluginContext tool dispatch exists, but upstream `kanban_create` has no structural Team/Magnetic root or exact mission-scoped assignee ceiling; an application adapter would duplicate task authority. The external plugin now stays on `ctx.dispatch_tool` and the bundled Kanban read API with no private Kanban imports. **UPSTREAM BEHAVIOR PRESERVED:** ordinary Bot Mode, unrestricted ordinary tasks, task storage, attempts, dispatch, retries, workers, PTY, MCP, and session behavior. Null `allowed_assignees` retains ordinary semantics. | The focused `kanban_tools` plus AutoTeam/Magnetic set passes 76 tests; the external plugin suite passes 10 tests, and Plugin Doctor plus the core-source catalog admission check pass. Fork cost is the listed policy fields/helpers and tests. Roll back the taskgraph family and plugin admission together if Hermes publishes an equivalent supported policy; keep or separately roll back the roster family according to its saved-profile compatibility contract. Never replace either family with application delivery, a board, a second SQLite store, or a fallback scheduler. |

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
| `getzep/graphiti` core `0.30.2` / MCP `1.1.0` at `eaa4128681bc53487138a4bbc22d58336ebe70d2` | `GraphitiLatest/graphiti_core/{knows.py,graphiti.py,graph_queries.py}`; episode-search label filtering in `search/{search_filters.py,search_utils.py}` and Neo4j/FalkorDB/Neptune search operations; `mcp_server/src/{graphiti_mcp_server.py,models/response_types.py,services/queue_service.py}`; MCP/core Know tests and MCP README; MCP-v2 `pyproject.toml` and transport port retained from the repository's prior accepted Graphiti compatibility work | **PURPOSE:** add one first-class, cited `Episodic:Know` that uses ordinary `add_episode` ingestion, hybrid episode retrieval, temporal fields, Communities and Saga edges, then stores exactly one caller-owned Entity UUID as data and removes the Know's `ABOUT` or extraction-created `MENTIONS` attachment edges. Exact UUID/name Entities are reused; an absent Entity is created without fuzzy target substitution. `get_know` reads the exact intake UUID; `search_knows` uses Graphiti BM25 plus cross-encoder reranking; `get_entity_knows` selects exact `entity_uuid`. Citation and reasoning are typed node properties and episode content is plain text, never a JSON Know envelope. **EXTERNAL ALTERNATIVE CHECK:** upstream `add_episode` supplies ingestion/retrieval/Saga behavior but has no first-class Know type, exact one-Entity property contract, or Know-specific edge cleanup; an application adapter cannot add those provider-owned graph semantics. Existing generic tools and non-Know records are unchanged. The product uses Neo4j; the additive Know path explicitly refuses deprecated Kuzu rather than pretending parity. | Focused core tests cover exact Entity reuse/create, plain-text ingestion, one-Entity enforcement, attachment-edge removal, Saga forwarding and filtered hybrid search; MCP tests cover v2 catalog shape, the shared per-group queue and argument parity; Python adapter/UI tests cover verified typed citations, property-based exact reads and display. Loaded Neo4j/agent persistence remains a separate proof tier. Fork cost is one additive model/property contract, four additive MCP tools, episode-label filtering, Know edge cleanup, and the retained MCP-v2 compatibility port. Rollback removes those additions and returns to upstream episodes without first-class Know retrieval; existing upstream Entity, episode, fact, Community and Saga behavior requires no migration. |

Graphiti community-result aggregation repair (2026-10-31): **VENDORED PROJECT:** the same `getzep/graphiti` fork/version above. **PURPOSE:** unblock the existing custom Know writer when episode extraction returns other than two Entities. **EXTERNAL ALTERNATIVE CHECK:** disabling communities or adding an application-side writer/retry would change behavior; the existing owner must collect its own results correctly. **FILES AND SYMBOLS:** `GraphitiLatest/graphiti_core/graphiti.py::Graphiti.add_episode` and the existing caller-supplied-UUID test in `GraphitiLatest/tests/test_knows.py`. **UPSTREAM BEHAVIOR PRESERVED:** the same native `update_community` calls, concurrency limit, persistence, exception propagation, and enabled/disabled choice; no Jev or graph-rule change. **CONTRACTS:** flatten the returned per-Entity Community and CommunityEdge lists into the existing `AddEpisodeResults` fields. **TESTS:** zero, one, two, and three Entities with community updates both enabled and disabled, including an Entity with no community; loaded Know persistence remains a separate acceptance tier. **FORK COST:** one result-aggregation correction and bounded regression coverage. **ROLLBACK:** remove only this correction/test expansion on explicit owner instruction; no data migration or deletion.

The installed Engraphis runtime and the separately retained browser-renderer fork have these bounded local divergences:

| Upstream/version | Local file and symbols | Purpose and preserved behavior | Proof, fork cost, rollback |
| --- | --- | --- | --- |
| `Coding-Dev-Tools/engraphis` `1.7.9` from upstream `main` at `619f49860f293ab1826aaf4e11a158bc22f03fcf` | `EngraphisLatest/pyproject.toml`, `requirements.txt`; `engraphis/mcp_server.py::{classic_mcp,smart_mcp,_safe_run_stdio_async}`; `engraphis/{mcp_http_cli,dashboard_app}.py`; `integrations/prime_agent/src/engraphis_prime_agent/mcp_client.py`; corresponding MCP/HTTP/package/Prime tests | Port Engraphis's MCP binding and bundled client from SDK v1 `FastMCP`/`ClientSession` to official SDK v2 `MCPServer`/`Client(mode="auto")`. Preserve all 40 Classic handlers, the Smart 10 handlers, memory/Think semantics, schemas, storage, consent, authentication, stdio wire isolation, and HTTP DNS-rebinding protection. LiquidAIty publishes the Smart surface; advanced Classic actions remain reachable through Engraphis's own discover/execute gateway. | Upstream MCP, HTTP, consent, dispatch, packaging, contract, annotation, and Prime client tests pass; direct disposable modern (`2026-07-28`) and legacy (`2025-11-25`) clients list the same Smart 10 and complete remember/recall/get/update/discovery/read/conflict/session flows. Fork cost is one mechanical SDK-major port. Remove this row and return `apps/python-models/requirements.txt` to upstream Engraphis when upstream ships the equivalent v2 port; no memory database or saved Card migration is required. |
| Same Engraphis baseline | `EngraphisLatest/engraphis/mcp_server.py::resolve_capability`; `apps/python-models/app/python_models/engraphis_operations.py::_invoke_tool` | Promote the existing capability-ID/schema-digest resolver to a public function so the authenticated Project adapter can inspect the exact discovered Smart action schema and inject `workspace` only when that action declares it. The resolver body, TTL/HMAC validation, availability gate, LRU refresh, action selection and execution remain unchanged. | Required proof is the focused Engraphis Smart discovery/execute suite plus the application operation/catalog contract. Fork cost is one identifier/API promotion suitable for an upstream PR. Remove the application dependency when upstream exposes an equivalent public capability-inspection API; never copy or reimplement its capability index. |
| Same Engraphis baseline | `EngraphisLatest/engraphis/mcp_server.py::smart_tool_catalog`; `EngraphisLatest/engraphis/backends/extractor.py::StructuredLLMExtractor.extraction_contract`; `apps/python-models/app/python_models/engraphis_operations.py`; `apps/python-models/app/python_models/thinkgraph_completed_pair_extraction.py` | Expose two read-only integration contracts that Engraphis already owns: the exact registered Smart MCP Tool models for synchronous host composition, and the exact structured-extraction prompt/schema for a saved Card that performs the model call. The application no longer reads MCPServer's private `_tool_manager` or extractor-private prompt/schema helpers, and it does not copy either contract. | Focused Smart MCP and extractor tests require each public result to equal the actually served/generated contract; application ThinkGraph and operation tests cover the consumers. Fork cost is two additive public methods suitable for upstream submission. Retire either method when upstream exposes an equivalent supported API. |
| Same Engraphis baseline | `EngraphisLatest/engraphis/core/engine.py::remember_entities`; `engraphis/service.py::remember_entities`; `engraphis/mcp_server.py::engraphis_remember_entities`; generated MCP contracts, bundled integrations, docs, and tests | Add one exact Entity-memory batch operation. Each Fact has exactly one caller-declared Entity incidence; an existing explicit ID/name mismatch fails, new exact Entities and their memories/incidences settle atomically, and automatic text-derived incidence is disabled for this path. Existing generic remember, extraction, graph, and Smart discovery behavior is unchanged. | Engine rollback and incidence tests, Smart/classic inventory and dispatch tests, generated-contract checks, bundled integration tests, and application settlement tests cover the path. Fork cost is one additive service/Smart/Classic operation suitable for an upstream PR. Rollback removes that operation and returns ThinkGraph to no exact Entity attachment; existing Engraphis data needs no migration. |
| Browser renderer fork originally copied from Engraphis 1.7.1 `dashboard_assets/engraphis-graph.js` | `client/src/vendor/engraphis/engraphis-graph.js`: `sanitizeEvidenceMetrics`, `graphNodeRadius`, `codeCategoryForce`, `materialRecipe`, `solarpunkMaterialRecipe`, material cache keys and `paintMaterialDirect`; existing spring/material/click helpers | Reuse public projected-radius and spring fields: knowledge size counts distinct incoming Entities; Code size counts distinct incoming caller/importer Files. Preserve Jev edge math and ordinary upstream mass-based sizing for untagged Engraphis nodes. Code retains shipped Cyberpunk colors; Think is sea-blue, Know orange, mixed Think/Know uses the recovered `joined-cyber` iridescent treatment with the owner's blue/orange substitutions, and observed heat is light purple. A cached violet `material_code_present` rim associates an exact matching annotation category without merging Code Files or asserting a semantic edge. No public category-force hook exists; the bounded `codeCategoryForce` adds transient category-centre attraction, reciprocal same-name docking and Code damping to the existing D3 simulation. Imports retain the existing dashed-edge accessor. Whole-canvas orbital mode cannot preserve this force; application presets are internal Compact for knowledge/mixed and Communities for Code-only. No visible category hub, membership spoke, new query, dependency, runtime, writer, storage path or telemetry source is added. | Existing renderer tests exercise real recipes, cached association paint, purple heat, projected sizing, preserved upstream mass sizing and the shipped Code palette. Projection/surface tests cover directional deduplication, separate Files, real provider tabs, source/category controls and removed Focus/tuning UI. Loaded mixed-source visual acceptance and fresh automatic Think/Know production remain separate proof. Fork cost is the named bounded renderer seams; rollback restores only these renderer/projection/configuration hunks together, without changing Main, Cards or graph data. |

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
- Bot Mode voice uses the existing Hermes audio endpoints; synthesis has current live proof while local
  recognition has the Windows policy blocker detailed above. WorldView voice, trading, and broader graph
  semantics retain their independent acceptance boundaries.
