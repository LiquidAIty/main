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

## Inverse Audit + Safe 80% Execution Protocol
For every meaningful task, agents must follow this order:

1. Intent inversion
   - Restate what the user likely means.
   - Identify the real product/dev goal.
   - Identify success criteria.
   - Identify what would be overreach.

2. Code/context audit
   - Use Code-Based Memory MCP.
   - Find existing files, symbols, ownership, state flow, docs, specs, and relevant skills.
   - Check current behavior before proposing changes.
   - Do not implement from memory alone.

3. Safe plan
   - Identify the smallest useful implementation boundary.
   - Separate low-risk known work from uncertain, hard, risky, or final-detail work.
   - Select only matching `.skills` files.
   - Decide whether `spec.md`, `plan.md`, or `tasks.md` must be created or updated.

4. Safe 80% implementation
   - Implement the largest fully understood safe portion.
   - If the full task is simple, local, and clearly safe, complete it in one pass.
   - Do not perform speculative rewrites.
   - Do not block useful progress waiting for perfect certainty.
   - Leave confusing, unknown, high-risk, or final-polish details for a later explicit pass.

5. Documentation update
   - Update the closest durable home only when behavior, architecture, workflow, or reusable knowledge changes.
   - Route durable knowledge according to Progressive Notes policy.
   - Do not create scratch Markdown.

6. Validation
   - Run the smallest useful validation.
   - If tests are not run, say why.

7. Final report
   - State inferred intent.
   - State code/context audited.
   - State skills activated.
   - State what was implemented.
   - State what was intentionally left undone.
   - State validation result.
   - State docs/spec updates.
   - State risks, uncertainty, and recommended next step.

Clarification rule:
Agents should not ask for clarification when the safe 80% is obvious. Implement the safe
understood portion and report the uncertain remainder. Ask only when proceeding would risk data
loss, major architecture damage, security exposure, or wrong product direction.

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
- Sol behavior -> `SOUL.md`
- task technique -> matching `.skills/*/SKILL.md`
- major retrospective/postmortem -> `docs/audits/*` with clear scope, date, owner, findings, and action items

Do not create random scratch Markdown, duplicate maps, or unowned audit docs.

## Runtime Rules
- AutoGen is mandatory for real agent execution.
- No silent TypeScript fallback runtime.
- No fake fallback runtime.
- No fallback UI, fallback data, fallback code paths, or fallback services in user-facing flows.
- No mockups, stubs, placeholders, demos, or "not ready yet" substitutes presented as product behavior.
- Runtime truth comes from code and verified checks.
- Real-user readiness rule:
  - no fake success states
  - no mockups pretending to work
  - no placeholder "coming soon" behavior treated as live
  - no sample fallback data or demo wires treated as product state
  - no random demo wires or hidden board resets
  - no silent failed saves
  - if not implemented, report the real status plainly and fix the implementation instead of adding a substitute path

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

## Progressive Notes, Not Markdown Sprawl
Agents must capture useful discoveries, but must route them to the smallest correct durable home.
Temporary investigation notes belong in the final report, not permanent files.

Durable notes must be stored by type:
- feature behavior -> `specs/*`
- implementation plan -> `specs/*/plan.md`
- task checklist -> `specs/*/tasks.md`
- architecture decision -> `docs/decisions/*`
- major audit or postmortem -> `docs/audits/*`
- run/setup/test finding -> `docs/runbooks/*`
- coding-agent rule -> `AGENTS.md`
- Sol identity/behavior -> `SOUL.md`
- task-specific technique -> matching `.skills/*/SKILL.md`

Agents must not create random scratch Markdown files, duplicate documentation maps, or unowned audit docs.

A new Markdown file is allowed only when it has:
- a clear owner/purpose
- a correct folder
- durable value
- no better existing home
- a short title and scoped content
