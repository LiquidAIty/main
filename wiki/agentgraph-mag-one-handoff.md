---
id: feature.agentgraph-mag-one-handoff
title: AgentGraph Mag One Handoff
kind: feature
status: partial
proof_level: source_and_focused_tests

cbm:
  project_identity: C-Projects-main
  index_root: C:/Projects/main
  coverage: committed_graph_plus_working_tree_direct_reads

roots:
  files:
    - apps/backend/src/coder/openclaude/mcp/liquidAItyAgentFlow.ts
    - apps/backend/src/cards/runtime.ts
    - apps/python-models/app/python_models/agentgraph.py
    - apps/python-models/app/python_models/magentic_agentchat.py
  symbols:
    - runMagOne
    - create_instruction
    - create_assignment
    - claim_assignment
    - read_assignment
    - finish_assignment
  tests:
    - apps/backend/src/coder/openclaude/mcp/liquidAItyAgentFlow.spec.ts
    - apps/python-models/app/python_models/test_agentgraph.py
    - apps/python-models/app/python_models/test_autogen_adapter.py
---

# AgentGraph Mag One Handoff

## Outcome

One saved Main controller sends an approved `instructionId` to the connected Mag One card. TypeScript
transports stable identities and the saved card topology. Python claims the corresponding AgentGraph
assignment, hydrates its exact relational instruction and context references, executes native Mag One,
then persists the correlated result and failure state.

Saved Agent Cards remain the authority for permanent prompt, provider/model, tools, permissions, and
runtime binding. AgentGraph stores operational instructions, assignments, attempts, references, results,
and traversal-worthy lineage; it does not copy card configuration, native graph records, or execute
agents itself. The sender chooses bounded instruction text and typed native references. The receiving
agent reads that handoff directly; native Engraphis, Graphiti, or CBM tools are available only when the
agent needs to inspect the referenced source more deeply.

## Runtime path

```text
run_mag_one({instructionId, projectId, deckId, conversationId})
→ TypeScript resolves the saved Main control edge and connected Mag One worker cards
→ runCardWithContract transports instruction/card/project/run identities
→ Python create_assignment / read_assignment / claim_assignment
   → exact instruction text
   → typed native context references selected by the sender
→ native Mag One / AutoGen execution
→ finish_assignment
→ correlated AgentGraph result lineage
```

## Must not break

1. TypeScript does not resolve instruction Markdown, execute SQL/Cypher, or write AgentGraph lineage.
2. Python AutoGen/Mag One remains the execution runtime; PostgreSQL/AGE is storage and lineage.
3. Saved cards remain the permanent configuration authority.
4. Main control and worker eligibility come from saved topology, not card names or TS classifiers.
5. AgentGraph handoffs contain bounded text and native references, never copied graph records or saved queries.
6. Receiving agents read the handoff without receiver-specific query registration or another policy layer.
7. Results, failures, attempts, cancellation, and parent/child assignments remain correlated by
   stable identities.
8. OpenClaude/Local Coder sessions, terminals, tools, streaming, and provider selection are separate preserved
   runtime boundaries.

## Valid proof

- Backend focused tests prove the saved topology and identity-only Mag One transport.
- Mag One adapter tests prove exact AgentGraph instruction/reference delivery before model construction.
- AgentGraph tests prove exact instruction/assignment/result identity and AGE traversal.
- Python import/type checks and backend typechecks prove imports and contracts after removal of obsolete
  job-folder transport.
- A real product run is still required before this feature can be marked complete.

## CBM limitation

The committed CBM graph is a structural anchor. Direct working-tree reads and focused tests outrank it
while this cleanup remains uncommitted; refresh after the completed change is committed.
