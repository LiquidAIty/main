# Plan: First Real Research-Graph Loop

**Spec**: `specs/012-first-real-research-graph-loop/spec.md`
**Implementation owner**: Fable
**Gate**: Do not begin T001 until Spec 007 T005 passes.

## Fable Starting Brief

Do not write a new spec or redesign the execution spine. Start by completing Spec 007 T005.

Known real smoke assets:

- Backend route: `POST /api/projects/:projectId/decks/:deckId/run`
- Existing project: `18600789-6a56-4f2f-9c87-58934a300065`
- Existing two-card deck: `t005_live_smoke_20260611`
- Deck shape: one `magentic_one`, one `assistant_agent`, one `magentic_option` edge
- Both cards explicitly select `openai/gpt-5.1-chat` through provider `openrouter`
- Backend start: repository root, `npm run dev:backend`
- Python sidecar start: repository root, `npm run dev:autogen`
- Backend health: `GET http://127.0.0.1:4000/api/health`
- Sidecar health: `GET http://127.0.0.1:8003/health`
- Python dependency source: `apps/python-models/requirements.txt`
- Canonical sidecar already imports `autogen_agentchat`; the host Python environment may not.

Known T005 failure:

```text
autogen_orchestrator_http_500:
'CardRuntimePrivateParticipant' object has no attribute 'title'
```

The failing function is `_build_card_team_participants` in
`apps/python-models/app/python_models/autogen_orchestrator.py`. It already computes a safe local
`title` value, but later directly reads `participant.title` while the selected private-participant
contract intentionally has no title. Fix that boundary narrowly, add a regression test, rebuild or
restart the canonical sidecar, and rerun the same persisted-deck smoke. Do not add `title` to the
private contract merely to hide the mismatch, and do not introduce any default/fallback model path.

## Technical Context

- Backend: TypeScript, Express, Vitest.
- Runtime: `executeDeck` calls `runCardWithContract`, which calls the Python AutoGen sidecar.
- Python sidecar: FastAPI, Pydantic, AutoGen AgentChat.
- Project/deck/run persistence: Postgres V3 project blob through
  `apps/backend/src/decks/store.ts`.
- Message persistence: `apps/backend/src/messages/store.ts`.
- ThinkGraph persistence: Apache AGE/Postgres graph `graph_liq`.
- Graph access: `apps/backend/src/services/graphService.ts`.
- ThinkGraph semantic validation: `apps/backend/src/graph/semanticLanguage.ts`.
- Existing `apps/backend/src/routes/kg.routes.ts` contains useful AGE patterns but also contains
  heuristic fallback and optional auto-research behavior that must not become Spec 012 truth.

## Architecture Decision

Keep the real deck run and downstream research-graph loop as separate truth domains:

```text
decks.routes.ts
  -> executeDeck
  -> verify success plus non-empty finalOutput
  -> saveDeckRun
  -> capture CompletedChatPair
  -> enqueue/start strict downstream ThinkGraph extraction

Python ThinkGraph endpoint/service
  -> accepts strict CompletedChatPair extraction request
  -> runs a dedicated extraction agent/service
  -> returns strict records or honest empty result

Backend ThinkGraph service
  -> validates semantic records
  -> persists project-scoped records and downstream status to graph_liq
  -> derives read-only ResearchPackCandidate from persisted gaps
```

The deck response must continue to report only the real deck result. Downstream extraction status
must be separately observable. A downstream failure must not be swallowed and must not rewrite or
fake the deck result.

## Contract Design

### Completed Chat Pair

Define one canonical backend type containing:

- `projectId`
- `deckId`
- `runId`
- `turnId`
- `userText`
- `assistantText`
- `source`
- `createdAt`

Use a stable `turnId` tied to the run. Persist the user and assistant messages with the same turn
provenance through the existing message store. Make repeated handling of the same successful run
idempotent.

### ThinkGraph Extraction HTTP Boundary

Add strict Pydantic request/response models in
`apps/python-models/app/python_models/orchestration_contracts.py`.

The response should be semantic-record-shaped or map deterministically into the existing semantic
validation rail. It must support an honest empty result. It must not return default records,
heuristic records, or unvalidated free-form graph data.

### ThinkGraph Persistence

Use `runCypherOnGraph("graph_liq", ...)`. Every persisted record must include:

- `project_id`
- `turn_id`
- `run_id`
- stable record ID
- provisional ThinkGraph identity
- source reference to the completed chat pair
- created/updated timestamps

Use idempotent merge keys. Do not add Prisma or a new database.

### Research Pack Candidate

Derive the candidate from persisted ThinkGraph records representing open questions, risks needing
evidence, or evidence gaps. Each candidate question must point to its source graph record. Return
an empty candidate when no real gaps exist. Do not invoke existing research execution services.

## Likely File Impact

### Existing files likely modified

- `apps/backend/src/routes/decks.routes.ts`
- `apps/backend/src/routes/index.ts`
- `apps/backend/src/messages/store.ts`, only if its existing contract cannot preserve required
  provenance without a narrowly scoped extension
- `apps/backend/src/contracts/runtimeContracts.ts`
- `apps/backend/src/graph/semanticLanguage.ts`, only for strict contract alignment or validation
- `apps/python-models/app/main.py`
- `apps/python-models/app/python_models/orchestration_contracts.py`
- `apps/python-models/app/python_models/autogen_orchestrator.py`, only for Spec 007 T005 before
  Spec 012 begins

### New files likely added

- `apps/backend/src/services/thinkgraph/thinkgraphExtractionClient.ts`
- `apps/backend/src/services/thinkgraph/thinkgraphMemoryStore.ts`
- `apps/backend/src/services/researchGraph/researchGraphLoopService.ts`
- `apps/backend/src/routes/researchGraph.routes.ts`
- `apps/python-models/app/python_models/thinkgraph_agent.py`
- Focused backend and Python contract/service tests
- One focused live smoke script in an existing scripts or test location if no direct command is
  sufficient

### Files and systems not to touch

- UI/client files
- Prisma or migrations
- Docker files
- `.env` or `.env.example`
- ThinkGraph/Research/KnowGraph broad feature implementations outside this bounded loop
- Trading features
- Old folders

## Hard Problems Reserved For Fable

1. Repair the cross-runtime private/public participant contract mismatch without weakening strict
   model ownership, then prove T005 with real AutoGen execution.
2. Choose and implement the exact post-success capture boundary so deck truth and downstream truth
   remain separate and idempotent.
3. Design a strict Python extraction contract that maps cleanly into existing semantic validation
   and permits honest empty output.
4. Implement project-scoped, idempotent AGE persistence with provenance and observable downstream
   status.
5. Derive a Research Pack candidate only from persisted real gaps without invoking or imitating the
   broader Research system.

## Risks And Mitigations

- **Deck success becomes coupled to extraction**: Persist and expose downstream status separately;
  never rewrite a verified deck result.
- **Duplicate graph memory**: Use stable run/turn/record IDs and idempotent AGE merges.
- **Cross-project leakage**: Require `project_id` in every write and every read predicate; test it.
- **Invented graph/research output**: Strict extraction prompt/contract, semantic validation, and
  explicit empty-result tests; no heuristic fallback.
- **Accidental use of stale Neo4j specs**: Use current `graph_liq` AGE rail proven by code.
- **Accidental research execution**: Keep candidate route read-only and do not call research
  services.
- **Hidden failure**: Persist or expose pending/complete/empty/failed downstream state with exact
  error details.

## Validation Strategy

Run the smallest relevant checks after each task, then the full bounded sequence:

```powershell
cd apps/python-models
python -m pytest app/python_models/test_contracts.py -v
```

Add and run focused Python extraction contract/service tests.

```powershell
npx vitest run apps/backend/src/cards/runtime.spec.ts
npx vitest run <focused Spec 012 backend tests>
npx tsc -p apps/backend/tsconfig.app.json --noEmit
```

Final live validation must:

1. Run the persisted two-card T005 deck through the real backend and Python sidecar.
2. Verify a non-empty real `run.finalOutput`.
3. Verify one completed chat pair with matching project/deck/run/turn provenance.
4. Verify the separate Python extraction endpoint ran.
5. Query `graph_liq` and verify only project-scoped validated records were written.
6. Call the read-only candidate route and verify its questions reference persisted gap records.
7. Prove a minimal input can yield an honest empty result.
8. Prove an extraction failure is surfaced without fake success or damage to the deck result.

## Stop Gates

- Stop immediately if Spec 007 T005 does not pass after the narrow participant-title repair.
- Stop before graph writes if the strict extraction contract and validation tests do not pass.
- Stop before candidate derivation if project-scoped idempotent AGE persistence is not proven.
- Stop before declaring completion unless the real end-to-end smoke passes without mocks,
  defaults, fallbacks, fake graph writes, or fake research output.

