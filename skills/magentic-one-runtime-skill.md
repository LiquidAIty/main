# Native Magentic-One Runtime

Use this procedure only for the real Python-rails `MagenticOneGroupChat` boundary.

## Invariants

1. The saved Magentic-One Card owns provider/model/runtime configuration.
2. The saved `magentic_control` edge owns who may start it.
3. Saved `magentic_option` edges own worker eligibility.
4. The approved transient Mag One Card input carries task meaning and selected native references.
5. `run_mag_one` is the one team-run MCP entrypoint.
6. Task and Progress Ledgers remain private AutoGen state.
7. No TypeScript participant classifier, hidden provider substitution, copied ledger, or fallback team.
8. A Hermes-backed Card is a Mag One worker only when its current saved `magentic_option` edge makes it
   eligible. The saved Local Coder is currently connected; no title, profile, or prompt implies membership.
9. Supply all eligible connected Cards. Do not add per-Run worker subsets, Main-selected speakers,
   candidate intersections, or manual worker sequences. An unused participant is not a failed member.
10. Distinguish native task completion from the pinned `Max rounds reached.` termination. A native
    final answer may exist after exhaustion; nonempty text alone is not successful completion.

## Discovery

Use the application-published `cbm.*` doorway on `C-Projects-LiquidAIty-main` to resolve `run_mag_one`, the configured Card runner,
roster composition, and AGE relationship checks. Direct-read the Python implementations and focused
tests after CBM bounds the slice.

## Proof

- saved Magentic-One Card and connected roster readback;
- exact one-call field equality at the Python runtime boundary;
- native `MagenticOneGroupChat` construction with no private-ledger interception;
- provider/model chosen only from the saved Card;
- one explicitly approved bounded live run, with tokens/cost and truthful Run/AGE completion.

Do not execute a provider or model during an audit or cleanup task.

## Characterization before live acceptance

Use the checked-in 0.7.5 `MagenticOneGroupChat` with deterministic model responses for mechanical
tests. Do not mock away the native loop or subclass its Orchestrator to capture private ledgers.
Check the full saved roster, exact descriptions, native public selection events, child-Run lineage,
stall recovery, explicit termination, and safe failures. Keep test fixtures distinct from product
proof. Native lifecycle evidence must not persist private Task/Progress Ledgers or reasoning.

On 2026-09-03, a provider-free native replay confirmed that the saved two-turn setting permits three
worker selections before the pinned `>` round check terminates. The old adapter incorrectly reported
that exhaustion as success. It also supplied `hermes/delegate` as every Hermes worker description.
The source repairs these projection/result defects, but the full-team live acceptance remains
unproven; failed historical receipts lacking stage data must not be retrospectively given a cause.
