# Bounded PromptSpec Task Handoff

@skill id=skill-packet-fable-handoff
@type Skill
@status active
@related_to graph-context-prompt-writer
@related_to implementation-report-protocol

Historical filename retained during the September 9, 2026 recovery from `2ddadeeb^`.
Use for handing an authorized bounded coding task to the correct saved Card or an explicitly
requested external coding agent. It does not select a legacy Fable runtime.

When a PromptSpec is active, load the PromptSpec Receiver first. That process owns task order,
Key Objectives, Definitions of Done, support-agent limits, sole code-writing authority, freeze
and final review. This skill only defines the context passed to an already-authorized recipient.

Identify the actual recipient, selected repository, project and conversation. Saved Card `builder`
owns app implementation and Card construction. Use
saved topology and the recipient's native path, not a title guess.

Supply the assigned task's Key Objective and Definition of Done, preservation set, selected
source/graph references, relevant procedure, proof commands and stop conditions. The active
PromptSpec remains the specification; do not create another spec/task file or copy a whole research
history into the handoff. The receiving Card materializes its IDF.

Require an evidence-backed completion report to Primary and compare its claims with the assigned task.
An accepted child is not a completed child. Agent 3's repo-root `turn.md` is the final report for a
PromptSpec run. Preserve native asynchronous completion where supported; do not create a second
scheduler, retry a running job, or make Main wait for unrelated work.

Prior user authorization persists; do not demand another generic Go. No automatic writes of
handoff diagnostics into ThinkGraph. Update canonical architecture or reusable skills only when
the active PromptSpec authorizes that documentation work.
