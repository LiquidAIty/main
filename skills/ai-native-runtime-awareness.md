---
name: ai-native-runtime-awareness
description: How LiquidAIty agents understand their own code, runtime activity, project state, and evidence. The awareness fabric: deterministic collection → structured events → Hermes interpretation → evidence-based action.
version: 1.0.0
---

# AI-Native Runtime Awareness

## Rule

An AI application should understand its own code, meaningful runtime activity, project state, agent actions, and resulting evidence more deeply than a normal application.

This does NOT mean "send every byte to an LLM."

## The Awareness Fabric

```
DETERMINISTIC COLLECTION
  → STRUCTURED EVENT FABRIC
    → PROJECT-SCOPED STORAGE
      → HERMES INTERPRETATION
        → EVIDENCE-BASED FINDINGS
          → EXPLICITLY APPROVED MEMORY OR ACTION
```

## Code Awareness

Use CBM to understand structure before acting:
- `search_graph` for symbols, `trace_path` for call chains, `get_architecture` for clusters
- Never grep-first for structural questions; CBM answers "who calls this" in <1ms
- Source reads confirm CBM findings; they do not replace structural queries
- search_code (v0.9.0) for graph-augmented text search within indexed code
- rg for files outside CBM coverage and comment-only searches

## Project Awareness

Every operation carries identity:
- `projectId` — which project
- `deckId` — which deck (when relevant)
- `conversationId` — which conversation
- `correlationId` — which run
- `cardId` — which card
- `parentRunId` — which parent run

Identity propagation is not optional. Missing IDs are blockers.

## Structured Runtime Events

The pipeline stages (emitted via `recordAgentEvent`):

| Stage | Emitter | Real? |
|-------|---------|-------|
| `frontdoor` | coder.routes.ts:973 (started), 1155 (completed) | YES |
| `hermes_context` | coder.routes.ts:1087 (started), 1107 (completed) | YES |
| `hermes_postflight` | coder.routes.ts:1130 (completed/failed) | YES |
| `mag_one_dispatch` | liquidAItyAgentFlow.ts:285 | YES |
| `card_call` | coder.routes.ts:1030, runtime.ts:653 | YES |
| `graph_read` | coder.routes.ts:607 | YES |
| `graph_write` | coder.routes.ts:293, 634 | YES |

Every event carries: id, timestamp, projectId, deckId, conversationId, correlationId, stage, caller, cardId, provider, model, inputSummary, outputSummary, status, errorSummary, durationMs, tools, graphReads, graphWrites, mode, metadata.

Events persist as JSONL in `coder-workspace/dev-telemetry/agent-events.jsonl` (dev mode only — `recordAgentEvent` returns null in production). Max 10,000 events in memory, file rotation at 5MB.

## Evidence Tiers

| Tier | Means | Example |
|------|-------|---------|
| CBM-path-proven | trace_path returned the edge | trace_path shows A calls B |
| Source-verified | Code read confirms relationship | Read file, found direct call |
| Contract-test-proven | Focused test proves mechanism | test confirms child process started |
| Persistence-readback-proven | Readback confirms state | Deck document read confirms card |
| Runtime-proven | Live process completed | Server started, health check passed |
| UI-proven | Browser interaction observed | Click fired, card selected |

## Identity Propagation

Every event must carry valid IDs. No invented IDs. No null IDs when the value is known. The correlationId ties all events in one run together.

## Privacy & Redaction

- Never log credentials, API keys, or complete environment contents
- `redactTrace()` is called on all log output
- `summarizeForTelemetry()` truncates event content to 200 chars with whitespace collapse
- Full prompts are not stored in telemetry events
- Full model responses are not stored; summaries only
- The `redactTrace` function strips credential-like patterns

## Hermes Observer Role

Hermes receives structured events for a run. It reconstructs:
- What was requested
- Which route was selected
- Which cards participated
- Which model/provider was used
- Which tools ran
- Which graph operations occurred
- What output was produced
- Where the run failed

Hermes failure does not block the primary run.

## Hermes Postflight Review

After a meaningful run, Hermes compares requested objective against events, artifacts, tests, graph activity. Returns structured findings: SUPPORTED, PARTIALLY_SUPPORTED, UNSUPPORTED, CONTRADICTED, MISSING_PROOF, UNVERIFIED.

A `hermes_postflight` event MUST correspond to a real Hermes review, not merely a TypeScript label.

## Hermes Context Steward

Before a bounded run, Hermes can prepare context recommendations from:
- CBM feature slice
- Applicable skills
- ThinkGraph reasoning references
- KnowGraph evidence references
- Prior accepted outcomes

Main retains routing authority. Hermes recommends; it does not become the orchestrator.

## No Fake Success

- Never report a stage as completed when it never ran
- Never report a graph write as applied without readback confirmation
- Never report a model call as successful without real output
- A missing stage chip means "no event seen" — this is honest, not a failure

## Graceful Degradation

When Hermes is offline:
- The primary run continues normally
- Events are still collected
- Review happens when Hermes reconnects
- Missing postflight is visible in the Observatory

## Verification Requirements

For AI-produced work:
- Postflight review required before accepting findings
- Graph writes require explicit authority (card-scoped, not ambient)
- CoderReports require evidence verification (SUPPORTED/UNSUPPORTED/CONTRADICTED)
- Accepted findings persist to ThinkGraph with provenance
