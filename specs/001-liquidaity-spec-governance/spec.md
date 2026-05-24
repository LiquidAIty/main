# Feature Specification: LiquidAIty Spec Governance System

## Status
Draft

## Feature ID
SPEC-001-LIQ-GOV

## Purpose
Add a formal spec-driven development layer to LiquidAIty so every major feature can move from intent to spec to plan to tasks to implementation while preserving current architecture, reducing agent drift, reducing documentation sprawl, and enforcing AutoGen/MCP/project-memory rules.

## Canonical Project Definition
LiquidAIty is a graph-native AI orchestration platform that turns projects, models, tools, agents, simulations, and knowledge into interactive canvases with executable agent workflows.

## Governance Source
- Constitution: `.specify/memory/constitution.md`
- Canonical documentation map: `docs/README.md`

## User Stories

### US-001: Developer starts from a governed spec
As Jeremiah, I want every major LiquidAIty feature to start from a clear spec so Codex, Cursor, Gemini, and other coding agents do not invent architecture or overwrite current design intent.

Acceptance criteria:
- A `specs/` folder exists.
- The first spec clearly defines LiquidAIty’s project identity.
- The spec references the constitution as the governing source.
- The spec does not duplicate all docs; it links the canonical doc map.

### US-002: Agent reads current project truth before implementation
As Jeremiah, I want coding agents to use Code-Based Memory MCP before implementation so they inspect the actual repo instead of relying on stale assumptions.

Acceptance criteria:
- The constitution requires Code-Based Memory MCP first.
- The spec says implementation must start with inverse audit.
- The spec includes audit outputs as required implementation artifacts.

### US-003: Documentation becomes navigable instead of scattered
As Jeremiah, I want `docs/README.md` to declare canonical, historical, external, and generated docs so agents know which docs to trust.

Acceptance criteria:
- `docs/README.md` has a doc map.
- Canonical docs are clearly marked.
- Historical docs are clearly marked.
- External subtree docs are scoped.
- Generated Spec Kit files are documented separately.

### US-004: Specs do not replace architecture docs
As Jeremiah, I want Spec Kit specs to define feature intent, while `docs/architecture.md` remains the technical system truth.

Acceptance criteria:
- Specs describe feature-level intent.
- `docs/architecture.md` remains canonical for system architecture.
- Specs link to architecture where needed.
- No contradictory architecture claims are introduced.

### US-005: AutoGen remains mandatory
As Jeremiah, I want Spec Kit tasks to preserve the mandatory AutoGen execution path and prevent fake fallback runtime behavior.

Acceptance criteria:
- Constitution states AutoGen mandatory.
- Generated plan/tasks do not introduce TypeScript fallback execution.
- Runtime failure must surface as failure, not a silent fallback.
- Tests or smoke checks verify AutoGen sidecar expectations where applicable.

### US-006: Future feature specs can become graph objects
As Jeremiah, I want future specs to be compatible with LiquidAIty’s graph memory so specs can later become entities, relationships, provenance, and executable project memory.

Acceptance criteria:
- Spec format includes stable IDs.
- Important requirements are atomic and referenceable.
- Entities and relationships are named clearly.
- Future graph ingestion is not blocked.

## Functional Requirements

- FR-001: The repo must contain a Spec Kit configuration initialized for Codex skills or commands.
- FR-002: The repo must contain `.specify/memory/constitution.md` with LiquidAIty-specific governing rules.
- FR-003: The repo must contain `specs/001-liquidaity-spec-governance/spec.md`.
- FR-004: The spec must define LiquidAIty as:
  - "a graph-native AI orchestration platform that turns projects, models, tools, agents, simulations, and knowledge into interactive canvases with executable agent workflows."
- FR-005: The documentation map must distinguish:
  - canonical docs
  - historical docs
  - external subtree docs
  - generated Spec Kit docs
  - feature specs
  - Architecture Decision Records (ADRs)
- FR-006: The spec workflow must require inverse audit before implementation.
- FR-007: The spec workflow must require implementation reports to include:
  - files changed
  - tests run
  - risks
  - uncertainty
  - forward plan
- FR-008: The spec workflow must preserve current runtime behavior.
- FR-009: The spec workflow must not delete or rewrite docs without classification first.
- FR-010: The spec workflow must support future LiquidAIty features such as:
  - Agent Canvas
  - Plan Canvas
  - ThinkGraph
  - KnowGraph
  - CodeGraph
  - WorldSignals
  - AutoGen card execution
  - repo-eating integrations
  - model/simulation ingestion
  - KnowledgeCoin / Graphprint knowledge asset workflows

## Non-Functional Requirements

- NFR-001: Specs must be readable by humans and coding agents.
- NFR-002: Specs must be detailed enough to reduce hallucinated implementation.
- NFR-003: Specs must avoid duplicating large docs.
- NFR-004: Specs must be stable enough to support future graph ingestion.
- NFR-005: Spec Kit additions must not break existing builds.
- NFR-006: All commands must be PowerShell-compatible.
- NFR-007: The repo must remain secure and must not expose secrets.
- NFR-008: No generated file should claim unverified runtime behavior.

## Entities

### Entity: Spec
Fields:
- id
- title
- status
- owner
- scope
- linked docs
- linked decisions
- requirements
- acceptance criteria

### Entity: Requirement
Fields:
- id
- type
- description
- source
- acceptance criteria
- status

### Entity: CanonicalDoc
Fields:
- path
- purpose
- trust level
- owner
- last reviewed date

### Entity: HistoricalDoc
Fields:
- path
- reason archived
- replacement doc
- last reviewed date

### Entity: AgentRule
Fields:
- id
- rule
- severity
- source
- enforcement method

### Entity: RuntimeConstraint
Fields:
- id
- subsystem
- rule
- validation command
- failure behavior

## Success Criteria

- SC-001: A new coding agent can inspect the repo and correctly identify the canonical docs.
- SC-002: A new coding agent understands that LiquidAIty is not just a chat app.
- SC-003: A new coding agent understands that AutoGen is mandatory for real execution.
- SC-004: A new coding agent understands that Code-Based Memory MCP must be used before significant edits.
- SC-005: Spec Kit-generated artifacts do not contradict `SOUL.md`, `AGENTS.md`, `docs/architecture.md`, or `docs/runbooks/full-stack-dev.md`.
- SC-006: The repo has a repeatable spec-first workflow for future features.

## Safety Constraints
- No runtime execution architecture changes in this feature.
- No fallback runtime introduction.
- No deletion/migration of existing docs in this feature.
- No branch switching required for this feature.

## Required Audit Artifacts
Each implementation report for this feature family MUST include:
- files changed
- tests run
- known uncertainty
- risks
- forward plan
