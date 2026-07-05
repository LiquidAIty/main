# RENAME.md — deferred functional-rename plan (report only, not executed)

**Goal:** the code should say *what it does*, not carry the two upstream brand names
("OpenClaude", "Mag One") that this project adopted. This is a **future** dedicated
pass — do it *after* the primitive works and *before* any big feature build, as its
own reviewable diff. Naming is **function over form**: the graphs already do this
(ThinkGraph = planning/memory, KnowGraph = knowledge, CodeGraph = code).

Decided targets (2026-07-05):

| Upstream brand | Functional name | Why |
|---|---|---|
| **Mag One** | **Orchestrator** | its job is to run/coordinate the agent team |
| **OpenClaude** (+ its console) | **Coder** | the coder engine *and* its live terminal — one thing; the console is just the coder's view under chat |
| the chat layer | **Harness / Harness Chat** | already the diagram's word |
| ThinkGraph / KnowGraph / CodeGraph | *(keep)* | already functional |
| LiquidAIty | *(keep)* | this is the product name, not an upstream brand |

## Do NOT rename
- Vendored AutoGen `MagenticOneGroupChat` / `MagenticOne*` classes — third-party, not ours.
- The `redactCoderBranding` / "Coder Console Naming Firewall" (`coderConsoleNames.ts`) —
  this IS the rebrand in progress; keep/advance it, it's not obfuscation.
- Do not ADD any new "OpenClaude"/"Mag One" references in the meantime.

## Surface inventory (what the rename will touch)

### Mag One → Orchestrator
- Symbols: `runMagOne`/`run_mag_one` → `run_orchestrator`; `resolvedMagenticOptions` → `connectedAgents`; `describeConnectedAgents` (ok as-is); `buildMagOne*` (already deleted).
- Card runtime type: `'magentic_one'` → `'orchestrator'` (touches `runtimeContracts.ts`, `orchestration_contracts.py` Literals, `magentic_agentchat.py`, `graph_compiler.py`, deck store, client card configs — **data migration needed for saved cards** that store `runtimeType: 'magentic_one'`).
- Files: `apps/python-models/app/python_models/magentic_agentchat.py` → `orchestrator.py`; `autogen_orchestrator.py` (already ok).
- MCP tool name `run_mag_one` / `describe_connected_agents` — the `run_mag_one` MCP verb + backend `/mcp-bridge/run_mag_one` route (client + gRPC harness must move together).

### OpenClaude → Coder (console folds into Coder)
- Routes (backend + every client caller move together): `/api/coder/openclaude/session/*` → `/api/coder/chat/*` (or `/harness/*`); `/api/coder/openclaude/console/*` → `/api/coder/console/*` (drop `openclaude`); `/api/coder/openclaude/status`, `/openclaude/terminal/*` → `/api/coder/*`.
- Files: `openClaudeConsoleClient.ts` → `coderConsoleClient.ts`; `openClaudeSessionClient.ts` → `chatSessionClient.ts`; `OpenClaudeConsolePanel.tsx` → `CoderConsolePanel.tsx`; `apps/backend/src/coder/openclaude/*` dir → `apps/backend/src/coder/*` (careful: `localcoder/` sub-tree already functional).
- Types/strings: `OpenClaudeRunRequest`, `ConsoleMode`, transcript branding.

## Sequencing (safe order for the future pass)
1. Rename **internal symbols/files first** (no cross-boundary contract change) — tsc/tests green.
2. Rename **routes last**, backend + client + gRPC harness in one atomic change, then run client + backend + Python suites.
3. Card `runtimeType` value migration (`magentic_one` → `orchestrator`) needs a saved-deck data migration — do NOT rename the value without migrating existing decks, or saved orchestrator cards stop resolving.

## Also spotted (kept code that could read more functionally — low priority)
- `coder.routes.ts` is really the **harness** route file (chat + console + mcp-bridge + cards + coder), not just "coder" — consider `harness.routes.ts`.
- `liquidAItyAgentFlow.ts` — fine, but its two handlers are "describe connected agents" + "run orchestrator"; the file could be `harnessTools.ts`.
