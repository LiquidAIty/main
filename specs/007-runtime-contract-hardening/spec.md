# Spec 007: Runtime Contract Hardening for Card-Owned Model Config

**Status**: Ready for implementation.
**Dependency**: Spec 006 complete. Canonical runtime live.
**Blocks**: Spec 008 (ThinkGraph). Nothing downstream is safe until this is proven.

---

## Problem

The deck run path from TypeScript to Python has two confirmed contract bugs that cause every
connected participant agent to fail at runtime:

### Bug A — `CardRuntimeParticipant` missing required fields causes 422

`buildPythonAutoGenCardRuntimePayload` (runtime.ts:146–162) builds the public `participants[]`
manifest without `provider` or `providerModelId` fields. Python's `CardRuntimeParticipant`
Pydantic model declares both as `provider: str` and `providerModelId: str` with no defaults,
meaning they are required. FastAPI/Pydantic raises a ValidationError when deserializing the
`ContextPack`, returning a 422 before any AutoGen code runs.

**Effect**: Any deck run with one or more connected participant agents returns HTTP 422 from the
sidecar. The deck run fails before Magentic-One initializes.

### Bug B — `privateParticipants` hardcode `provider='openrouter'` and `providerModelId='default'`

`buildPythonAutoGenCardRuntimePayload` (runtime.ts:164–177) builds `privateParticipants[]` with:
```ts
provider: 'openrouter',
providerModelId: 'default',
```

These are hardcoded strings, not resolved from the card's actual model config. Python reads them
in `_build_card_team_participants` (autogen_orchestrator.py:938–944):
```python
config = AutoGenAgentConfig(
    provider=str(participant.provider or default_model_config.provider)...
    provider_model_id=str(participant.providerModelId or default_model_config.provider_model_id)...
```

Because `'openrouter'` and `'default'` are truthy, the fallback `or default_model_config...`
never fires. Python builds an `OpenAIChatCompletionClient` with `model='default'` pointed at
`https://openrouter.ai/api/v1`. OpenRouter returns 400 or 404. Every participant agent fails.

**Effect**: Even if Bug A is fixed, connected participant agents use invalid model config and
fail at the AutoGen API call level.

---

## Goal

Prove the complete path:

```
frontend deck run
  → POST /api/projects/:projectId/decks/:deckId/run
  → deckRuntime.ts → executeDeck
  → cards/runtime.ts → runCardWithContract → buildPythonAutoGenCardRuntimePayload
  → autogenOrchestratorClient.ts → POST AUTOGEN_ORCHESTRATOR_URL/autogen/orchestrate
  → main.py → orchestrate_context_pack (ContextPack deserialized without 422)
  → _orchestrate_card_runtime_context
  → _build_card_team_participants (participant receives valid model client)
  → MagenticOneGroupChat runs with real participants
  → finalResponseText returned
```

The acceptance bar is: one `magentic_one` card connected to one `assistant_agent` card via a
`magentic_option` edge runs end-to-end without a 422, without `'default'` as a model ID, and
returns a real `finalResponseText`.

---

## Scope

In scope:
- Fix Bug A: TypeScript `participants[]` must send `provider` and `providerModelId` resolved from `MODEL_REGISTRY[participantCard.runtimeOptions.modelKey]`. If `modelKey` is absent, throw `card_model_config_missing`.
- Fix Bug B: TypeScript `privateParticipants[]` must read the participant card's `runtimeOptions.modelKey` and resolve it through `MODEL_REGISTRY`. No hardcoded strings. No fallbacks. If `modelKey` is absent, throw `card_model_config_missing`.
- Add tests that fail on current hardcoded garbage and pass after the fix.
- Prove the happy path: magentic_one + one assistant_agent (both with explicit card model config in the ReactFlow editor) → end-to-end.

Out of scope:
- ThinkGraph, KnowGraph, Research Agent — not started here
- UI changes
- Graph context injection
- Prisma, .env, debug log cleanup
- Any spec 004 tasks (separate queue)

---

## Acceptance Criteria

1. `npx vitest run apps/backend/src/cards/runtime.spec.ts` passes with new model config tests.
2. `privateParticipants[0].provider` and `.providerModelId` exactly match `MODEL_REGISTRY[participantCard.runtimeOptions.modelKey].provider` and `.id`.
3. `participants[0].provider` and `.providerModelId` carry the same resolved values as `privateParticipants[0]`.
4. A participant card with no `runtimeOptions.modelKey` causes the backend to throw `card_model_config_missing: cardId=<id>` before any payload is sent to Python.
5. `providerModelId='default'` does not appear anywhere in a runtime payload.
6. Python `CardRuntimeParticipant.provider` and `providerModelId` remain required — no `= ""` defaults added to Python.
7. End-to-end smoke uses real cards with model config explicitly selected in the ReactFlow card editor. No model is specified in this spec — the card editor is the source of truth.
