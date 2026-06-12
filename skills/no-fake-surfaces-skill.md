# Skill: No Fake Surfaces

@skill id=no-fake-surfaces
@type Skill
@status active
@related_to spec-as-prompt
@related_to coder-report-protocol

## Vector Summary

Keep every visible planning, execution, proof, and memory surface honest: no stubs, fake fallback,
silent fallback, road-sign planning, fake preview, invented provenance, or hidden success.

## Guardrails

@guardrail id=no-fake-surfaces.no-stubs
@guardrail id=no-fake-surfaces.no-fake-fallback
@guardrail id=no-fake-surfaces.no-silent-fallback
@guardrail id=no-fake-surfaces.no-hidden-success
@guardrail id=no-fake-surfaces.no-road-signs
@guardrail id=no-fake-surfaces.no-deterministic-fake-planning
@guardrail id=no-fake-surfaces.no-run-preview

* PlanFlow shows active planning/control state, not a document library or fake planner summary.
* Runtime success requires real runtime evidence.
* Planner/model provenance requires a real planner/model path.
* Errors and blockers remain visible.

## Query Patterns

@query id=no-fake-surfaces.audit "search changed surfaces for preview, fallback, placeholder, stub, fake success, invented planner provenance, and document-library PlanFlow language"
