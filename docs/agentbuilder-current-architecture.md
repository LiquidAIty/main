# AgentBuilder Current Architecture

## Purpose

This document captures the current AgentBuilder baseline so future agents do not infer architecture from stale route versions, stale launch-flag history, or half-finished refactor assumptions.

## Current Baseline

- ADMIN project-backed workspace is the active reference baseline
- `/api/projects/*` is the canonical project/deck route family
- `launchMode.ts` is removed
- `displayFallback` is not part of the active AgentBuilder board path
- chat/bus/canvas layout is a protected UX contract
- saved project-backed deck state is authoritative

## Current File Map

### `client/src/pages/agentbuilder.tsx`

Still owns:

- page conductor
- current route constants and most frontend route usage
- runtime glue across chat, plan, deck run, KG orchestration, and surface switching
- mission approval/run orchestration
- knowledge graph orchestration
- object drawer/editor conductors
- some panel/drawer composition kept inline after rollback
- deck integrity guard callbacks and persistence-conductor wiring

This file is intentionally still large because UI stability currently matters more than decomposition purity.

### `client/src/features/agentbuilder/core/`

Currently active shell pieces:

- `AgentBuilderWorkspace.tsx`
- `AgentBuilderShell.tsx`
- `AgentBuilderRail.tsx`
- `AgentBuilderChatPane.tsx`
- `AgentBuilderCanvasRegion.tsx`
- `AgentBuilderSplitter.tsx`
- `CompanionSurfaceHost.tsx`
- `agentBuilderViewportMath.ts`

These are safe shell helpers, not the full runtime brain.

### `client/src/features/agentbuilder/canvas/`

- `AgentCanvasPane.tsx`
- `AgentBoard.tsx`

These wrap the main Agent canvas surface while leaving ReactFlow runtime internals in `client/src/components/builder/BuilderCanvas.tsx`.

### `client/src/features/agentbuilder/state/`

- `useAgentBuilderProject.ts`
- `useAgentBuilderDeck.ts`
- `useAgentBuilderSelection.ts`
- `useAgentBuilderDeckLoad.ts`
- `useAgentBuilderProjectReset.ts`
- `useAgentBuilderAutosave.ts`

These hooks exist, but `agentbuilder.tsx` still owns critical orchestration and should not be treated as fully decomposed.

### `client/src/components/builder/`

Still owns the main graph/runtime internals:

- `BuilderCanvas.tsx`
- node/edge internals
- `MagenticBusNode.tsx`
- deck run state helpers
- runtime actions
- mission/plan helper modules

### Backend route ownership

- `apps/backend/src/routes/index.ts` mounts the canonical route family
- `apps/backend/src/routes/projects.routes.ts` owns project CRUD + state
- `apps/backend/src/routes/decks.routes.ts` owns deck CRUD + run

## Frontend vs Backend Reality

### Frontend currently owns

- workspace shell and view switching
- chat UI
- plan and mission presentation
- runtime event presentation
- selection and drawer behavior
- some mission orchestration that should eventually become more backend-owned

### Backend currently owns

- project persistence
- deck persistence
- run endpoint
- deck run storage
- auth/session gates on canonical routes

## Active Surfaces

- Chat / Magentic-One
- Agent Canvas
- Plan Canvas
- KnowGraph
- ThinkGraph
- CodeGraph
- WorldSignals
- Trading workspace placeholder/surface path if present on the active shell
- Local Coder as an active helper capability

## Inactive or Draft Surfaces

- Telescope
- NRGSim / Energy
- Image
- Video
- Data Formulator
- Understand Anything
- broader media/science/design surfaces

Rules:

- inactive source may remain in repo
- inactive surfaces should not become active rail/canvas clutter by accident
- future reactivation should happen through deliberate product work, ideally Add Agent / Add Canvas style flows

## Protected Areas

Do not change casually:

- chat/bus/canvas viewport behavior
- splitter resize behavior
- under-chat reveal behavior
- deck integrity guards
- empty/partial save protection
- mission approval/run orchestration
- KG query/load/fallback logic
- chat send / Magentic-One runtime path
- graph write contracts
- Local Coder / CodeGraph workflow

## Future-Agent Warning

- Do not infer architecture from old v2/v3 route names
- Do not create new versioned project routes
- Do not “fix” missing data with fallback boards
- Do not convert runtime errors into visual canvas nodes
- Do not hide unfinished features with launch flags
- Do not split chat/bus/canvas UX without screenshot proof
- Do not claim visual restoration without browser screenshot/measurement
- Preserve `/api/projects` as the single AgentBuilder route family
- Preserve project-backed deck persistence
