---
id: feature.saved-agent-card-runtime
title: Saved Agent Card Runtime
kind: feature
status: partial

roots:
  files:
    - apps/python-models/app/python_models/card_domain.py
    - apps/python-models/app/python_models/idf.py
    - apps/python-models/app/python_models/idd.py
    - apps/python-models/app/python_models/card_script.py
    - apps/backend/src/routes/coder.routes.ts
    - apps/backend/src/hermes/cardTerminal.ts
    - apps/backend/src/contracts/runtimeEvents.d.ts
    - client/src/components/AgentManager.tsx
    - client/src/features/agentbuilder/console/AdaptiveCardTerminal.tsx
  symbols:
    - materialize_invocation
    - begin_run / finish_run
    - AgentManager
---

# Saved Agent Card Runtime

A saved card is the sole authority for its prompt, provider, model, runtime type, and assigned tools.
The backend reads that card from the canonical deck, rejects caller overrides, transports one bounded
runtime request, and returns the native result/run identity to the originating card.

Ordinary inspector options use `/api/coder/card-editor/options`: the existing configured-model owner
supplies models and Python projects executable field contracts without reading the full Builder IDD.
The full Agent Builder palette remains separate. Unavailable saved provider/model selections stay
visible and are not replaced on discovery failure or provider changes. Native Hermes profile reads
and explicit Apply remain independent of Card Save. Public input labels use “Run input”; retained
file bytes and formats are unchanged.

Must remain true:

- missing cards, models, tools, and runtimes fail explicitly;
- no role inference, model substitution, tool injection, or compatibility normalization;
- TypeScript transports typed saved configuration but does not interpret task content;
- the selected-Run Inspector renders the exact retained `in.idf`; the editor shows unsaved Invocation and
  Knowledge state before execution without creating another IDF;
- Save Card Version persists stable Card fields and never copies dynamic input into the Card;
- AgentGraph/AGE owns saved Card relationships and may observe native references/results but cannot
  gate execution;
- manual Card Run and automatic agent handoff enter the same canonical receiving-Card execution path;
- standalone card execution does not silently consult canvas edges;
- Mag One participant eligibility comes only from saved `magentic_option` edges.

The Terminal tab replaces Task/input-output, retaining one mission composer and the existing Run
authority. Public events share one identity contract and renderer across the specialized Main, Coder,
Kanban, ordinary agent, and Mag One surfaces. Observation never grants or removes runtime capabilities.
Native session replay/deletion requires exact exclusive ownership; ambiguous multi-Run sessions must
not be attributed to or deleted as one Run. See `ARCHITECTURE.md` for current observation gaps.

Focused proof:

```powershell
npx vitest run apps/backend/src/routes/coder.routes.spec.ts apps/backend/src/decks/store.normalize.spec.ts
apps\python-models\.venv\Scripts\python.exe -m pytest -q apps/python-models/app/python_models/test_card_domain.py apps/python-models/app/python_models/test_agentgraph.py
```

Unproven: paid model execution through the canonical transient Card-call consumer path.

Card Script source is optional saved runtime-extension data. Enabled Script currently fails before
materialization with `card_script_isolated_native_execution_unavailable`; absent/disabled Script
retains the existing path. Script analysis, generated names/types, lint, static call-site preview,
autocomplete, formatting and the Script tab/editor are deferred to the second pass. A future static
preview must not invoke tools, write graphs, grant capabilities, start a Run or produce a finalized
IDF. Native execution and fixture execution remain unavailable.
See the existing IDD section in ARCHITECTURE.md.
