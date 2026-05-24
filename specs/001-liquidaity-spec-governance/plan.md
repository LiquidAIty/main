# Implementation Plan: LiquidAIty Spec Governance System

## Plan ID
PLAN-001-LIQ-GOV

## Linked Spec
- `specs/001-liquidaity-spec-governance/spec.md`

## Technical Context
- Repo type: Nx-style monorepo
- Runtime surfaces: `client/`, `apps/backend/`, `apps/python-models/`
- Governance substrate: `.specify/` + `specs/`
- Existing operational docs: `AGENTS.md`, `policy.md`, `SOUL.md`, `docs/*`
- Execution backend policy: AutoGen mandatory for real runs

## Inverse Audit Summary
1. Spec Kit presence verified (`.specify/`, `.agents/skills/`).
2. Existing docs include canonical, historical, and external subtree materials.
3. Core policy docs already enforce MCP-first and no fake runtime fallback.
4. No safe basis to claim runtime behavior beyond explicit smoke/test outputs.

## Affected Files
- `.specify/memory/constitution.md` (preserve existing content; no destructive rewrite)
- `specs/001-liquidaity-spec-governance/spec.md`
- `specs/001-liquidaity-spec-governance/plan.md`
- `specs/001-liquidaity-spec-governance/tasks.md`
- `docs/README.md`

## Safety Constraints
- No runtime code-path rewrites.
- No deletion/move of historical docs in this pass.
- No branch creation/switching in this pass.
- No LangChain introduction.
- No fake TypeScript fallback.
- No claims of unverified runtime behavior.

## Validation Commands
```powershell
git status --short
Get-ChildItem -Force .specify
Get-ChildItem -Force specs
Get-ChildItem docs -Recurse -File | Select-Object FullName
```

## Rollback Strategy
- Revert only touched governance/spec docs if needed.
- Keep runtime files untouched.
- Use a single commit boundary for all spec-governance doc artifacts.

## Documentation Migration Strategy
- Classify docs first, migrate later.
- Keep old docs in place now, mark them in doc map as historical or external.
- Promote a single canonical map in `docs/README.md`.

## Graph-Memory Future Compatibility
- Use stable IDs in spec artifacts (`SPEC-`, `PLAN-`, `TASK-`, `FR-`, `SC-`).
- Keep requirements atomic and referenceable.
- Keep entities explicit for future ingestion into graph layers.

## Risks
1. **Spec Kit drift risk**: generated scaffolding may evolve upstream.
   - Mitigation: keep local canonical definitions explicit in constitution/spec.
2. **Doc trust confusion**: many legacy/external docs at repo root.
   - Mitigation: classify in `docs/README.md` now; migrate in later controlled pass.
3. **Overreach risk**: accidental runtime edits while doing governance setup.
   - Mitigation: constrain this feature to docs/spec files only.

## Known Uncertainty
- Spec Kit CLI initialization previously showed non-interactive behavior issues in this shell.
- Existing `.specify/` is now present and usable, but provenance of every generated file is not asserted in this plan.

## Phase Plan
1. Audit current governance/doc state.
2. Ensure constitution exists and is preserved.
3. Complete first canonical feature spec.
4. Create task plan and dependency-ordered tasks.
5. Update docs map classification.
6. Validate filesystem/state and report.
