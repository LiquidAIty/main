---
name: test-generator
description: Adapted real testing skill for LiquidAIty. Use when adding frontend/backend/unit/integration/e2e tests or improving coverage.
source: adapted from TerminalSkills/skills skills/test-generator/SKILL.md
license: Apache-2.0
category: development-testing
---

# Test Generator

## Purpose

Generate meaningful tests for existing LiquidAIty code. This skill is derived from the real TerminalSkills `test-generator` skill and adapted for LiquidAIty's Vite/React/TypeScript/Nx/backend/Python sidecar context.

## Required Reads

1. `SOUL.md`
2. `AGENTS.md`
3. `.specify/memory/constitution.md`
4. relevant `specs/*`
5. relevant source files and nearby existing tests
6. package/project test configuration found with Code-Based Memory MCP

## Workflow

1. Use Code-Based Memory MCP to locate target code, existing tests, scripts, and test config.
2. Identify the behavior being protected.
3. Detect framework from existing repo files. Do not introduce a new framework unless explicitly approved.
4. Generate the smallest useful regression/unit/integration test.
5. Cover happy path, edge case, and error path when practical.
6. Mock external dependencies without over-mocking the logic being tested.
7. Run the closest existing test command.
8. Update docs/runbooks if test commands changed.
9. Report tests added, command run, pass/fail, coverage gap, and uncertainty.

## Framework Detection

Check actual files first:

```powershell
Get-Content package.json
Get-Content client\package.json
Get-ChildItem -Recurse -Include vitest.config.*,jest.config.*,playwright.config.*,cypress.config.* -ErrorAction SilentlyContinue
```

Likely LiquidAIty targets:

- React/Vite frontend → Vitest / React Testing Library if already configured
- Node/Express backend → existing Jest/Vitest target if configured
- Python sidecar → pytest if configured
- UI smoke/e2e → Playwright only if already present or approved

## Do

- Match existing test style and location.
- Use descriptive test names.
- Test behavior, not implementation trivia.
- Add regression tests for fixed bugs.
- Prefer stable selectors for e2e tests.
- Keep tests deterministic.
- Report if the repo lacks setup for the requested test type.

## Do Not

- Do not install test libraries without approval.
- Do not create a parallel test framework.
- Do not add brittle snapshots by default.
- Do not skip failing tests silently.
- Do not claim tests pass unless actually run.
- Do not use bash command examples; use PowerShell.

## Validation

Use actual discovered scripts. Common examples:

```powershell
npm --prefix client run test
npm --prefix client run test -- --run
npm --prefix client run build
npx nx test backend
pytest
```

## Documentation Update Rule

- Test command or local workflow change → update `docs/runbooks/full-stack-dev.md`.
- Feature behavior expectation → update relevant `specs/*`.
- Testing convention change → update this skill or existing docs; no random audit docs.

## Source Attribution

Adapted from `TerminalSkills/skills` `skills/test-generator/SKILL.md`, Apache-2.0. The original skill covers unit, integration, e2e, Jest, Vitest, Pytest, Playwright, React Testing Library, and Cypress patterns.
