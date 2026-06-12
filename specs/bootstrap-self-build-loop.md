# Bootstrap Self-Build Loop

## Purpose

Define the temporary outside planning triangle that lets CodeSpine / LiquidAIty remember and
improve its own build process before planning moves into the product UI.

## Scope

The loop coordinates ChatGPT planner, Codex middle scout, FableCoder, ThinkGraph, CodeGraph, and
KnowGraph through TaskRealm, CodeTaskPacket, SemanticReport, and referenced patch artifacts.

## Non-Goals

No runtime implementation in this planning pass. No AgentChat, Semantic Kernel, Microsoft Agent
Framework, AutoGen Studio, full autonomous runtime, marketplace, giant graph UI, LocalScout
implementation, local coding runner, or fake validation.

## Inputs

* user request and planner intent
* fresh CBM graph evidence
* focused exact-search results
* direct file reads
* relevant ThinkGraph and KnowGraph context

## Outputs

* one bounded TaskRealm
* one executable CodeTaskPacket
* one referenced patch artifact after coding
* one evidence-bound SemanticReport
* ThinkGraph-style task memory for the next planning turn

## Schema

```json
{
  "loop": {
    "planner": "ChatGPT",
    "scout": "Codex",
    "executor": "FableCoder",
    "futureScout": "LocalScout"
  },
  "flow": [
    "Intent",
    "TaskRealm",
    "CodeTaskPacket",
    "PatchReference",
    "SemanticReport",
    "ThinkGraphMemory"
  ]
}
```

## Artifacts

* `PLAN.md`
* `skills/codebasedmemory.md`
* `specs/bootstrap-self-build-loop.md`
* `specs/task-realm.md`
* `specs/code-task-packet.md`
* `specs/semantic-report.md`
* `tasks/<task-id>.md`
* future `tasks/<task-id>.packet.json`, `.patch`, and `.semantic-report.json`

## Validation

The loop is ready when a task can be scoped from fresh repo evidence, handed to Fable without broad
discovery, validated honestly, and represented as graph-friendly memory without embedding raw
diffs.

## Risks

Stale CBM can poison scope. Weak evidence can make packets confidently wrong. Markdown artifacts
are bootstrap transport, not the final UI or graph persistence mechanism.

## Next Tasks

Execute T001, then define the smallest real SemanticReport-to-ThinkGraph ingestion boundary.
