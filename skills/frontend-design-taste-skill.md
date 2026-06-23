# Skill: Frontend Design Taste (Redesign Existing Surfaces)

@skill id=frontend-design-taste
@type Skill
@status active
@related_to deep-glass-inspector-material
@related_to no-fake-surfaces

## Source / Attribution

Adapted from **Taste Skill** (`redesign-existing-projects` + `high-end-visual-design`)
by Leonxlnx, MIT — https://github.com/Leonxlnx/taste-skill. This is the LiquidAIty-scoped
version. The upstream skill is also installable directly (see "Plugin / Install" below).

## When To Use It

When improving the LOOK of an EXISTING LiquidAIty surface (graph panels, inspectors,
WorldSignal, Energy, Media, agent cards). The job is to make real surfaces look good,
not to invent new ones.

Hard rule (the antidote to the deleted /workbench mistake): **audit and fix what's
there. Do not rewrite from scratch. Do not add a new UI system, route, or design
framework.** Small, targeted, reviewable changes only.

## Scope Warning For This App

The upstream `high-end-visual-design` skill is tuned for **$150k marketing landing
pages**: huge whitespace (`py-40`), asymmetric bento, massive type, scroll-reveal
everything, a "variance engine." LiquidAIty is a **dense agent / trading / graph
workbench**. Cherry-pick the SURFACE, COLOR, MOTION, and STATE rules below; do NOT
apply the landing-page layout mandates to dense data UI.

## Scan -> Diagnose -> Fix

1. Scan: read the real component + its shared tokens (`graphVisualTokens.ts`). Identify
   the styling method (this repo: inline styles + shared token helpers, Tailwind v4).
2. Diagnose: list the generic/weak patterns below that actually appear.
3. Fix: targeted upgrades on the existing stack. Test after each.

## High-Value Checks (apply where real)

* Color/surfaces: avoid the "purple/blue AI gradient" fingerprint; keep one accent
  (this repo: teal `#37ADAA`). `GRAPH_THEME` carries a purple `memory` and orange
  `solar` accent — consolidate deliberately, don't sprinkle.
* Shadows: tint to the background hue, never pure black at low opacity.
* Surfaces: true glassmorphism = blur + a 1px directional border + layered inner
  shadow for edge refraction (see [[deep-glass-inspector-material]]), not bare
  `backdrop-filter: blur`.
* States: real hover / active (`scale(0.98)`) / focus-ring / loading-skeleton /
  honest empty + error states. Never `window.alert()`.
* Motion: animate only `transform` / `opacity`; custom easing over `linear`;
  `IntersectionObserver`, never a scroll listener.
* Type: tabular figures for data columns; sentence case headers; limit body width.
* Performance: `backdrop-blur` only on fixed/small floating elements, never large
  scrolling/animating containers.

## Fix Priority (max impact, min risk)

1. Color/shadow cleanup → 2. hover/active/focus states → 3. surface material (glass /
tinted shadow) → 4. spacing/rhythm on the existing layout → 5. loading/empty/error
states. Stop and review between steps.

## Rules

* Work with the existing stack; never migrate frameworks/styling libs (Tailwind v4 here).
* Don't break functionality, data, labels, or honest missing-state text.
* Check `package.json` before importing anything new.
* Keep edits scoped and reviewable; prefer shared-token changes that propagate over
  per-element copy-paste.

## Plugin / Install (upstream)

The upstream pack is a Claude Code plugin and an Agent-Skills bundle:

* Claude Code plugin (interactive terminal): `/plugin marketplace add Leonxlnx/taste-skill` then `/plugin install taste-skill`.
* Agent-Skills CLI (drops SKILL.md into the project): `npx skills add https://github.com/Leonxlnx/taste-skill --skill "redesign-existing-projects"`.

## Proof

@proof id=frontend-design-taste.types npx tsc -p client/tsconfig.app.json --noEmit (no new errors in touched files)
@proof id=frontend-design-taste.tests npx vitest run <focused tests for the touched surface>
@proof id=frontend-design-taste.browser smoke the real surface; confirm contrast + honest states preserved.
