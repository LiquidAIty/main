# Feature Specification: LiquidAIty Spec-First Development System

**Feature Branch**: `001-liquidaity-spec-first-development-system`

**Created**: 2026-05-24

**Status**: Draft

**Input**: User description: "LiquidAIty Spec-First Development System"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enforce Spec-First Workflow (Priority: P1)

As Jeremiah, I want every meaningful repository change to follow a disciplined default sequence
(intent inversion -> MCP audit -> safe slice -> validation -> final report), with Spec Kit used
only when it clearly reduces risk, so coding agents cannot bypass reasoning and implementation
control.

**Why this priority**: This is the core control mechanism that prevents architecture drift,
undocumented changes, and ungoverned implementation.

**Independent Test**: Can be fully tested by asking a new coding agent to propose a meaningful
change and verifying the agent must produce spec, plan, and tasks before implementation.

**Acceptance Scenarios**:

1. **Given** a meaningful requested change, **When** an agent starts work, **Then** the agent
   starts with an audit-backed implementation path and uses Spec Kit only when the work warrants it.
2. **Given** a high-risk or multi-step requested change, **When** the agent proceeds, **Then**
   Spec Kit plan and tasks are created or updated before implementation.
3. **Given** implementation of a meaningful change, **When** the work completes, **Then** the
   final report includes files changed, docs updated, validation, risks, uncertainty, and forward plan.

---

### User Story 2 - Align Instruction System Around Sol + AGENTS + Spec Kit (Priority: P1)

As Jeremiah, I want instruction files to clearly encode Sol identity and coding-agent law
so new agents read current truth and avoid stale or conflicting workflows.

**Why this priority**: Instruction clarity determines day-to-day development quality and directly
affects whether agents follow repository intent.

**Independent Test**: Can be fully tested by onboarding a new coding agent and checking whether
it reads `SOUL.md`, `AGENTS.md`, and `.specify/memory/constitution.md` in the required order.

**Acceptance Scenarios**:

1. **Given** a new coding agent session, **When** the agent reads instruction files, **Then**
   it identifies Sol through `SOUL.md` and follows repo law from `AGENTS.md`.
2. **Given** a meaningful change request, **When** the agent plans work, **Then** it applies
   optional heavy-mode Spec Kit policy and MCP-first inverse-audit workflow.

---

### User Story 3 - Remove Active Noise And Non-Target Workflow Artifacts (Priority: P2)

As Jeremiah, I want Claude-specific and audit-noise artifacts removed from active scope
so the repo does not accumulate conflicting workflows or permanent audit clutter.

**Why this priority**: Noise reduction improves consistency and reduces wrong-path behavior,
while preserving focus on one development system.

**Independent Test**: Can be tested by checking active structure and confirming excluded files
are absent and not referenced by active docs.

**Acceptance Scenarios**:

1. **Given** the active repo instruction structure, **When** audit-noise files are checked,
   **Then** standalone audit docs are not used as the default durable home for findings.
2. **Given** active docs, **When** references are scanned, **Then** no active workflow requires
   Claude-specific files for core development control.

---

### User Story 4 - Documentation-On-Change Discipline (Priority: P2)

As Jeremiah, I want documentation updates to be mandatory for touched subsystems
so architecture and runbooks stay current and development gets easier over time.

**Why this priority**: Without this rule, docs drift and agents re-learn systems incorrectly.

**Independent Test**: Can be tested by making a scoped subsystem change and verifying related
canonical docs are updated in the same change set.

**Acceptance Scenarios**:

1. **Given** a subsystem behavior change, **When** implementation is complete, **Then**
   the closest canonical doc is updated in the same work item.
2. **Given** command or run workflow changes, **When** implementation is complete, **Then**
   `docs/runbooks/full-stack-dev.md` is updated.
3. **Given** an architecture-level decision, **When** the decision is finalized, **Then**
   an ADR is added or updated in `docs/decisions/`.

## Edge Cases

- What happens when a requested edit is trivial (for example typo-only)?
  - Trivial, reversible edits may skip full spec lifecycle only when clearly non-meaningful.
- How does the system handle conflicting instructions across stale docs?
  - Canonical instruction order wins; stale docs must not override current intent.
- What happens if an agent attempts direct implementation without spec updates?
  - Work is considered non-compliant and must be redirected to spec-first flow.
- How does the system handle external subtree documentation that conflicts with repo truth?
  - External subtree docs remain scoped and non-authoritative for LiquidAIty architecture.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `SOUL.md` MUST remain the active identity file and MUST identify the agent as Sol.
- **FR-002**: `SOUL.md` MUST include Identity, Values & Principles, Communication Style, Expertise &
  Knowledge, Hard Limits, Workflow, Tool Usage, Memory Policy, and Example Interaction.
- **FR-003**: `AGENTS.md` MUST be the hard coding-agent rule file.
- **FR-004**: `AGENTS.md` MUST require Code-Based Memory MCP before significant edits.
- **FR-005**: `AGENTS.md` MUST require inverse audit before implementation.
- **FR-006**: `AGENTS.md` MUST define Spec Kit as optional heavy-mode rather than the default for
  every meaningful implementation.
- **FR-007**: `AGENTS.md` MUST require PowerShell commands by default.
- **FR-008**: `AGENTS.md` MUST require final reports with files changed, docs updated, validation,
  risks, uncertainty, and forward plan.
- **FR-009**: Spec Kit assets MUST be preserved: `.specify/`, `.specify/memory/constitution.md`,
  `.specify/templates/`, `.agents/skills/`, and `specs/`.
- **FR-010**: The active feature folder for this initiative MUST be
  `specs/001-liquidaity-spec-first-development-system/`.
- **FR-011**: High-risk or multi-step future changes MUST use Spec Kit when a spec clearly reduces
  risk.
- **FR-012**: Heavy-mode work MUST update or create `plan.md` and `tasks.md` before
  implementation.
- **FR-013**: Every implementation MUST run inverse audit before editing.
- **FR-014**: Every touched subsystem MUST have relevant documentation updated.
- **FR-015**: Final implementation reports MUST include spec/plan/tasks status, files changed/created/
  deleted, docs updated, validation run and results, risks, uncertainty, and forward plan.
- **FR-016**: Active Claude-specific workflow artifacts MUST be out of active scope.
- **FR-017**: Active audit-noise files MUST be removed from active scope.
- **FR-018**: This feature MUST NOT change runtime code.
- **FR-019**: This feature MUST NOT change package files.
- **FR-020**: This feature MUST NOT commit automatically.
- **FR-021**: Runtime guardrails MUST remain explicit: AutoGen mandatory for real execution, no
  silent fallback runtime, no fake fallback runtime, lazy loading/loading states/error
  boundaries/retries/diagnostics/honest unavailable states allowed when truthful, and no fake
  substitute product behavior.
- **FR-023**: Audit findings MUST be routed into the closest living source of truth rather than
  standalone audit Markdown by default.
- **FR-024**: Temporary audit findings MUST remain in the final report only.
- **FR-025**: Historical audit files MUST be moved to `docs/old/` or deleted after durable
  findings are extracted unless the user explicitly approves keeping them active.
- **FR-022**: Active architecture constraints MUST remain explicit: no LangChain, no Zorro, and no
  Ghostfolio as active architecture.

### Key Entities *(include if feature involves data)*

- **Instruction Artifact**: A canonical instruction document (`SOUL.md`, `AGENTS.md`,
  `.specify/memory/constitution.md`) that defines behavior constraints for agents.
- **Spec Lifecycle Artifact**: Feature-level spec, plan, and task artifacts under `specs/*` used to
  govern meaningful implementation.
- **Documentation Surface**: Canonical docs area (`README.md`, `docs/README.md`,
  `docs/architecture.md`, `docs/runbooks/*`, `docs/decisions/*`) that must be updated on change.
- **Compliance Report**: Final implementation report artifact summarizing spec/plan/tasks status,
  files changed, validation, risks, uncertainty, and forward plan.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of meaningful development changes follow the default audit-first workflow before
  implementation.
- **SC-002**: 100% of heavy-mode changes include plan and tasks updates before implementation.
- **SC-003**: 100% of completed implementation reports include files changed, docs updated,
  validation results, risks, uncertainty, and forward plan.
- **SC-004**: A new coding agent can identify Sol identity and required workflow in under 5 minutes
  of reading canonical instruction docs.
- **SC-005**: Active instruction docs contain zero required references to excluded workflow artifacts.
- **SC-006**: No runtime or package-file modifications are introduced by this feature.

## Assumptions

- Meaningful changes are changes that modify behavior, contracts, architecture, workflows, or
  cross-file logic beyond trivial reversible edits.
- Trivial typo-only edits may use a lighter process when they do not change behavior or project
  intent.
- External subtree docs remain in the repo but do not define LiquidAIty canonical truth.
- Existing Spec Kit installation is valid and reused when heavy-mode is chosen; no reinstallation
  is required.
- Validation uses repo-native commands and PowerShell defaults.
