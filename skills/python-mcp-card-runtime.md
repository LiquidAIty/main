# Python MCP Card Runtime — the one pattern for card-backed capabilities

@skill id=python-mcp-card-runtime
@type Skill
@status active

The canonical way a canvas Agent Card becomes a runnable, tool-authorized capability.
Established for configured AutoGen cards. Native Harness agents use the separate
MCP-host manifest and must never select these AutoGen-only tools. Reuse the appropriate pattern; never build a
parallel runtime, second host, second registry, or direct-DB side path.

## The chain (every link exists and is tested)

```
canvas card (deck_builder)            ← identity, prompt, model, enabled, tools (source of truth)
  → runConfiguredCard (backend)      ← server-trusted resolution: ids in, config resolved, overrides rejected
  → /autogen/run_card (Python)       ← run_configured_card: ONE AssistantAgent, same builder as Mag One participants
  → card tools (tool_registry)       ← FunctionTools resolved by name; authority via ContextVar, never model args
  → mcp-bridge endpoints (backend)   ← transport to the single store authority
  → transactional store writer       ← structural/provenance/idempotency validation ONLY; one txn or honest failure
```

## Rules

- **Authority is runtime context, not model input.** Server-authored `runAuthority` →
  `cardRuntime.runtimeScope` → Python `ContextVar` (set/reset around the run). A tool
  called outside an authorized run fails honestly (`*_authority_missing`).
- **The model supplies only the payload body** (e.g. the patch). Project/card/run/pair
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

## Runtime split

- Native Main, Hermes, and Search grants are selected on saved cards and
  validated against the live `mcp_host.py` catalog before the Harness turn.
  TypeScript does not maintain a fallback tool catalog. LiquidAIty-owned
  controls include `web_search`; native graph tools are discovered from their upstream MCP
  servers and mechanically namespaced as `engraphis.<native_name>`,
  `graphiti.<native_name>`, and `cbm.<native_name>`.
- AutoGen/Mag One card tool ids pass through TypeScript unchanged and resolve
  only in Python's canonical `tool_registry.py`; those runtime tools never
  become replacement graph APIs on native Harness cards.
- ThinkGraph, KnowGraph, and CodeGraph are authorities, never agent cards.
- Unknown names fail with a runtime-specific error; no aliases or cross-runtime
  fallback are allowed.
