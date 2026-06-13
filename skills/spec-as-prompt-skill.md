# Skill: Prompt As Spec And Task

@skill id=spec-as-prompt
@type Skill
@status active
@related_to context-packet
@related_to coder-report-protocol
@requires fresh_cbm_index

## Vector Summary

Use one temporary, reviewable CoderPacket prompt as both the complete spec and the complete task for
a bounded part of `PLAN.md`. Never create spec files or task files.

## Procedure

1. Read `PLAN.md` and current PlanFlow state.
2. Pull a Context Packet with fresh CBM/code anchors and relevant skills.
3. Create one active CoderPacket prompt containing requirements, scope, proof, and stop conditions.
4. Let the user review or edit the active prompt.
5. Send it to a coder only after Go.
6. Compare the returned CoderReport against every prompt requirement.
7. Keep durable direction in `PLAN.md` and reusable learning in skills.

## Guardrails

@guardrail id=spec-as-prompt.no-spec-folder
@guardrail id=spec-as-prompt.no-spec-files
@guardrail id=spec-as-prompt.no-task-files
@guardrail id=spec-as-prompt.one-active-job

* The active CoderPacket prompt is both spec and task.
* There is no `specs/` folder, task file, task ledger, or spec export.
* PlanFlow shows one active CoderPacket, never a spec or task library.

## Query Patterns

@query id=spec-as-prompt.current-law "direct-read PLAN.md and AGENTS.md, retrieve fresh CBM and relevant skills, then create one active CoderPacket prompt as both spec and task"

## Core-Law Cleanup Attempt

@attempt id=spec-as-prompt.remove-spec-and-task-files
@status active
@source_prompt "remove the specs folder and make the active prompt both spec and task"
@requires_fresh_cbm true

@attempt_result id=spec-as-prompt.remove-spec-and-task-files
@status succeeded
@cbm_after nodes=4650 edges=8255
@proved_by the specs folder and obsolete active task file were removed
@proved_by the Spec-Kit scaffold was removed and PlanFlow no longer scans or renders a spec/task-file hierarchy
@proved_by SkillGraph ingestion replaces importer-owned memory and live retrieval contains no legacy spec relationships
@validated_by 51 SkillGraph tests, 5 focused PlanFlow tests, backend TypeScript compile, client TypeScript compile, focused audits, and live skill ingestion
@touches_code PLAN.md
@touches_code AGENTS.md
@touches_code services/knowgraph/skill_ingest.py
@touches_code apps/backend/src/services/planflow/planFlowProjection.ts
@touches_code client/src/features/agentbuilder/plan/planFlowProjection.ts

## First PlanFlow Go Attempt

@attempt id=spec-as-prompt.planflow-go
@status succeeded
@source_prompt "implement the first real LiquidAIty chat-to-coder loop"
@requires_fresh_cbm true

@attempt_result id=spec-as-prompt.planflow-go
@status succeeded
@cbm_before nodes=4620 edges=8499
@cbm_after nodes=4640 edges=8596
@proved_by PlanFlow accepts exactly one validated CoderPacket for the selected project before Go
@proved_by Go sends the accepted packet to POST /api/coder/localcoder/run and renders blocked reports returned with HTTP 424
@proved_by the report comparison, blockers, proof, and next recommended task remain visible without starting another job
@validated_by 7 focused client checks, 19 combined focused checks, clean backend TypeScript compile, and live browser proof
@guardrail never manufacture planner provenance from raw chat text
@guardrail preserve blocked and failed CoderReports instead of treating non-2xx as absent output
@touches_code client/src/features/agentbuilder/plan/coderLoop.ts
@touches_code client/src/features/agentbuilder/plan/ActiveCoderJobPanel.tsx
@touches_code client/src/pages/agentbuilder.tsx
@touches_code apps/backend/src/coder/localcoder/adapter.ts
