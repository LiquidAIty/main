# AgentBuilder Viewport Contract

## Purpose

This document captures the intentional AgentBuilder chat/bus/canvas landing behavior so future refactors do not accidentally "fix" it away.

## Contract

The AgentBuilder workspace is intentionally not centered on the whole graph by default.

- The chat pane and the Magentic-One bus are meant to feel visually coupled.
- The vertical Magentic bus presentation should stay seam-locked relative to the chat/canvas boundary.
- The default ReactFlow viewport should hide the inner helper graph under or behind the chat pane until the user manually pans outward.
- Resizing the chat pane should re-anchor the canvas so the bus stays on the seam.
- Manual pan/zoom is allowed after landing; the lock is for initial and resize-driven presentation, not for permanent camera enforcement.

## Current Ownership

### Chat width ownership

`client/src/pages/agentbuilder.tsx`

- `chatPanelWidth` is owned at page level.
- `clampAgentsChatWidth(...)` constrains width during drag and resize.
- `finishChatResize(...)` finalizes width updates and releases drag state.

### Splitter ownership

`client/src/pages/agentbuilder.tsx`
`client/src/features/agentbuilder/core/AgentBuilderSplitter.tsx`

- Drag state and width updates remain page-owned.
- `AgentBuilderSplitter` is a render shell only and forwards pointer handlers.
- Mouse release, window blur, and Escape cleanup must continue to end resize cleanly.

### Viewport math ownership

`client/src/features/agentbuilder/core/agentBuilderViewportMath.ts`

- `resolveInitialBusSeamCenterX(...)` measures the current splitter seam inside the canvas region.
- `buildInitialBusSeamViewport(...)` converts bus target coordinates into a viewport.
- `buildInitialWorkbenchLandingViewport(...)` computes the intended landing viewport from the deck document.
- `buildPresentationLandingViewport(...)` combines seam measurement with landing math.

### Viewport application ownership

`client/src/components/builder/BuilderCanvas.tsx`

- Initial landing viewport is applied after nodes exist and before the first visible presentation is complete.
- Re-anchor after chat resize is triggered by `presentationViewportKey`.
- Manual "fit back to workbench landing" behavior also uses the same landing math.

## Default Behavior

### Initial landing

On first canvas presentation:

1. The canvas finds the current chat/canvas seam.
2. The bus presentation is re-anchored from that seam calculation.
3. The viewport lands on the workbench presentation, not the full graph extent.
4. Inner agents remain partially or fully hidden under the chat pane.

This is intentional and must remain true unless product direction changes explicitly.

### Resize behavior

When `chatPanelWidth` changes:

1. The page updates splitter width state.
2. `presentationViewportKey` changes.
3. `BuilderCanvas` recalculates the landing viewport using the new seam position.
4. The bus returns to its current git seam-relative landing without re-centering the entire graph.

### Manual pan behavior

After landing:

- The user may pan or zoom freely.
- Manual navigation may reveal helper agents that start under the chat pane.
- The product should not fight manual pan continuously.
- Re-anchor only happens on intended presentation events such as initial mount, resize-driven key change, or explicit fit behavior.

## Saved Viewport Behavior

The current project-backed deck persists nodes and edges, but the presentation landing viewport is still recomputed from layout context.

- The landing camera is presentation-driven.
- The initial view is not meant to expose the entire internal graph.
- Future refactors must not silently replace this with a generic `fitView()` default.

## Current Observed Geometry

On the current ADMIN board, the live rendered Magentic bus body does not sit at the exact same global `x` center as the splitter.

- The landing is stable and intentionally seam-derived.
- The current git behavior produces a consistent visual offset between the splitter center and the bus center.
- Refactor-only work must preserve that observed landing behavior unless a separate UI correction task explicitly retunes it.

## Must Not Break

- Do not center the entire graph by default.
- Do not retune the current git seam-relative bus landing during a refactor-only slice.
- Do not remove the resize-driven viewport re-anchor.
- Do not convert the canvas to a local fake landing state.
- Do not move the drag cleanup off the real mouseup/blur/Escape path.
- Do not save a presentation viewport as if it were a graph truth change.

## Smoke Test

1. Open `/agentbuilder?projectId=20ac92da-01fd-4cf6-97cc-0672421e751a`.
2. Confirm ADMIN loads and the board renders.
3. Confirm the chat pane is visible.
4. Confirm the Magentic bus lands in the current git seam-relative presentation position.
5. Confirm helper/internal agents are not fully exposed by default.
6. Manually pan the canvas and confirm the hidden internal graph can be revealed.
7. Drag the splitter.
8. Release the mouse and confirm resize stops immediately.
9. Confirm the bus re-aligns to the same seam-relative presentation position after resize.
10. Press Escape during a drag and confirm resize does not remain stuck.
11. Move a node and reload to confirm persistence still works.
12. Create and delete a temporary test node, reload, and confirm the final board returns to baseline.
