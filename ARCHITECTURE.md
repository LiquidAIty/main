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

## Source-owner map

Use Codebase Memory first for covered structural discovery, then read the complete current source.
When CBM is unavailable or a path is excluded, use the bounded direct-source fallback in
[`skills/codebasedmemory.md`](skills/codebasedmemory.md).

| Concern | Current owner | Contract |
| --- | --- | --- |
| Saved Card and deck state | `apps/python-models/app/python_models/card_domain.py` | Saved identity, revision, runtime binding, profile, provider/model, prompt, grants, topology, and Run state |
| Canonical Run input | `apps/python-models/app/python_models/idf.py::materialize_idf` | One UTF-8 `in.idf`, written and reread before execution |
| Card Python Script | `apps/python-models/app/python_models/card_script.py` plus the existing Card editor transport | Saved Card-owned source, structural compilation, live selected-tool validation, honest provider availability, and retained receipt identity; no TypeScript executor |
| Browser transport | `client/src` | Rendering, input controls, SSE/HTTP consumption, and no semantic routing |
| Application HTTP transport | `apps/backend/src/routes` | Authentication, saved-scope checks, Hermes request/event translation, and Python-rails calls; it does not own Hermes processes or sessions |
| Hermes Card session adapter | `apps/backend/src/routes/mainSession.routes.ts::cardSession` and `apps/backend/src/services/hermesGateway.ts` | Reuse the shipped Hermes Gateway client, materialize one saved Card profile, and resolve or create the exact Project conversation session |
| Hermes Run receipt | `apps/backend/src/routes/mainSession.routes.ts::{prepareRun,submitTurn,finishRun}` plus Python rails Run records | Correlate one already-materialized saved Run with one Hermes submission and persist the observed completion or failure |
| Hermes profile application | `apps/backend/src/hermes/profileMaterialization.ts` | Apply and read back only Card-owned Soul, model/runtime, skills, toolsets, MCP selection, delegation, and Team marker while preserving Hermes-owned and unknown profile state |
| Hermes runtime | `HermesLatest/` | Hermes inference, profiles, sessions, tools, memory, delegation, task/dependency dispatch, Gateway, TUI, desktop, and direct-agent messaging |
| Mag One execution | `apps/python-models/app/python_models/magentic_execution.py` | Headless structured submit, status/rejoin, stop, and final-result observation against Hermes' existing SQLite task/dependency runtime |
| Tool contracts and execution | `apps/python-models/app/python_models/tool_registry.py` plus the current Python operation owners | Canonical schemas, provider availability, deterministic validation, and execution; transports do not duplicate these owners |
| Official MCP host | `apps/python-models/app/mcp_host.py` | One authenticated projection of the canonical definitions for external clients and Hermes Dynamic Tool callbacks; protocol and transport are owned by the official Python MCP SDK |
| CodeGraph | Native Codebase Memory through the official MCP host | Repository structure and source relationships; CBM is the sole graph writer |
| ThinkGraph | Engraphis through `apps/python-models/app/python_models/engraphis.py` | Project reasoning, canonical entities, append-only temporal episodic Thinks, native structured incidence, and the sole persistent ThinkGraph store; Jev owns durable semantic edge admission/classification |
| KnowGraph | Graphiti/Neo4j through `services/knowgraph` | Sourced knowledge and provenance |
| AgentGraph | AGE/PostgreSQL through the Card-domain observation path | Saved Card relationships and truthful Run/reference/artifact observations |

## Authority chain

```text
saved Card revision
  + current dynamic mission
  + deliberately selected native references and bounded data
  + effective saved grants
  -> Python materializes and rereads one in.idf
  -> saved runtime binding chooses the exact Hermes mode and profile
  -> native runtime executes
  -> PostgreSQL stores Run state and artifact metadata
  -> AGE may observe stable identities and truthful native events
```

Callers do not supply replacement Card definitions. A model cannot enlarge its grants, change its
saved runtime, invent graph data, or choose a provider fallback. TypeScript does not reconstruct a
second model payload.

## Saved Cards, IDF, and Runs

A saved Card is the permanent authority for:

- stable identity and revision;
- prompt;
- provider, model, native profile, and desired native subagent model;
- runtime kind and mode;
- enabled state;
- selected skills, Hermes tools/toolsets, MCP tools, and other capability grants;
- saved topology and presentation attachments.

The sending user or Card supplies only the current task, images, and selected native references.
`materialize_idf` is the only input materializer. It writes and rereads the exact bounded input before
the runtime sees it. The Run artifact catalog retains the path, byte size, and hash. Receipts,
approval state, provider lineage, AGE observations, and runtime status remain outside `in.idf`.

Each independently invoked saved Card owns its own root Run and IDF. Native temporary children remain
inside their owning Hermes Card. A Hermes Team is one root boundary: Hermes owns decomposition,
worker prompts, retries, synthesis, and child context, so LiquidAIty does not manufacture per-worker
IDFs from native child IDs.

Card Python Scripts remain optional saved Card configuration. Python rails owns parsing, literal tool
handle validation, hashes, and the compact presentation decision. The Agent Builder renders the editor
below the Card's Tools selection; TypeScript only transports the draft and live palette. The removed ACP
plugin/callback was not a valid reason to delete Script authoring, persistence, compilation, or
validation. Until a separately approved Hermes-native owner exists, a valid enabled Script reports
`card_script_native_bridge_unavailable` and the Run retains the Card's existing deliberate MCP
presentation. No alternate executor or synthetic Script result is active.

## Application routes

`apps/backend/src/routes/index.ts` mounts each domain once. Browser-facing routes use normal user
authentication. The official Python MCP host's internal Main endpoints use their process-secret or
signed runtime boundary and are mounted separately from browser authentication.

| Route family | Current responsibility |
| --- | --- |
| `/api/cards` | Card configuration, Script validation, and read-only latest/current Run projection; it does not execute a Card |
| `/api/idd` | Builder/editor-only IDD fields and deterministic live-catalog tool projections |
| `/api/main/session` | Main/direct-Card saved Run preparation, exact Hermes submission/events/Stop, conversation projection, and saved-specialist callbacks |
| `/api/agent-terminals` | Authenticated handoff to HermesLatest's existing PTY WebSocket for the exact Card session |
| `/api/hermes-profile` | Thin saved-Card profile/learning/skills/MCP read and supported-operation adapter |
| `/api/codegraph` | Authenticated interactive CodeGraph UI reads through Python rails |
| `/api/thinkgraph` and `/api/knowgraph` | Native graph projections/operations without merging authority |
| `/api/projects` | Project and deck transport |

Route names are transport addresses, not agent identities or separate runtimes. The retired generic
Card-runtime and loopback Hermes Card-tools routes remain absent.

## HermesLatest application boundary

One independently supervised `hermes serve` process starts from `scripts/start-hermes.ps1`. The
backend connects through HermesLatest's shipped JSON-RPC client. It does not launch a per-Card
process, own a session registry, kill Hermes when a client disconnects, supervise retries, or open a
second Bot/terminal execution path.

For one authorized Card turn the application performs only this translation:


```text
saved Card + Project/conversation authority
  -> Python prepares one Run and rereads one in.idf
  -> backend applies Card-owned profile fields through profiles.describe/configure
  -> backend resolves or creates the exact profile-scoped Hermes session
  -> prompt.submit carries one opaque submission ID and exact Dynamic Tools
  -> Hermes owns queueing, inference, tools, Bot delivery, retries, and completion
  -> backend projects real events and settles the exact durable Run through Python
```

Project-specific orange/blue topology is resolved for the session or Magnetic invocation and is not
written into the reusable profile. Bot Mode remains an internal Hermes capability, not a product
catalog tool. The terminal route returns Hermes' PTY WebSocket; React only renders xterm and forwards
bytes/resize messages. A transport disconnect clears the application client reference but does not
stop Hermes or manufacture a Run result.

## MCP and Codebase Memory

`apps/python-models/app/mcp_host.py` is the one official MCP host. It derives one authenticated MCP
projection from the canonical definitions, preserves provider-owned tool schemas, and dispatches to the existing Python owners. External
account access uses the configured OAuth resource boundary. Internal Hermes Card tools use the same
protocol-neutral Python operation definitions through the Hermes Dynamic Tools callback and do not depend on IDD.
Catalog/readback tests and loaded internal-tool execution are proven separately from external-client live
acceptance.

Codebase Memory is a native MCP dependency of that host. Canonical startup resolves the current official
`codebase-memory-mcp` command from the machine's normal installed PATH; the repository does not retain a
versioned copy or checksum pin. LiquidAIty owns one long-lived application stdio frontend. Codex Desktop may own one separate
frontend through its official direct registration, independent of LiquidAIty and GPT/plugin availability. Both
join the same upstream per-account daemon/cache/runtime identity outside the repository. Docker, Hermes, Cards,
plugins, and connectors do not launch another frontend. The upstream watcher owns ordinary freshness;
indexing/deletion are explicit application-MCP administrative operations.

CodeGraph reads use granted `cbm.*` MCP tools and bounded CBM references selected into the canonical
IDF. There is no separate browser CodeGraph route or catalog. Builder and other authorized Cards call
the official CBM provider through the application MCP host; saved Card grants remain the ceiling.

The canonical project is `C-Projects-LiquidAIty-main` at `C:/Projects/LiquidAIty/main`.

## Graph authorities and native observations

```text
ThinkGraph = Engraphis project reasoning and operational knowledge
KnowGraph  = Graphiti/Neo4j sourced knowledge and provenance
CodeGraph  = native CBM repository structure
AgentGraph = AGE Card topology and truthful execution observations
```

Each graph has one authority and one writer. Run-scoped Context Selections may carry bounded native
IDs, data, and provenance together in `in.idf`; that transport is not another graph and does not copy
ownership. Main retains explicit ThinkGraph writes and deliberate delegation. It also submits an exact
completed User/Main pair to the approved Engraphis-native lifecycle only after the visible Main turn and
conversation persistence complete:

```text
non-persisting completed-pair preparation
  existing authoritative Think -> duplicate noop -> stop
  new pair
    -> exact saved ThinkGraph Card through the normal saved-Card/App Server Run path
    -> Engraphis llm_structured: exactly one episodic Think + canonical entities/concepts
       + free-form directed relationship proposals
    -> freeze the turn-start latest-prior-Think snapshot for existing endpoints
    -> bounded graph-aware Jev classification of every proposed durable edge
    -> append exactly one native EPISODIC Memory with validated structured_extraction.think
       and resolve_conflicts=False
    -> native direct structured_extractor incidence for accepted/reused canonical entities
    -> accepted native endpoints plus Jev winner/distribution/strength edges only
    -> event-driven settled projection refresh
```

Engraphis owns canonical identity, memory/entity incidence, bi-temporal fields, native evidence, graph scene
projection, and its existing force/galaxy vocabulary. One portable ThinkGraph unit is a **Think**: exactly one
completed User/Main pair stored as one native append-only `EPISODIC` Memory whose semantic authority is
`structured_extraction.think`. Native code owns entry time and saved-Card/run provenance. A canonical entity's
Latest Think and Earlier Thinks are resolved only through direct `memory_entities` incidence with
`source_kind="structured_extractor"` plus a validated Think payload, newest-first by native Engraphis time.
The Card's free-form relationship remains structured context, while Jev independently chooses the canonical
edge winner, full distribution, and relationship strength. Thinks are excluded from Engraphis semantic
distillation, retention archival, and profile consolidation. The old automatic proxy/replay and regex-first
paths remain removed; there is no candidate system, approval state, shadow graph, second extractor, direct
model edge writer, or whole-graph reclassification loop. This lifecycle does not write KnowGraph.

Visual activity may be driven only by real reads, selections, deliveries, traversals, writes, Run
completion, or failure. There is no native-attention compatibility graph or generic tool-event
normalizer. AGE may store stable Run/reference/artifact identities, but it does not authorize a
runtime, hold raw IDFs, choose a Card, or control Hermes lifecycle.

## UI and Builder

React/TypeScript renders Main Chat, Agent Canvas, graph views, Card/Run inspection, and Builder's lower
terminal. It may validate structured transport and render status. It may not interpret task meaning,
rank or route agents, merge graph semantics, infer knowledge access from prose, or fabricate native
activity.

Builder is the saved Card with stable ID/profile `builder`; Agent Builder is the workspace that edits
Cards and shows Builder's terminal. Creation, configuration, and invocation remain separate explicit
operations. Builder receives an ordinary mission and uses only its saved grants. There is no hidden
create/edit mode, PLAN loader, semantic TypeScript router, or alternate prompt envelope.

## Persistence and identity

- PostgreSQL stores saved Cards, decks, revisions, Runs, conversations, and artifact metadata.
- AGE/PostgreSQL stores accepted Card relationships and execution observations.
- Hermes profile homes store native configuration, sessions, memory, skills, and Kanban state.
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
5. a real saved Card input and native output through Gateway/TUI;
6. external connector acceptance;
7. Jeremiah's visual acceptance.

A lower tier never proves a higher one.

## Controlled imported and vendored roots

`HermesLatest/`, `EngraphisLatest/`, `worldsignal/`, `Kronos-main/`, and other imported systems are controlled
upstream forks or first-party runtime source, not general cleanup targets. Prefer a public API,
protocol, configuration, hook, or existing adapter boundary. A justified vendor edit must record its
exact files/symbols, preserved upstream behavior, tests, fork cost, and rollback.

For Hermes, the retained local extensions are recorded in
`HermesLatest/LIQUIDAITY_PATCHES.md`. Direct-agent delivery remains Hermes-owned. Saved orange
topology is supplied only to the addressed Project session as its Bot roster; the reusable profile is
not rewritten with Project topology, and the application does not resolve, retry, or select an
individual `message_agent` destination. Magnetic changes only assignment authority inside one
explicitly bounded creator tree and leaves ordinary tasks unrestricted. Upstream ACP is not a
LiquidAIty execution boundary. No other Hermes customization is accepted by this document.

| Upstream/version | Local file and symbols | Purpose and preserved behavior | Proof, fork cost, rollback/removability |
| --- | --- | --- | --- |
| `NousResearch/hermes-agent` `0.21.5`, tag `v2026.9.24`, source commit `f97608f178d1ffeca59860195ab7da295f7c8e5f` | The six bounded families inventoried by file and symbol in `HermesLatest/LIQUIDAITY_PATCHES.md` | Experimental Codex App Server Dynamic Tools, session-scoped Bot roster enforcement, exact-submission correlation, Card-owned profile fields and profile-scoped learning selection, AutoTeam/Team TaskGraph, and Magnetic assignment ceiling/lineage. Hermes retains execution, session, Bot delivery, learning, queue, task-ledger, and PTY ownership. | The overlay register records focused tests, mechanical compatibility decisions, exclusions, apply-check procedure, update cost, and rollback. Application residue checks prohibit the old target opener, process/session owners, IDD tool authority, and alternate Codex App Server paths. |

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
| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `worldsignal/gods-eye-view-main/src/app/{application,viewer,viewport,directApplication,mount,directBridge}.js`; `src/runtimeUrl.js`; `src/voice/{gevRealtime,realtimeProtocol,realtimeViewport}.js`; `src/data/contextStore.js`; `client/src/components/worldsignal/{loadWorldViewNative,GodsEyeSurface}.tsx`; `client/vite.config.ts` | **UPSTREAM CURRENT:** retain the modular application lifecycle, Cesium viewer, complete visual/control surface, live data managers, scene context, selected-entity context, Realtime action runner, and image grounding. **LOCAL KEPT:** retain the supervised camera-stability rules, WorldView presentation wording, Project source readback, selection projection, and credits. **MERGED:** both standalone and LiquidAIty use the same lifecycle and full controller graph. **LIQUIDAITY-SPECIFIC:** React supplies one caller-owned pane, scoped CSS/container sizing, same-origin provider transport, direct callbacks, and serialized teardown/remount. The removed iframe/postMessage bridge is not a fallback. Realtime image grounding accepts only the Cesium canvas contained by the currently mounted WorldView root, records root/canvas/image bounds, and invalidates retained images on stop or unmount. Under the shared hybrid Main layout, capture intersects that stable canvas with the actual exposed companion viewport and crops the source pixels to those visible bounds; it never captures the covered portion or the LiquidAIty page. | Focused vendor tests cover URL scoping, annotations, context reset, Realtime protocol, pane-bounded and exposed-pane-cropped capture, retained-image deletion, and teardown invalidation; focused React tests cover one mount, direct commands, callbacks, and cleanup; vendor/client production builds cover both bundles. A visible Trading Project Preview proved one iframe-free 795×720 mount/canvas inside a 1280×720 page, current satellite/mission feeds, a completed camera reset, a real Launch Library selection with source metadata, and complete removal followed by one clean remount with idle voice and no selected mission. Live AI question/answer acceptance remains blocked honestly because the supervised provider has no configured `OPENAI_API_KEY`; the port is not declared parity-complete until those turns and the resulting viewport-capture diagnostics run. Fork cost is the bounded lifecycle/root/capture seam plus focused tests. Roll back this row's files together; no graph, Project, Card, user, or source data is migrated. |
| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `worldsignal/gods-eye-view-main/src/app/directBridge.js::setLayerVisibility,executeAction`; `src/data/manager.js::isExplicitLayerIntentOrigin`; `src/voice/gevActions.js::set_layer_visibility` | Carry an internal `restore` origin through the existing God’s Eye layer manager and a distinct `worldview_card` origin through its existing action runner. This preserves the one God’s Eye Data Layers control, source lifecycle, provider readback, and standalone voice behavior; it does not create a second layer switch or runtime. | Focused `directBridge.test.mjs` and `gevActions.test.mjs` pass. Fork cost is three origin handoffs at existing interfaces. Roll back these hunks with the Project-origin integration if that seam is retired; no saved source or scene data is rewritten. |
| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `worldsignal/gods-eye-view-main/src/app/mount.js::attachInspectorControls,selectInspectorTab`; `src/ui.js::StyleManager` panel-layout guards; `client/src/features/worldview/{WorldViewSurface.tsx,worldviewInspector.css}` | In the supervised presentation only, move the original God’s Eye control elements (not copies or replacement switches) into tabs inside LiquidAIty's existing right-edge Inspector. The vendor's standalone layout, control handlers, layer manager, presets, cameras, scenes, context, cockpit behavior, and globe remain owned by their existing code. The mounted control bridge is needed because the existing action API cannot relocate already-bound DOM controls without cloning them. Teardown restores each element to its original anchor before the viewer is destroyed. | Focused React bridge/Inspector tests and vendor panel/Cockpit/Context tests pass; client typecheck and production build pass. Loaded visual/control acceptance remains for owner inspection in Preview. Fork cost is one reversible mount-time DOM placement seam and two panel-layout guards. Roll back those hunks with the Inspector adapter; no Project, Card, graph, source, or scene data is migrated. |

| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `worldsignal/gods-eye-view-main/src/data/satellites.js::setParams,setLabelFocus,getLabelFocus,_syncFocusOverlay,getDetectableObjects`; `src/data/detection.js::_drawOverlay`; `src/data/layerState.js` satellite option; `src/ui.js` Labels control; `src/voice/gevActions.js::focus_satellites`; `src/app/directBridge.js` satellite params/action projection | Focus-only satellite names by default, with explicit All restored through the existing layer-state coordinator. A transient exact-NORAD set of at most 50 renderable objects uses the existing overlay host and action runner; replacement/clear removes only its names, and tracked/selected readouts retain ownership. The public layer-param and action interfaces are the integration seams; ambient label gating and ISS suppression require this small native fork change. Satellite points/brackets, catalogs, TLE/SGP4 positions, orbit paths, native selection/tracking, Space Missions, providers, Earth and camera behavior are preserved. Backend/Python transport retains saved Card/Run authentication and the Project source OFF guard; there is no new renderer, agent or research store. | Focused native label lifecycle, saved-mode roundtrip, DENSE/detection, action/bridge and backend/Python contract tests cover immediate suppression, replacement/clear, disabled-source refusal and atomic invalid-focus preservation. Client/vendor builds and loaded control/action proof are separate from owner visual acceptance. Fork cost is one additive enum, one bounded transient label source and gates at existing label/action seams. Roll back only these label-policy hunks and their transport/schema counterparts together; no saved data migration or reset is required. |

| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `worldsignal/gods-eye-view-main/src/data/satellites.js::_handleSatelliteClick,_installClickHandler`; `src/data/satellitesClickSelection.test.mjs` | When the current tracked marker is the top Cesium pick, use native `drillPick` to inspect the first distinct hit instead of ignoring a different satellite underneath it. Ordinary frontmost picking, sibling-layer ownership, current-only no-op, empty-click clear, tracking, labels, catalogs, orbital propagation and rendering stay on their existing paths. No public adapter can resolve this native click-handler early return. | The production callback regression covers ordinary and occluded A-to-B switching plus current-only, sibling and empty-click behavior. A mounted WorldView second click changed tracking from NORAD 45358 to 28474 and showed the new native readout. Fork cost is one conditional deeper pick and a test seam; remove these hunks when upstream supplies equivalent click resolution. No saved data or runtime configuration is migrated. |
| `bilawalsidhu/gods-eye-view` package `0.1.1` at `81eb44340d90feda5b5283438f6e5fdad5cabbdd` | `worldsignal/gods-eye-view-main/src/data/traffic.js::disable,destroy`; `src/data/trafficTiming.test.mjs` | Make traffic teardown idempotent when serialized React/native remount cleanup reaches an already-removed point collection. The existing application lifecycle and DataLayerManager remain the owners; the guard creates no second teardown path, viewer, layer state, or fallback. | A loaded WorldView remount reproduced the null point-collection write through the real DataLayerManager teardown. The focused native test destroys traffic twice after initialization and requires no error while retaining the traffic timing invariants. Fork cost is one null guard plus the regression assertion. Roll back both together when upstream teardown becomes idempotent; no saved Project, camera, layer, graph, or source state is migrated. |

The installed Engraphis runtime and the separately retained browser-renderer fork have these bounded local divergences:

| Upstream/version | Local file and symbols | Purpose and preserved behavior | Proof, fork cost, rollback |
| --- | --- | --- | --- |
| `Coding-Dev-Tools/engraphis` `1.7.9` from upstream `main` at `619f49860f293ab1826aaf4e11a158bc22f03fcf` | `EngraphisLatest/pyproject.toml`, `requirements.txt`; `engraphis/mcp_server.py::{classic_mcp,smart_mcp,_safe_run_stdio_async}`; `engraphis/{mcp_http_cli,dashboard_app}.py`; `integrations/prime_agent/src/engraphis_prime_agent/mcp_client.py`; corresponding MCP/HTTP/package/Prime tests | Port only Engraphis's MCP binding and bundled client from SDK v1 `FastMCP`/`ClientSession` to official SDK v2 `MCPServer`/`Client(mode="auto")`. Preserve all 39 Classic compatibility handlers, the Smart 9 handlers, memory/Think semantics, schemas, storage, consent, authentication, stdio wire isolation, and HTTP DNS-rebinding protection. LiquidAIty publishes only the Smart 9; advanced Classic actions remain reachable only through Engraphis's own discover/execute gateway. | Upstream MCP, HTTP, consent, dispatch, packaging, contract, annotation, and Prime client tests pass; direct disposable modern (`2026-07-28`) and legacy (`2025-11-25`) clients list the same Smart 9 and complete remember/recall/get/update/discovery/read/conflict/session flows. Fork cost is one mechanical SDK-major port. Remove this row and return `apps/python-models/requirements.txt` to upstream Engraphis when upstream ships the equivalent v2 port; no memory database or saved Card migration is required. |
| Browser renderer fork originally copied from Engraphis 1.7.1 `dashboard_assets/engraphis-graph.js` | `client/src/vendor/engraphis/engraphis-graph.js`: `semanticRelationshipStrength`, `semanticRelationshipWidth`, `semanticRelationshipDistance`, `semanticRelationshipSpring`, `turnHeatIntensity`, `preserveRefreshPosition`, `solarpunkMaterialRecipe`, `paintSolarpunkMaterial`, `materialCacheKey`, `handleNodeClick`, and the existing force/paint/`setData` call sites | Render Jev relationship strength through native edge width/spring/distance, preserve mature coordinates/camera across authoritative revisions, paint transient current-turn heat, and opt explicitly annotated render nodes into one cached Solarpunk material seam: blue-dominant Think with a soft green material accent, orange-dominant Know with a soft yellow material accent, or a unified dark paired surface with separate blue and orange authority treatment. Lavender marks recent turn activity; neutral cyan-white remains available for selection/Focus emphasis, and the opposite authority hue never decorates a single-authority node. Node-provided authority colors and active state key the cache without changing modality. When an embed supplies `onNodeDoubleClick`, the renderer resolves the click pair before either callback so a single-click inspector cannot move or cover the second hit; embeds without that option retain immediate upstream click behavior. Existing public style names, presets, palettes, shared node geometry, graph scene, inspectors, Galaxy black-hole authority/physics, controls, focus behavior, and layout engine remain authoritative. No second style, layout, or graph is introduced. | `ThinkGraphSemanticPhysics.spec.ts` exercises the real renderer internals for all three canonical-color modalities, single-authority secondary accents, lavender turn activity, unified paired material, and active exposure/cache identity; focused renderer and graph-state tests plus client production typecheck cover the retained seams. Sync cost is a small call-site rebase when deliberately adopting a later renderer asset. Rollback removes these helpers/call-site mappings and restores the upstream width/force/refresh behavior without changing graph data. |

## Current proof limits

- Source, focused tests, typechecks, a loaded service, a real saved-Card turn, an external MCP call,
  and owner visual acceptance remain separate proof tiers.
- The MCP v2, Engraphis Smart surface, Graphiti, Card-grant, Hermes Dynamic Tool, Gateway, profile,
  and completed-pair changes require one coordinated loaded-stack acceptance after all static gates
  pass. A recent `dev:fresh` compiled and launched local services, but MCP readiness stayed `503`
  when the application CBM dependency was unavailable and the public tunnel remained unpublished;
  that process is not external-client acceptance.
- Team and Magnetic preparation must resolve through HermesLatest. Team execution and an actual Mag One
  mission remain separate user-authorized acceptance; this repair does not launch a Magnetic mission.
- Actual child provider/model, Bot delivery, graph attention, external-provider calls, terminal attachment,
  and exact Run/Stop correlation require their own observed receipts. Saved or projected configuration is
  not execution proof.
- Voice is outside the current acceptance pass and remains standard Hermes behavior. WorldView, trading,
  and broader graph semantics retain their existing independent acceptance boundaries.
