# AgentBuilder UI Contract

## Current Intended Structure

The current AgentBuilder UI is not a generic split-pane application.

It is a protected workspace contract built around:

- AgentBuilder page as conductor
- project-backed chat with Magentic-One
- Agent canvas on the right when canvas workspace is active
- the Magentic bus/internal helper stack visually coupled to the chat/canvas seam
- companion surfaces for plan/knowledge/worldsignal/codegraph-style work

## Core UX Rules

- ADMIN project auto-loads when present
- initial load should present a chat-first view
- internal helper agents can be tucked under or behind chat by default
- manual pan may reveal the internal graph
- chat/bus/canvas behavior must not silently become a normal generic split-pane unless explicitly redesigned

## Protected Layout Contract

- chat is intentionally tied to the Magentic-One bus/internal agent stack
- the bus/internal helper stack may be partially covered by the chat-first presentation view
- splitter resize must preserve the presentation relationship
- release, blur, and Escape cleanup must not leave resize stuck

See also:

- `docs/agentbuilder-viewport-contract.md`

## Forbidden UI Regressions

- do not add roadsign banners
- do not add fake fallback boards
- do not reintroduce `displayFallback`
- do not recreate `launchMode.ts`
- do not convert runtime errors into fake graph nodes
- do not claim a visual fix without screenshot/measurement proof

## Current Conductors

### Page conductor

`client/src/pages/agentbuilder.tsx`

Still owns:

- top-level workspace orchestration
- mission/plan orchestration
- KG orchestration
- object drawer/editor conductors
- active surface selection

### Safe extracted shell helpers

`client/src/features/agentbuilder/core/`

- workspace shell pieces
- splitter/shell helpers
- viewport math helper

### Main canvas shell

`client/src/features/agentbuilder/canvas/`

- `AgentCanvasPane.tsx`
- `AgentBoard.tsx`

### State hooks

`client/src/features/agentbuilder/state/`

- project state hook
- deck state hook
- selection state hook
- deck load hook
- project reset hook
- autosave hook if present

### ReactFlow internals

`client/src/components/builder/`

- `BuilderCanvas.tsx`
- `MagenticBusNode.tsx`
- node/edge internals

## Active Surfaces

- Chat / Magentic-One
- Agent Canvas
- Plan Canvas
- KnowGraph
- ThinkGraph
- CodeGraph
- WorldSignals
- Trading surface placeholder/workspace if present
- Local Coder as an active helper capability

## Inactive/Draft Surfaces

- Telescope
- NRGSim / Energy
- Image
- Video
- Data Formulator
- Understand Anything
- broader media/science/design surfaces

Rules:

- inactive source can remain in repo
- inactive surfaces should not appear as active rail/canvas clutter
- inactive surfaces should not leak through active canvases such as WorldSignals
- future reactivation should happen through a deliberate Add Agent / Add Canvas action

## Do-Not-Touch-Without-Spec Areas

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

- do not infer architecture from old route names
- do not create new versioned project routes
- do not “fix” missing data with fallback boards
- do not hide unfinished features with launch flags
- do not split chat/bus/canvas UX without screenshot proof
- preserve `/api/projects` as the single AgentBuilder route family
- preserve project-backed deck persistence
