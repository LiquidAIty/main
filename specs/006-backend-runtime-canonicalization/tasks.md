# Task Breakdown: Backend Runtime Canonical Rebuild

## Phase 0: Freeze Current Working State
- `[ ]` Classify existing modified files and ensure only stable boundary/spec changes are committed.
- `[ ]` Hold `mock.json` and `simulate.py` unless explicitly promoted.
- `[ ]` Leave existing `v2` and `v3` runtime folders completely untouched.

## Phase 1: Define Canonical Contracts
- `[ ]` Identify the minimum interfaces needed for deck execution, card runtime, Magentic-One runtime scope, payload building, and CardRunResult.
- `[ ]` Create canonical contracts under `apps/backend/src/contracts` or `apps/backend/src/types`.
- `[ ]` Ensure no dependencies exist on `v2` or `v3` within these canonical contracts.

## Phase 2: Rebuild Canonical Card/Deck Runtime Beside v3
- `[ ]` Create clean canonical file: `apps/backend/src/cards/runtime.ts`
- `[ ]` Create clean canonical file: `apps/backend/src/cards/runtime.spec.ts`
- `[ ]` Create clean canonical file: `apps/backend/src/decks/deckRuntime.ts`
- `[ ]` Create clean canonical file: `apps/backend/src/runtime/index.ts`
- `[ ]` Copy necessary logic from `v3`, stripping stale ledger remnants, old PlanDraft logic, and duplicated state paths.
- `[ ]` Maintain the locked Magentic-One runtime boundary and generic prompt guard.
- `[ ]` Write and verify tests proving the canonical runtime produces the correct payload for the Python sidecar.

## Phase 3: Create Canonical Route Adapter
- `[ ]` Switch `apps/backend/src/routes/decks.routes.ts` to import from `../runtime/deckRuntime` (or `../decks/deckRuntime`).
- `[ ]` Verify external API path `/api/projects/:projectId/decks/:deckId/execute` handles requests without errors.
- `[ ]` Keep `v3` intact as an immediate fallback.

## Phase 4: Rebuild/Flatten v2 Routes Beside Old v2
- `[ ]` Create canonical route: `apps/backend/src/routes/kg.routes.ts`
- `[ ]` Create canonical route: `apps/backend/src/routes/dev.routes.ts`
- `[ ]` Create canonical route: `apps/backend/src/routes/worldsignal.routes.ts`
- `[ ]` Create canonical route: `apps/backend/src/routes/agentBuilder.routes.ts`
- `[ ]` Create canonical service: `apps/backend/src/services/agentConfigStore.ts`
- `[ ]` Keep external `/api/v2/...` string paths identical.
- `[ ]` Do not delete `routes/v2` yet.

## Phase 5: Switch Route Registration
- `[ ]` Update `apps/backend/src/routes/index.ts` to register the new canonical route handler files instead of the `v2` ones.
- `[ ]` Run validation and confirm frontend WorldSignal and AgentBuilder routes respond correctly.

## Phase 6: Remove v2/v3 Dependencies
- `[ ]` Run `grep -r "/v3/" apps/backend/src` and `grep -r "/v2/" apps/backend/src`.
- `[ ]` Remove or rewrite remaining internal imports pointing to the old folders.
- `[ ]` Distinguish carefully between internal relative imports and external HTTP path strings.

## Phase 7: Delete Old v2/v3 (Deletion Gate)
- `[ ]` Delete `apps/backend/src/v3` ONLY AFTER tests pass and no internal imports remain.
- `[ ]` Delete `apps/backend/src/routes/v2` and `apps/backend/src/services/v2` ONLY AFTER routes pass and no internal imports remain.
- `[ ]` Verify final state with `npm run mcp:check` and `npx tsc --noEmit`.
