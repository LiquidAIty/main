# Test the Actual Product Path

@skill id=how-to-run-a-test
@type Skill
@status active
@related_to conversation-graph-acceptance
@related_to double-agent-standin

Use to choose and execute a meaningful test for the requested behavior. Recovered from
`2ddadeeb^` and refreshed September 9, 2026. Main is Hermes; the old instruction to treat
ordinary Main chat as a Magentic-One test is obsolete. Builder/CLI tests require an actual
Builder/CLI task and authorization, not merely available controls.

1. Name the behavior, affected preservation invariants, and what result could disprove success.
2. Inspect the existing test and current runtime owner. Run the smallest useful baseline.
3. Use focused structural tests for deterministic behavior. Use actual ordinary user input
   through the product UI when proving chat behavior. Keep diagnostic instructions out of it.
4. Correlate the exact saved Card/Run, effective model and tools, real result, and visible output.
   Test persistence or later recall only when relevant; do not script Main into readback loops.
5. Record time and actual token receipts for model tests. Reuse retained failures for diagnosis
   before repeating expensive runs. Repeat only for a changed hypothesis or unresolved failure.

Inspect the existing canonical stack before startup. Do not launch duplicate services. When
startup is authorized and needed, `npm run dev:fresh` owns the full application tree; do not
repair a failing component by introducing a second process. If Docker is down, stop and tell
the owner as requested. Do not restart Docker or reset its data.

Observe a running test rather than launching it again. A progressing build may take longer than
a minute; use bounded waits and meaningful progress updates. A timeout is not proof that a child
failed. Inspect its existing state before any retry, stop, or re-dispatch.

HTTP 200, compile success, a mock, or an external stand-in is not proof that the user's UI path
works. Conversely, do not launch a live model to test a reversible CSS or schema change when
the relevant deterministic and visual checks suffice. Report proof tiers separately.
