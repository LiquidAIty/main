# AGENTS.md

## Project Definition
LiquidAIty is a graph-native AI orchestration and modeling platform that turns projects, models, tools, agents, simulations, files, data, knowledge, and user intent into interactive canvases with executable agent workflows.

LiquidAIty is a general AI-native platform first. Trading, energy modeling, repo eating, research, media, simulations, and KnowledgeCoin-style knowledge assets are downstream use cases.

## Read Order
1. `SOUL.md`
2. `AGENTS.md`
3. `CLAUDE.md` (if using Claude Code)
4. `.specify/memory/constitution.md`
5. `docs/architecture.md`
6. `docs/runbooks/`
7. relevant `specs/*`

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
