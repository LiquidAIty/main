# Context to Active Prompt

@skill id=graph-context-prompt-writer
@type Skill
@status active
@related_to codegraph
@related_to skill-packet-fable-handoff

Use when translating an actual user request into a bounded agent/coding mission. Recovered
from `2ddadeeb^` and refreshed September 9, 2026.

When a PromptSpec is active, load the PromptSpec Receiver first. It owns the ordered tasks,
Key Objectives, Definitions of Done, support-agent roles, implementation authority, freeze and
final review. This skill only helps select and transmit the minimum useful context for one of
those tasks; it does not create another specification or approval workflow.

1. Identify the requested outcome, preservation set and current scope. Preserve exploratory
   statements as tentative; assistant proposals do not become accepted user decisions.
2. Select only relevant evidence: ThinkGraph intent, KnowGraph sourced findings, CodeGraph
   source structure, or a needed procedure. The task does not automatically need all four.
3. Carry native IDs, necessary bounded content, provenance, uncertainty and retrieval capability.
   Preserve the distinction between task data and stable receiving-Card instructions.
4. For coding, include the task's Key Objective, Definition of Done, affected scope, source anchors,
   proof and stop conditions in its PromptSpec task handoff. Existing authorization governs execution;
   this skill adds no review gate.
5. The receiving Card owns its saved prompt, model and grants. Python
   `apps/python-models/app/python_models/idf.py::materialize_idf` owns the one runtime input.

Do not automatically append whole schemas, all skills, app code or every graph. Resolve the
effective selected tool contracts through the existing runtime, not a keyword-based tool router.
Avoid duplicating the same selected data in task prose and a second context block. Verify what
the adapter actually sends before calling retained metadata prompt overhead.

No SkillGraph import prerequisite, competing prompt file, second materializer, automatic CBM
refresh, or report-to-graph write. A prompt for an agent remains the user's work, not a diagnostic
test instruction disguised as user chatter.
