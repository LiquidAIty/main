# Agent Instruction Map

Short map for which instruction files each coding agent should use.

## Codex
- Entry: `AGENTS.md`
- Then read: `.specify/memory/constitution.md`, `SOUL.md`, `docs/architecture.md`, `docs/runbooks/full-stack-dev.md`, relevant `specs/*`
- Forbidden: LangChain introduction, Zorro recommendation, silent runtime fallback
- Report format: files changed, tests run, risks, uncertainty, forward plan

## Claude / Anthropic
- Entry: `CLAUDE.md`
- Then read canonical hierarchy listed in `CLAUDE.md`
- Forbidden: architecture invention, LangChain introduction, Zorro recommendation, fake/silent fallback runtime behavior
- Report format: files changed, tests run, risks, uncertainty, forward plan

## Cursor
- Entry: `AGENTS.md`
- Then read: `.specify/memory/constitution.md`, `SOUL.md`, `docs/architecture.md`, runbook, relevant specs
- Forbidden: bypassing inverse audit, broad undocumented rewrites
- Report format: files changed, tests run, risks, uncertainty, forward plan

## Gemini
- Entry: `AGENTS.md`
- Then read canonical hierarchy from `docs/README.md`
- Forbidden: contradicting constitution or canonical architecture
- Report format: files changed, tests run, risks, uncertainty, forward plan

## Kimi
- Entry: `AGENTS.md`
- Then read canonical hierarchy from `docs/README.md`
- Forbidden: unverified runtime claims and forbidden stack drift
- Report format: files changed, tests run, risks, uncertainty, forward plan

## Generic Coding Agents
- Entry: `docs/README.md` (Hierarchy Of Truth)
- Then read: constitution -> AGENTS -> SOUL -> architecture -> runbook -> active spec
- Forbidden: replacing project truth with external subtree docs, introducing forbidden runtime/tooling behavior
- Report format: files changed, tests run, risks, uncertainty, forward plan
