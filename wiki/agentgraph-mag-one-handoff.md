---
id: feature.agentgraph-mag-one-handoff
title: AgentGraph Mag One Handoff
kind: feature
status: partial
proof_level: source_and_focused_tests

cbm:
  project_identity: C-Projects-main
  index_root: C:/Projects/main
  coverage: registered_queries.py_missing_from_committed_index

roots:
  files:
    - apps/backend/src/coder/openclaude/mcp/liquidAItyAgentFlow.ts
    - apps/backend/src/cards/runtime.ts
    - apps/python-models/app/python_models/agentgraph.py
    - apps/python-models/app/python_models/registered_queries.py
    - apps/python-models/app/python_models/magentic_agentchat.py
  symbols:
    - runMagOne
    - create_instruction
    - create_assignment
    - claim_assignment
    - hydrate_assignment_context
    - execute_binding
    - finish_assignment
    - read_assignment
  tests:
    - apps/backend/src/coder/openclaude/mcp/liquidAItyAgentFlow.spec.ts
    - apps/python-models/app/python_models/test_agentgraph.py
    - apps/python-models/app/python_models/test_registered_queries.py
---

# AgentGraph Mag One Handoff

## Outcome

One saved Main controller sends an approved `instructionId` to the connected Mag One card. TypeScript
transports stable identities and the saved card topology. Python claims the corresponding AgentGraph
assignment, hydrates its exact relational instruction and context references, executes native Mag One,
then persists the correlated result and failure state.

Saved Agent Cards remain the authority for permanent prompt, provider/model, tools, permissions, and
runtime binding. AgentGraph stores operational instructions, assignments, attempts, references, results,
and traversal-worthy lineage; it does not copy card configuration or execute agents itself.

## Registered SQL/Cypher and Graph Views

Registered operations are part of this feature:

- an operation has a stable identity and immutable version;
- parameters are typed and bounded;
- raw SQL/Cypher is never accepted from a prompt or model tool call;
- required bindings materialize bounded Graph Views before model execution;
- optional bindings remain callable through `execute_registered_query`;
- each execution persists the operation version, parameters, Graph View identity, assignment identity,
  and lineage;
- graph-specific authority remains with ThinkGraph, KnowGraph, CodeGraph/CBM, or AgentGraph as selected
  by the registered operation.

The Graph View is the bounded data product agents pass and reference. AgentGraph carries its stable
identity and lineage instead of copying uncontrolled database result blobs between agents.

## Runtime path

```text
run_mag_one({instructionId, projectId, deckId, conversationId})
→ TypeScript resolves the saved Main control edge and connected Mag One worker cards
→ runCardWithContract transports instruction/card/project/run identities
→ Python create_assignment / claim_assignment
→ Python hydrate_assignment_context
   → relational instruction and context references
   → registered operation versions
   → required bounded Graph Views
   → optional execute_registered_query tools
→ native Mag One / AutoGen execution
→ finish_assignment
→ correlated AgentGraph result lineage
```

## Must not break

1. TypeScript does not resolve instruction Markdown, execute SQL/Cypher, or write AgentGraph lineage.
2. Python AutoGen/Mag One remains the execution runtime; PostgreSQL/AGE is storage and lineage.
3. Saved cards remain the permanent configuration authority.
4. Main control and worker eligibility come from saved topology, not card names or TS classifiers.
5. Raw SQL/Cypher from prompts is rejected; models receive only assigned binding IDs and typed parameters.
6. Required Graph Views are materialized before execution; optional results are not injected into every prompt.
7. Results, failures, attempts, cancellation, and parent/child assignments remain correlated by
   stable identities.
8. OpenClaude/Local Coder sessions, terminals, tools, streaming, and provider selection are separate preserved
   runtime boundaries.

## Valid proof

- Backend focused tests prove the saved topology and identity-only Mag One transport.
- Registered-query tests prove typed parameters, read-only enforcement, required/optional binding
  behavior, Graph View materialization, and lineage.
- AgentGraph tests prove exact instruction/assignment/result identity and AGE traversal.
- Python import/type checks and backend typechecks prove imports and contracts after removal of obsolete
  job-folder transport.
- A real product run is still required before this feature can be marked complete.

## CBM limitation

The current committed CBM index resolves `runMagOne` but still describes deleted job-folder callees, and it
returns no node for the tracked, unignored `registered_queries.py`. Current source, focused exact-reference
search, tests, and runtime proof therefore outrank that stale graph edge set until the next post-commit index.
