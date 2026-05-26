# Plan: LiquidAIty Spec-First Development System

## Purpose
Enforce spec-first development and task-triggered skills so agents reduce mistakes and token waste.

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

## Validation
- Inspect `.skills` structure and skill routing guidance
- Verify agents are instructed not to read all skills globally
- Verify alignment across `SOUL.md`, `AGENTS.md`, constitution, and active specs
- Run status and targeted string checks
