# Tasks: Runtime Contract Hardening for Card-Owned Model Config

**Spec**: `specs/007-runtime-contract-hardening/spec.md`
**Plan**: `specs/007-runtime-contract-hardening/plan.md`
**Blocks**: specs 008+. Do not start 008 until T005 passes.

## Root Cause

`buildPythonAutoGenCardRuntimePayload` hardcodes participant model config:
  `provider: 'openrouter'`
  `providerModelId: 'default'`

These must come from the participant card's `runtimeOptions.modelKey` resolved through
`MODEL_REGISTRY`. Model config is owned by the ReactFlow card editor. Backend reads it.
Python executes it. If it is missing from the card, the backend throws before sending any
payload.

## Protected Baseline

- `POST /api/projects/:projectId/decks/:deckId/run` route signature unchanged
- Locked Magentic-One mode: cards without `magentic_option` edge stay invisible
- No TypeScript fallback for failed sidecar calls
- No fake success paths
- No default model. No fallback model.
- Missing card model config = hard throw (`card_model_config_missing`)
- Unknown `modelKey` = propagate `resolveModel` throw
- Python `CardRuntimeParticipant.provider` and `providerModelId` remain required — no `= ""` defaults ever

Do not touch: `deckRuntime.ts`, `decks.routes.ts`, `autogenOrchestratorClient.ts`,
`autogen_orchestrator.py`, `autogen_provider_env.py`, `orchestration_contracts.py`,
`.env`, Prisma, ThinkGraph, KnowGraph, Research, UI.

---

## T001 — Confirm card model source (read-only audit)

**Behavior**: Verify the exact fields and resolution path before writing any code.

Already confirmed from code audit:

**Source of truth**: `card.runtimeOptions.modelKey` (key into `MODEL_REGISTRY`)
**Optional hint**: `card.runtimeOptions.provider` (explicit UI provider override, may be null)
**Type**: `AgentCardRuntimeOptions` in `client/src/types/agentgraph.ts:66`

**Resolution path**:
1. Read `head.runtimeOptions?.modelKey`
2. Call `resolveModel(modelKey)` in `apps/backend/src/llm/models.config.ts`
3. Returns `{ provider, id }` — `id` becomes `providerModelId`
4. `resolveModel` already throws `Unknown model key: <key>` if not in `MODEL_REGISTRY`
5. `gpt-4o` is NOT in `MODEL_REGISTRY` — it is not a valid card selection for this repo

**Forbidden fallbacks in `resolveModelConfig` (must NOT be used for participant resolution)**:
- `String(modelKeyRaw || '').trim() || 'gpt-4o-mini'` — invents a model when none is set
- `providerHint || 'openrouter'` — invents provider for slash-style models
- catch block `providerHint || 'openai'` — invents provider on registry miss

Do not route participant resolution through `resolveModelConfig`. Call `resolveModel` directly.
If `modelKey` is absent, throw before calling `resolveModel`.

**Stop condition**: Field names confirmed. No code written yet.

---

## T002 — Add failing tests: card-selected model config propagates exactly to payload

**Behavior**: Prove both bugs are real. All four new tests must fail before T003 is applied.

**File**: `apps/backend/src/cards/runtime.spec.ts`

Add inside the existing `describe('Canonical Cards Runtime', ...)` block:

```ts
it('privateParticipants carry the participant card selected model config exactly', () => {
  // Fixture: participant card with explicit model selection — simulates ReactFlow card editor state.
  // Uses a real MODEL_REGISTRY key. This is a fixture value, not a global default.
  const selectedModelKey = 'gpt-5.1-chat-latest';         // real MODEL_REGISTRY key
  const selectedProvider = 'openai';                       // MODEL_REGISTRY[selectedModelKey].provider
  const selectedProviderModelId = 'gpt-5.1-chat-latest';  // MODEL_REGISTRY[selectedModelKey].id

  const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
  const cardA = {
    id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
    runtimeOptions: { modelKey: selectedModelKey, provider: selectedProvider },
  };

  const payload = buildPythonAutoGenCardRuntimePayload(
    cardM, {}, 'test', {}, {}, [cardA], '2026',
  );

  const priv = payload.cardRuntime.privateParticipants?.[0];
  expect(priv).toBeDefined();
  expect(priv?.provider).toBe(selectedProvider);
  expect(priv?.providerModelId).toBe(selectedProviderModelId);
});

it('public participants[] carry the same resolved model config as privateParticipants[]', () => {
  const selectedModelKey = 'gpt-5.1-chat-latest';
  const selectedProvider = 'openai';
  const selectedProviderModelId = 'gpt-5.1-chat-latest';

  const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
  const cardA = {
    id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
    runtimeOptions: { modelKey: selectedModelKey, provider: selectedProvider },
  };

  const payload = buildPythonAutoGenCardRuntimePayload(
    cardM, {}, 'test', {}, {}, [cardA], '2026',
  );

  const pub = payload.cardRuntime.participants?.[0];
  expect(pub?.provider).toBe(selectedProvider);
  expect(pub?.providerModelId).toBe(selectedProviderModelId);
});

it('throws card_model_config_missing when participant card has no runtimeOptions.modelKey', () => {
  const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
  const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent' }; // no runtimeOptions

  expect(() =>
    buildPythonAutoGenCardRuntimePayload(cardM, {}, 'test', {}, {}, [cardA], '2026'),
  ).toThrow('card_model_config_missing');
});

it('providerModelId is never the string default in any payload', () => {
  const selectedModelKey = 'gpt-5.1-chat-latest';
  const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
  const cardA = {
    id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
    runtimeOptions: { modelKey: selectedModelKey },
  };
  const payload = buildPythonAutoGenCardRuntimePayload(
    cardM, {}, 'test', {}, {}, [cardA], '2026',
  );
  const priv = payload.cardRuntime.privateParticipants?.[0];
  expect(priv?.providerModelId).not.toBe('default');
  expect(priv?.providerModelId).not.toBe('');
});
```

**Note on fixtures**: `gpt-5.1-chat-latest` is used here because it is a real `MODEL_REGISTRY`
key. It represents the card editor selection in this test. It is NOT a fallback or global default.
Any other real `MODEL_REGISTRY` key is equally valid as a fixture.

**Validation**: `npx vitest run apps/backend/src/cards/runtime.spec.ts`

**Stop condition**: All four new tests fail (hardcoded `'openrouter'/'default'` and no throw).
All pre-existing tests still pass.

---

## T003 — Fix `runtime.ts`: read participant model from card via `MODEL_REGISTRY`

**Behavior**: Replace hardcoded `'openrouter'`/`'default'` with a `MODEL_REGISTRY` lookup.
Throw loudly if `modelKey` is absent or unknown. Apply to both `participants[]` and
`privateParticipants[]`.

**File**: `apps/backend/src/cards/runtime.ts`

**Fix for `privateParticipants[]`** — replace the hardcoded `return` block in `callableHeads.map`:

```ts
const participantModelKey = head.runtimeOptions?.modelKey;
if (!participantModelKey) {
  throw new Error(
    `card_model_config_missing: cardId=${head.id} runtimeType=${head.runtimeType}`,
  );
}
const resolvedParticipantModel = resolveModel(participantModelKey); // propagate throw on unknown key
const effectiveProvider = head.runtimeOptions?.provider || resolvedParticipantModel.provider;

return {
  cardId: String(head.id || ''),
  runtimeType: mappedRuntimeType,
  runtimeBinding: head.runtimeBinding || null,
  prompt: String(head.prompt || '').trim(),
  provider: effectiveProvider,
  providerModelId: resolvedParticipantModel.id,
  temperature: head.runtimeOptions?.temperature ?? null,
  maxTokens: head.runtimeOptions?.maxTokens ?? null,
};
```

**Fix for `participants[]`** — add the same resolution to the `supportedHeads.map` return block:

```ts
const participantModelKey = head.runtimeOptions?.modelKey;
if (!participantModelKey) {
  throw new Error(
    `card_model_config_missing: cardId=${head.id} runtimeType=${head.runtimeType}`,
  );
}
const resolvedParticipantModel = resolveModel(participantModelKey);
const effectiveProvider = head.runtimeOptions?.provider || resolvedParticipantModel.provider;

return {
  cardId: String(head.id || ''),
  title: String(head.title || 'Agent'),
  runtimeType: mappedRuntimeType,
  role: 'assistant',
  summary: `Participant ${head.title || 'Agent'}`,
  allowedActions: [],
  inputContract: 'text',
  outputContract: 'text',
  callable: true,
  provider: effectiveProvider,
  providerModelId: resolvedParticipantModel.id,
  temperature: head.runtimeOptions?.temperature ?? null,
  maxTokens: head.runtimeOptions?.maxTokens ?? null,
};
```

`resolveModel` is already imported at the top of `runtime.ts` (line 3:
`import { resolveModel } from '../llm/models.config'`).

Do NOT catch the `resolveModel` throw. Do NOT call `resolveCardModelConfig` for participant
resolution — it has forbidden fallbacks (`gpt-4o-mini`, OpenRouter, OpenAI) that must not fire.

**Validation**:
```powershell
npx vitest run apps/backend/src/cards/runtime.spec.ts
npx tsc -p apps/backend/tsconfig.app.json --noEmit
```

**Stop condition**: All four T002 tests pass. All pre-existing tests pass. TypeScript compiles
clean. No `'default'` or `'openrouter'` strings remain in participant payload construction.

---

## T004 — Python contract: stays strict, round-trip test with card-owned values

**Behavior**: Confirm Python `CardRuntimeParticipant.provider`/`providerModelId` remain required.
Confirm `CardRuntimePrivateParticipant` same. Add a contract test that validates a payload built
from explicit card-selected model config. Python files are NOT edited.

**Files to read** (no edits expected):
- `apps/python-models/app/python_models/orchestration_contracts.py` — confirm no `= ""` defaults
- `apps/python-models/app/python_models/autogen_orchestrator.py` — confirm values flow to `_build_model_client`

**New test file**: `apps/python-models/app/python_models/test_contracts.py`

```python
import pytest
from apps.python_models.app.python_models.orchestration_contracts import (
    ContextPack, CardRuntimeParticipant, CardRuntimePrivateParticipant,
)

# Fixture values — match a card with explicit model selection in the ReactFlow card editor.
# These are NOT defaults. They represent a specific card fixture.
SELECTED_PROVIDER = "openai"
SELECTED_PROVIDER_MODEL_ID = "gpt-5.1-chat-latest"  # real MODEL_REGISTRY key and id


def test_context_pack_with_card_selected_model_validates():
    """Payload from a card with explicit model selection must validate without error."""
    payload = {
        "session": {
            "sessionId": "s1", "projectId": "p1", "turnId": "t1",
            "route": "deck_runtime", "orchestrator": "magentic_one",
            "modelProvider": SELECTED_PROVIDER,
            "modelKey": SELECTED_PROVIDER_MODEL_ID,
            "providerModelId": SELECTED_PROVIDER_MODEL_ID,
            "startedAt": "2026-01-01T00:00:00Z",
        },
        "userText": "hello",
        "cardRuntime": {
            "cardId": "mag1", "title": "Orchestrator", "runtimeType": "magentic_one",
            "participants": [{
                "cardId": "agentA", "title": "Agent A",
                "runtimeType": "assistant_agent",
                "provider": SELECTED_PROVIDER,
                "providerModelId": SELECTED_PROVIDER_MODEL_ID,
            }],
            "privateParticipants": [{
                "cardId": "agentA", "runtimeType": "assistant_agent",
                "prompt": "Be helpful.",
                "provider": SELECTED_PROVIDER,
                "providerModelId": SELECTED_PROVIDER_MODEL_ID,
            }],
        },
    }
    pack = ContextPack.model_validate(payload)
    assert pack.cardRuntime is not None
    assert pack.cardRuntime.participants[0].provider == SELECTED_PROVIDER
    assert pack.cardRuntime.participants[0].providerModelId == SELECTED_PROVIDER_MODEL_ID
    assert pack.cardRuntime.privateParticipants[0].provider == SELECTED_PROVIDER
    assert pack.cardRuntime.privateParticipants[0].providerModelId == SELECTED_PROVIDER_MODEL_ID


def test_private_participant_rejects_missing_model_config():
    """Python must fail loudly if participant model config is absent."""
    with pytest.raises(Exception):
        CardRuntimePrivateParticipant(
            cardId="x", runtimeType="assistant_agent", prompt="",
            # provider and providerModelId intentionally absent — Python must reject this
        )


def test_public_participant_rejects_missing_model_config():
    """Python must fail loudly if public participant model config is absent."""
    with pytest.raises(Exception):
        CardRuntimeParticipant(
            cardId="x", title="Agent", runtimeType="assistant_agent",
            # provider and providerModelId intentionally absent — Python must reject this
        )
```

**Validation**: `python -m pytest app/python_models/test_contracts.py -v`

**Stop condition**: All three tests pass. Python raises on missing required fields.
No `= ""` defaults added to Python models. No Python source files modified.

---

## T005 — Live two-card smoke

**Behavior**: Full stack running. Use an existing deck where both cards have model config
explicitly selected in the ReactFlow card editor. The exact model is determined by the card
editor — this spec does not specify or default it.

**Preconditions**:
- `npm run dev:backend` running (port 4000)
- `npm run dev:autogen` running (sidecar on port 8003)
- Deck exists in Postgres with:
  - card A: `runtimeType: 'magentic_one'`, model key selected in card editor
  - card B: `runtimeType: 'assistant_agent'`, model key selected in card editor
  - edge: `edgeType: 'magentic_option'`

**Smoke call**:
```powershell
$body = @{ input = "hello"; templates = @(@{ id = "tpl1" }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod `
  -Uri "http://localhost:4000/api/projects/<projectId>/decks/<deckId>/run" `
  -Method Post -ContentType "application/json" -Body $body
```

**Sidecar logs — must NOT appear**:
- `providerModelId=default`
- `422 Unprocessable Entity`
- `card_model_config_missing` (would mean a card has no model selected in the editor)
- Any model string that does not match the card editor selection

**Stop condition**: HTTP 200. `run.status === 'success'`. `run.finalOutput` is a non-empty
string. The sidecar receives the exact `provider`/`providerModelId` that the cards are
configured with in the ReactFlow editor.

---

## Completion Gate

T001: card model source confirmed — `card.runtimeOptions.modelKey` → `MODEL_REGISTRY`
T002: all four failing tests added and confirmed failing
T003: fix applied — all four tests pass, TypeScript compiles clean
T004: Python audit done, contract tests pass, no Python files modified
T005: live smoke returns HTTP 200 with real `finalResponseText`

Do not start spec 008 until T005 passes.
