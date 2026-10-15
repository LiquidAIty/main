# LiquidAIty current plan

[Overview](README.md) · [Execution law](AGENTS.md) · [Known failures](DONT.md) · [Current architecture](ARCHITECTURE.md) · [Deferred work](FUTURE.md)

This file records current status and the next approved boundary. It is not runtime input, a task
ledger, a historical report, or authority to begin deferred work.

## Product outcome

LiquidAIty's MVP is a persistent Project workbench where:

- saved Cards own durable identity, prompt, provider/model/profile, grants, and topology;
- Main is the human-facing Project conversation and bounded orchestration agent;
- ThinkGraph compounds Project reasoning in Engraphis;
- KnowGraph preserves sourced evidence and provenance in Graphiti/Neo4j;
- Builder turns Project reasoning and evidence into PromptSpecs, Cards, applications, code, artifacts,
  and executable missions;
- Magnetic executes one approved mission across an exact saved blue worker roster;
- Team provides the separate generic Hermes Team/Kanban mechanism;
- specialized domain Cards add bounded capabilities without becoming graph authorities.

One canonical `in.idf` carries the exact saved Card revision, current dynamic input, selected provider
references/data, images, and effective grants into Hermes.

## Current source truth

### Saved Cards and new Projects

The server attaches six core Cards to a new agent Project: Main, Builder, ThinkGraph, Magnetic, Team,
and KnowGraph. The default server topology contains Main → Builder and Team ↔ Magnetic only. Client
seed examples also contain optional/domain Cards, but those examples are not the saved-state authority
for an existing Project.

PostgreSQL current Card revisions and grants remain authoritative. A source seed, title, installed
profile, or historical screenshot cannot establish one Project's current configuration.

### Graph context

- The canonical Entity directory is a complete union of separate Engraphis and Graphiti rows. It does
  not persist a merged identity.
- Exact Data Anchors resolve provider-owned IDs and bounded data before Python materializes the single
  IDF.
- `project_graph.list_entities` returns the complete exact directory. The read-only
  `project_graph.read_entity_context` requires exact directory references plus a current query. It uses
  exact provider Entity reads followed by Jev relevance and defaults to one Relevant plus one distinct
  Recent Think and Know.
- The joined graph may visually pair exact same-name provider members without becoming another graph.
- Only Entities render as graph nodes. Thinks and Knows are attached properties; Graphiti episodes,
  citations, and supporting IDs remain evidence/provenance and never become visible Project nodes.
- The Entity inspector defaults to KnowGraph when both authorities exist and shows at most two current
  provider-projected attached Thinks or Knows. Search/Results and a Relevant/Recent switch are not current UI.
- Main, Builder, ThinkGraph, and KnowGraph receive the current Entity/Relationship map and a non-persisting
  default packet containing one most Relevant and one distinct most Recent record from each authority.
  Engraphis and Graphiti produce provider candidates; Jev alone ranks them. Relevant is presented first and
  outweighs recency, preventing the last exchange from becoming a repeating context loop.
- The **Think** and **Know** color-key labels select isolated provider layouts and an empty-canvas click
  returns the fixed combined view. Graph settings remain in the detailed inspector.
- Entity radius scales linearly from least to most attached Think-and-Know words. Jev relationship
  probability remains movement/centrality input and is not replaced by word count.

### ThinkGraph

The completed-pair Python preparation and settlement rails remain intact, but there is currently no
LiquidAIty TypeScript agent-execution caller. Automatic User/Main-pair intake is therefore not current
product behavior. A later Hermes saved-Card integration requires a separate approved implementation.

### KnowGraph

KnowGraph has Hermes Web plus its saved Graphiti read/write corridor. A deliberately supplied Think is
framing, not evidence. Useful sourced findings enter Graphiti through Graphiti's queued
`add_memory_to_entity`, which binds the episode to one exact Entity through `ABOUT`, leaves extracted
`MENTIONS` independent, updates Graphiti communities by default, and may associate the continuing research
thread with one Saga. One Know is one atomic `know.v1` episode with a cited supporting idea and a cited
counter idea; both compact bodies and both citation sets are mandatory, while each side may place depth
behind **More**. Python rails validates and encodes that structure before the unchanged Graphiti queue.
One-sided episodes are not projected as Knows. The source-default KnowGraph Card uses Sol; ThinkGraph
remains Luna. Queue acceptance does not prove materialization. KnowGraph is not Team-enabled and has no
current Team integration.

### Execution

- Ordinary Hermes delegation, Hermes Team/Kanban, and Magnetic are three different mechanisms.
- Main and every non-Magnetic saved Hermes Card have one stable profile plus one hidden session per
  Project. The application supplies only exact profile/session/roster context; Hermes owns inference,
  queueing, direct Bot delivery, transcript persistence, and each Card terminal.
- Source now prepares one receiving-Card Run and canonical `in.idf` before Main, terminal, and orange
  recipient inference. Direct `@Card` delivery observes the recipient session without a second Main
  synthesis; consultations continue the same open Main Run from Hermes' real completion notification.
- Saved application tools are exact include-filtered profile MCP tools. AutoTools can narrow that loaded
  set for one turn but cannot grant a tool. The retired application per-turn callback tool protocol is absent.
- Valid enabled Card Scripts execute through Hermes' existing child Python runner and exact profile-loaded
  grants; blank or invalid source is inert. The owner's later general Hooks design remains a separate boundary.
- Only saved Card `card_team` receives Hermes `task_mode: team`.
- Magnetic uses saved blue topology as its worker ceiling; its same root remains both orchestrator and
  final result task.
- Hermes owns task rows, dependencies, attempts, dispatch, retries, workers, and synthesis.
- LiquidAIty owns one outer product Run and does not copy the Hermes task ledger.

## Current gaps before live acceptance

These are source/documentation gaps, not permission to repair them during this documentation run:

1. Main's approved quick-Web direction is not present in its source-default toolsets.
2. Main's source-default prompt describes ThinkGraph/KnowGraph use, but the server's default new-Project
   topology does not attach those orange edges.
3. Automatic completed User/Main-pair ThinkGraph capture remains unconnected. The owner deferred its
   saved per-Project “Capture Main turns automatically” control and Hermes caller to a later change.
4. Quick-Web evidence handoff to durable KnowGraph correlation is not implemented.
5. Existing saved Projects remain governed by their persisted Card revisions; the new source-default
   prompts, grants, and KnowGraph model do not silently overwrite saved authority.
6. The 2026-10-14 loaded pass proved ordinary Main, Main consultation, direct Builder/ThinkGraph/KnowGraph/
   WorldView/Trader delivery, refresh retention, and the Builder terminal. The 2026-10-15 cleanup passed a
   fresh loaded health/source check and graph-inspector visual regression, but did not repeat model turns.
   Interactive profile OAuth, enabled Card Script execution/failure recovery, Team, Magnetic, graph writes,
   external clients, and final owner visual acceptance remain separate.

## Loaded core checkpoint — reached 2026-10-14

Current source has one connected path from the restored UI through saved Card authority, one Project
session per Card, one IDF/Run lifecycle, Hermes profile tools, orange Bot delivery, blue Magnetic
authority, and each non-Main Card terminal. The old combined-conversation runtime, direct target executor,
per-turn application tool callback, transport selector, fake status/limit controls, Card-runtime MCP
principal, and their stale tests are absent from the live application path.

The same loaded pass recorded the real Main/Bot/Builder terminal cases in `turn.md`. It did not prove
OAuth-backed tool execution, an enabled Card Script, Team, Magnetic, graph writes, external clients, or
complete owner visual acceptance.

## Cleaned source checkpoint — reached 2026-10-15

The reduction/route/graph/tooling cleanup passed:

- all first-party Python tests: 420 passed; one upstream Graphiti Pydantic deprecation warning;
- all repository TypeScript tests: 389 passed, one intentionally skipped; the focused Magnetic suite then
  passed without its former React act warnings;
- client/backend source and spec TypeScript checks: passed;
- backend and client production builds: passed; the client retains browser-externalization and large God’s Eye
  bundle warnings;
- authenticated streamable-HTTP MCP proof invoked granted `calculator` and denied it to ungranted peers;
- production dependency audit: zero vulnerabilities after non-breaking updates; 14 dev-only advisories remain
  behind separate breaking Nx 23/Vitest 5 migrations;
- `git diff --check`: passed; canonical Markdown links: passed.

The canonical launcher then loaded backend, Python rails, KnowGraph, MCP, Hermes, WorldView, WorldSignals,
and the client. Health/readiness returned HTTP 200; MCP froze 55 unique tools with `sourceCurrent=true`,
startup ID `333ca4c32261466aa05f0b248de6d74f`, and catalog hash
`984322f92548fd5e3a0d5f467999b37673edd099a6ceae9cb506f2c8c5dfd6b47`. Preview loaded the restored Project
with an enabled Main composer, Card canvas, Entity-only graph, and Rocket Lab Know inspector showing separate
cited For/Against evidence and no console warnings. No new model turn, graph write, Team/Magnetic mission,
trade, credential change, or saved Card mutation was performed.

## Next acceptance boundary

Profile OAuth tool readback and Card Script success/failure recovery require their real external or saved
prerequisites. A new model turn, Team, Magnetic, graph writes, external-client acceptance, and Jeremiah's final
visual acceptance remain separate and must not be inferred from health, deterministic, or inspector proof.

## Next graph boundary — deferred

The owner has named, but deferred, a saved ThinkGraph control labeled “Capture Main turns automatically.”
When off, only explicitly selected data may be sent to ThinkGraph. A later implementation must use the
real saved ThinkGraph Card through Hermes and the existing completed-pair Python preparation/settlement
owners; it may not restore the deleted TypeScript child-Card executor. No graph optimization, automatic
caller, time-sort interaction, entitlement, retention/billing policy, reset, report surface, or quick-Web
handoff is part of this recovery.

## Proof tiers still separate

1. source and residue inspection;
2. deterministic contract tests;
3. typecheck/build;
4. loaded service health and exact source identity;
5. real saved Card behavior through the loaded Hermes path;
6. persistence/readback;
7. external client acceptance;
8. owner visual acceptance.

A lower tier never proves a higher one. No Magnetic mission, graph write, trading action, or service
restart is authorized by this plan alone.
