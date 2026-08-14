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
runtime request, and returns the native result/run identity to the originating card.

Must remain true:

- missing cards, models, tools, and runtimes fail explicitly;
- no role inference, model substitution, tool injection, or compatibility normalization;
- TypeScript transports typed saved configuration but does not interpret task content;
- the PostgreSQL IDF carries the actual bounded model input; dynamic AgentGraph context evolves later
  IDFs without becoming runtime authority;
- optional AGE meta-knowledge may relate native references/results but cannot gate execution;
- standalone card execution does not silently consult canvas edges;
- Mag One participant eligibility comes only from saved `magentic_option` edges.

Focused proof:

```powershell
npx vitest run apps/backend/src/cards/runtime.spec.ts apps/backend/src/cards/runConfiguredCard.spec.ts apps/backend/src/decks/store.normalize.spec.ts
```

Unproven: paid model execution and the canonical PostgreSQL IDF consumer path.
