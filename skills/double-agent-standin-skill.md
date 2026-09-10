# Double-Agent Stand-In

@skill id=double-agent-standin
@type Skill
@status active
@related_to conversation-graph-acceptance

## Purpose and recovery

Do the actual product job while independently inspecting the boundary for defects and waste.
Recovered from `2ddadeeb^` at the owner's request on September 9, 2026. The original July
procedure proved useful for finding context and execution leaks. Its old model assignments,
tool names, KG campaign, mandatory graph reports, and zero-cost claim are superseded.

## Two intents in every job

1. **Product work:** act as an ordinary user of the selected capability, or as the specified
   Card's stand-in. State which position is being played. Complete the real task with a useful
   answer, evidence, or permitted operation; evaluation alone does not satisfy this intent.
2. **Evaluation:** separately inspect context quality, duplicate reads/work, tool usability,
   attribution, missing results, elapsed time, and cost evidence. Keep diagnostic instructions
   and reports outside the product conversation and graph writes.

Start with Main. Use one bounded job before increasing agent count. Every additional subagent
also carries both intents. Match its requested model to the saved Card selection when available;
report any mismatch in model, reasoning setting, tools, history, or runtime. Do not change Cards
to fit the test. An external stand-in is not the Hermes runtime, even when its model matches.

## Preparation

- Identify project, conversation, task, Card, and exact retained Run/input when applicable.
- Read only relevant role instructions, selected context, and callable tool contracts. Inspect
  the actual saved/runtime input before calling it representative; do not invent a second IDF.
- Keep a small record of supplied versus inspected material. Retained runtime settings and
  schemas are not automatically provider-visible prompt text; trace the final adapter to prove that.
- Verify real doorways through current source/catalog and effective grants. Existing
  `skills/codebasedmemory.md` owns code discovery. Do not restore historical tool names.
- Distinguish an external stand-in, a user testing the real Card, and a live Card run. Use the
  same task for a controlled comparison; label changes in tools, context, or source dates.

## Stopwatch and scale

Record wall-clock start/end and relevant tool timings. Separate startup, queueing, inference,
retrieval, and final delivery when receipts support it. Record input/output bytes or characters
with units, tool calls, repeated requests, and provider input/output/cached/reasoning tokens
where exposed. Unknown token usage is unknown, not zero; an external subagent is not free.

Cached repeated input, duplicated material within one request, and repeated research are different
findings. A large schema is not itself proof of waste. Report whether the agent needed the tool,
whether the same information already existed, and whether it helped complete the task. Do not
invent numerical attention, actually-used-token counts, or subjective precision scores.

## Job report

**A. Position output:** the real user-facing result, with native references and sources where relevant.

**B. Evaluation:** position/model/runtime; project/conversation/task; elapsed time; measurable input,
retrieval and output sizes; token receipts or unknown; tool calls; duplicate work; useful/missing
context; observed defects versus hypotheses; actual writes or missing capability; next discriminating
check. Explain severity using the consequence, not a fabricated quality score.

Useful defect categories: context, retrieval, execution, persistence, scope, authority, proof,
visualization, attribution, and cost. Report the earliest evidenced failure, not merely its symptom.
Do not promote an evaluator's recommendation into an accepted design change.

## Keep the real task moving

Repair a proven blocker within the authorized boundary and retest that case. Other observations
stay in the report or the existing canonical plan when they merit follow-up. No duplicate fan-out
just to reconfirm a finding, no new diagnostic store, no automatic report-to-graph ingestion.

Use actual native write tools only when writes are authorized for the test. Otherwise label proposed
payloads unexecuted. Do not fabricate a successful operation or pollute production with fixtures.
An independent persistence check may establish a write; Main must not perform repetitive readback
as conversational behavior. Preserve graph data, Cards, sessions, and unrelated work.

Give separate verdicts for useful product work and the integration under evaluation. A good
stand-in answer can coexist with unproven Hermes execution or a poor graph result.
