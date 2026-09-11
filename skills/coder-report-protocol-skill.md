# CoderReport Protocol

@skill id=coder-report-protocol
@type Skill
@status active

Use after a bounded implementation to compare the result with the active request. Recovered
from `2ddadeeb^` and refreshed September 9, 2026. `AGENTS.md` owns the full report contract.

Lead with the observable result and verdict: complete, partial/unproven, or blocked. Include
completed, incomplete and changed requirements; affected files; proof commands and results;
baseline failures; assumptions; and the next bounded task when one is needed. Report the
Preservation Set and actual CBM coverage. Keep the report proportional to the change.

Distinguish source, tests, persistence, loaded runtime, and visible product evidence. A passing
typecheck is not runtime proof; an accepted request is not a completed child Run. Report a
regression ratio only against enumerated exercised invariants, not untested repository health.

Keep work reports in the conversation and existing Run artifacts. Update a canonical document
only when the active PromptSpec authorizes that documentation work. The historical instruction to persist every report comparison
into ThinkGraph is removed: diagnostics and implementation instructions are not project knowledge.
Do not create a report store, task file, freshness gate, or automatic next execution.
