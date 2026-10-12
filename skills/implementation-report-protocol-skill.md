# Reviewed Implementation Reporting

@skill id=implementation-report-protocol
@type Skill
@status active

Use after bounded work to compare the frozen result with the active request. Recovered from
`2ddadeeb^`; the current PromptSpec Receiver and `AGENTS.md` own the reporting contract.

## PromptSpec runs

Load the PromptSpec Receiver first. Primary assembles task outcomes, affected files, proof commands,
baseline failures, assumptions, Preservation Set evidence and actual CBM coverage, then freezes the
implementation. The independent final reviewer inspects that frozen snapshot and writes the sole
repo-root `turn.md` report with:

- PASS or FAIL against every task's Key Objective and Definition of Done;
- completed, incomplete and changed requirements;
- separate source, structural, focused-test, build, loaded-runtime, live-product and visual evidence;
- per-file SHA-256 values and the deterministic combined `REVIEW_SNAPSHOT_SHA256`;
- documentation-coherence findings, deferred proposals and unproven claims.

Primary must not patch implementation or documentation after final review begins. A FAIL stops the
run for owner disposition; it is not permission for same-run repair. For staged PromptSpecs, each
stage receives its own frozen review and `turn.md`, then stops for owner review, save and approval.

## Non-PromptSpec fallback

Lead with the observable result and verdict: complete, partial/unproven, or blocked. Include affected
files, evidence, baseline failures, assumptions and the next bounded task. Keep the report in the
conversation unless the user explicitly authorizes a document. Distinguish source, tests, persistence,
loaded runtime and visible product evidence. A passing typecheck is not runtime proof; an accepted
request is not a completed child Run. Report a regression ratio only against enumerated exercised
invariants, never as a claim of untested repository health.

The historical instruction to persist report comparisons into ThinkGraph remains removed:
diagnostics and implementation instructions are not project knowledge. Do not create a report store,
freshness gate, automatic next execution or competing task file.
