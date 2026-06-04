# LiquidAIty Coding Policy

> Legacy workflow memo.
> `AGENTS.md` and `.specify/memory/constitution.md` are the governing workflow sources.
> Treat this file as supplemental context only.

Read this before planning or editing. `AGENTS.md` is the entry point; this file is the operational workflow for coding work.

## Critical Workflow

1. Restate the user's intent in plain terms before planning.
2. Run an inverse audit:
   - What must already be true in the repo for this change to work?
   - What files, routes, contracts, or patterns should already exist?
   - What could break if this is implemented wrong?
   - What must not be touched?
3. Use Code-Based Memory MCP first for code discovery:
   - Prefer `search_graph`, `trace_path`, `get_code_snippet`, `query_graph`, and `get_architecture`.
   - Do not rely only on grep, file search, repo memory, or prior chat memory.
   - Fall back to PowerShell reads/search only after MCP has narrowed the target or when searching non-code files, literals, configs, docs, or generated artifacts.
4. Read local memory/docs before planning when they exist and are relevant:
   - `AGENTS.md`
   - `policy.md`
   - `MEMORY.md`
   - `ROOT_REPO_OPERATING_GUIDE.md`
   - focused subsystem docs or repo Markdown files named by the task
5. Inspect actual code before editing:
   - Read files you will touch.
   - Read the caller/callee or route/runtime path that proves the edit belongs there.
   - Ground file-level recommendations in current code, not memory alone.
6. Implement the biggest safe part that is fully understood:
   - Do not block on uncertain pieces when a safe partial implementation is possible.
   - Do not guess on risky or unclear pieces.
   - Leave uncertain, high-impact, or architecture-changing work for a staged follow-up.
7. Verify with the narrowest meaningful checks first, then broader checks when the touched surface justifies it.

## Hard Rules

- Use PowerShell commands only.
- No package installs unless explicitly approved.
- No LangChain or LangGraph unless explicitly approved.
- No broad refactors.
- No unrelated files.
- Preserve existing architecture and ownership boundaries.
- Do not rewrite Agent Canvas, graph persistence, Plan Surface, or runtime bindings unless the user explicitly asks for that scope.
- Do not modify third-party/reference repos such as `Understand-Anything-main` unless explicitly asked.
- Do not move, delete, flatten, or clean up reference repos just because they are at repo root.
- Do not seed addable/staged agents into default decks unless explicitly requested.
- Do not claim a test, smoke, route, or browser check passed unless it was actually run and the output was read.

## End-of-Task Report

Always report:

1. What intent was implemented.
2. What changed.
3. What was intentionally not changed.
4. What remains uncertain.
5. What should be audited next.
6. The next implementation step.
7. Exact files changed.
8. Smoke test commands and outcomes.
9. A one-line PowerShell Git save command when changes were made.

## Staging Standard

For complex work, stage progress by risk:

- Stage 1: contracts, extraction, read-only surfacing, logs, or display only.
- Stage 2: validation and review flows.
- Stage 3: persistence or mutation.
- Stage 4: cross-surface integration.

Prefer earlier stages when graph writes, database writes, runtime bindings, external services, or Plan Surface persistence are involved.
