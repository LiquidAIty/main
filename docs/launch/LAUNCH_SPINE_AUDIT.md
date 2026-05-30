# LAUNCH_SPINE_AUDIT

Date: 2026-05-27
Scope: launch wiring audit + safest first implementation chunk

## Current State
- Root launch routes send `/` and chat aliases to `client/src/pages/agentbuilder.tsx` through `client/src/app.tsx`.
- Chat runtime path is deck-run based (`/api/v3/projects/:projectId/decks/run`) and not the legacy `/api/v2/projects/:projectId/agent_builder/chat` path for primary workspace execution.
- Magentic-One executes through Python AutoGen sidecar (`AUTOGEN_ORCHESTRATOR_URL` -> `/autogen/orchestrate`) with card runtime payload assembly in backend `v3` runtime.
- LocalCoder/OpenClaude exists as a backend-owned harness with status/run/terminal-launch routes.

## What Was Found

### 1. Landing layout
- Root app layout file: `client/src/app.tsx`.
- First screen behavior: `/` redirects to `/agentbuilder`.
- Chat-first launch shell exists: yes, `AgentBuilder` is default route with chat-centric workspace state.
- Graph-paper background exists: yes in plan/canvas surfaces (React Flow `Background` layers) and graph visual token system.
- Chat can dock/shift left: yes, workspace has resizable chat panel and surface switching (`chatPanelWidth`, `workspace-chat-resize-handle`).

### 2. Sol/Magentic-One chat path
- Main chat component: `client/src/components/builder/BuilderChat.tsx` used by `client/src/pages/agentbuilder.tsx`.
- Backend route used by chat: `POST /api/v3/projects/:projectId/decks/run` (streaming NDJSON supported).
- Magentic-One invocation: `apps/backend/src/v3/cards/runtime.ts` -> `runMagenticCard` -> `orchestrateWithAutoGen(...)`.
- Active canvas/selected object context reaches request: yes via `workspaceObjectContext` in chat send body and backend normalization in `apps/backend/src/v3/runtime/deckRuntime.ts`.

### 3. Magentic bus/default wiring
- Magentic bus component exists (`MagenticBusNode`, resolver and topology helpers).
- Backside/system side logic exists conceptually through system cards + magentic_option edges.
- Deck/project seed is centralized in `INITIAL_DECK` in `client/src/pages/agentbuilder.tsx`.
- Default cards existed but default edges were empty before this change.

### 4. LocalCoder/OpenClaude implementation
- Launch mechanism:
  - Terminal wrapper script: `apps/backend/scripts/openclaude-terminal-launch.ps1`.
  - Adapter builds launch command against `localcoder/bin/openclaude` and backend env ownership.
- Route prefix:
  - `/api/coder/openclaude/status`
  - `/api/coder/openclaude/run`
  - `/api/coder/openclaude/terminal/launch`
- Installed status detection: yes (`OpenClaudeAdapter.getInstallInfo`).
- Receives task/context: yes (`task`, mode/access/provider/model options, optional system prompt).
- Minimal chat-side access: indirect today via `local_coder` runtime card under deck runtime.

### 5. Magentic-One terminal/tool hands reality
- Python sidecar does not create a native terminal participant abstraction; participants are AutoGen assistant participants derived from callable heads.
- LocalCoder/OpenClaude is not included as participant for Python team calls.
- `local_coder` is explicitly excluded from Python callable participant types (unsupported heads are recorded in payload).
- Magentic-One cannot directly inspect repo/files through Python participants today unless routed via supported participant runtime and tooling.
- OpenClaude is best exposed as a system capability/runtime card (already true via `local_coder` card path).

### 6. Selected object / active canvas state
- Selected object state is built in `agentbuilder.tsx` and transported as `workspaceObjectContext`.
- Active canvas/surface is represented with `activeSurface`, `workspaceView`, workbench fields.
- Selected graph node exists through plan/canvas focus state and card selection state.
- Selected object to editable target mapping is partial and surface-specific.

### 7. Plan / MissionSpec-related code
- Plan surfaces exist (`PlanMissionFlow`, plan wiki/document state, structured plan extraction).
- MissionSpec type did not exist as a named cross-layer contract.

### 8. ThinkGraph and KnowGraph flows
- ThinkGraph chat extraction path: `apps/backend/src/routes/v2/kg.routes.ts`.
- KnowGraph ingest/query path: `apps/backend/src/routes/knowgraph.routes.ts` + service `services/knowgraph/*`.
- ThinkGraph and KnowGraph are separate flows and can be separately invoked.
- Boundary logging in v2 KG route indicates ThinkGraph chat extraction should not directly write to Neo4j in boundary mode.
- No direct graph mutation path from Magentic-One runtime itself was added in this chunk.

### 9. CodeGraph/code context state
- CodeGraph exists as context contract (`graphViewContract` with `graphKind: 'codegraph'`) and runtime output memory.
- Code-based memory MCP is configured in backend MCP config.
- Current minimal CodeGraph exposure is context/view-contract based, not full mutation pipeline.

## What Was Changed (Safe First Chunk)
1. Added/confirmed default backside/system seed connections in `INITIAL_DECK`:
- Plan / MissionSpec (`card_plan_agent`)
- LocalCoder / OpenClaude Harness (`card_local_coder`)
- ThinkGraph Agent (`card_thinkgraph_agent`)
- KnowGraph Agent (`card_knowgraph_agent`)
- Research Agent (`card_research_agent`)
- CodeGraph Context (`card_codegraph_agent`)

2. Added minimal MissionSpec type on both frontend and backend shared deck contracts:
- `id`
- `title`
- `userGoal`
- `target`
- `readContext`
- `agentRuns`
- `runState`

3. Added minimal generic CanvasObjectContext type on both frontend and backend shared deck contracts:
- `id`
- `canvasId`
- `type`
- `title`
- `props`
- `editableTargets`
- `graphRefs`

4. Added explicit OpenClaude harness system capability metadata and route-prefix constant:
- Frontend capability registry marker tied to `card_local_coder` + `/api/coder/openclaude`
- Backend exported route prefix constant in coder routes

## What Is Missing
- MissionSpec execution semantics are not wired end-to-end yet (type added, runtime contract integration still pending).
- CanvasObjectContext mapping to real editable targets and graphRefs remains partial and surface-dependent.
- Python orchestration still excludes `local_coder` participants; Magentic tool-hands bridge policy needs explicit design pass.

## What Was Intentionally Not Changed
- No extra approval-control layer was introduced.
- No OpenClaude log duplication layer was introduced.
- No direct graph mutation path was added to Magentic-One or OpenClaude harness.
- Optional/demo canvases were not default-connected.

## Boundary Status
- Sol/Magentic-One query/traverse: supported through runtime context + graph query paths.
- Sol/Magentic-One direct graph mutation: not added in this chunk.
- LocalCoder/OpenClaude workspace/code editing: supported.
- LocalCoder/OpenClaude direct graph memory mutation: not added in this chunk.
- Graph mutation ownership remains with graph flows/services.

## Next Safe Implementation Step
- Wire MissionSpec as the explicit pre-run contract for `decks/run` payloads (non-breaking optional field), then map selected object/canvas to the new minimal CanvasObjectContext fields and feed that into Magentic planning prompts without altering graph-write boundaries.

## Local Route Check Commands
- Backend local/dev route checks should use port 4000 unless the environment explicitly overrides PORT.
- OpenClaude status:
  `Invoke-RestMethod "http://localhost:4000/api/coder/openclaude/status"`
- OpenClaude terminal launch:
  `Invoke-RestMethod "http://localhost:4000/api/coder/openclaude/terminal/launch"`

## Approved Mission Execution
- MissionRun type/status:
  - Added cross-layer `MissionRun`, `MissionRunStatus`, and `MissionAgentRunStatus`.
  - Mission statuses now support: `approved`, `wiring`, `running`, `complete`, `failed`, `cancelled`, `needs_user_input`.
  - Agent run statuses now support: `queued`, `running`, `complete`, `failed`, `skipped`, `needs_user_input`.
- MissionDeckPatch status:
  - Added `MissionDeckPatch` contract.
  - Added pure helpers:
    - `buildMissionDeckPatch(missionSpec, currentDeck)`
    - `applyMissionDeckPatch(currentDeck, patch)`
  - Behavior is non-destructive: avoids duplicate node/edge insertion and does not delete user-created deck content.
- Approval-to-run behavior:
  - Plan surface `Approve` now triggers mission run wiring/execution flow.
  - Flow: `approved -> wiring -> running -> (complete|failed)`.
- Sequential execution status:
  - Approved mission steps execute in order.
  - Current supported chain in this pass: `research_agent -> knowgraph_agent -> thinkgraph_agent`.
  - Unsupported/missing steps are marked honestly (`skipped` or `failed` based on required flag).
- Agents that can actually run now:
  - Research Agent (`card_research_agent`)
  - KnowGraph Agent (`card_knowgraph_agent`)
  - ThinkGraph Agent (`card_thinkgraph_agent`)
  - Via existing `/api/v3/projects/:projectId/decks/run` runtime path.
- Prompt seeding and result passing:
  - Mission prompt seeds are written into agent card prompt fields by deck patch.
  - Each step input includes mission goal + prior step output for simple chained context.
- UI status:
  - Plan surface now shows mission status and per-agent run status summary.
  - No heavy log viewer was added.
  - OpenClaude terminal logs are not duplicated.
- Graph boundary status:
  - Sol/Magentic runtime still does not directly mutate ThinkGraph/KnowGraph/CodeGraph records.
  - Deck wiring harness only mutates deck/canvas state and invokes existing agent/runtime paths.
  - ThinkGraph and KnowGraph writes remain owned by their graph agent/service flows.
- Known limitations:
  - Approval currently triggers from the existing activation proposal approval affordance.
  - Mission execution currently uses a fixed initial agent chain and does not yet parse a richer mission graph.
  - MissionRun persistence is UI session state; it is not yet persisted as a backend run record.
- Next safe step:
  - Add explicit `missionSpec` payload support on `/decks/run` with backend-side mission run state persistence and structured per-step result contracts, while preserving graph-write boundaries.

### Backend Mission Run Contract
- `/api/v3/projects/:projectId/decks/run` now accepts optional mission fields:
  - `missionSpec?: MissionSpec`
  - `missionRunId?: string`
  - `missionAgentRunId?: string`
- Deck-run responses now include optional mission metadata (without breaking existing consumers):
  - `missionRunId`
  - `missionAgentRunId`
  - `missionStatus`
  - `agentRunStatus`
  - `resultSummary`
  - `needsUserInputReason`
  - `errorReason`
- Backend runtime context now carries mission fields into card execution context and returns mission metadata in `run.mission`.
- Frontend mission execution now sends mission fields on each sequential step and prefers backend mission metadata when present, with existing fallback parsing preserved when metadata is absent.
- Limitations:
  - Mission metadata is per-request/per-run payload metadata, not durable mission history storage.
  - `needs_user_input` is included in the contract, but only populated when runtime path emits that condition.
- Next safe step:
  - Persist mission runs server-side (project-scoped) and expose a lightweight read endpoint for resume/inspection while keeping graph mutation boundaries unchanged.

### Workspace Harness / Claude-Code-Style Filter
- Purpose:
  - Introduce a provider-neutral workspace action layer used by Sol/Magentic chat for deck/mission/plan actions.
- Provider design:
  - Current provider: `internal-workspace`
  - Future provider targets: `openclaude`, `claude-code`, `codex`, `local`
- Supported operations in this pass:
  - `inspect_context`, `draft_mission`, `refine_mission`, `generate_deck_patch`, `apply_deck_patch`, `connect_agents`, `seed_prompts`, `run_approved_mission`, `query_graph`, `traverse_graph`, `ask_clarifying_questions`, `request_graph_update`
- Excluded operations in this pass:
  - source-code editing, direct graph writes, arbitrary terminal execution, continuous/scheduled/watch loops
- Open mission message behavior:
  - A minimal live mission card is maintained with mission title/status, active agent statuses, latest summary, and final outcome hints.
- Graph boundary:
  - Harness may return `graphUpdateRequests` but cannot directly mutate graph records.
  - ThinkGraph/KnowGraph graph writes remain owned by their graph agents.
- Next safe step:
  - Add a backend-managed harness executor endpoint for provider routing/policy while keeping mission execution on existing mission-aware `/decks/run` path.

### Dual Reply Planning
- Sol reply and plan drafting now run in parallel per chat turn.
- Users can keep chatting while ChatPlanCompanion drafts/refines the MissionSpec from the same message and current workspace context.
- ChatPlanCompanion supports first-pass mission types:
  - `plan_only`
  - `research_to_knowgraph`
  - `object_agent_setup`
  - `graph_query_summary`
- If intent is vague, ChatPlanCompanion returns `needs_user_input` questions and keeps the draft editable.
- Approval freezes the current draft MissionSpec and runs it through the existing MissionRun + mission-aware `/decks/run` execution path.
- Graph boundary remains unchanged:
  - ChatPlanCompanion does not directly mutate graph records.
  - ThinkGraph/KnowGraph writes remain graph-agent owned.
- Next safe step:
  - Move ChatPlanCompanion drafting logic behind a backend endpoint for centralized policy, validation, and future provider routing.

#### Manual Smoke
1. Open `/agentbuilder`.
2. Send: `Research AI agent marketplaces and build a knowledge map.`
3. Confirm Sol replies normally.
4. Confirm Plan surface enters `Drafting plan...` then `Plan ready`.
5. Send: `Add KnowGraph and make it source-backed.`
6. Confirm the same draft updates (no duplicate unrelated plan).
7. Send: `Skip CodeGraph for now.`
8. Confirm CodeGraph is removed/skipped in the draft plan.
9. Approve.
10. Confirm mission runs until done through existing MissionRun path.
11. Confirm graph writes only happen through graph agents.

### Project Deck Layout Persistence
- The previous default-layout attempt was reverted; changing `INITIAL_DECK` is not a fix for existing projects with persisted decks.
- Manual canvas layout now persists per project/deck via the existing backend deck save route:
  - `PUT /api/v3/projects/:projectId/decks/:deckId`
- Autosave is triggered for layout mutations:
  - `canvas:nodes` (drag/move position changes)
  - `canvas:edges`, `canvas:connect`, `canvas:reconnect`, `edge-delete` (connection changes)
- Seed overwrite protections:
  - hydration no longer hard-replaces legacy/system-only persisted decks with `INITIAL_DECK`.
  - existing persisted node positions are preserved during system-card upgrade hydration.
- Mission patch behavior remains non-destructive for layout:
  - existing node positions are preserved
  - existing user edges are not blanket-replaced by seed defaults
- Known limitations:
  - autosave is client-debounced and depends on existing deck revision/CAS behavior.
  - display-fallback mode intentionally does not autosave.
- Next safe step:
  - show a lightweight “Last saved” timestamp in the canvas controls so users can verify autosave state immediately.

#### Manual Persistence Smoke Checklist
1. Open an existing project in `/agentbuilder`.
2. Move three nodes.
3. Add one edge.
4. Remove one edge.
5. Wait for save/autosave.
6. Refresh the browser.
7. Confirm exact layout remains.
8. Restart frontend dev server.
9. Reopen the same project.
10. Confirm exact layout remains.
11. Restart backend.
12. Reopen the same project.
13. Confirm exact layout remains.
14. Send a chat message.
15. Confirm layout remains.
16. Approve/run a mission.
17. Confirm layout remains.

### Semantic Graph Language (ThinkGraph / KnowGraph)
- Added first-pass shared semantic graph contracts (frontend + backend v3 types):
  - `SemanticGraphRecord` (JSON-LD compatible `@context`, `@id`, `@type`)
  - `SemanticGraphEntity`
  - `SemanticGraphRelationship`
  - `SemanticGraphSourceRef`
  - `SemanticGraphProvenance`
  - `GraphUpdateRequest` (request-only boundary)
  - `GraphSearchRequest`, `GraphTraverseRequest`, `GraphNeighborhoodRequest`
- Writer boundary is explicit in contract:
  - writers: `thinkgraph-agent`, `knowgraph-agent`, `codegraph-agent`, `system`
  - write modes: `agent-owned`, `system-owned`, `read-only`
- Sol / WorkspaceHarness / ChatPlanCompanion are represented as requesters, not direct graph writers.
- Added normalization adapter stubs on backend:
  - `normalizeKnowGraphOutputToSemanticRecords(...)`
  - `normalizeThinkGraphOutputToSemanticRecords(...)`
  - `canApplyGraphUpdateRequest(actor)` enforces graph-agent-only apply boundary.
- Persistence status for semantic records:
  - contract and normalization are implemented;
  - direct semantic-record persistence path is not yet wired in this pass.

### Real Semantic Graph Foundation
- Existing skills found and updated:
  - `.skills/frontend/react-flow-xyflow/SKILL.md` (existing, reused)
  - `.skills/graph/graph-memory-design/SKILL.md` (updated in place; no duplicate skill created)
- OWL/JSON-LD alignment:
  - semantic organizing format explicitly aligned to OWL/RDF/JSON-LD concepts in graph-memory skill rules
  - no custom ontology language introduced
- Category theory posture:
  - explicitly treated as emergent structure from typed records/relationships/properties/paths/vectors/ML
  - not implemented directly and not exposed as product surface
- Actual files changed:
  - `.skills/graph/graph-memory-design/SKILL.md`
  - `client/src/types/agentgraph.ts`
  - `apps/backend/src/v3/types/index.ts`
  - `apps/backend/src/v3/graph/semanticLanguage.ts`
  - `apps/backend/src/v3/graph/semanticLanguage.spec.ts`
  - `client/src/components/graph/thinkGraphReactFlowAdapter.ts`
  - `client/src/components/assist/ThinkGraphFlow.tsx`
  - `client/src/components/knowledge/KnowledgeGraphNVL.tsx`
- Validation status:
  - `validateSemanticGraphRecord(record)` added with `ok/errors/warnings`
  - missing provenance now errors
  - KnowGraph claim/evidence/source without source refs errors unless clearly low confidence (warn path)
  - unknown source ref type no longer silently falls back to `chat`
- Graph UI behavior status:
  - no synthetic placeholder edges were added
  - ThinkGraph flow node/edge details now come from actual graph payload fields only
  - hover metadata expanded to include confidence/source counts where present
  - node source action opens URL in new tab; non-openable refs show explicit "source target not yet openable."
- Source-link behavior status:
  - URL source refs open via browser new tab
  - non-URL source targets are explicitly reported as not openable yet
- No fake graph / no road-sign rules:
  - added to graph-memory skill constraints and semantic normalizer validations
  - no fake persistence success added
- Known limitations:
  - backend normalization validates and filters records but does not persist to Neo4j in this pass
  - semantic detail panel richness depends on fields present in current graph query payload
  - KnowledgeGraphFramework still renders through existing shared scene path; no new semantic backend read endpoint introduced
- Next safe step:
  - wire a backend `GraphReadResult` endpoint that returns records + relationships + source refs + provenance with confidence filtering, then bind KnowledgeGraphFramework/NVL detail drawer directly to that payload.
