# Skill: Deep-Glass Inspector Material

@skill id=deep-glass-inspector-material
@type Skill
@status active
@related_to no-fake-surfaces
@related_to canvas-wiring-discipline

## When To Use It

When styling a **floating, focused surface** in LiquidAIty: an object lens, a nav
pill, a small menu, or a selected-object inspector shell. This is the
"an object is being inspected" material.

Do NOT use it for:

* Dense raw text / debug blocks that need maximum legibility (keep those darker and
  more opaque than the shell).
* Operator-first drawers meant to fully occlude the workspace
  ([[BuilderDrawer]] explicitly wants full occlusion — deep glass weakens that
  contract).
* Every panel/row. If everything becomes deep glass it turns into aquarium soup.
  Canvas nodes stay lighter and simpler; reserve deep glass for the inspected object.

## Core Rule: Material Layer, Not A New UI System

Deep glass is a **shared material on the existing graph/panel tokens**, never a new
component system or route. It lives in `client/src/components/graph/graphVisualTokens.ts`
as `graphInspectorPanelStyle()`. `graphGlassCardStyle()` is left INTACT because agent
cards, WorldSignal, Energy, and Media already consume it — deep glass is a separate,
heavier material for inspector shells only.

## What "Deep Glass" Actually Is

Regular glass = blur + translucent fill + directional border + subtle shadow + enough
detail behind it. Deep glass adds **thickness**: layered inner shadows, stronger edge
lighting, a saturation/overlay lift, rounded depth, and very subtle grain.

The recipe (`GRAPH_THEME.inspector` + `graphInspectorPanelStyle()`):

* Fill: dark but not dead opaque — `rgba(11,14,18,0.84–0.86)` so text stays readable.
* Backdrop filter: `blur(18px) saturate(150%)`.
* Border: directional gradient (bright top-right, dark bottom-left) via
  `padding-box` fill + `border-box` edge over a transparent 1px border.
* Shadow stack: outer tinted drop shadow (floating depth) + top white/teal inner
  highlight + darker bottom inner shadow + a faint teal glass rim.

## Dark-UI Tuning Trap

Glassmorphism tutorials demo on bright photo backgrounds and use **70–100% white**
inner glows. LiquidAIty is a dark instrument UI: copy those alphas literally and the
panel blows out to milky white. Dial the white insets DOWN (~0.05–0.14) and tint the
drop shadow with the background hue instead of pure black. Lowering the shell alpha
ALONE (without the layered insets/border) just makes text muddy — you need the layered
shell, not transparent black.

## Where It Is Applied

* `TaskNodeInspector.tsx` — outer `<aside>` shell only.
* `PlanSourceInspector.tsx` — outer `<aside>` shell only.

Replace ONLY the outer shell visual style. Do NOT change data, labels, missing-state
text ("none yet" / "No plan summary available."), or Run Agents behavior. The selected
inspector is rendered from real ReactFlow selection in `BuilderCanvas.tsx`, so styling
the shell does not create fake state.

Next candidate (only if the two inspectors read well): `RightGlassDrawer.tsx`, which
already powers the object drawer, CodeGraph filters, Media inspector, and Knowledge
drawer.

## Known Traps

* Lower alpha alone = muddy text. Use the layered shell.
* `backdrop-filter` belongs on small/fixed floating panels, not large scrolling
  content areas (GPU repaint cost). The inspectors are small fixed panels — fine.
* Inner sections should stay calmer/more opaque than the shell; raw artifact/debug
  blocks should stay darker than the shell so dense text stays honest and readable.

## Proof

@proof id=deep-glass-inspector-material.types npx tsc -p client/tsconfig.app.json --noEmit (no new errors from graphVisualTokens.ts / TaskNodeInspector.tsx / PlanSourceInspector.tsx)
@proof id=deep-glass-inspector-material.tests npx vitest run client/src/components/builder
@proof id=deep-glass-inspector-material.browser /agentbuilder — select a task node and a plan/source node; inspector shells read as deep glass; text contrast holds; "none yet" / missing states stay visible.
