# Turn Report

## Status

COMPLETE for the requested recovery: the upstream CBM daemon and application stack are healthy, the in-app CodeGraph renders real provider data without the unwanted Feature sorter, the saved Agents canvas is visible, and real Main plus direct Builder Bot Mode turns completed and rendered.

## Requested Delta

- Make the loaded LiquidAIty application work again.
- Restore Main chat and direct saved-Card Bot Mode.
- Restore the in-app CodeGraph through the official CBM provider.
- Remove the unwanted CodeGraph Feature sorter.
- Verify that the Project's saved agents are present and visible.

## Preservation Set

- Preserve every saved Card, profile, grant, Project, graph record, conversation, Run, topology edge, and unrelated dirty-tree change.
- Preserve the single official application CBM frontend and one shared upstream daemon; no cache/database access, reindex, repair, project deletion, alternate frontend, or fallback.
- Preserve the joined Think/Know graph, existing Engraphis renderer, shared Inspector, File/Symbol expansion, source reads, and CodeGraph provider authority.
- Preserve the user's browser draft; live acceptance ran in a separate test tab.

## Tasks

### T001 — Recover official CBM service

- Key Objective: Restore the application-owned CBM provider without another implementation or graph authority.
- Definition of Done: official daemon lifecycle only; application catalog includes CBM; source identity is current; real CodeGraph provider reads succeed.
- Result: PASS. The official CLI reported a wedged state (`daemon status` said not running while frontends were refused as active/starting). One authorized `daemon stop`/`daemon start` lifecycle was performed, followed by one canonical `npm run dev:fresh` application reload. MCP froze 57 unique tools with `liquidaity`, `cbm`, and `graphiti` ready and no unavailable families.

### T002 — Remove Feature sorter

- Key Objective: Remove the unwanted CodeGraph Feature dropdown and always render the complete provider projection.
- Definition of Done: no `CodeGraph Feature` combobox or `All Features` option; no abandoned filter path; Feature/File/Symbol records and edges remain intact; counts/freshness remain visible.
- Result: PASS. `CodeGraphSurface` now passes the complete projection directly to the shared renderer. The filter helper and its filter-specific test were removed; multi-Feature identity remains covered by the full-projection test.

### T003 — Restore Agents canvas

- Key Objective: Prove the user's saved agents were not lost and restore their visible canvas.
- Definition of Done: authoritative saved deck still contains the six enabled core Cards; Agents navigation mounts the canvas and shows every Card without a saved-state write.
- Result: PASS. Read-only saved-deck readback returned Main, Builder, ThinkGraph, Magnetic, Team, and KnowGraph. Selecting Agents removed `workspace=knowledge`, mounted the canvas, and rendered all six Cards plus the two saved edges. No Card/topology mutation occurred.

### T004 — Prove Main chat and Bot Mode

- Key Objective: Execute real loaded Main and direct Builder turns through saved Card/Hermes authority.
- Definition of Done: newly submitted input; terminal outer Run; expected native response rendered; exact provider/model/session readback; direct Builder delivery settles through Bot Mode.
- Result: PASS.
  - Main Run `req_516c8e77bd0f4624` completed with `MAIN_CHAT_OK`, provider `openai-codex`, model `gpt-5.6-sol`, session `20261016_200153_db929c`.
  - Direct Builder Bot Mode Run `req_11da909347e246e9` completed with `BUILDER_BOT_OK`, provider `openai-codex`, model `gpt-5.6-sol`, same saved Main session. The Builder delivery settled in saved Builder session `20261016_195431_6b25c4`.
  - Both replies rendered in Main chat with exact underscores and no accidental emphasis.

## Actual Changes

- `client/src/components/knowledge/KnowledgeAuthorityGraphSurface.tsx`
  - Removed Feature selection state, dropdown, reset effect, and filtered projection.
  - Retained read-only Feature/File/freshness counts.
  - Passes the complete CodeGraph projection to the existing Engraphis surface.
- `client/src/components/knowledge/codeGraphProjection.ts`
  - Removed the now-abandoned `filterCodeGraphProjection` presentation path.
- Focused tests
  - Assert the sorter is absent and the complete projection reaches the one renderer.
  - Assert one shared File retains both source-owned Feature memberships.
- Runtime
  - Started the official permanent CBM daemon once and reloaded the canonical application stack once.
  - No saved Product data, Git state, index data, cache data, or configuration was changed.

## Verification

### Source

- PASS — direct source and CBM map identified the exact sorter owner and all consumers.
- PASS — exact residue search finds no production `CodeGraph Feature`, `All Features`, or `filterCodeGraphProjection` path.
- PASS — `git diff --check` for the four changed files.

### Deterministic

- `KnowledgeAuthorityGraphSurface.spec.tsx`: 32 passed.
- `codeGraphProjection.spec.ts`: 3 passed.
- Client source and spec TypeScript checks: PASS.
- Client production build: PASS, 2,715 modules; only the existing God's Eye `node:fs` externalization and large-chunk warnings remain.

### Loaded

- PASS — MCP catalog ready, 57 generated/published/unique tools, zero unavailable families, `sourceCurrent=true`, startup `96048858c8c24789b04be05c94c6ee4d`.
- PASS — loaded CodeGraph rendered 51 Features and 374 Files with no `read_failed` state and no sorter.
- PASS — loaded Agents canvas rendered all six saved core Cards.

### Live Agent

- PASS — one new real Main turn and one new real direct Builder Bot Mode turn completed with exact expected outputs.

### Persistence

- PASS — exact outer Run readback confirmed both terminal Runs, provider/model/session identities, and final results.
- PASS — Builder's direct Bot delivery settled; saved Card/deck/topology state remained unchanged.

### Visual

- PASS — inspected the loaded Main chat, Builder reply, Agents canvas, and positive CodeGraph scene. The Feature sorter is absent.
- Owner visual acceptance remains the owner's judgment.

## Baseline or Unrelated Failures

- One initial combined Vitest attempt could not start an isolated worker under concurrent service/build load; exact isolated replays passed 32/32 and 3/3.
- CodeGraph reports freshness `unverified`; the real 51-Feature/374-File projection and provider calls succeeded. No freshness gate or hidden fallback was added.
- Existing older pending Runs were not altered.

## Documentation Coherence

- No canonical architecture document claimed the removed Feature selector as required current behavior.
- This report replaces the prior blocked retry handoff with the successful daemon recovery and loaded acceptance evidence.

## Remaining / Blocked

- None for the requested recovery.

## Proposal — Not Implemented

- None.

## Changed-File Snapshot

`turn.md` is excluded from its own self-referential digest.

```text
86cd01879e8f4ebe552f717b87e6c346c86d4de7c812db708e620e695939fb0c  client/src/components/knowledge/codeGraphProjection.spec.ts
001514058b15251cc805dbef1a3e6dfc23d5cb3969234b9df9b7abdd00dce3e1  client/src/components/knowledge/codeGraphProjection.ts
dcc9b552be7d3c6805008ea5ed555aa5c972fe135d1cb7b0808154d7c57b6ec4  client/src/components/knowledge/KnowledgeAuthorityGraphSurface.spec.tsx
934f4dcb6c0b799a15d010d0f5eeb4a8a14534e9bdd8e783a0961e1994786043  client/src/components/knowledge/KnowledgeAuthorityGraphSurface.tsx
```

CHANGED_SNAPSHOT_SHA256: `8bb4222189f9ac0a552563951dcec5f2706355a3c5fcec7b4bb58dd8d8cdbba9`
