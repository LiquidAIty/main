# Tasks: LiquidAIty Spec Governance System

## Feature
- Spec: `specs/001-liquidaity-spec-governance/spec.md`
- Plan: `specs/001-liquidaity-spec-governance/plan.md`

## Phase 1 - Audit
- [ ] T001 Run inverse audit for Spec Kit/docs/runtime-policy alignment and capture findings in implementation report
- [ ] T002 Verify `.specify/`, `.specify/memory/constitution.md`, `.specify/templates/`, `.agents/skills/`, and `specs/001-liquidaity-spec-governance/` existence states
- [ ] T003 Classify documentation surfaces: canonical, conflicting, historical, external subtree

## Phase 2 - Spec Kit Initialization State
- [ ] T004 Confirm Spec Kit initialization status from filesystem artifacts without reinstall
- [ ] T005 Record initialization uncertainty (if any) and avoid destructive re-init

## Phase 3 - Constitution
- [ ] T006 Preserve existing `.specify/memory/constitution.md` as governing source
- [ ] T007 Validate constitution includes AutoGen mandatory, MCP-first, and no-doc-sprawl governance constraints

## Phase 4 - First Canonical Spec
- [ ] T008 [US1] Complete `specs/001-liquidaity-spec-governance/spec.md` with project definition, user stories, FRs, NFRs, entities, and success criteria
- [ ] T009 [US2] Ensure spec requires inverse audit artifacts before implementation
- [ ] T010 [US5] Ensure spec explicitly prevents fake fallback runtime and preserves AutoGen mandatory behavior
- [ ] T011 [US6] Ensure spec uses stable IDs and graph-memory-compatible requirement structure

## Phase 5 - Docs Map Update
- [ ] T012 [US3] Update `docs/README.md` to classify canonical docs
- [ ] T013 [US3] Update `docs/README.md` to classify historical docs
- [ ] T014 [US3] Update `docs/README.md` to classify external subtree docs
- [ ] T015 [US3] Update `docs/README.md` to classify generated Spec Kit docs and feature specs/ADRs
- [ ] T016 [US4] Ensure docs map states that `docs/architecture.md` remains system truth while specs capture feature intent

## Phase 6 - Validation
- [ ] T017 Run `git status --short`
- [ ] T018 Run `Get-ChildItem -Force .specify`
- [ ] T019 Run `Get-ChildItem -Force specs`
- [ ] T020 Run `Get-ChildItem docs -Recurse -File | Select-Object FullName`

## Phase 7 - Report
- [ ] T021 Produce final report with created/edited files, Spec Kit init status, docs touched, validations run, uncertainty, and forward plan

## Dependencies
- T001-T003 before T008-T016
- T004-T007 before T010
- T008 before T009-T011
- T012-T016 before T020
- T017-T020 before T021

## Parallel Opportunities
- [P] T002 and T003 can run in parallel.
- [P] T009 and T011 can run in parallel after T008.
- [P] T013-T015 can run in parallel once T012 starts the docs map update.

## Suggested MVP Scope
- T001-T008, T010, T012, T017-T021
