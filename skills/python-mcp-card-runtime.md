# Python MCP Card Runtime — the one pattern for card-backed capabilities

@skill id=python-mcp-card-runtime
@type Skill
@status active

The canonical way a canvas Agent Card becomes a runnable, tool-authorized capability.
Established for configured AutoGen cards. Native Hermes Cards use their saved MCP grants and must
never select AutoGen-only tools. Reuse the appropriate pattern; never build a
parallel runtime, second host, second registry, or direct-DB side path.

## The chain (every link exists and is tested)

```
canvas card (deck_builder)            ← identity, prompt, model, enabled, tools (source of truth)
  → /api/coder/mcp-bridge/run_configured_card (backend transport)
                                    ← ids and exact prepared bytes forwarded; overrides rejected
  → /autogen/dispatch (Python)       ← Python selects the saved AssistantAgent or Mag One runtime
                                      (AssistantAgent or typed runtime adapter)
  → card tools (tool_registry)       ← FunctionTools resolved by saved grants, never invented model args
  → mcp-bridge endpoints (backend)   ← transport to the single store authority
  → transactional store writer       ← structural/provenance/idempotency validation ONLY; one txn or honest failure
```

## Rules

- **Authority is saved-card configuration plus explicit runtime input.** The saved card owns the
  capability ceiling; the current transient Card call instantiates valid values/references under IDD rules.
  One saved enabled `FLOW` relationship authorizes only the source Card's bounded delegation to that
  exact connected target and mechanically exposes the standard delegation transport. It grants no
  ordinary tool or target permission. Other AgentGraph/AGE observations do not authorize a runtime.
- **The model supplies only the permitted operation payload body** (e.g. the patch). Project/card/run
  identity can never be overridden from model arguments.
- **No fallback anywhere**: missing model config, unknown tool, disabled card, rails
  down, model failure — every path returns a typed honest status; nothing substitutes.
- **One writer per store.** Persistence validates structure/ownership/provenance/
  idempotency/size in ONE transaction. It never interprets meaning.
- **Front doors take exact references** (message ids, correlation keys) — never
  "the latest X". Deterministic correlation = idempotent re-fire.
- **MCP host = thin stdio transport** (`apps/python-models/app/mcp_host.py`, official
  `mcp` SDK) bridging to `/api/coder/mcp-bridge/*`. No product logic in the host;
  structural argument allow-lists reject smuggled prompts/models/patches.
- **Canonical model context = the exact transient Inspector-visible Card call.** Runtime-specific adapters
  may mechanically frame it, but may not rebuild another context packet or append IDD definitions to
  the prompt. Dynamic input is not saved by default.

## Runtime split

- Native Main, Hermes, and Search grants are selected on saved cards and
  validated against the live `mcp_host.py` catalog before the Hermes turn.
  TypeScript does not maintain a fallback tool catalog. LiquidAIty-owned
  controls include `web_search`; native graph tools are discovered from their upstream MCP
  servers and mechanically namespaced as `engraphis.<native_name>`,
  `graphiti.<native_name>`, and `cbm.<native_name>`.
- AutoGen/Mag One card tool ids pass through TypeScript unchanged and resolve
  only in Python's canonical `tool_registry.py`; those runtime tools never
  become replacement graph APIs on native Hermes Cards.
- ThinkGraph, KnowGraph, and CodeGraph are authorities, never agent cards.
- Unknown names fail with a runtime-specific error; no aliases or cross-runtime
  fallback are allowed.
