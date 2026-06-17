# Skill: How To Run A Live Mag One Chat Test

@skill id=how-to-run-a-test
@type Skill
@status active
@related_to magentic-one-runtime
@related_to no-fake-surfaces
@related_to planflow-no-deterministic-projection

## Vector Summary

How to prove the LiquidAIty Agent Builder chat actually works end to end with the real
Magentic-One / Python rails route. The ONLY acceptable proof is the real model answer rendering
in the chat UI. A TypeScript compile is not proof. A backend curl returning HTTP 200 is not proof.
A sleep/echo script is never proof. If the answer does not appear in the chat panel, it is not fixed.

## How To Run The Test

1. Confirm all three dev services are listening: frontend 5173, backend 4000, Python rails 8003.
   - If 8003 is missing the chat goes silent (rails down). Start the whole stack with `npm run dev:all`,
     or start only the rails with `npm run dev:autogen` (uvicorn app.main:app on 127.0.0.1:8003).
2. Open Agent Builder in the running app for the real loaded project (do not invent a project/deck id;
   use the one already open in the URL, e.g. `?projectId=...`, with its real deck and its real
   magentic_one card already on the canvas).
3. In the chat, type a cheap real prompt with a unique marker word so the new answer is unambiguous,
   e.g. `Tell me a one-sentence joke about penguins.`
4. Send it through the real UI chat control (not a backend call).
5. Wait for the real run, then confirm the new model answer text appears as an assistant bubble in the
   chat panel — containing the marker (a penguin joke). That is the pass condition.

## Pass / Fail

@guardrail id=how-to-run-a-test.ui-answer-is-the-only-proof
@guardrail id=how-to-run-a-test.no-compile-only-claim
@guardrail id=how-to-run-a-test.no-curl-200-claim
@guardrail id=how-to-run-a-test.no-fake-script
@guardrail id=how-to-run-a-test.artifact-never-suppresses-answer

* PASS only when the real model answer renders in the chat UI.
* Never claim success from `npx tsc --noEmit` alone — compile is not behavior.
* Never claim success from a curl HTTP 200 alone — that bypasses the UI and does not prove chat render.
* Never run a `sleep`/`echo`/no-op script and report a fabricated "200"/"ok" result.
* The Task Ledger artifact may exist on the same turn; it must NEVER replace or hide the real answer.

## Known Failure Modes

@note id=how-to-run-a-test.rails-down Python rails (8003) not running -> every send fails with PYTHON_AUTOGEN_RAILS_UNAVAILABLE. Fix: start the rails, do not fake an answer.
@note id=how-to-run-a-test.answer-suppressed Chat shows "Task Ledger artifact captured on canvas" / "Plan created on canvas" instead of the real answer -> a suppression gate is hiding finalText whenever taskLedgerArtifact exists. Fix: real finalText wins for chat; artifact is a separate surface.

## Query Patterns

@query id=how-to-run-a-test.run "send a cheap marked prompt through the real Agent Builder chat UI and confirm the real Magentic-One answer renders in the chat panel; rails 8003 up; artifact must not suppress the answer"
