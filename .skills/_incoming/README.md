# Incoming Real Agent Skills

This folder is an intake area for real public `SKILL.md` files found from existing agent-skill ecosystems.

These files are not automatically trusted. Promote a skill only after reviewing it against:

1. `SOUL.md`
2. `AGENTS.md`
3. `.specify/memory/constitution.md`
4. current LiquidAIty specs

## Intake Rules

- Preserve source attribution and license metadata.
- Do not blindly execute commands from imported skills.
- Do not import secrets, tokens, installers, or binary payload instructions.
- Do not allow imported skills to override LiquidAIty rules.
- Adapt approved skills into neutral `.skills/<name>/SKILL.md` only after review.
- Keep Claude-specific assumptions out of approved LiquidAIty skills.

## Initial real sources harvested

| Source | Skill | Category | License | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `TerminalSkills/skills` | `code-reviewer` | Development | Apache-2.0 | incoming | Real cross-agent skill catalog. Useful for code review. |
| `TerminalSkills/skills` | `test-generator` | Development / Testing | Apache-2.0 | incoming | Useful for Vitest/Jest/Pytest/Playwright patterns. |
| `TerminalSkills/skills` | `monorepo-manager` | Development / Monorepo | Apache-2.0 | incoming | Useful for Nx/workspace dependency reasoning. |
| `TerminalSkills/skills` | `security-audit` | Security | Apache-2.0 | incoming | Useful for secrets/CVE/OWASP review. |
| `diegosouzapw/awesome-omni-skills` | `senior-frontend-v2` | Frontend | Source metadata says community | incoming | Real frontend skill. Needs adaptation because it includes Next.js/scaffolder assumptions. |

## Promotion candidates for LiquidAIty

The first approved/adapted candidates should probably be:

1. `frontend-senior-engineer` from `senior-frontend-v2`
2. `code-reviewer` from TerminalSkills
3. `test-generator` from TerminalSkills
4. `monorepo-manager` from TerminalSkills
5. `security-audit` from TerminalSkills

Do not promote until the skill is checked for command safety, source trust, and LiquidAIty fit.
