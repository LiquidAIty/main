# Plan: Runtime Contract Hardening

**Spec**: `specs/007-runtime-contract-hardening/spec.md`

---

## Architecture Context

The TypeScript → Python boundary is a JSON HTTP POST. TypeScript builds
`PythonAutoGenPayloadShape`; Python deserializes it as `ContextPack` via Pydantic. Any
mismatch that violates Pydantic required fields causes a 422 before any AutoGen code runs.

The `ContextPack.cardRuntime` field is type `CardRuntimeConfig | None`. When present, Python
routes to `_orchestrate_card_runtime_context`, which builds participant `AssistantAgent`
instances from `cardRuntime.privateParticipants`. The model config for each participant comes
from `participant.provider` and `participant.providerModelId` — directly from the TypeScript
payload.

---

## Fix A: TypeScript `participants[]` — add resolved model config from card

**File**: `apps/backend/src/cards/runtime.ts`
**Section**: `participants` array construction inside `buildPythonAutoGenCardRuntimePayload`

`CardRuntimeParticipant` in Python requires `provider: str` and `providerModelId: str`.
TypeScript currently omits them, causing a Pydantic 422 before AutoGen initializes.

Fix: for each `head` in `supportedHeads`, read `head.runtimeOptions?.modelKey`. If absent,
throw `card_model_config_missing: cardId=<id>`. Call `resolveModel(modelKey)` to get
`{ provider, id }`. Add `provider` (= `resolvedModel.provider`) and `providerModelId`
(= `resolvedModel.id`) to the returned object. If `head.runtimeOptions?.provider` is set
and does not match `resolvedModel.provider`, throw `card_model_config_mismatch: cardId=<id>`.
A UI provider that conflicts with the registry must not silently override.

Do not fall back to any default model. Do not inherit from the orchestrator card.
Propagate `resolveModel` throws on unknown keys — they indicate a misconfigured card.

Python `CardRuntimeParticipant` is not modified. Its `provider: str` and `providerModelId: str`
remain required. TypeScript now sends the values Python already expects.

---

## Fix B: TypeScript `privateParticipants` — resolve real model config per head

**File**: `apps/backend/src/cards/runtime.ts`
**Lines**: 164–177 (`privateParticipants` construction inside `buildPythonAutoGenCardRuntimePayload`)

Current:
```ts
return {
  cardId: String(head.id || ''),
  runtimeType: mappedRuntimeType,
  runtimeBinding: head.runtimeBinding || null,
  prompt: String(head.prompt || '').trim(),
  provider: 'openrouter',         // BUG: hardcoded
  providerModelId: 'default',     // BUG: hardcoded
};
```

Fix applied (card-owned config only — no fallbacks, no defaults):
```ts
const participantModelKey = head.runtimeOptions?.modelKey;
if (!participantModelKey) {
  throw new Error(
    `card_model_config_missing: cardId=${head.id} runtimeType=${head.runtimeType}`,
  );
}
const resolvedParticipantModel = resolveModel(participantModelKey);
const registryProvider = resolvedParticipantModel.provider;
const uiProvider = normalizeProvider(head.runtimeOptions?.provider);
if (uiProvider && uiProvider !== registryProvider) {
  throw new Error(
    `card_model_config_mismatch: cardId=${head.id} uiProvider=${uiProvider} registryProvider=${registryProvider}`,
  );
}

return {
  cardId: String(head.id || ''),
  runtimeType: mappedRuntimeType,
  runtimeBinding: head.runtimeBinding || null,
  prompt: String(head.prompt || '').trim(),
  provider: registryProvider,
  providerModelId: resolvedParticipantModel.id,
  temperature: head.runtimeOptions?.temperature ?? null,
  maxTokens: head.runtimeOptions?.maxTokens ?? null,
};
```

`resolveModel` is already imported at the top of `runtime.ts` (line 3).
Do NOT catch the `resolveModel` throw. A missing or unknown `modelKey` means the card is
misconfigured — surface that error immediately rather than substituting a fake model.

---

## Affected Files

| File | Change | Risk |
|---|---|---|
| `apps/backend/src/cards/runtime.ts` | Fix Bug A — add `provider`/`providerModelId` to `participants[]` from `MODEL_REGISTRY` | Low. Adds fields Python already requires. |
| `apps/backend/src/cards/runtime.ts` | Fix Bug B — replace hardcoded values in `privateParticipants[]` with `MODEL_REGISTRY` lookup | Low. Replaces two hardcoded strings with a card-owned read. |
| `apps/backend/src/cards/runtime.spec.ts` | Add four new failing tests | None. |

---

## No-Touch List

- `apps/backend/src/decks/deckRuntime.ts` — no change needed
- `apps/backend/src/routes/decks.routes.ts` — no change needed
- `apps/backend/src/services/autogen/autogenOrchestratorClient.ts` — no change needed
- `apps/python-models/app/python_models/autogen_orchestrator.py` — modified in a prior session (runtime canonicalization, +81/-44 lines). T004 must audit existing changes and review `_build_card_team_participants` fallback chain.
- `apps/python-models/app/python_models/autogen_provider_env.py` — no change needed
- `CardRuntimePrivateParticipant` — keep `provider` and `providerModelId` required (correct)
- `CardRuntimeParticipant` — keep `provider` and `providerModelId` required (correct — TypeScript now sends real values)
- All ThinkGraph, KnowGraph, Research paths — not touched

---

## Validation

```powershell
# TypeScript tests
npx vitest run apps/backend/src/cards/runtime.spec.ts

# TypeScript type check
npx tsc -p apps/backend/tsconfig.app.json --noEmit

# Python sidecar health check (requires docker running)
Invoke-RestMethod http://127.0.0.1:8003/health

# End-to-end smoke (requires full stack running)
# POST a deck run with one magentic_one + one assistant_agent connected by magentic_option
# Verify: HTTP 200, finalResponseText is non-empty, no 422 in sidecar logs
```

---

## Risk Assessment

- Both fixes replace hardcoded constant strings with `resolveModel(modelKey)` lookups. No
  behavioral logic changes for cards that are correctly configured.
- The only new observable behavior: a participant card with no `runtimeOptions.modelKey` now
  throws `card_model_config_missing` before sending any payload to Python. Previously it would
  silently send `providerModelId='default'` and fail at the Python model client level. Failing
  loudly before the HTTP call is strictly better.
- Fix A adds two fields to `participants[]` that Python already requires. This is non-breaking
  for Python: the fields were missing before (causing 422); now they carry real values.
- `resolveModel` already throws `Unknown model key: <key>` for keys not in `MODEL_REGISTRY`.
  Propagating that throw is not a regression — it surfaces a pre-existing card configuration
  problem that was previously silently hidden by fallbacks.
- Python contracts are not modified. No `= ""` defaults added. No required fields made optional.
