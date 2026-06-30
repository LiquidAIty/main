# DONT.md — read this before you write code here

This codebase has been cleaned of ~16,000 lines of layered spaghetti more than once. It came
back because agents kept **adding** a new approach without **deleting** the old one, and then
mimicked the mess they saw. These rules exist to break that loop. They override any instinct,
any inherited prompt, and any pattern you observe in surrounding code.

## The one rule that matters most

1. **When you change approach, DELETE the abandoned path in the same change.** Never layer the
   new over the old. A new thing that "works" while the old thing still exists is **not done** —
   it is debt you just created. Deletion is the work, not a cleanup for later.

2. **"Looks done" is not done.** Before you call something finished: did you remove what it
   replaced? Search for the old symbols and confirm zero callers. If you can't delete it because
   something still uses it, the job isn't finished — say so.

3. **Do NOT mimic the surrounding code.** If a file looks like a hairball, that is a bug to fix,
   not a style to copy. Follow these rules, not the mess.

## What is allowed to exist

4. **Membership test.** If a thing is not (a) bound by an agent, (b) controlling/visualizing an
   agent on the canvas, or (c) knowledge — it does not belong here. Delete it.

## TypeScript is rails, not a brain

5. **No logic in TypeScript. None.** No calculation, classification, planning, reasoning, regex
   intent-routing, or model selection. TS only: MCP transport + tool registration, request/
   session/project identity, strict input validation, fail-closed integrity checks, thin
   read/persistence adapters, streamed UI events, resolving stable graph refs into bounded slices.
6. **The UI (agentbuilder, client) is a UI, not a calculator.** All calculation is Python + models.
   If you'd have to *read* a `.tsx`/`.ts` file to understand a decision the system makes, that
   decision is in the wrong language — move it to Python or the model.

## The graphs

7. **A plan is data, never a planner.** A Plan = a prompt + stable graph pointers (think:/know:/
   code:), handed to Mag One via `execute_visible_flow`. Mag One plans natively (its own Task
   Ledger). NEVER rebuild PlanFlow / Mission / a TS planner / planFlowTaskObjects.
8. **The graph is the source of truth — pass pointers, not copies.** Do not pass graph data around
   to be mutated. Refs in, refs out.
9. **One authority per graph.** Harness writes ThinkGraph only (via `thinkgraph.apply_delta`).
   Research agents write KnowGraph only. The CBM indexer writes CodeGraph only. No cross-writes,
   no second writer, no UI→DB graph write.
10. **Files for how-to, graphs for what-is.** Skills/docs are files. CodeGraph/KnowGraph/ThinkGraph
    are graphs. Don't smear one into the other (e.g. SkillGraph nodes must never leak into KnowGraph).

## Forbidden, always

11. **No fallbacks.** Succeed on the real path or fail honestly and report. No `a || b` legacy, no
    try-real-catch-degraded, no timeout→stand-in, no silent graph blending.
12. **No fake success.** No `{id, ts}` no-op events, no success-shaped payloads that no listener
    applies, no "completed" without real proof.
13. **No hidden surfaces.** No debug routes, sidecars, pollers, schedulers, second MCP hosts, or
    second renderers. If information matters, surface it in-loop (on the canvas), not a hidden route.
14. **Extract, don't absorb.** Never dump a whole external repo into this tree. Lift the one useful
    skill/persona/pattern into the curated set; the source stays out (gitignored/Downloads).

## Proof

15. **Proof = real runtime + the build the dev server uses.** Typecheck + the touched tests must be
    green, and you must say what you did NOT verify. "It compiles" is not "it works."
