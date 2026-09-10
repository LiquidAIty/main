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

For MCP catalog tests, replace native discovery with fail-on-call guards unless discovery is the
explicit test subject. The application host owns the sole CBM frontend; importing a catalog test
must not acquire that lifecycle. Control inherited allowlists explicitly. Assert the canonical
private tool is present before testing public projection exclusion, preserve native descriptors
and OAuth metadata, and validate supported and invalid runtime inputs against actual schemas.
These boundaries repaired the September 10 failures without changing publication or authentication.

Test runtime-selected documentation against its real file as well as small fixtures. Builder's
PLAN heading accidentally included other roles and audit history despite isolated fixture tests.
Keep those evaluator assertions in tests, outside the selected product section.

Check invocation paths before classifying a source-reading test failure. Some client tests resolve
`client/src/...` against `process.cwd()` and require running Vitest from the repo root with
`--config client/vite.config.ts`. Running those from `client/` produced eight ENOENT failures on
September 10; all 54 tests in the two affected suites passed from root without weakened assertions.
Use `npm --workspace client run build` for the client bundle: the root Vite is 6.3.5 while the client's
own pinned Vite is 7.1.3. A build with the wrong CLI is not the workspace's release-build proof.
