# CodeTaskPacket

## Purpose

Define the isolated, evidence-grounded execution packet handed to FableCoder.

## Scope

The packet translates one approved TaskRealm into exact coding work, proof commands, output
artifacts, and stop conditions. FableCoder codes; the middle scout does not.

## Non-Goals

The packet is not a conversation transcript, broad repo exploration prompt, autonomous backlog,
raw diff container, or authority to implement OutOfScopeObservations.

## Inputs

* one approved TaskRealm
* direct-read file and symbol evidence
* relevant CodeGraph relationships
* required validations
* one KnowGraph Skill Memory Packet (see `specs/skill-packet-fable-handoff-spec.md`)

## Outputs

* bounded code changes
* referenced `.patch`
* validation results
* one SemanticReport

## Schema

```json
{
  "@type": "CodeTaskPacket",
  "id": "packet:<task-id>",
  "taskRealmRef": "task-realm:<task-id>",
  "executor": "FableCoder",
  "objective": "string",
  "allowedFiles": ["path"],
  "allowedSymbols": ["qualified-name"],
  "requiredReads": ["path"],
  "intendedDelta": ["claim"],
  "forbidden": ["boundary"],
  "evidenceRefs": ["evidence"],
  "validations": [{ "id": "validation", "command": "string", "properties": {} }],
  "outputs": {
    "patchRef": "tasks/<task-id>.patch",
    "semanticReportRef": "tasks/<task-id>.semantic-report.json"
  },
  "stopConditions": ["condition"]
}
```

## Artifacts

* human task brief: `tasks/<task-id>.md`
* future packet: `tasks/<task-id>.packet.json`
* raw diff: `tasks/<task-id>.patch`
* execution meaning: `tasks/<task-id>.semantic-report.json`

## Validation

The packet is ready only when it can be executed cold: exact scope, intended delta, evidence,
forbidden work, proof commands, artifacts, and stop conditions are present. Missing proof or scope
evidence blocks execution.

## Risks

Over-specified implementation can preserve a bad assumption. Under-specified scope makes Fable
repeat discovery. Packet claims must distinguish proven facts from hypotheses.

## Next Tasks

Create the machine-readable packet only when T001 begins execution; stop before unrelated work.
