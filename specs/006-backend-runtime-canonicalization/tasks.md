# Task Breakdown: Backend Runtime Canonical Rebuild

## Status: COMPLETE

All phases delivered. Canonical runtime is live at `apps/backend/src/`.
No v2/v3 folders remain. Tasks are checked for historical record only.
Do not reimplement. See `spec.md` for what was built.

---

## Phase 0: Freeze Current Working State
- [x] Classify existing modified files and ensure only stable boundary/spec changes are committed.
- [x] Hold `mock.json` and `simulate.py` unless explicitly promoted.
- [x] Leave existing `v2` and `v3` runtime folders completely untouched.

## Phase 1: Define Canonical Contracts
- [x] Identify the minimum interfaces needed for deck execution, card runtime, Magentic-One runtime scope, payload building, and CardRunResult.
- [x] Create canonical contracts under `apps/backend/src/contracts/runtimeContracts.ts`.
- [x] Ensure no dependencies exist on `v2` or `v3` within these canonical contracts.

## Phase 2: Rebuild Canonical Card/Deck Runtime Beside v3
- [x] Create clean canonical file: `apps/backend/src/cards/runtime.ts`
- [x] Create clean canonical file: `apps/backend/src/cards/runtime.spec.ts`
- [x] Create clean canonical file: `apps/backend/src/decks/deckRuntime.ts`
- [x] Copy necessary logic from `v3`, stripping stale ledger remnants, old PlanDraft logic, and duplicated state paths.
- [x] Maintain the locked Magentic-One runtime boundary and generic prompt guard.
- [x] Write and verify tests proving the canonical runtime produces the correct payload for the Python sidecar.

## Phase 3: Create Canonical Route Adapter
- [x] Switch `apps/backend/src/routes/decks.routes.ts` to import from canonical runtime.
- [x] Verify external API path `/api/projects/:projectId/decks/:deckId/run` handles requests without errors.

## Phase 4: Rebuild/Flatten v2 Routes Beside Old v2
- [x] Create canonical route: `apps/backend/src/routes/kg.routes.ts`
- [x] Create canonical route: `apps/backend/src/routes/dev.routes.ts`
- [x] Create canonical route: `apps/backend/src/routes/worldsignal.routes.ts`
- [x] Create canonical route: `apps/backend/src/routes/agentBuilder.routes.ts`
- [x] Create canonical service: `apps/backend/src/services/agentConfigStore.ts`

## Phase 5: Switch Route Registration
- [x] Update `apps/backend/src/routes/index.ts` to register the new canonical route handler files.

## Phase 6: Remove v2/v3 Dependencies
- [x] Remove or rewrite remaining internal imports pointing to the old folders.

## Phase 7: Delete Old v2/v3 (Deletion Gate)
- [x] Delete `apps/backend/src/v3` after tests passed and no internal imports remained.
- [x] Delete `apps/backend/src/routes/v2` and `apps/backend/src/services/v2`.
- [x] Final state verified with TypeScript check.
