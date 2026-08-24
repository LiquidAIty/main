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
    - apps/backend/src/routes/coder.routes.ts
    - client/src/components/AgentManager.tsx
  symbols:
    - materialize_invocation
    - begin_run / finish_run
    - AgentManager
---

# Saved Agent Card Runtime

A saved card is the sole authority for its prompt, provider, model, runtime type, and assigned tools.
The backend reads that card from the canonical deck, rejects caller overrides, transports one bounded
runtime request, and returns the native result/run identity to the originating card.

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

Focused proof:

```powershell
npx vitest run apps/backend/src/routes/coder.routes.spec.ts apps/backend/src/decks/store.normalize.spec.ts
apps\python-models\.venv\Scripts\python.exe -m pytest -q apps/python-models/app/python_models/test_card_domain.py apps/python-models/app/python_models/test_agentgraph.py
```

Unproven: paid model execution through the canonical transient Card-call consumer path.
