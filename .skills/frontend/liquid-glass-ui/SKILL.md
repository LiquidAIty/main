# Liquid Glass UI

## Trigger

Use only when:
- changing LiquidAIty visual style, panels, cards, rails, inspector, dark UI, or glass effects
- improving contrast, readability, spacing, or responsive layout
- changing canvas backgrounds, overlays, or object-aware UI surfaces
- removing clutter, road-sign labels, or duplicated controls

## Read

- SOUL.md
- AGENTS.md
- .specify/memory/constitution.md
- relevant specs/*
- nearby UI components/styles found with Code-Based Memory MCP

## Do

- Keep UI readable before making it flashy.
- Preserve dark-mode-first assumptions unless told otherwise.
- Use spacing, grouping, and progressive reveal instead of over-labeling.
- Keep canvas interaction clear and object-aware.
- Keep touch/laptop usability in mind.
- Reuse existing styling conventions.
- Update specs/docs when a design convention changes.

## Do Not

- Do not add road-sign labels everywhere.
- Do not make translucent panels unreadable.
- Do not redesign the whole app for one visual issue.
- Do not hardcode one-off colors everywhere.
- Do not hide important controls behind hover-only behavior.
- Do not create duplicate access paths that confuse navigation.

## Validate

```powershell
npm --prefix client run build
npm --prefix client run typecheck
```

Manual check:
- readable
- no clutter increase
- touch/click targets usable
- contrast acceptable

## Docs

Design behavior change -> relevant specs/*  
Reusable UI convention -> docs/architecture.md if architecture-level

## Source

Repo-native LiquidAIty UI skill based on the project's glass/canvas UI intent.
