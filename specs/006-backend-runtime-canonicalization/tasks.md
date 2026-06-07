# Task Breakdown: Backend Runtime Canonicalization

## Phase 0: Freeze and Classify Current Tree
- `[ ]` Commit existing, safe `v3` card/deck boundary modifications from the prior research-loop task.
- `[ ]` Ensure `simulate.py` and `mock.json` are excluded from the main commit.

## Phase 1: Canonical Layout Definition
- `[ ]` Verify target canonical directories (`src/cards`, `src/decks`, `src/runtime`, `src/services`, etc.) exist or map properly from `v3`.

## Phase 2: Move Active v3 Card/Deck Runtime
- `[ ]` `git mv apps/backend/src/v3/cards apps/backend/src/cards`
- `[ ]` `git mv apps/backend/src/v3/decks apps/backend/src/decks`
- `[ ]` `git mv apps/backend/src/v3/runtime apps/backend/src/runtime`
- `[ ]` `git mv apps/backend/src/v3/graph apps/backend/src/graph`
- `[ ]` `git mv apps/backend/src/v3/knowledge apps/backend/src/knowledge`
- `[ ]` `git mv apps/backend/src/v3/types/* apps/backend/src/types/`
- `[ ]` Update relative imports inside the moved files.

## Phase 3: Move Active v3/v2 Routes and Services
- `[ ]` Move `apps/backend/src/v3/routes/*` to `apps/backend/src/routes/`.
- `[ ]` Move `apps/backend/src/routes/v2/*` to `apps/backend/src/routes/`.
- `[ ]` Move `apps/backend/src/services/v2/*` to `apps/backend/src/services/`.
- `[ ]` Update Express route registration in `apps/backend/src/routes/index.ts` to reflect flattened paths.

## Phase 4: Remove Duplicate/Stale v2/v3 Imports
- `[ ]` Run `grep -r "/v3/" apps/backend/src` and fix remaining imports.
- `[ ]` Run `grep -r "/v2/" apps/backend/src` and fix remaining imports.
- `[ ]` Verify `apps/backend/src/routes/decks.routes.ts` correctly imports `../runtime/deckRuntime`.

## Phase 5: Delete Dead v2/v3 Directories
- `[ ]` Run compilation check `npx tsc --noEmit -p apps/backend/tsconfig.app.json`.
- `[ ]` Run `npm run mcp:check`.
- `[ ]` Execute `rm -rf apps/backend/src/v3`.
- `[ ]` Execute `rm -rf apps/backend/src/routes/v2`.
- `[ ]` Execute `rm -rf apps/backend/src/services/v2`.

## Phase 6: Update Research-Loop Specs
- `[ ]` Update `specs/004-agent-workspace-primitive/spec.md` to remove `/v3/` paths.
- `[ ]` Update `specs/005-interactive-graph-research-loop/spec.md` to ensure no `/v3/` paths are present.
