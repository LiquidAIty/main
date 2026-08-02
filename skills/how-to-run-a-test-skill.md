# Skill: How To Run A Live Mag One Chat Test

@skill id=how-to-run-a-test
@type Skill
@status active
@related_to magentic-one-runtime
@related_to no-fake-surfaces

## Vector Summary

How to prove the LiquidAIty Agent Builder chat actually works end to end with the real
Magentic-One / Python rails route. The ONLY acceptable proof is the real model answer rendering
in the chat UI. A TypeScript compile is not proof. A backend curl returning HTTP 200 is not proof.
A sleep/echo script is never proof. If the answer does not appear in the chat panel, it is not fixed.

## How To Run The Test

1. Start the canonical full stack once with `npm run dev:fresh`, then confirm frontend 5173,
   backend 4000, and Python rails 8003 are listening. Do not launch individual services.
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

* PASS only when the real model answer renders in the chat UI.
* Never claim success from `npx tsc --noEmit` alone — compile is not behavior.
* Never claim success from a curl HTTP 200 alone — that bypasses the UI and does not prove chat render.
* Never run a `sleep`/`echo`/no-op script and report a fabricated "200"/"ok" result.

## Known Failure Modes

@note id=how-to-run-a-test.rails-down Python rails (8003) not running -> every send fails with PYTHON_AUTOGEN_RAILS_UNAVAILABLE. Fix: start the rails, do not fake an answer.
## Query Patterns

@query id=how-to-run-a-test.run "send a cheap marked prompt through the real Agent Builder chat UI and confirm the real Magentic-One answer renders in the chat panel with the canonical full stack running"
