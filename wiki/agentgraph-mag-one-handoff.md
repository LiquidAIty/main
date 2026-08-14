---
id: feature.agentgraph-mag-one-handoff
title: AgentGraph Context and Native Mag One
kind: feature
status: current_partial
proof_level: focused_tests_and_source

cbm:
  project_identity: C-Projects-LiquidAIty-main
  index_root: C:/Projects/LiquidAIty/main
  coverage: divergent_structural_graph_plus_working_tree_and_git_history

roots:
  current_replacement_files:
    - LiquidAIty.idd
    - apps/backend/src/cards/runtime.ts
    - apps/backend/src/contracts/runtimeContracts.ts
    - apps/backend/src/cards/toolCatalogProjection.ts
    - apps/python-models/app/python_models/idd.py
    - apps/python-models/app/python_models/idf.py
    - apps/python-models/app/python_models/magentic_agentchat.py
---

# AgentGraph Context and Native Mag One

## Outcome

AgentGraph is dynamic graph-aware context persisted in PostgreSQL and used to assemble the next actual
IDF. The IDF is the versioned model-context document that reaches the runtime/model call. Native
AutoGen `MagenticOneGroupChat` remains the Mag One execution authority, with worker eligibility from
saved `magentic_option` topology and permanent configuration from saved cards.

Apache AGE is optional meta-knowledge. It may relate stable IDs for IDFs, runs, cards/models, native
references, consumption, production, and derivation. It does not claim assignments, grant permission,
select workers, schedule execution, or decide native run success.

## Verified current replacement seam

Current source has no live assignment/claim runtime owner. One literal `LiquidAIty.idd` defines the
currently proven typed helpers. Python rails assembles and persists one mixed-language loose-Markdown IDF containing
the exact prompt, saved-card runtime snapshot, dynamic Markdown, native-reference island, and current
input. Main and ordinary Hermes consume the persisted snapshot. AutoGen single-card and Mag One receive
the same snapshot as `cardRuntime`, and Python rejects a mismatched parallel definition before execution.

## Historical recovery result

Git history contains no completed earlier IDF/IDD system to restore:

- June `ContextPack` was bounded context packaging but had no production consumer.
- July `unified_context.py` / `DeliveredContextManifest` rebuilt selected graph projections and was
  coupled to GraphViews and assignments; it was not the stored document sent through every model path.
- AGE `AgentContext` made sender/receiver context an AGE authority.
- registered-query/GraphView machinery mixed typed query ideas with another registry and assignment
  control layer.
- the explicit IDF/IDD product law entered canonical documentation in `fe6daa9d` on 2026-08-10.
- the former `toolInputDataDictionary.ts` logic is now `toolCatalogProjection.ts`, a live projection of
  native catalogs only; it is not the IDD and does not own tools.

Reuse the exact saved-card contract, exact instruction bodies, typed parameter validation/read-only
query ideas, and live tool catalog projection. Do not restore the old packet, manifest, registry,
GraphView, receiver, claim, or assignment systems under new names.

## Intended runtime path

```text
saved originating card + exact current input + explicit selected native references
→ IDD validates structured values and operation forms
→ PostgreSQL stores one versioned actual IDF
→ runtime receives that same IDF through its existing native adapter
→ Hermes single/Kanban, native Mag One, or Coder executes with real native run identity
→ result returns to the originating run/card
→ dynamic AgentGraph context evolves the next IDF
→ optional AGE meta-knowledge relates references consumed and results produced
```

## Must not break

1. Saved cards remain the sole permanent authority for identity, prompt, model/profile, runtime, tools,
   capabilities, and topology.
2. Native Mag One remains `MagenticOneGroupChat`; its private ledgers are not transported or rebuilt.
3. Hermes single and Hermes Auto-Kanban are execution modes of the same ordinary card identity.
4. TypeScript transports and renders structured fields; it does not interpret task meaning.
5. The actual stored IDF reaches the actual runtime/model consumer; a receipt or manifest is not proof.
6. AGE failure cannot fail an otherwise valid native runtime execution.
7. Native graphs remain authoritative; IDFs contain bounded material/pointers, not copied graph stores.
8. OpenClaude/LocalCoder remains the contained Coder boundary.

## Valid proof

- persistence readback proves the versioned IDF equals the assembled consumer input;
- focused adapter tests prove Hermes, native Mag One, and Coder receive the canonical IDF;
- native runtime tests prove real statuses/results without assignment/claim machinery;
- IDD tests prove editor/runtime validation uses one definition boundary and does not enter prompts;
- focused residue search proves assignment/claim/manifest/GraphView runtime authority is gone;
- a real configured product run is still required before the complete feature is marked current.

## CBM limitation

The current CBM project was structurally useful but divergent and included stale/excluded paths during
this recovery. Git history, complete direct source, focused searches, compile/tests, persistence
readback, and live runtime evidence outrank it until the canonical project is cleanly refreshed.
