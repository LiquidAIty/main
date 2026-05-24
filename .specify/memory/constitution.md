# LiquidAIty Constitution

## 1. Graph-Native Project Truth
All meaningful project state should be represented as entities, relationships, properties, provenance, or structured artifacts where practical.
Docs must not become the long-term source of fragmented truth when graph/object state is intended.

## 2. AutoGen Mandatory Execution
Real agent/deck/card execution must route through the Python AutoGen sidecar when `executionBackend` is `python_autogen`.
No silent TypeScript Magentic-One fallback.
No diagnostic fallback unless explicitly requested by the user.
Failure must be visible and actionable.

## 3. Code-Based Memory MCP First
Before significant repo edits, coding agents must use Code-Based Memory MCP to inspect existing structure, symbols, architecture, and prior decisions.
Agents must not implement from memory alone.

## 4. User-Approved Execution
Plans and important execution steps require user approval.
The system should support plan-first workflows where Magentic-One/Sol proposes an execution path, then runs selected agents after approval.

## 5. Canvas-First Workbench
Canvases are first-class work surfaces.
Chat must remain object-aware and context-aware of selected canvases, cards, agents, and project state.
Canvas features should avoid generic over-labeling, heavy road signs, or gimmicky UI labels.

## 6. No Documentation Sprawl
Canonical docs must be declared in `docs/README.md`.
Duplicate docs must be archived or marked historical.
External subtree docs must remain scoped to their source project and must not override LiquidAIty architecture.

## 7. Security and Secrets
Secrets stay in `.env` files or secret managers.
No secrets in committed docs.
No accidental exposure of backend credentials, API keys, or local machine paths beyond necessary developer instructions.

## 8. Runtime Truth Comes From Code
Specs and docs must be verified against actual code paths.
Do not claim a feature works unless it is implemented and tested.
Do not let docs drift ahead of runtime reality without marking them as planned.

## 9. Small Safe Changes
Prefer surgical edits.
Avoid massive rewrites unless the audit proves they are necessary.
Keep rollback easy.
Preserve current working behavior.

## 10. Explicit Uncertainty
Every implementation report must include:
- files changed
- tests run
- known uncertainty
- risks
- forward plan
