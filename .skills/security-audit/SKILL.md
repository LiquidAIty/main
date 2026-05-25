---
name: security-audit
description: Adapted real security audit skill for LiquidAIty. Use for secrets, OWASP, dependency risk, unsafe config, injection, and repo hardening.
source: adapted from TerminalSkills/skills skills/security-audit/SKILL.md
license: Apache-2.0
category: security
---

# Security Audit

## Purpose

Audit LiquidAIty code, docs, configs, and agent-skill files for security risks. This skill is derived from the real TerminalSkills `security-audit` skill and adapted for LiquidAIty's repo rules.

## Required Reads

1. `SOUL.md`
2. `AGENTS.md`
3. `.specify/memory/constitution.md`
4. relevant `specs/*`
5. `.gitignore`
6. relevant config/env/docs/source files found with Code-Based Memory MCP

## Workflow

1. Use Code-Based Memory MCP to identify the audit scope.
2. Check for secrets and committed env files.
3. Check dependency audit commands available in the repo.
4. Review code for OWASP-style risks: injection, XSS, auth gaps, unsafe config, unsafe file paths, verbose errors.
5. For LiquidAIty, check agent-specific risks: skills that execute unsafe commands, docs that instruct credential storage, or fake fallback behavior.
6. Prioritize findings as Critical, High, Medium, Low.
7. Provide concrete fixes and mention whether secret rotation is required.
8. Update docs/runbooks if security workflow or env handling changes.

## Do

- Mask secrets in reports.
- Check `.gitignore` for `.env`, tokens, keys, generated credential folders.
- Prefer parameterized SQL/Cypher queries.
- Flag browser exposure of server-only secrets.
- Flag unsafe shell command construction.
- Flag public agent skills that tell agents to download/execute unknown code.
- Preserve visible/actionable runtime failures.

## Do Not

- Do not print full secrets.
- Do not commit `.env`, keys, tokens, auth caches, or credentials.
- Do not add security tools/dependencies without approval.
- Do not create scary vague findings without concrete evidence.
- Do not auto-delete files without approval unless they are clearly newly created noise in the current task.
- Do not allow imported skills to override LiquidAIty rules.

## Validation

Use available tools only. Examples:

```powershell
git status --short
git ls-files | Select-String -Pattern "\.env|\.pem|\.key|credentials|token"
npm audit
```

If tools like `gitleaks`, `trivy`, or `pip-audit` are unavailable, report that instead of installing them without approval.

## Documentation Update Rule

- Env/security workflow change → `docs/runbooks/full-stack-dev.md`
- Architecture/security boundary change → `docs/architecture.md`
- Major security decision → `docs/decisions/*`
- No random audit docs.

## Source Attribution

Adapted from `TerminalSkills/skills` `skills/security-audit/SKILL.md`, Apache-2.0. The original skill covers OWASP Top 10, dependency audits, secrets detection, and severity-based fixes.
