# CODE.md

> Non-canonical working memo.
> This file does not override `docs/README.md`, `docs/architecture.md`, `AGENTS.md`, `.specify/memory/constitution.md`, or `specs/*`.
> Do not treat this file as implementation approval or current Stage 0 truth.

## Current Working State
The repo is an Nx-style monorepo with active frontend and backend surfaces (`client`, `apps/backend`, `apps/python-models` visible in the code graph index). The main active product shell is in `client/src/pages/agentbuilder.tsx`, which currently acts as orchestration, state container, interaction controller, and layout compositor in one file.

The current app behavior is functional across primary surfaces:
- project selection and project drawer flows
- chat surface (`BuilderChat`)
- deck/canvas authoring surface (`BuilderCanvas`)
- right companion/editor surface (tabs and inspectors)
- knowledge/codegraph surface switching with shared graph framework

Core graph/builder behavior is implemented and non-trivial (deck execution planning, runtime visual state, canvas persistence mutations, focus and viewport recovery), but the implementation is tightly coupled in large components and still carries active stabilization work.

What is clearly working:
- 3-zone workspace behavior in canvas mode (chat + canvas + companion editor)
- resizable left/chat and right/editor regions with minimum-width guards
- collapsible companion dock behavior
- drawer-based navigation/projects workflow
- shared graph visual contract usage in builder/knowledge graph components

What is still unstable or high-maintenance:
- `agentbuilder.tsx` remains very large and multi-responsibility
- heavy inline style usage and duplicated resize/dock UI fragments
- mixed tokenization maturity (graph surfaces are more standardized than shell/editor surfaces)
- several new/untracked files suggest in-flight migration, not fully settled architecture

## Current UI / UX Direction
- Fixed left rail: narrow persistent rail with workspace mode switching (Home, Agents/Canvas, Knowledge, CodeGraph, Plan, Menu).
- Left chat column: the large surface defaults to chat behavior and stays integrated with project context and runtime actions.
- Center canvas / graph workspace: when in canvas view, the middle region is dedicated to `BuilderCanvas` with deck graph editing and runtime emphasis.
- Floating right-side editor/drawer concept: a collapsible, resizable right companion dock handles context editors; modal-style drawer (`BuilderDrawer`) handles navigation/projects.
- Dark glass / teal-cyan visual language: dark base surfaces with teal-cyan accents are present in both shell and graph themes.
- Compact density: small tab pills, compact controls, narrow rail, and constrained panel paddings prioritize usable information density.
- Shared visual token direction: `graphVisualTokens.ts` + `graphWorkspaceContract.ts` centralize graph color/navigation/zoom rhythm and control styling.

## Technical Achievements in the New Design
- Glass panel tokenization (graph-first): `GRAPH_THEME` defines consistent graph surface/background/accent/control tokens rather than one-off edge/control color literals.
- Shared styling helpers: `graphPillButtonStyle`, `graphControlButtonStyle`, and shared workspace nav constants reduce per-component styling drift in graph surfaces.
- Floating editor/drawer behavior: right companion dock supports collapse/expand and resize; overlay drawer gives focused navigation/project management.
- Compact layout improvements: explicit min widths (`AGENTS_CHAT_MIN_WIDTH`, `AGENTS_CANVAS_MIN_WIDTH`, `AGENTS_EDITOR_MIN_WIDTH`) reduce accidental layout collapse.
- Reduced hardcoded-width damage: panel widths are clamped against shell width to preserve center workspace viability.
- Improved layout stability work: canvas viewport recovery logic prevents common "graph lost offscreen/camera jump" regressions.
- Better visual consistency direction: graph and knowledge surfaces are converging on shared contracts/themes rather than unrelated style islands.
- CodeGraph / Knowledge organization improvements: workspace view switching and `GraphViewContract` handling support both knowgraph and codegraph within one surface framework.

## Why This Design Direction Is Better
- Preserves canvas space better: explicit width clamping protects graph authoring space from side panel overgrowth.
- Reduces layout crushing: minimum-width guards and resize constraints keep 3-zone layouts usable under resize.
- Improves consistency: shared graph theme/workspace contracts align controls, zoom behavior, and graph aesthetics.
- Feels more like a product shell: fixed rail + structured surfaces + collapsible companion region provide predictable navigation.
- Makes future styling easier: tokenized graph styles are a reusable base for continuing shell-level token adoption.
- Keeps complexity manageable: explicit surface roles (large vs companion) and workspace modes organize growing feature surfaces.
- Supports responsive stabilization better than one-off tweaks: width clamps and centralized graph navigation settings are maintainable levers.

## How To Think About This System
- Treat this as continuation-and-polish, not a reset redesign.
- Protect the working structure that already supports chat, canvas, knowledge/codegraph, and companion editing.
- Preserve the 3-zone canvas layout behavior (left chat, center canvas, right companion editor).
- Prefer shared tokens/contracts over one-off inline style additions where feasible.
- Avoid introducing large hardcoded widths/min-widths that bypass existing clamp logic.
- Avoid regressions into older "single giant pane" behavior that crushes canvas/editor usability.
- Keep behavior stable unless behavior change is explicitly requested.
- Treat layout stability and viewport stability as first-class requirements, not cosmetic extras.

## Current Risks / Fragile Areas
- `client/src/pages/agentbuilder.tsx` is a monolithic control surface (state, networking, layout, rendering, telemetry), raising regression risk for small changes.
- Dock resize/collapse UI is partially duplicated (same grip motifs and logic in multiple branches), increasing drift risk.
- Style system is partially tokenized: graph surfaces have shared tokens; many shell/editor surfaces still use local constants/inline gradients.
- Multiple `any`-typed graph payloads and broad unknown normalization increase runtime-shape mismatch risk.
- Window-global contract hooks (`__LIQUIDAITY_SET_CODEGRAPH_VIEW_CONTRACT__`) are effective but fragile integration points.
- New/untracked frontend files indicate active migration; integration boundaries and ownership may still be shifting.
- Drawer width/layout behavior (`BuilderDrawer` fixed width and full-screen occlusion) is intentional but rigid for future responsiveness.

## Immediate Next Priorities
- Break `agentbuilder.tsx` into composable shell/surface/controller modules without changing behavior.
- Extend shared visual token usage from graph surfaces into shell/editor/drawer controls.
- Consolidate dock grips/resize behavior into shared components/hooks to remove duplicate logic.
- Add/strengthen tests around workspace view switching, dock collapse/expand, and resize clamping invariants.
- Harden typing for graph payload normalization paths to reduce runtime contract drift.
- Finish integrating current in-flight UI files and remove incidental/generated working-tree artifacts from normal commits.
