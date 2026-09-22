# Mag One Hermes Runtime

The filename is retained for compatibility. Use this procedure for the existing LiquidAIty Mag One
bus whose execution engine is Hermes.

## Invariants

1. The saved Mag One Card owns orchestrator identity, prompt, provider/model, grants, and Hermes profile.
2. An ordinary orange relationship from a non-Magnetic Card with its saved `Orchestrator` setting enabled
   authorizes that source to call Magnetic. The explicit invocation starts an approved run; the wire itself
   never starts or controls Magnetic.
3. Enabled saved `magentic_option` edges own the complete worker roster and mean only that those Cards are available to Magnetic.
4. One saved Card may be orange-connected to an orchestrator and blue-connected to Magnetic at the same time. Orange
   invokes that Card directly; blue makes the same identity available through Hermes' SQLite task ledger.
5. Resolve exact current Card revisions and Hermes bindings; never infer membership from titles, prompts,
   installed profiles, or global discovery.
6. The transient Mag One input and selected native references pass through the one canonical reloaded
   `in.idf`; `run_mag_one` and the Canvas share the existing `/api/cards/run` doorway.
7. Hermes SQLite owns native tasks, dependencies, attempts, assignment, retries, dispatch, and summaries.
   PostgreSQL keeps only the one outer product Run and final result; do not copy native task rows.
8. The root task carries an inherited assignee ceiling containing only the saved Mag One profile and the
   exact projected workers. A native child cannot widen or replace that ceiling.
9. The saved Mag One profile performs model-driven decomposition and creates exactly one final dependency
   sink assigned back to itself. Return only that verified native summary as the final result.
10. Keep the bus headless. Do not add a terminal, transcript, task feed, board UI, fabricated artifacts,
   replacement scheduler, worker registry, temporary global workers, or fallback executor.
11. Each worker runs its exact saved profile configuration, tools, skills, plugins/MCP, model/provider,
     context authority, and native session. Contained subagents remain inside that Card's runtime.

## Discovery

Use Codebase Memory when available to resolve `run_mag_one`, `/api/cards/run`, `begin_run`,
`_connected_hermes_card_targets`, `ensureMagenticAgents`, and `magentic_execution.py`. Direct-read the
complete current owners and focused tests after the graph bounds the slice. Hermes is excluded from the
derived projection, so inspect its exact SQLite task owners directly.

## Static proof

- saved Mag One Card, current revision, provider/model/profile, and connected roster readback;
- canonical IDF write/reload and exact mission equality at structured submit;
- profile materialization/readback for the orchestrator and every worker before root creation;
- root `allowed_assignees` readback, inherited child enforcement, and unrestricted ordinary-task behavior;
- idempotent root submission and creator-tree-scoped Stop;
- unique final dependency sink assigned to the saved Mag One profile;
- final text sourced only from the native final task summary;
- no legacy executor import/package/route/config residue outside immutable migration or recovery evidence;
- focused Python, Hermes, backend, and client tests plus production typecheck/build.

## Live proof

After a Python-rails restart, use one explicitly approved bounded saved-product mission. Prove the existing
Card/Canvas/blue topology remains unchanged, the native root is assigned to `card_magentic`, every executing
worker is in the projected roster, an unwired profile cannot be assigned, the verified final synthesis is
returned through the same outer Run, and no terminal or copied native task feed appears. Static tests are not
provider execution proof; report any credential/runtime blocker exactly.
