# Harness → ThinkGraph card delegation — the real mechanism

Established 2026-07-06/07 after a real Harness chat request delegated to `card_thinkgraph_agent`
and produced a persisted, independently-verified ThinkGraph write. This is the proven
runtime path — read it before touching card doorways, ThinkGraph authority, or main-chat
delegation behavior.

## The path (every link real, none simulated)

```
Harness chat request (POST /api/coder/openclaude/session/chat)
  → grpcChatClient.resolveCardDoorwayDefinitions (per-turn doorway list)
  → main-chat model reads each doorway's when_to_use and decides to delegate
  → native AgentTool call ("Agent") with agent_type = card_thinkgraph_agent
  → doorway's bound tool call: mcp__liquidaity__card_run_assistant_agent
  → control_plane.card_run_assistant_agent (Python) forwards conversationId verbatim
  → POST /api/coder/mcp-bridge/run_configured_card
  → runtime.ts runConfiguredCard: resolves runtimeBinding via resolveRuntimeBinding(),
    mints { kind: 'thinkgraph_card_run', projectId, cardId, correlationId, conversationId }
    ONLY when resolvedBinding === 'thinkgraph_agent' AND a real conversationId is present
  → Python run_configured_card arms THINKGRAPH_RUN_AUTHORITY for the run
  → the card's own AssistantAgent calls read_thinkgraph_scope, then apply_thinkgraph_patch
  → thinkGraphStore.applyThinkGraphPatch persists the AGE write
  → GET /api/thinkgraph/graph-view reflects the new nodes/edges immediately (no cache)
```

## The two things that actually break delegation (both fixed, both real bugs)

1. **The model doesn't know the sub-agent can write.** The doorway's parent-facing
   description (`when_to_use` on `AgentDefinitionConfig`, relayed by vendored
   `server.ts`) must be *truthful*: state plainly that this agent reads AND writes the
   real graph, and forbid the model from substituting a conceptual/text-only graph.
   A generic `"Saved card agent (runtimeBinding=X)"` description is not enough — the
   model will reason "no write tool visible to me" and answer with prose instead of
   delegating. See `doorwayWhenToUse()` in `grpcChatClient.ts`.

2. **Even when it delegates, write authority can silently fail to arm.** `runtime.ts`
   must resolve the card's binding the *same way* the doorway did
   (`resolveRuntimeBinding(runtimeOptions.binding ?? runtimeBinding ?? binding, cardId)`),
   not by reading `card.runtimeBinding` raw. A default card whose binding is only
   inferable from its `cardId` (not an explicit field) will silently get NO write
   authority under the raw check, and `apply_thinkgraph_patch` reports
   `thinkgraph_authority_missing` — with no visible error reaching the model, which
   then also falls back to a conceptual answer. Both failure modes look identical to
   the user: "it just describes a graph instead of writing one."

## Never do instead
- Do not add phrase/regex routing to force delegation ("if message contains ThinkGraph...").
- Do not expose `apply_thinkgraph_patch` directly to the Harness model — write authority
  must stay inside the Python card run, minted server-side per the rule above.
- Do not hard-code the card id into the Harness prompt. The model must choose based on
  the doorway's own truthful capability description.

## Proof trace (what to grep for)
```
[agent] card doorway started corr=<harness-correlation>
[agent] card-run requested cardId=card_thinkgraph_agent corr=<card-correlation>
[agent] card card_thinkgraph_agent invoking-python binding=thinkgraph_agent authority=thinkgraph_card_run tools=[read_thinkgraph_scope,apply_thinkgraph_patch]
[THINKGRAPH][tool] read_scope ... nodes=N
[THINKGRAPH][tool] apply_patch ... -> applied
[agent] card card_thinkgraph_agent completed
[agent] card doorway completed
```
If `authority=` is missing/empty on the `invoking-python` line, the binding-resolution
bug (item 2 above) has regressed. If there is no `[agent] card doorway started` line at
all, the model never delegated (item 1).

See also: [[python-mcp-card-runtime]], and the Claude Code skill
`prove-harness-card-delegation` for the exact commands used to test this without a
browser.
