# LiquidAIty Hermes web-plugin contract

This is the canonical positive design for LiquidAIty's Hermes integration. Read it before
AGENTS.md, PLAN.md, or ARCHITECTURE.md when the question is who owns chat, profiles, tools,
taskgraphs, memory, or the browser host. DONT.md records rejected paths; this file defines the
allowed path.

## Product identity

LiquidAIty is a new Hermes UI with its own React experience. It is delivered as a Hermes
web-dashboard plugin so it can use Hermes's supported browser host, authentication, profiles,
sessions, Bot Mode, tools, task runtime, and telemetry without rebuilding them.

LiquidAIty is not a Desktop/Electron plugin, iframe, second Gateway, second agent runtime, second
session service, copied transcript store, parallel scheduler, or replacement memory provider. The
distinctive LiquidAIty Cards, wires, Main composer, voice controls, images, graph canvases,
inspectors, Builder surface, Trading deck, and other product pixels remain.

## What the dashboard SDK global means

`window.__HERMES_PLUGIN_SDK__` is a browser object injected by the Hermes web dashboard into
loaded dashboard plugins. It is not Electron, a Desktop bridge, a hidden agent runtime, or a
replacement UI. It provides the host's React instance and authenticated browser helpers such as
`buildWsUrl`, `fetchJSON`, and `authedFetch`.

LiquidAIty uses the host React instance, registers one page with
`window.__HERMES_PLUGINS__`, and lazy-loads its existing React workspace. LiquidAIty continues
to own every component rendered inside that page.

The phrase “Hermes generated UI client” means generated TypeScript protocol middleware used by a
UI. It does not mean Hermes-generated pixels:

- `gateway-contract.generated.ts` defines typed JSON-RPC methods and events.
- `json-rpc-channel.ts` owns request correlation and server requests.
- `json-rpc-gateway.ts` owns the typed connection and event fan-out.
- `gateway-events.ts` owns the event vocabulary.
- `websocket-url.ts` owns public WebSocket URL mechanics.

LiquidAIty maps those public types and events into its components. It does not recreate the decoder,
heartbeat, correlation, replay cursor, reconnect state machine, or server-request handling.

## Public entry points

```text
apps/hermes-liquidaity-plugin/
├── plugin.yaml
├── __init__.py
├── card_script_runtime.py
├── navigation_map.py
├── taskgraph_runtime.py
├── dashboard/
│   ├── manifest.json
│   ├── plugin_api.py
│   └── dist/                    generated dashboard bundle
└── tests/test_plugin.py
```

Hermes discovers two related public surfaces:

1. The native directory plugin: `plugin.yaml` plus `__init__.py::register(ctx)`.
2. The web-dashboard extension: `dashboard/manifest.json`, the prebuilt bootstrap, scoped
   stylesheet, and authenticated `dashboard/plugin_api.py` router.

The dashboard uses only the documented SDK global. The native plugin registers only its declared
hooks, auxiliary work, and tools. Neither surface imports Hermes Desktop.

## One owner per concern

| Concern | Authoritative owner | LiquidAIty responsibility |
| --- | --- | --- |
| Product pixels | LiquidAIty React | Render Cards, chat, graphs, inspectors, images, voice, and workbenches. |
| Dashboard host and browser authentication | Hermes dashboard | Load the plugin and supply host React plus authenticated HTTP/WebSocket helpers. |
| Sessions, history, streaming, Stop, approvals, reconnect, reply identity | Hermes Gateway | Call the generated client and render reported state. |
| Profiles, models, tools, MCP, skills, memory provider, Bot roster | Hermes profiles | Project one saved Card into one stable profile and verify readback. |
| Card revisions, Project topology, wire meaning | LiquidAIty database and AGE | Persist product configuration and publish matching profile fields. |
| Direct agent messaging | Hermes Bot Mode and `message_agent` | Supply the exact saved wired roster and useful profile descriptions. |
| Team and Magnetic execution | Hermes SQLite task/dependency runtime | Admit one root; never copy tasks or schedule workers. |
| Application operations | LiquidAIty MCP host | Publish one catalog and enforce saved per-profile grants. |
| Per-profile memory | Holographic | Select/configure the provider; do not copy it. |
| Project reasoning | Engraphis / ThinkGraph | Keep its existing MCP authority and writer. |
| Sourced knowledge | Graphiti / KnowGraph | Keep its existing MCP authority and provenance. |
| Repository structure | Codebase Memory / CodeGraph | Expose bounded saved grants, especially to Builder. |
| Topology and execution observations | AGE / AgentGraph | Observe; never control Hermes execution. |

## Main chat and runtime transport

```text
LiquidAIty Main pixels
  -> dashboard SDK buildWsUrl('/api/ws', { profile: 'main' })
  -> Hermes JsonRpcGatewayClient
  -> canonical Main Bot Chat
  -> Hermes session and prompt methods
  -> Hermes events
  -> LiquidAIty message/tool/approval/voice/image/activity pixels
```

Hermes owns session creation/resume/history, prompt submission, streaming, Stop, approvals,
clarification, images, late events, and author identity. The browser sends literal user input. No
LiquidAIty route opens a session, calls a Bot, waits for a reply, polls history, decodes a second wire
format, or persists a copied transcript.

Main may finish before another Bot. A later reply stays a Hermes event/history item with the sender
Hermes reports. The UI never infers the sender from a mention, wire, title, or prose.

The lower CLI uses Hermes dashboard `/api/pty` through an SDK-authenticated WebSocket URL.
LiquidAIty does not spawn `hermes --tui`, proxy PTY bytes, manage a process, or own terminal lifetime.

Runtime glow, model count, token totals, and latency come from Hermes
`session.active_list`, `subagent.roster`, `session.usage`, and corresponding events.
Planned workers and prompt mentions never count as running.

### Exact public gap: Project-scoped Main history

Hermes's public Bot Mode contract resolves the canonical `Bot Chat` by stable profile. The generated
Gateway client does not expose a LiquidAIty Project key or Project-scoped Bot-session metadata. Reusing
one stable Main profile across concurrently active Projects therefore does not prove isolated chat history.

The v0.1 source and acceptance claim only the retained Trading development Project. LiquidAIty does not
fill this gap with profile clones, a session map, transcript filtering, copied history, or another route.
Multi-Project Main-history isolation requires a documented Hermes capability or separate upstream proof.
The navigation cache is likewise profile-bound and must not be represented as concurrent multi-Project
isolation.

## Saved Cards and profiles

One saved Card maps to one stable Hermes profile. Saving first persists the Product revision. The UI
then uses public `profiles.create`, `profiles.describe`, and `profiles.configure` calls and
verifies the resulting profile.

Workspace open/reopen only loads saved state. It must not republish profiles or rosters, issue/refresh
credentials, enable plugins, or force MCP reloads. A successful saved wire edit publishes only rosters
whose membership changed, including an empty roster. Card movement and unrelated deck revisions do not
reconfigure agents. The rejected implementation and deletion are recorded in
[DONT.md](DONT.md#incident-record--2026-11-07-rejected-workspace-open-synchronization-and-provisioning).

Published profile configuration includes the saved provider/model; SOUL compiled from prompt blocks;
selected Card/Hermes skills; selected Hermes toolsets and LiquidAIty MCP includes; Holographic policy; exact
Bot roster; Team/Magnetic task mode; optional immutable Card Python; and a deterministic description
containing the category plus exact `[ORCHESTRATOR SKILL]` introduction.

The description lets Main understand a Bot target without copying its full prompt. A Card may select
its one editable custom skill, Hermes library skills, or both. When selected, the custom skill loads
first. Hermes Skills must be enabled for its skill tools and selected auto-load behavior; the selector
does not create a second skill library. SOUL still comes from the Card's PromptBlocks.

## Wires and roles

All valid enabled wires provide native Bot reachability. A wire configures; it never delivers.

- Orange `flow` is an ordinary direct Bot relationship.
- Blue `magentic_option` supplies the same reachability and additionally enrolls that identity in
  Magnetic's exact worker ceiling.
- A wire neither makes the target an orchestrator nor grants reverse authority.
- An orchestrator receives only its own enabled wired roster.
- Main is the source-default orchestrator over the Project's enabled wired topology.

Main is the fast boss: understand, delegate, review, answer. Main never creates or edits Cards,
skills, prompts, profiles, or wires.

Builder builds and never runs. It may create non-core blue worker candidates and edit existing
non-core blue workers plus their blue Magnetic wires. Python rejects Builder mutations to Main,
Builder, ThinkGraph, KnowGraph, Team, Magnetic, orange system wiring, or unrelated unwired Cards.
Main tests saved workers through native `message_agent`.

## Direct specialist, Team, and Magnetic

Main chooses the smallest native path:

1. Direct specialist: one bounded task to one matching Card through `message_agent`.
2. Team: a bounded job with no good saved specialist goes directly to protected Team.
3. Magnetic: Builder prepares the exact PromptSpec from relevant ThinkGraph, KnowGraph, and sometimes
   CodeGraph context; Main sends it to Magnetic.

Team is a protected core blue worker and wildcard. Main may call it without Magnetic. Magnetic may
assign one bounded blue child to Team, which then owns its same-profile AutoTeam boundary.

Magnetic's blue roster is the worker ceiling. Workers may create narrowed sequential descendants
inside their own allowed profile. AutoTeam workers remain depth-one. Cross-profile nested
orchestrators are outside launch MVP.

## The narrow native tools

`taskgraph_start` admits the exact current Team or Magnetic Bot assignment into Hermes's existing
SQLite task/dependency runtime. Team creates one auto-decompose root. Magnetic creates one root whose
`allowed_assignees` are its exact blue roster. Hermes owns decomposition, task rows, dependencies,
attempts, dispatch, workers, retries, and final synthesis. The plugin calls the documented
`ctx.dispatch_tool("kanban_create", ...)` doorway; the Task tab reads Hermes's bundled authenticated
Kanban board/task APIs and reconstructs only the exact root creator lineage.

Hermes 0.23.0's public `kanban_create` contract has no structural Team/Magnetic root or mission-scoped
assignee ceiling. That exact gap is why the retained Hermes fork contains a small taskgraph policy
delta behind the existing public tool doorway and the plugin has one admission tool. The external
plugin imports no private Kanban modules. This does not authorize a second task store, board,
dispatcher, registry, or Gateway route. Focused tests cover ordinary Hermes behavior and the local delta.

`card_python` runs only an enabled, validated, profile-projected Card recipe through the plugin
host's Python executable. Disabled or blank recipes are inert. Source/compiled hashes, input/output
schemas, timeout, output bytes, call count, and saved tool scope bound execution. Nested operations use
`ctx.call_mcp('liquidaity', ...)`; a script cannot invent a grant. This explicitly retained Python
child is not an agent runtime, TUI, Gateway, or semantic router.

## Shared navigation context

The graph navigation map is one small in-process JSON snapshot of what the user can see: enabled
Think/Know/Code layers, visible nodes and relationships, provider pointers, and at most one open node
with bounded attached detail.

React publishes it through the existing Project-authorized view endpoint. `graph_context.py` reads
the already-displayed map once at turn start for Main, Builder, ThinkGraph, and KnowGraph. Only Main
receives the displayed open-node detail. Request-only selection reuses that value through the turn
and discards it at completion; it does not add it to chat text, history, or compaction.

Send makes no graph request and waits for no publication. No submission-reference capture or
bookkeeping remains. Engraphis, Graphiti, and CBM remain the deeper pointer-following tools.

## Completed Main turn to ThinkGraph

The application does not poll Hermes history or accept caller-supplied chat copies. Hermes's
`on_session_end` hook observes a successful, non-interrupted Main turn. It captures the exact Main
profile, Hermes session, and validated loopback Python-rails origin, then the Hermes plugin host
schedules blocking work with documented `ctx.spawn_task` plus `asyncio.to_thread`. Main can finish
immediately. Hermes—not Main—owns background-task supervision and unload cancellation.

At the session-end boundary the plugin captures the exact User/Main `state.db` row IDs. The task resolves
authenticated Project context through MCP; Python rails reads only those two rows and refuses an already
settled pair; the registered Hermes auxiliary ThinkGraph model performs structured extraction; Engraphis
settlement records the pair outcome and stores zero or more Thinks.
Main cannot start, stop, steer, approve, choose candidates for, or settle this work. Its completed turn
is only the observed source event.

There is no TypeScript conversation store, minimum Think count, Python semantic validator, history
poller, Main session route, or copied transcript. Python owns deterministic selection/transport, the
model extracts, and Engraphis owns settlement.

## Tool and MCP grants

### Official Hermes Bot Mode and MCP ownership

This account is pinned to the installed Hermes **0.23.0** contract, not an invented LiquidAIty runtime.
Consult the shipped source when official prose and observed tool names differ.

**Bot Mode:** a Bot is a Hermes profile with its own configuration, credentials, model, skills and
canonical Bot Chat. `message_agent` validates the destination, adds the actual sender's attribution,
and delivers to that Bot's chat. Its acknowledgement is not the answer. The recipient's final reply is
captured by Hermes and returned through the completion path; the recipient need not bounce it back with
another `message_agent`. The sender can finish its foreground turn and receive the later outcome. Keep
failures visible, avoid resending unknown deliveries, and retain `process_complete`. LiquidAIty supplies
the saved wire-derived roster; it does not replace delivery, sessions, reply identity or completion.
See the [official versioned Bot Mode guide](https://github.com/NousResearch/hermes-agent/blob/v0.23.0/website/docs/user-guide/bot-mode.md)
and local `HermesLatest/tools/bot_mode_dm.py` / `tools/bot_mode_probe.py`.

**MCP configuration and authority:** the receiving Bot's profile selects its configured `mcp_servers`,
enabled toolsets and per-server tool filters. Hermes reads the selected server's stdio or HTTP settings
and configured authentication. The server's own authorization remains authoritative; being in a Bot
roster does not grant another Card's tools. LiquidAIty's MCP host still checks the saved owner, Project,
profile and exact grants. An empty saved grant does not authorize broader access. Do not add a second
toolset alias or a client-generated credential scheme to make an unavailable tool appear available.
See the [official MCP configuration reference](https://github.com/NousResearch/hermes-agent/blob/v0.23.0/website/docs/reference/mcp-config-reference.md).

**Discovery and execution:** Hermes connects, obtains the server's tool schemas, applies exposure
filters, registers the tools and dispatches actual calls. Use the names returned by the installed
runtime rather than guessing a prefix. Server tool-list-change notifications and Hermes's own
configuration/reconnect mechanisms handle supported changes. Explicit `/reload-mcp` is a real reload,
not a cheap availability query or a workspace-open requirement. It may invalidate prompt caches.
Never call it once per Card just to load the canvas.
See the [official MCP guide](https://github.com/NousResearch/hermes-agent/blob/v0.23.0/website/docs/user-guide/features/mcp.md)
and local `HermesLatest/tools/mcp_tool_discovery.py`, `mcp_tool_agent.py`,
`mcp_tool_lifecycle.py`, and `tui_gateway/methods_tools.py`.

**Deferred tools:** when Hermes Tool Search is active, a tool may be callable without its full schema
being eagerly placed in the initial model tool array. Hermes supplies `tool_search`, `tool_describe`,
and `tool_call`; execution still reaches the real registered tool with its normal checks. A missing
eager schema is not proof of a broken MCP connection. Inspect the saved grants, actual deferred catalog,
description and call result before changing anything.
See the [official Tool Search guide](https://github.com/NousResearch/hermes-agent/blob/v0.23.0/website/docs/user-guide/features/tool-search.md).

**Authentication is not eliminated:** Hermes owns use of configured credentials and supported OAuth,
but cannot invent a proprietary server credential or keep an already-issued custom token alive beyond
its expiry. Report that exact failure and use an owner-approved supported setup. Do not restore the
deleted credential issuer, silently broaden access, or replace the real tool with a manual graph write.

The approved shape is ordinary Hermes Bot Mode plus saved wire control, using real profile-scoped MCP
tools. Application-owned startup synchronization/provisioning and forced-refresh helpers are rejected.
These paragraphs do not authorize runtime changes, installs, reloads or new transports.

### LiquidAIty tool grants

LiquidAIty publishes one MCP catalog. Hermes's native MCP client connects each profile to its exact
saved include list.

- ThinkGraph: Engraphis hybrid vector/lexical operations.
- KnowGraph: Hermes Web pinned to Firecrawl plus Graphiti search/write.
- Main: Engraphis and Graphiti search.
- Builder: Engraphis and Graphiti search, bounded CBM reads, and restricted Card/canvas construction.
- Trading and other Cards: only their saved operations.

The only native plugin tools are the Hermes-local Card Python boundary and taskgraph admission boundary.
Catalog metadata derives from current manifests and a source hash. Removed tools, IDF/Data Anchor
operations, and obsolete versions must not survive. Source, loaded local plugin, and remote ChatGPT
connector metadata are separate proof tiers.

## Memory

Every retained Card profile selects Holographic. Built-in Markdown memory, user-profile Markdown,
background review, curator behavior, and automatic skill creation are disabled for launch MVP.
Holographic's per-profile SQLite memory remains independent of Project graphs.

```text
Holographic = per-profile agent memory
Engraphis   = Project reasoning / ThinkGraph
Graphiti    = sourced knowledge / KnowGraph
CBM         = repository structure / CodeGraph
AGE         = topology and truthful execution observations
```

LiquidAIty has no Hermes Learning Graph editor. Custom Card skills are editable configuration, not
automatic learning records.

## IDD and removed layers

`LiquidAIty.idd` is the authoring dictionary for Card fields, choices, relationships, and editor
metadata. It is not runtime input, an IDF materializer, a prompt envelope, an execution receipt, or a
second catalog.

The IDF/Data Anchor/invocation-preparation/automatic-model/automatic-tool/Jev-ranking stack is removed.
Selected graph context travels through the navigation map or provider tools. Hermes profile
configuration plus literal current input are sufficient.

## Forbidden executable residue

```text
useAgentBuilderMainChat
mainSessionClient
/api/main/session
mainSession.routes
requestForBot
LiquidAIty-owned Gateway/session maps
LiquidAIty chat SSE text/done/error protocol
history watermark polling
LiquidAIty PTY/TUI spawning or proxying
private Hermes Desktop bridges
direct product reads or writes of Hermes chat state.db
IDF or Data Anchor runtime materialization
automatic model/tool/Jev invocation preparation
another task store, dispatcher, board, or worker registry
```

The generated Hermes client, dashboard SDK, native plugin hooks, official MCP client, and explicitly
recorded Hermes taskgraph fork are the allowed surfaces.

## Proof boundary

Source proof can establish structure, tests, type safety, bundle production, and residue absence. It
cannot prove that a running host reloaded the plugin, a remote ChatGPT connector refreshed its catalog,
a provider completed a prompt, Holographic persisted a fact, or Jeremiah accepted the rendered product.
Loaded, live, persistence, and visual proof remain separate and require an authorized run.

No runtime restart, live prompt, database migration, or Git mutation is implied by source work.
