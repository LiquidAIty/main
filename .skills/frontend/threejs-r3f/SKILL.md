# Three.js / React Three Fiber

## Trigger

Use only when:
- editing Three.js, React Three Fiber, Drei, WebGL, or 3D scene code
- changing Energy, Telescope, protein/molecule, or other 3D canvas surfaces
- changing cameras, controls, render loops, model loading, lights, materials, or interaction
- fixing 3D performance, memory leaks, or broken scene behavior

## Read

- SOUL.md
- AGENTS.md
- .specify/memory/constitution.md
- relevant specs/*
- relevant 3D scene/components found with Code-Based Memory MCP

## Do

- Keep scene state, UI state, and app state separated.
- Use React Three Fiber patterns instead of unmanaged imperative Three.js where the repo uses R3F.
- Use `useFrame` for frame-loop work, not unmanaged `requestAnimationFrame`.
- Keep render-loop work minimal and frame-rate independent.
- Use Drei helpers when already part of repo patterns.
- Clean up/dispose expensive resources when needed.
- Preserve interaction controls, camera behavior, and canvas layout.

## Do Not

- Do not create unbounded render loops.
- Do not load heavy assets without approval or lazy-loading strategy.
- Do not mix DOM state and scene state blindly.
- Do not mutate shared scene objects in ways React cannot track.
- Do not add postprocessing/performance-heavy effects without approval.
- Do not claim performance improved without evidence or clear reasoning.

## Validate

Inspect scripts first.

```powershell
npm --prefix client run build
npm --prefix client run typecheck
```

Manual check:
- scene still renders
- controls still work
- no obvious render-loop runaway
- no broken camera/viewport behavior

## Docs

New 3D behavior -> relevant specs/*  
3D architecture change -> docs/architecture.md  
Run/build command change -> docs/runbooks/full-stack-dev.md

## Source

Extracted from TerminalSkills react-three-fiber public skill and adapted for LiquidAIty.
