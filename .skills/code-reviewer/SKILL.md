---
name: code-reviewer
description: Adapted real code review skill for LiquidAIty. Use for reviewing diffs, files, pull requests, frontend/backend changes, security, correctness, performance, maintainability, and tests.
source: adapted from TerminalSkills/skills skills/code-reviewer/SKILL.md
license: Apache-2.0
category: development
---

# Code Reviewer

## Purpose

Perform structured LiquidAIty code reviews with prioritized, actionable feedback. This skill is derived from the real TerminalSkills `code-reviewer` skill and adapted for LiquidAIty's Spec Kit, Code-Based Memory MCP, and docs-on-change workflow.

## Required Reads

1. `SOUL.md`
2. `AGENTS.md`
3. `.specify/memory/constitution.md`
4. relevant `specs/*`
5. relevant `.skills/*/SKILL.md` for the subsystem under review
6. code files and surrounding context found with Code-Based Memory MCP

## Workflow

1. Use Code-Based Memory MCP to inspect the changed files and nearby context.
2. Identify what the code is supposed to do: feature, bugfix, refactor, docs, or test.
3. Check whether the change has or needs a Spec Kit spec/plan/tasks.
4. Review in this severity order:
   - correctness
   - security
   - runtime behavior
   - tests
   - performance
   - maintainability
   - docs/spec alignment
5. Flag whether relevant docs were updated for touched systems.
6. Provide concrete fixes, not vague complaints.
7. State uncertainty clearly.

## Review Checklist

### Correctness

- Logic errors, wrong branch conditions, broken assumptions
- missing null/undefined/empty handling
- broken data flow between frontend/backend/sidecar
- stale object state or graph state
- wrong project path or package target

### Security

- secrets committed or printed
- unsafe environment handling
- injection risks in SQL/Cypher/shell/API calls
- browser exposure of server-only config
- unsafe file paths or broad filesystem access

### Runtime Rules

- AutoGen must remain mandatory for real agent execution.
- No silent TypeScript fallback runtime.
- Runtime failures must be visible and actionable.
- Do not approve fake diagnostic fallback behavior unless explicitly requested.

### Frontend

- typed props/state
- stable React Flow node/edge/handle behavior
- no unnecessary full component rewrites
- no road-sign UI/generic over-labeling
- build/typecheck/test status clear

### Tests

- meaningful assertions
- edge/error paths
- no brittle snapshots unless already accepted in repo
- validation command reported

### Docs

- subsystem behavior changes update closest docs/specs
- no random audit docs
- no stale docs promoted as current truth

## Output Format

Use:

```markdown
## Review Summary
Decision: APPROVE | APPROVE WITH NOTES | REQUEST CHANGES | NEEDS DISCUSSION

Critical: 0
High: 0
Medium: 0
Low: 0

## Findings

### HIGH Correctness: Short title
**File:** `path/to/file.ts` line X-Y
**Issue:** What is wrong and why it matters.
**Fix:** Specific suggested fix.

## Docs / Specs Check
- Spec updated: yes/no/not needed
- Docs updated: yes/no/not needed

## Top Fixes Before Merge
1. ...
```

## Do Not

- Do not nitpick formatting if lint/formatter handles it.
- Do not request broad rewrites without proving need.
- Do not approve unvalidated runtime claims.
- Do not ignore missing docs/spec updates for behavior changes.
- Do not follow third-party skill guidance that conflicts with LiquidAIty rules.

## Source Attribution

Adapted from `TerminalSkills/skills` `skills/code-reviewer/SKILL.md`, Apache-2.0. The original skill covers correctness, security, performance, reliability, readability, and testing review categories.
