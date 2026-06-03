# Plan: LiquidAIty Spec-First Development System

## Purpose
Enforce audit-first development by default, reserve Spec Kit for heavy-mode work, and keep
documentation attached to living sources of truth instead of standalone audit files.

## Affected Files
- `SOUL.md`
- `AGENTS.md`
- `.specify/memory/constitution.md`
- `.agents/skills/*`
- `.skills/*`
- `specs/*`
- `docs/*`

## Constraints
- No runtime code edits
- No package file edits
- No Claude workflow as active canonical guidance
- No random audit docs or instruction-map files
- No standalone audit files by default
- No mandatory Spec Kit requirement for every meaningful task

## Validation
- Inspect `.skills` structure and skill routing guidance
- Verify agents are instructed not to read all skills globally
- Verify alignment across `SOUL.md`, `AGENTS.md`, constitution, docs map, templates, and active specs
- Run status and targeted string checks
