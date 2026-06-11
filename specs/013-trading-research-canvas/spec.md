# Spec 013: Trading Research Canvas

**Status**: Future skeleton - blocked by Spec 012 completion.
**Dependency**: Spec 012 real research-graph loop must pass end to end.

## Purpose

Define a future research-only trading vertical built on the proven Agent-Memory/Research-Graph
loop. This spec is intentionally a short boundary marker, not an implementation plan.

## First Slice

```text
user asks about a ticker or market idea
-> real agent run creates completed-pair memory
-> ThinkGraph captures provisional entities, assumptions, risks, and open questions
-> Research Pack candidate identifies filings, news, price, and action questions
-> future trading canvas surfaces the research plan
```

## Hard Boundaries

- No implementation until Spec 012 passes.
- No broker integration.
- No live or paper orders.
- No portfolio automation.
- No automatic trade recommendations or execution.
- No fake market data, fake research, or invented graph memory.
- The first trading slice is research-only.
- Broker execution belongs to a much later separately specified and approved phase.

## Future Acceptance Direction

1. A ticker or market-idea question flows through the same proven real execution and memory loop.
2. Candidate research questions are derived from real graph gaps and can cover filings, news,
   price behavior, risks, and possible actions.
3. A future canvas can surface the candidate plan without launching research or placing orders.
4. Project isolation, provenance, and no-fallback runtime rules remain mandatory.

