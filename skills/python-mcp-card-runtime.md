# Python MCP Card Runtime — the one pattern for card-backed capabilities

The canonical way a canvas Agent Card becomes a runnable, tool-authorized capability.
Established 2026-07-02 by the ThinkGraph front door. Reuse this pattern; never build a
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

## ThinkGraph specifics

- Write authority: ONLY `apply_thinkgraph_patch`, callable only inside the deck-bound
  ThinkGraph card run (`deck.thinkGraphCardId`, validated server-side: enabled +
  assistant_agent + real model + exactly the two tools).
- The card's canvas prompt owns all semantics (`no_patch` judgment included).
- Every stored record carries: project, conversation, both source message ids, card id,
  correlation id, timestamps — exposed directly by `/graph-view`.
