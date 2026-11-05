# LiquidAIty current plan

[Plugin contract](plugin.md) · [CodeGraph contract](CODEGRAPH.md) · [Execution law](AGENTS.md) · [Rejected paths](DONT.md) ·
[Current architecture](ARCHITECTURE.md) · [Deferred work](FUTURE.md)

This file records the current source state, remaining proof, and the order of work. It is not runtime
input, a task ledger, or permission to revive a removed layer. plugin.md owns the Hermes integration
contract.

## Goal

Ship LiquidAIty as a distinctive Hermes web-dashboard UI plugin with one runtime owner:

- Hermes owns chat, sessions, history, delivery, reply identity, Bot Mode, profiles, skills, tools,
  memory-provider loading, task execution, PTY, telemetry, and cancellation.
- LiquidAIty owns its product pixels, saved Card revisions, Project wire topology, application MCP
  operations, and graph views.
- Engraphis, Graphiti, CBM, AGE, and Holographic retain separate authority.
- No application-owned transport, Gateway manager, copied task runtime, IDF pipeline, or hidden
  fallback survives.

## Current source truth

### Plugin and UI host

The first-party plugin is `apps/hermes-liquidaity-plugin`. Its native entry is
`plugin.yaml` plus `register(ctx)`. Its web entry is `dashboard/manifest.json` plus the
prebuilt dashboard bundle and authenticated plugin API.

The dashboard bootstrap uses Hermes's injected React and plugin registry. LiquidAIty's existing
Agent Builder workspace renders directly as the plugin page—no Electron, iframe, second React host, or
replacement stock UI.

The browser obtains profile-scoped authenticated WebSocket URLs from the dashboard SDK. It imports
Hermes's generated Gateway contract/client and maps public events into existing LiquidAIty components.

### Main, history, Stop, voice, images, and activity

Main uses the canonical Hermes Bot Chat and the generated Gateway client. Hermes owns session
creation/resume/history, prompt submit, streaming, approvals, clarification, Stop, reconnect/replay,
image delivery, and author identity. LiquidAIty has no Main session route, backend Bot requester,
second decoder, transcript poller, or reply waiter.

Voice remains a LiquidAIty control surface over Hermes-owned chat delivery. The UI never treats local
speech state as a second session authority.

Card glow, live model count, token totals, and average latency read actual Hermes session/subagent/usage
state. Missing Hermes data renders unavailable; it is never guessed.

Hermes currently exposes the canonical `Bot Chat` by stable profile, not by LiquidAIty Project. The
generated client exposes no Project/session metadata key. Source therefore claims one retained Trading
development Project, not concurrent multi-Project Main-history isolation. No profile cloning, session map,
history filter, or replacement transport is permitted to conceal this exact upstream capability gap.

### Saved Cards and profiles

Each saved Card maps to one stable Hermes profile. Card Save persists the Product revision, creates the
profile through the public API when missing, configures it, and verifies readback.

The profile projection includes provider/model, compiled SOUL, one selected custom or Hermes skill,
toolsets, exact MCP includes, Holographic policy, exact Bot roster, useful categorized description,
optional Card Python, and Team/Magnetic task mode.

New Projects retain six core Cards: Main, Builder, ThinkGraph, Magnetic, Team, and KnowGraph. Persisted
Project Cards remain authority; source defaults do not overwrite an existing Project.

### Roles and wires

Every valid enabled wire provides direct native Bot reachability:

- orange `flow`: ordinary Bot relationship;
- blue `magentic_option`: the same direct relationship plus Magnetic worker membership.

Main is the fast boss and source-default orchestrator. It delegates, reviews, and answers; it never
builds. Builder builds and never runs. Main tests a saved Card through `message_agent`.

Builder's mutation tools enforce a narrow boundary in Python: create new non-core blue worker
candidates, edit existing non-core blue workers, and maintain their blue Magnetic wires. Core Cards,
orange system topology, and unrelated unwired Cards are protected.

Profile descriptions publish each connected Card's category plus exact `[ORCHESTRATOR SKILL]`
introduction so Main can distinguish specialists, memory/research helpers, Team, and Magnetic without
copying their full prompts.

### Team and Magnetic taskgraphs

The plugin's `taskgraph_start` tool admits one current Bot assignment into Hermes's existing SQLite
task/dependency runtime.

- Team is a protected wildcard. Main may call it directly when no saved specialist matches. Its root
  auto-decomposes into same-profile depth-one workers and returns to the same root for synthesis.
- Magnetic receives an exact Builder-authored PromptSpec from Main. Its root is restricted to the exact
  saved blue roster. Dependencies block the same root until worker work is ready, then that root
  synthesizes.
- Magnetic may assign a blue child to Team. Team then owns its own AutoTeam boundary.
- Ordinary direct specialists remain ordinary Bot Mode.

Hermes owns tasks, dependencies, attempts, workers, retries, dispatch, and synthesis. LiquidAIty has no
task copy, scheduler, board, worker selector, or dispatcher. The Task tab reads Hermes's bundled
authenticated Kanban board/task APIs and reconstructs only the exact root creator lineage.

The plugin admits through documented `ctx.dispatch_tool("kanban_create", ...)`. The retained Hermes
0.22.7 fork contains the smallest policy delta needed because upstream `kanban_create` has no structural
Team/Magnetic root or mission-scoped assignee ceiling. Ordinary Kanban and Bot Mode behavior are
regression-tested.

### Card Python and skills

The on-Card Python editor is preserved. A checkbox controls publication. Disabled or blank code is
inert. Enabled recipes are immutable, schema-bound, time/output/call bounded, and may call only the
Card's selected LiquidAIty MCP operations through Hermes's plugin context.

Each runnable Card has one selected skill. A user may edit the Card's custom skill or choose an
existing Hermes skill. There is no second LiquidAIty skill library or automatic skill-learning UI.

### Tool grants

Source-default grants are:

- Main: Engraphis recall plus Graphiti node/fact search and its retained worldview capability.
- Builder: Engraphis and Graphiti search, bounded CBM reads, explicit Card create/update, canvas
  inspection, and blue-wire editing, plus its saved construction toolsets.
- ThinkGraph: Engraphis hybrid vector/lexical reads and Think settlement operations.
- KnowGraph: Graphiti search/write and Hermes Web pinned to Firecrawl.
- Team: its saved research/execution surface plus the LiquidAIty plugin toolset.
- Magnetic: the LiquidAIty plugin toolset for taskgraph admission.

Saved Project configuration remains the runtime ceiling. The MCP host publishes one canonical catalog.
Catalog version includes the root package version and source-manifest hash.

### Shared graph navigation map

The graph surface publishes one compact in-memory JSON snapshot matching the visible Think/Know/Code
layers. It contains bounded nodes, relationships, provider pointers, and at most one open-node detail
record.

The plugin validates and pre-renders the snapshot. Main, Builder, ThinkGraph, and KnowGraph receive an
atomic pre-LLM string read. Main Send waits for synchronization and fails closed if the model would see
a different map from the user. Reconnect republishes.

The map is navigation context, not another graph. Engraphis, Graphiti, and CBM remain the deep-read
tools and writers.

### ThinkGraph completed-turn intake

Hermes's `on_session_end` plugin hook observes a successful Main turn. The hook captures the exact
profile/session context, then the Hermes plugin host uses `ctx.spawn_task` plus `asyncio.to_thread`;
Main returns without waiting. Main does not supervise, invoke, steer, approve, or settle the work.

The hook captures the exact User/Main `state.db` row IDs at the completed-turn boundary. Python rails
reads only those rows and prepares deterministic extraction input. Hermes's registered ThinkGraph
auxiliary model returns structured candidates. Engraphis records the pair outcome and writes zero or
more Thinks. There is no minimum count and no Python semantic validator.

The deleted TypeScript conversation store is not replaced. There is no history polling, caller-supplied
chat copy, Main route coupling, or duplicated transcript owner.

### Memory

Every retained Card profile selects Holographic. Built-in Markdown memory, user-profile Markdown,
background review, curator work, and automatic skill creation are disabled. ThinkGraph and KnowGraph
remain Project authorities rather than Hermes profile memory.

### Removed paths

The following are deleted and must stay deleted:

- `/api/main/session`, `mainSessionClient`, `useAgentBuilderMainChat`, backend Gateway Bot
  requester, custom SSE decoder, transcript/history state machine;
- application PTY/TUI spawn and WebSocket proxy;
- private Desktop profile bridge and LiquidAIty Learning Graph editor;
- TypeScript conversation copy/store;
- IDF, Data Anchor, Card invocation preparation, automatic model/tool selection, and Jev prefilter;
- duplicate profile policy and stale MCP metadata;
- non-Trading experimental Project copies. The retained `agent-products/nrgsim` source is reference
  material for later work, not a second active development Project.

`LiquidAIty.idd` remains the Card authoring dictionary only.

## Verification completed in this source turn

The proof ledger remains tiered:

- Complete active TypeScript suite: 522 passed; one explicitly skipped test remains skipped.
- Complete first-party Python-model suite: 434 passed with one upstream Graphiti Pydantic deprecation warning.
- Complete KnowGraph service suite: 31 passed with the same upstream warning class.
- Focused Hermes `kanban_tools` plus Team/Magnetic suite: 76 passed.
- LiquidAIty native-plugin suite: 10 passed.
- Production and specification TypeScript checks: passed.
- Backend, normal browser UI, and Hermes dashboard-plugin production builds: passed. The two existing
  browser-externalized `node:fs` notices and large lazy WorldView/Monaco chunks remain packaging warnings.
- Hermes Plugin Doctor passed discovery, manifest parsing, import, registration, two tools, and two hooks.
- The exact catalog-admission checks over native/general plugin source passed with safe security verdict,
  host-ready isolation, no tool collisions, no core overrides, and no private-import warnings.
- Forbidden-residue scans, the 340-file first-party Entity/Relationship structural audit,
  `git diff --check`, and six parent-to-commit delivery comparisons completed.
- No loaded runtime, live provider prompt, persistence readback, remote connector refresh, or visual
  acceptance is inferred from those results.

## Remaining packaging review

The final dashboard bundle deliberately still contains the retained lazy WorldView/Cesium,
NRGSIM/Monaco, graph, and domain-product assets: 455 scannable files, about 30.5 MB, with six files over
the catalog scanner's generic 1 MB caution threshold. Hermes's complete package security scan is
CPU-active for more than ten minutes on those generated single-line chunks and has not produced a final
catalog verdict in a bounded run. The native/general source result above is clean; it is not represented as
the final generated-bundle verdict.

Post-v0.1 packaging should move substantial domain agents/products into independently versioned and
scanned repositories/plugins as defined in CODEGRAPH.md. Do not remove retained UI or fabricate a
core-only distributable merely to make this generic threshold disappear.

## Later acceptance, not authorized in this run

A separately authorized loaded pass must establish:

- Hermes discovers and reloads the native/dashboard plugin;
- each saved Card profile creates/configures and reads back correctly;
- Main send/history/Stop/voice/images work through Hermes in the loaded UI;
- direct specialist, Team, and Magnetic behavior use the intended native paths;
- Holographic persistence and graph pointer navigation work with real providers;
- the refreshed MCP catalog is visible to local and remote clients; and
- Jeremiah accepts the rendered product.

This source task performs no restart, live prompt, data migration, external connector change, or Git
mutation.
