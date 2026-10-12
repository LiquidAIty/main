# LiquidAIty

LiquidAIty is a persistent, Project-oriented agent workbench. A Project keeps durable saved Cards,
their prompts and grants, native graph authorities, one shared human conversation, and explicit
execution topology. Hermes executes saved Cards; LiquidAIty supplies authenticated product state,
bounded context, transport, and presentation without replacing Hermes orchestration.

This repository is in an MVP hardening phase. Current source is authoritative. Static source,
deterministic tests, a loaded service, a real saved-Card Run, persisted readback, and visual acceptance
are separate proof tiers.

## Read this repository

The canonical documents have distinct jobs:

| Document | Authority |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Repository execution law and the PromptSpec process |
| [DONT.md](DONT.md) | Prohibitions and known failure patterns |
| [PLAN.md](PLAN.md) | Current status, gaps, and next approved boundary |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Detailed current source owners and contracts |
| [FUTURE.md](FUTURE.md) | Deferred candidates, never execution authority |
| [skills/](skills/) | Conditional domain procedures; PromptSpec process stays in `promptspec-receiver` |

Historical reports and old PromptSpecs are evidence only. They do not override current source or the
owner's latest instruction.

## Current MVP

The server attaches six core saved Cards to a new agent Project by their current saved revisions:

| Card | Current responsibility |
| --- | --- |
| Main | Human-facing Project conversation and bounded orchestration |
| Builder | Prompts, Cards, applications, UI, code, artifacts, and construction work |
| ThinkGraph | Engraphis-backed Project reasoning and completed User/Main-pair Think intake |
| KnowGraph | Graphiti-backed sourced research, provenance, and queued Know ingestion |
| Magnetic | Approved mission execution across an exact saved blue worker roster |
| Team | Generic native Hermes Team/Kanban work through the saved `team` profile |

Persisted PostgreSQL Card revisions and grants—not TypeScript seed objects—are runtime authority for an
existing Project. WorldView, WorldSignals, Trading, and other domain Cards are specialized saved Cards
when deliberately attached; they are not universal members of every new Project and do not replace the
core graph authorities.

## Separate graph authorities

```text
ThinkGraph = Engraphis progressive Project reasoning
KnowGraph  = Graphiti / Neo4j sourced evidence and provenance
CodeGraph  = native Codebase Memory repository structure
AgentGraph = AGE / PostgreSQL saved topology and truthful Run observations
```

One logical Project Entity may have one Engraphis-native identity and one Graphiti-native identity.
The canonical Entity directory keeps those provider identities separate. The joined graph can present
an exact same-name pair as one visual Entity, but that presentation is not a third graph, shared provider
ID, semantic merger, or additional writer.

## Execution boundaries

- **Ordinary Hermes delegation** is transient leaf or recursive child work when a saved Card enables it.
- **Team** is the saved `card_team` profile's durable Hermes Kanban mode with native decomposition,
  workers, review, and synthesis.
- **Magnetic** is a separate saved-Card TaskGraph over an exact blue roster. Its root remains both the
  orchestrator and final result task.
- **Python rails** owns deterministic Card/Run preparation, graph adapters, tool dispatch, IDF/IDD,
  validation, and settlement.
- **The backend** owns authenticated HTTP/SSE transport, saved scope, Hermes Gateway translation,
  profile/session binding, and event correlation.
- **React/TypeScript** owns transport-facing UI and pixels, not semantic routing or graph meaning.

## Current versus approved direction

These distinctions are load-bearing:

### Current

- Main's source-default Card has no Hermes Web toolset.
- Main is the fast front door: it answers straightforward requests normally, grounds uncertain material in
  both ThinkGraph reasoning and KnowGraph evidence, compares two plausible options when useful, and delegates
  sustained building/reasoning/research to the owning saved Card rather than performing it inline.
- Exact Data Anchors and one canonical `in.idf` carry selected provider graph data.
- A unique completed User/Main pair may produce Entity-specific append-only Thinks for several Entities,
  with at most one Think for each Entity in that pair; an identical pair is a pre-extraction no-op.
- `project_graph.list_entities` exposes the complete exact Entity directory and
  `project_graph.read_entity_context` performs an exact Entity-scoped read for the supplied query while
  preserving separate provider IDs. Its default is one Jev-ranked **Relevant** record plus one distinct
  newest **Recent** record per authority; an inspector-only result limit may expand either view to 12.
- Main, Builder, ThinkGraph, and KnowGraph receive the current Entity/Relationship map plus the default
  Relevant/Recent grounding before inference. Engraphis native recall supplies Think candidates; Graphiti
  native Entity search plus exact `ABOUT` reads supplies Know candidates; Jev ranks the bounded native
  candidates. TypeScript does not search or rank prose.
- Thinks faithfully steelman the user's current idea. One valid Know is one atomic two-sided Graphiti
  episode: a cited **For** and cited **Against**, each with its own compact body, optional **More** detail,
  and citations. A one-sided cited statement is not projected as a Know.
- The Entity inspector defaults to KnowGraph when both authorities exist and opens on **Relevant**. One
  small arrow switches the same card space to **Recent**; `Search` and a transient `Results` count rerun
  exact Entity context without changing Main/Builder's default bounded packet.
- Only Entities are visible Project graph nodes. Thinks, Knows, source episodes, citations, and provider
  references remain attached evidence/provenance rather than extra canvas nodes.
- Entity radius is a linear presentation scale over the full attached Think-and-Know word total. Existing
  Jev relationship physics remains movement/centrality authority.
- The visible **Think** and **Know** color-key labels select isolated native views; an empty-canvas click
  returns the one combined view. View settings remain in the graph inspector.
- KnowGraph owns sourced research and Graphiti persistence; Thinks are framing, never evidence.
- KnowGraph writes through queued `graphiti.add_memory_to_entity`, which records one exact structural
  `ABOUT` attachment, leaves `MENTIONS` independent, updates Graphiti communities by default, and may join
  a continuing research-thread Saga. Python rails requires and encodes both cited sides as one `know.v1`
  episode before calling Graphiti. Queue acceptance is not materialization proof.

### Approved direction, not current behavior

- Main may gain bounded quick Web research without taking over durable evidence correlation.
- Materially used quick-Web evidence may be handed to KnowGraph for verification and persistence.
- A subtle requested-time sorter may later expand Entity history without changing the Relevant-first
  default; no time-sort interaction is approved by this pass.

### Deferred

- A Project Knowledge Dashboard derived from both graph authorities.
- Any new repository wiki, review Card, or automated documentation-maintenance system.
- KnowGraph-Team integration and broader trading execution.

## PromptSpec development law

Substantial repository work begins by loading the installed `promptspec-receiver` skill. The Primary
maps current ownership with the Codebase Memory CLI, may use up to two read-only scouts, decomposes work
into ordered tasks with a Key Objective and Definition of Done, and remains the only implementation
writer. Agent behavior requires real loaded-runtime acceptance rather than mocks.

Before completion, documentation coherence is reviewed, implementation bytes are frozen, and an
independent Agent 3 writes repo-root `turn.md` with per-file SHA-256 hashes and a combined
`REVIEW_SNAPSHOT_SHA256`. The Primary does not patch after final review begins. A failed review stops for
owner disposition.

See [AGENTS.md](AGENTS.md) for the complete repository-facing summary. The installed skill remains the
process authority for an active PromptSpec.

## Development entry point

Canonical local startup is:

```powershell
npm run dev:fresh
```

Do not start duplicate component processes to work around a failed owner. Current readiness and the next
authorized proof boundary are recorded in [PLAN.md](PLAN.md).
