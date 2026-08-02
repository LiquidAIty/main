---
id: feature.saved-agent-card-runtime
title: Saved Agent Card Runtime
kind: feature
status: partial

roots:
  files:
    - apps/backend/src/cards/runtime.ts
    - apps/backend/src/cards/runConfiguredCard.spec.ts
    - apps/backend/src/cards/runtime.spec.ts
    - apps/backend/src/decks/store.ts
  symbols:
    - runConfiguredCard
    - resolveCardModelStrict
    - resolveCardTools
    - buildPythonAutoGenCardRuntimePayload
---

# Saved Agent Card Runtime

A saved card is the sole authority for its prompt, provider, model, runtime type, and assigned tools.
The backend reads that card from the canonical deck, rejects caller overrides, transports one bounded
runtime request to Python rails, and returns the native result and AGEntgraph identities.

Must remain true:

- missing cards, models, tools, and runtimes fail explicitly;
- no role inference, model substitution, tool injection, or compatibility normalization;
- TypeScript transports typed saved configuration but does not interpret task content;
- AGEntgraph carries run-specific assignment/reference/result identity, not copied graph databases;
- standalone card execution does not silently consult canvas edges;
- Mag One participant eligibility comes only from saved `magentic_option` edges.

Focused proof:

```powershell
npx vitest run apps/backend/src/cards/runtime.spec.ts apps/backend/src/cards/runConfiguredCard.spec.ts apps/backend/src/decks/store.normalize.spec.ts
```

Unproven: paid model execution and the final AGEntgraph context projection.
