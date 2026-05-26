# AGENTS.md

## Project Definition
LiquidAIty is a graph-native AI orchestration and modeling platform that turns projects, models, tools, agents, simulations, files, data, knowledge, and user intent into interactive canvases with executable agent workflows.

LiquidAIty is a general AI-native platform first. Trading, energy modeling, repo eating, research, media, simulations, and KnowledgeCoin-style knowledge assets are downstream use cases.

## Read Order
1. `SOUL.md`
2. `AGENTS.md`
3. `.specify/memory/constitution.md`
4. `docs/architecture.md`
5. `docs/runbooks/`
6. relevant `specs/*`

## Task Skills
- Agents must not read every `.skills` file globally.
- Read only the matching task skill.
- Skills are subordinate to:
  - `SOUL.md`
  - `AGENTS.md`
  - `.specify/memory/constitution.md`
  - approved `specs/*`
- Use `.skills/frontend/react-flow-xyflow/SKILL.md` for React Flow / XYFlow work.
- Use `.skills/frontend/threejs-r3f/SKILL.md` for Three.js / React Three Fiber work.
- Use `.skills/graph/cypher/SKILL.md` plus Neo4j or Apache AGE skill for graph queries.
- Use `.skills/workflow/spec-kit/SKILL.md` for meaningful feature work.

## Required First Step: Use Code-Based Memory MCP
- Before significant edits, use Code-Based Memory MCP for structural discovery.
- Use filesystem search only after MCP narrows scope or when scanning docs/config text.

## Inverse Audit Requirement
- Run inverse audit before implementation.
- Confirm what already exists, what must remain stable, and what is risky.
- Surface assumptions explicitly before editing.

## Implementation Rule
- Implement the largest fully understood safe portion.
- Keep edits surgical.
- Leave uncertain, risky, or broad changes for a follow-up with an audit note and forward plan.

## Spec Kit Rule
- Use Spec Kit for major features:
  - `$speckit-constitution`
  - `$speckit-specify`
  - `$speckit-plan`
  - `$speckit-tasks`
  - `$speckit-implement`

## Progressive Spec Policy
LiquidAIty does not require every subsystem to be fully specified upfront.

When an agent revisits a meaningful subsystem, it must create or update the closest relevant
Spec Kit feature folder.

Use:
- `spec.md` for intent, behavior, scope, and success criteria.
- `plan.md` for architecture approach, affected files, risks, skills, and validation.
- `tasks.md` for ordered implementation steps.

If work touches an existing subsystem, improve the existing spec instead of creating duplicate
specs.

If no matching spec exists, create the smallest useful new spec folder.

Specs should grow as the repo is worked on. Do not create giant speculative specs for untouched
systems.

Durable lessons discovered during implementation must be placed in the smallest correct home:
- feature behavior -> relevant `specs/*`
- architecture decision -> `docs/decisions/*`
- run/setup command -> `docs/runbooks/full-stack-dev.md`
- coding rule -> `AGENTS.md`
- task technique -> matching `.skills/*/SKILL.md`

Do not create random scratch Markdown, audit docs, or duplicate documentation maps.

## Runtime Rules
- AutoGen is mandatory for real agent execution.
- No silent TypeScript fallback runtime.
- No fake fallback runtime.
- Runtime truth comes from code and verified checks.

## Forbidden / Historical
- No LangChain.
- No Zorro.
- Ghostfolio is historical only, not active architecture.

## Command Style
- Use PowerShell commands by default.
- Do not commit automatically.
- Keep secrets out of committed files.

## Testing / Validation
- Run the smallest useful validation for the changed surface.
- State what was not run.
- Never claim tests/smokes passed unless run and read.

## Final Report Format
- files changed
- tests run
- risks
- uncertainty
- forward plan

## Working Notes
Agents may keep short working notes in their final report while working.

Durable notes must go into the correct existing place:
- feature behavior -> `specs/*`
- architecture decision -> `docs/decisions/*`
- run command/setup -> `docs/runbooks/full-stack-dev.md`
- project identity/rules -> `SOUL.md` or `AGENTS.md`

Agents must not create random audit docs, scratch Markdown files, or duplicate documentation maps.
Temporary reasoning belongs in the final report, not permanent repo files.
