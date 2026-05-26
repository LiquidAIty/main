# Docs On Change

## Trigger

Use only when:
- changing code behavior, runtime behavior, commands, architecture, schema, graph model, or UI behavior
- changing how a subsystem works
- changing setup/run/test/deploy commands
- creating an Architecture Decision Record

## Read

- SOUL.md
- AGENTS.md
- .specify/memory/constitution.md
- relevant specs/*
- nearest docs for the touched subsystem

## Do

- Update the closest useful doc/spec.
- Keep docs short and current.
- Mark planned behavior as planned.
- Put real decisions in docs/decisions/*.
- Update runbooks when commands change.
- Update specs when feature behavior changes.
- Update architecture docs when system behavior changes.

## Do Not

- Do not create random audit docs.
- Do not duplicate the same truth in many files.
- Do not let docs claim unverified runtime behavior.
- Do not leave changed behavior undocumented.
- Do not treat external subtree docs as LiquidAIty truth.

## Validate

```powershell
git status --short
Select-String -Path docs\**\*.md,specs\**\*.md -Pattern "TODO|planned|AutoGen|Spec Kit|fallback" -ErrorAction SilentlyContinue
```

## Docs

This skill governs docs updates. Use it to decide which existing doc/spec to update.

## Source

Repo-native skill from LiquidAIty's docs-on-change requirement.
