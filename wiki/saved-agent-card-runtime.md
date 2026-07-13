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
    - buildRuntimeGraph
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

When the Harness or Agent Canvas opens a card doorway, the backend resolves the card's
model, provider, tools, and runtime binding from the canonical deck document — never from
role heuristics, caller overrides, or model inference. Missing or mismatched config
produces a structured error, not a silent fallback.

## What the user/agent experiences

"Run Card" → backend reads deck, validates card, builds AutoGen payload, dispatches.
Outcomes: `completed`, `failed`, `not_found`, `disabled`. All carry the caller's
`correlationId`.

## How it works

The entire resolution lives in one file: `apps/backend/src/cards/runtime.ts` (926 lines).

```
POST /api/coder/mcp-bridge/run_configured_card    [coder.routes.ts:159]
  → runConfiguredCard                              [runtime.ts:490]
    → getDeckDocument → find card → validate enabled
    → isSingleAssistRunDocument
    → runSingleAssistCardAsDeckRun
      → resolveOrchestratorCardModel
      → buildPythonAutoGenCardRuntimePayload       [runtime.ts:334]
        → resolveCardRuntimeType
        → resolveCardModelStrict                   [runtime.ts:118]
          → normalizeLocalCoderControllerCard       [localCoderController.ts]
        → resolveCardTools                         [runtime.ts:138]
        → resolvedMagenticOptions
        → buildRuntimeGraph                        [runtime.ts:181]
        → serializeCardParticipant                 [runtime.ts:284]
      → runCardWithContract                        [runtime.ts:737]
        → orchestrateWithAutoGen / runSingleCardWithAutoGen
    → toAgentRunResult
```

## Must not break

1. Card config is authoritative — `resolveCardModelStrict` and `resolveCardTools` both
   call `normalizeLocalCoderControllerCard` first. No fallback to role inference.
2. Caller overrides structurally rejected by `runConfiguredCard`.
3. No auto-injected tools — exactly the card editor's Tools tab selection.
4. `not_found`, `disabled`, and config errors (`card_model_config_missing`,
   `card_model_config_mismatch`) are honest — never a fabricated run.
5. correlationId preserved through the entire chain.
6. Durable constants stay on saved cards/runtime, not in Magnetic One `prompt.md`
   packets. Card config owns system prompt/role definition, model/provider, selected
   tools, what the agent does/does not do, output expectations, graph write
   permissions, runtime binding, and card-specific behavior rules. `prompt.md`
   carries only run-specific variables.
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
`buildPythonAutoGenCardRuntimePayload` → `runCardWithContract` are all connected by
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

Proves: card found, model/tools resolved from saved config, AutoGen invoked.
Does not prove: AutoGen network round-trip, coder subprocess output quality.

## Limitations

- **trace_path** accepts only simple function names, not qualified names. Store
  `runConfiguredCard` (not `C-Projects-main.apps.backend.src.cards.runtime.runConfiguredCard`).
- **index_status** accepts only the project name `C-Projects-main`, not the filesystem path.
- **Route→handler edges** don't materialize in the CBM graph — the POST handler link at
  `coder.routes.ts:159` is a source-level fact, not a graph edge.
- **No timeout propagation** from `runConfiguredCard` to the AutoGen subprocess.
- **Deck staleness** is not checked — `getDeckDocument` returns whatever was last saved.
