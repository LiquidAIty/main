# TaskRealm

## Purpose

Define the scoped graph slice within which an agent may act for one user request.

## Scope

A TaskRealm binds intent, evidence, allowed repo structure, forbidden boundaries, hypotheses,
validation, and stop conditions. Frontend/planner creates the realm; the middle scout grounds it.

## Non-Goals

A TaskRealm is not a full repo map, autonomous work queue, permission bypass, or invitation to fix
adjacent problems.

## Inputs

* planner intent
* fresh CBM nodes and edges
* focused search findings
* direct-read evidence
* relevant ThinkGraph and KnowGraph records

## Outputs

* bounded execution scope for one CodeTaskPacket
* explicit OutOfScopeObservations
* evidence references usable by FableCoder and SemanticReport

## Schema

```json
{
  "@type": "TaskRealm",
  "id": "task-realm:<task-id>",
  "objective": "string",
  "state": { "@type": "TaskState", "status": "planned" },
  "allowed": {
    "files": ["path"],
    "symbols": ["qualified-name"],
    "operations": ["operation"]
  },
  "forbidden": {
    "files": ["path"],
    "systems": ["system"],
    "operations": ["operation"]
  },
  "graphSlice": {
    "nodes": [{ "id": "graph-node", "type": "string", "properties": {} }],
    "relationships": [{ "from": "id", "to": "id", "type": "verb", "properties": {} }]
  },
  "claims": [{ "id": "claim", "text": "string", "evidenceRefs": ["evidence"] }],
  "hypotheses": [{ "id": "hypothesis", "text": "string", "properties": {} }],
  "validations": [{ "id": "validation", "command": "string", "properties": {} }],
  "stopConditions": ["condition"],
  "outOfScopeObservations": []
}
```

## Artifacts

The human-readable realm lives in `tasks/<task-id>.md`; its future machine form may live inside
`tasks/<task-id>.packet.json`.

## Validation

Every allowed file is direct-read or explicitly marked for executor confirmation. Every repo claim
has evidence. Forbidden boundaries and stop conditions are explicit. An agent can determine whether
an idea is inside scope without guessing.

## Risks

An overly broad realm wastes paid coding time. An overly narrow realm may block a necessary local
change. Missing evidence must block packet readiness rather than invite invention.

## Next Tasks

Use this schema to execute T001 and refine only from observed execution evidence.
