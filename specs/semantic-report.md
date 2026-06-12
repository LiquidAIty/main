# SemanticReport

## Purpose

Define FableCoder's graph-friendly, evidence-bound report after coding and validation.

## Scope

A SemanticReport explains what changed, what proof ran, what claims are supported, what failed, and
what should enter ThinkGraph task memory. It references the raw patch instead of embedding it.

## Non-Goals

It is not a raw diff, chat transcript, unverified success claim, KnowGraph promotion, or permission
to implement additional ideas.

## Inputs

* executed CodeTaskPacket
* patch artifact and hash
* validation command outputs
* refreshed CodeGraph/CBM evidence when available

## Outputs

* OWL-ish graph records
* vector-friendly summary
* evidence-bound claims and validation states
* OutOfScopeObservations
* patch reference

## Schema

```json
{
  "@type": "SemanticReport",
  "id": "semantic-report:<task-id>",
  "taskPacketRef": "packet:<task-id>",
  "state": { "@type": "TaskState", "status": "complete", "properties": {} },
  "vectorSummary": "compact retrieval summary",
  "entities": [{ "id": "entity", "type": "File|Symbol|Test|Validation|Patch", "properties": {} }],
  "relationships": [{ "from": "id", "to": "id", "type": "verb", "properties": {} }],
  "claims": [{ "id": "claim", "text": "string", "evidenceRefs": ["evidence"], "properties": {} }],
  "evidence": [{ "id": "evidence", "sourceRef": "string", "properties": {} }],
  "validations": [{ "id": "validation", "status": "passed|failed|blocked", "evidenceRefs": ["evidence"], "properties": {} }],
  "patch": { "@type": "PatchReference", "path": "tasks/<task-id>.patch", "hash": "string" },
  "outOfScopeObservations": [{ "@type": "OutOfScopeObservation", "summary": "string", "evidenceRefs": ["evidence"] }],
  "provenance": { "executor": "FableCoder", "sourceRefs": ["evidence"] }
}
```

Numeric values appear only inside record `properties`.

## Artifacts

* `tasks/<task-id>.semantic-report.json`
* referenced `tasks/<task-id>.patch`
* ThinkGraph records derived from the report

## Validation

Every completion claim has validation evidence. Failed or blocked proof remains explicit. The patch
path and hash resolve. The report contains no embedded raw diff. Out-of-scope ideas are observations
only.

## Risks

Semantic compression can omit important failure detail. Unsupported claims can pollute future
planning. KnowGraph promotion must remain a later evidence-reviewed action.

## Next Tasks

After T001, define and implement the smallest SemanticReport-to-ThinkGraph write path.
