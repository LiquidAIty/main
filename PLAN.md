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
  exact native Entity reads followed by Jev relevance and defaults to one Relevant plus one distinct
  Recent Think and Know; the detailed inspector may request 1–12 results without changing agent defaults.
- The joined graph may visually pair exact same-name provider members without becoming another graph.
- Only Entities render as graph nodes. Thinks and Knows are attached properties; Graphiti episodes,
  citations, and supporting IDs remain evidence/provenance and never become visible Project nodes.
- The Entity inspector defaults to KnowGraph when both authorities exist. It opens on Relevant and one
  small arrow replaces that view with Recent. A compact Search field and transient Results count rerun
  exact Entity context; the default remains one result.
- Main, Builder, ThinkGraph, and KnowGraph receive the current Entity/Relationship map and a non-persisting
  default packet containing one most Relevant and one distinct most Recent record from each authority.
  Engraphis and Graphiti produce native candidates; Jev alone ranks them. Relevant is presented first and
  outweighs recency, preventing the last exchange from becoming a repeating context loop.
- The **Think** and **Know** color-key labels select isolated native layouts and an empty-canvas click
  returns the fixed combined view. Graph settings remain in the detailed inspector.
- Entity radius scales linearly from least to most attached Think-and-Know words. Jev relationship
  probability remains movement/centrality input and is not replaced by word count.

### ThinkGraph

After an ordinary Main response is persisted and returned, the completed User/Main pair enters the
saved ThinkGraph Card lifecycle. Preparation is non-persisting. An identical completed-pair identity
no-ops; otherwise the saved Card returns zero or more Entity-specific structured episodic Thinks, with at
most one Think per Entity in that pair. Python settles the batch atomically as one append-only Engraphis
Memory per Think with one exact structured-extractor incidence. Each Think has one compact summary and an
optional technical `detail` rendered behind **More**.

Completed-pair preparation now receives the same Relevant/Recent packet. Think candidates are selected
to faithfully steelman the user's current idea, so the saved ThinkGraph Card can prefer a refinement,
correction, contradiction, genuinely new idea, or no-op over a near-duplicate. Jev separately classifies
each Card-proposed directed Relationship and supplies its canonical predicate, distribution, and strength;
it is not an independent endpoint or graph authority.

### KnowGraph

KnowGraph has Hermes Web plus its saved Graphiti read/write corridor. A deliberately supplied Think is
framing, not evidence. Useful sourced findings enter Graphiti through native queued
`add_memory_to_entity`, which binds the episode to one exact Entity through `ABOUT`, leaves extracted
`MENTIONS` independent, updates native communities by default, and may associate the continuing research
thread with one Saga. One Know is one atomic `know.v1` episode with a cited supporting idea and a cited
counter idea; both compact bodies and both citation sets are mandatory, while each side may place depth
behind **More**. Python rails validates and encodes that structure before the unchanged Graphiti queue.
One-sided episodes are not projected as Knows. The source-default KnowGraph Card uses Sol; ThinkGraph
remains Luna. Queue acceptance does not prove materialization. KnowGraph is not Team-enabled and has no
current Team integration.

### Execution

- Ordinary Hermes delegation, native Team/Kanban, and Magnetic are three different mechanisms.
- Only saved Card `card_team` receives Hermes `task_mode: team`.
- Magnetic uses saved blue topology as its worker ceiling; its same root remains both orchestrator and
  final result task.
- Hermes owns native task rows, dependencies, attempts, dispatch, retries, workers, and synthesis.
- LiquidAIty owns one outer product Run and does not copy the Hermes task ledger.

## Current gaps before live acceptance

These are source/documentation gaps, not permission to repair them during this documentation run:

1. Main's approved quick-Web direction is not present in its source-default toolsets.
2. Main's source-default prompt describes ThinkGraph/KnowGraph use, but the server's default new-Project
   topology does not attach those orange edges.
3. Quick-Web evidence handoff to durable KnowGraph correlation is not implemented.
4. Existing saved Projects remain governed by their persisted Card revisions; the new source-default
   prompts, grants, and KnowGraph model do not silently overwrite saved authority.
5. Loaded Main, Builder, ThinkGraph, KnowGraph, Team, Magnetic, external MCP, and visual acceptance remain separate
   proof tiers.

## Current acceptance boundary

The active Entity/Think/Know contract pass must leave:

- one coherent CURRENT / APPROVED DIRECTION / DEFERRED narrative;
- one PromptSpec process authority;
- no active-looking obsolete PromptSpec or removed WorldView bridge;
- exact structural storage, native retrieval plus Jev ranking, Relevant/Recent visibility, two-sided Knows,
  Entity-only graph nodes, and native removal without another graph authority or semantic router;
- a frozen documentation snapshot;
- an independent `turn.md` review with exact file hashes and combined checksum.

A PASS means the frozen source and documents agree on the current Entity/Think/Know contract and the
reported proof tiers. It does not mean every loaded product path is live-proven.

## Next graph boundary — not approved

No additional graph feature is approved by this plan. A later subtle time-sort interaction, paid-setting
entitlement, Project retention/billing policy, global default reset, report surface, or quick-Web evidence
handoff requires its own exact authority and acceptance packet. None may change the current Relevant-first,
one-result default or create deterministic semantic ranking in TypeScript.

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
