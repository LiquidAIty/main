# LiquidAIty

LiquidAIty is a persistent, Project-oriented agent workbench. A Project keeps durable saved Cards,
their prompts and grants, provider-owned graph authorities, one Project human conversation, and explicit
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
| ThinkGraph | Engraphis-backed Project reasoning; automatic User/Main-pair intake is not currently connected |
| KnowGraph | Graphiti-backed sourced research, provenance, and queued Know ingestion |
| Magnetic | Approved mission execution across an exact saved blue worker roster |
| Team | Generic Hermes Team/Kanban work through the saved `team` profile |

Persisted PostgreSQL Card revisions and grants—not TypeScript seed objects—are runtime authority for an
existing Project. WorldView, WorldSignals, Trading, and other domain Cards are specialized saved Cards
when deliberately attached; they are not universal members of every new Project and do not replace the
core graph authorities.

## Separate graph authorities

```text
ThinkGraph = Engraphis progressive Project reasoning
KnowGraph  = Graphiti / Neo4j sourced evidence and provenance
CodeGraph  = Codebase Memory repository structure
AgentGraph = AGE / PostgreSQL saved topology and truthful Run observations
```

One logical Project Entity may have one Engraphis provider identity and one Graphiti provider identity.
The canonical Entity directory keeps those provider identities separate. The joined graph can present
an exact same-name pair as one visual Entity, but that presentation is not a third graph, shared provider
ID, semantic merger, or additional writer.

## Execution boundaries

- **Ordinary Hermes delegation** is transient leaf or recursive child work when a saved Card enables it.
- **Team** is the saved `card_team` profile's durable Hermes Kanban mode with Hermes-owned decomposition,
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
- The completed-pair preparation, extraction, and settlement rails remain available, but no automatic
  User/Main-pair caller is current. Explicitly selected ThinkGraph work continues through its saved Card.
- `project_graph.list_entities` exposes the complete exact Entity directory and
  `project_graph.read_entity_context` performs an exact Entity-scoped read for the supplied query while
  preserving separate provider IDs. The operation defaults to one Jev-ranked **Relevant** record plus one
  distinct newest **Recent** record per authority.
- Main, Builder, ThinkGraph, and KnowGraph receive the current Entity/Relationship map plus the default
  Relevant/Recent grounding before inference. Engraphis recall supplies Think candidates; Graphiti
  Entity search plus exact `ABOUT` reads supplies Know candidates; Jev ranks the bounded provider
  candidates. TypeScript does not search or rank prose.
- Thinks faithfully steelman the user's current idea. One valid Know is one first-class Graphiti object with
  one sourced observation, one bounded interpretation, one inspectable citation, and one exact Entity
  attachment. Supporting, challenging, contextual and neutral Knows are separate valid records; research
  coverage and later synthesis provide balance rather than forcing two sides into every Know.
- The Entity inspector defaults to KnowGraph when both authorities exist. It shows at most two current
  provider-projected attached Thinks or Knows; it has no current Search/Results control or Relevant/Recent
  switch. Agent grounding and inspector presentation are separate contracts.
- Only Entities are visible Project graph nodes. Thinks, Knows, source episodes, citations, and provider
  references remain attached evidence/provenance rather than extra canvas nodes.
- Entity radius is a linear presentation scale over the full attached Think-and-Know word total. Existing
  Jev relationship physics remains movement/centrality authority.
- The visible **Think** and **Know** color-key labels select isolated provider views; an empty-canvas click
  returns the one combined view. View settings remain in the graph inspector.
- KnowGraph owns sourced research and Graphiti persistence; Thinks are framing, never evidence.
- KnowGraph writes through queued `graphiti.add_know`, which stores a typed `Episodic:Know`, records one exact
  structural `ABOUT` attachment, leaves extracted `MENTIONS` independent, updates Graphiti communities by
  default, and may join a continuing research-thread Saga. Python rails verifies the citation before passing
  it as typed fields; Graphiti keeps plain-text episode content for extraction and hybrid retrieval. Processing
  acceptance supplies an exact Know UUID/content hash but is not materialization proof; `graphiti.get_know`
  provides the exact readback.

### Approved direction, not current behavior

- Main may gain bounded quick Web research without taking over durable evidence correlation.
- Materially used quick-Web evidence may be handed to KnowGraph for verification and persistence.
- An optional Entity-history search/time interaction may be designed later without changing automatic
  agent grounding; no such inspector interaction is current.

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

See [AGENTS.md](AGENTS.md) for the controlling repository process. The installed skill supplies the
generic PromptSpec procedure and defers to these repository-local instructions.

## Development entry point

Canonical local startup is:

```powershell
npm run dev:fresh
```

Do not start duplicate component processes to work around a failed owner. Current readiness and the next
authorized proof boundary are recorded in [PLAN.md](PLAN.md).
