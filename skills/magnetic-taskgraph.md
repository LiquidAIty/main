# Magnetic TaskGraph

Use this procedure for LiquidAIty's saved Magnetic Card and its Hermes task/dependency execution.

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
6. The transient Mag One input and selected provider references pass through the one canonical reloaded
   `in.idf`. `run_mag_one` enters through the authenticated tool dispatcher; a visible addressed turn enters
   through `/api/shared-chat/turn`. Both resolve the same saved Magnetic Card and Python preparation owner.
7. Hermes SQLite owns tasks, dependencies, attempts, assignment, retries, dispatch, and summaries.
   PostgreSQL keeps only the one outer product Run and final result; do not copy Hermes task rows.
8. The root task carries an inherited assignee ceiling containing only the saved Mag One profile and the
   exact projected workers. A child task cannot widen or replace that ceiling.
9. The saved Mag One profile performs model-driven decomposition. That same root remains the final
   synthesis task; do not create a separate final sink. Return only its verified Hermes summary.
10. Keep the bus headless. Do not add a terminal, transcript, task feed, board UI, fabricated artifacts,
   replacement scheduler, worker registry, temporary global workers, or fallback executor.
11. Each worker runs its exact saved profile configuration, tools, skills, plugins/MCP, model/provider,
    context authority, and Hermes session. Contained subagents remain inside that Card's Hermes execution.

## Discovery

Use Codebase Memory when available to resolve `run_mag_one`, `begin_run`,
`agentgraph_topology.connected_hermes_card_targets`, `MagneticTasksTab`, and
`magnetic_taskgraph_authority.py`, `magnetic_taskgraph_submission.py`, and
`magnetic_taskgraph_readback.py`. Direct-read the
complete current owners and focused tests after the graph bounds the slice. Treat HermesLatest as a
controlled fork: use its indexed structure for discovery, then read every affected task-ledger body directly.

## Static proof

- saved Mag One Card, current revision, provider/model/profile, and connected roster readback;
- canonical IDF write/reload and exact mission equality at structured submit;
- profile materialization/readback for the orchestrator and every worker before root creation;
- root `allowed_assignees` readback, inherited child enforcement, and unrestricted ordinary-task behavior;
- idempotent root submission and exact outer-Run correlation;
- the root itself remains the final synthesis task assigned to the saved Mag One profile;
- final text sourced only from the Hermes root summary;
- no legacy executor import/package/route/config residue outside immutable migration or recovery evidence;
- focused Python, Hermes, backend, and client tests plus production typecheck/build.

## Live proof

After a Python-rails restart, use one explicitly approved bounded saved-product mission. Prove the existing
Card/Canvas/blue topology remains unchanged, the Hermes root is assigned to `card_magentic`, every executing
worker is in the projected roster, an unwired profile cannot be assigned, the verified final synthesis is
returned through the same outer Run, and no terminal or copied Hermes task feed appears. Static tests are not
provider execution proof; report any credential/runtime blocker exactly.
