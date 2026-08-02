---
id: feature.saved-agent-card-runtime
title: Saved Agent Card Runtime Resolution
kind: feature
status: partial
proof_level: cbm_path_proven

cbm:
  project_identity: C-Projects-main
  index_root: C:/Projects/main
  full_index_nodes: 5273
  full_index_edges: 10327
  freshness: ready

roots:
  files:
    - apps/backend/src/cards/runtime.ts
    - apps/backend/src/cards/runConfiguredCard.spec.ts
    - apps/backend/src/cards/runtime.spec.ts
  symbols:
    - runConfiguredCard
    - resolveCardModelStrict
    - resolveCardTools
    - buildPythonAutoGenCardRuntimePayload
    - runCardWithContract
    - serializeCardParticipant
    - normalizeLocalCoderControllerCard
  routes:
    - POST /api/coder/mcp-bridge/run_configured_card
  tests:
    - runConfiguredCard.spec.ts
    - runtime.spec.ts
---

# Saved Agent Card Runtime Resolution

## What this is

When the Harness opens a saved-card doorway, the backend resolves the card's
model, provider, tools, and runtime binding from the canonical deck document — never from
role heuristics, caller overrides, or model inference. Missing or mismatched config
produces a structured error, not a silent fallback.

## What the user/agent experiences

Saved-card doorway → backend reads the saved deck, validates the card, builds the AutoGen
payload, and dispatches to Python rails. Agent Canvas only edits and saves cards; it has no
separate Run Card/Run Deck/Task execution surface.
Outcomes: `completed`, `failed`, `not_found`, `disabled`. All carry the caller's
`correlationId`.

## How it works

```
card.run_assistant_agent                           [mcp_host.py]
  → card_run_assistant_agent                       [control_plane.py]
  → POST /api/coder/mcp-bridge/run_configured_card
  → runConfiguredCard                              [runtime.ts]
    → getDeckDocument → find card → validate enabled
    → resolveCardModelStrict / resolveCardTools
    → buildPythonAutoGenCardRuntimePayload
    → runSingleCardWithAutoGen
      → Python run_configured_card                  [magentic_agentchat.py]
        → AgentGraph read_context (when agentContextId exists)
        → AssistantAgent.run
        → AgentGraph record_result
```

## Must not break

1. Card config is authoritative — `resolveCardModelStrict` and `resolveCardTools` both
   call `normalizeLocalCoderControllerCard` first. No fallback to role inference.
2. Caller overrides structurally rejected by `runConfiguredCard`.
3. No auto-injected tools — exactly the card editor's Tools tab selection.
4. `not_found`, `disabled`, and config errors (`card_model_config_missing`,
   `card_model_config_mismatch`) are honest — never a fabricated run.
5. correlationId preserved through the entire chain.
6. Durable constants stay on saved cards/runtime, not in AgentGraph instructions.
   Card config owns system prompt/role definition, model/provider, selected tools,
   what the agent does/does not do, output expectations, graph write permissions,
   runtime binding, and card-specific behavior rules. AgentGraph owns run-specific
   instructions, assignments, references, and correlated results.
7. Hooks/runtime gates enforce invariants: no commit/push unless explicitly allowed,
   no Local Coder unless selected, no Magnetic One graph write authority, CodeGraph
   measurement-only, required packet exists before run, CBM dirty-overlay warnings,
   exact-byte packet readback, card-owned tool calls only, and graph writes only through
   the owning graph authority. Hooks must not become phrase-based workflow routers,
   deterministic user-intent classifiers, or hidden model/tool fallback.

## Start in CBM

```
# Use project name, not filesystem path:
search_graph(project="C-Projects-main", query="runConfiguredCard")
search_graph(project="C-Projects-main", query="resolveCardModelStrict")

# trace_path uses simple function names, not qualified names:
trace_path(project="C-Projects-main", function_name="runConfiguredCard",
           mode="calls", direction="outbound", depth=2)

# index_status uses project name:
index_status(project="C-Projects-main")
```

The call chain is CBM-path-proven: `runConfiguredCard` → `resolveCardModelStrict` →
`buildPythonAutoGenCardRuntimePayload` → `runSingleCardWithAutoGen` are connected by
CALLS edges discoverable via `trace_path`.

## Valid proof

```typescript
import { runConfiguredCard } from './runtime';
const result = await runConfiguredCard({
  projectId: 'proj-1', deckId: 'deck_builder',
  cardId: 'card_local_coder', correlationId: 'corr-verify',
  input: 'List the files you have access to.',
});
assert(result.status !== 'not_found' && result.status !== 'disabled');
assert(result.correlationId === 'corr-verify');
```

Use the focused mocked transport tests for ordinary proof. A live call is billable and must
be explicitly authorized. Unit proof establishes saved config resolution, exact identifier
transport, Python context scoping, and result-lineage handling without a provider call.

## Limitations

- **trace_path** accepts only simple function names, not qualified names. Store
  `runConfiguredCard` (not `C-Projects-main.apps.backend.src.cards.runtime.runConfiguredCard`).
- **index_status** accepts only the project name `C-Projects-main`, not the filesystem path.
- **Route→handler edges** may not materialize in the CBM graph; verify the bridge in source.
- **No timeout propagation** from `runConfiguredCard` to the AutoGen subprocess.
- **Deck staleness** is not checked — `getDeckDocument` returns whatever was last saved.
