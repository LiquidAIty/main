# Double-Agent Stand-In — real position work + embedded leak inspection, one job at a time

@skill id=double-agent-standin
@type Skill
@status active
@related_to agent-stand-in-testing

## When to use

The recursive campaign where **LiquidAIty uses its own graphs to study and improve its own
knowledge-graph code** (episodes KG-01…KG-08 over real imported source material). Each rung of an
episode is a **job**: an external stand-in plays a real product position AND inspects that
boundary for leaks. Dev-only, **$0** (external stand-ins over the real *free* doorways —
CBM, mcp-bridge transport, KnowGraph deterministic retrieval, conversation/graph writers). No
paid product-model call is ever required to conduct an episode.

This is NOT a token audit. The primary subject is always the episode's knowledge-graph Question.
The leak inspection rides along; it never becomes the Goal unless Main deliberately selects it.

## The two roles — BOTH happen in every job

- **ROLE 1 — Product position.** Do the real work that position performs, through its real
  doorway. Main plans; Coder/CodeGraph inspects via CBM; Hermes selects source evidence + writes
  memory/report; KnowGraph retrieves trusted Claims; Mag One produces a task ledger; Coder
  implements real code; Reviewer reviews the exact result.
- **ROLE 2 — Embedded double agent.** While doing Role 1, inspect the boundary from inside and
  record leaks. Role 2 never replaces Role 1's real task.

## Job → doorway map (all $0)

| Job | Position | Real doorway (dev, free) | Role-1 output |
|---|---|---|---|
| Main | front door / orchestrator | conversation store + `thinkgraph_submit_update` | plan, Goal, Questions, Decision, closure |
| Coder/CodeGraph | code inspector | **CBM** (`search_graph`/`get_code_snippet`/`search_code`) | CodeFindings (+ freshness) |
| Hermes | memory/report | real ThinkGraph read + `hermes_memory_write` / report writer | evidence selection + recommendation |
| KnowGraph | research/retrieval | real hybrid retrieval over existing project scope | trusted-Claim evidence packet |
| Mag One | worker orchestrator | job folder `handoff/<id>/prompt.md` | task ledger / approved prompt |
| Coder-impl | implementer | rung-4 job claim → real edit + `returns/<id>/` | CoderReport + real files |
| Reviewer | reviewer | read returns + ThinkGraph ReviewResult | review verdict |

**Input contract (required):** every job's inputs MUST include `{project, conversation, goal}` — not
just the goal — so the position can scope its writes without guessing. A missing scope block is a
`ProcessLeak: scope` (found as PL-5 in KG-01 Job 3). **Stand-in positions are propose-only** unless
handed a callable write tool: if a position has no write doorway, it returns exact write payloads and
the **conductor executes + reads them back before the next job** (PL-4).

Casting is **hybrid**: Opus conducts and plays high-judgment jobs (Main, Hermes, Reviewer, the
Decision); Sonnet-5 agents play Coder/CodeGraph, KnowGraph, Mag One where fresh myopia sharpens
the boundary inspection. Never launch duplicate agents merely to re-confirm a finding.

## The JOB REPORT (every job produces exactly this)

**A. Position output** — the real Role-1 result (plan / findings / evidence packet / Decision /
prompt / CoderReport / review / response).

**B. Double-agent report** — compact, machine-readable:
```
{ job, position, played_by, doorway,
  context_given_chars, self_retrieved_chars, actually_used_chars, discarded_chars,
  handed_up_chars, compression_ratio, tool_calls, duplicate_work,
  canonical_writes_done: [...], expected_writes_missing: [...],
  scope: { project, conversation, goal },
  became_visible: true|false|unknown, honestly_classified: true|false,
  suspected_leak: { category, severity, detail } | null,
  recommended_correction: "..." | null }
```
**Hand-up rule:** store B in the episode diagnostic artifact. Pass upward to the next role ONLY
the findings that affect the active Decision — never the whole report (that would itself be a
context leak).

## Leak categories + severity

`context` (too much raw context crosses a boundary) · `retrieval` (same code/chunks/branch
re-fetched) · `execution` (model/worker effort, no durable output) · `persistence` (result only
in stdout/temp) · `scope` (wrong project/conversation/Goal/scope) · `authority` (a component
writes/decides what belongs to another) · `proof` (claims done from tests/API while the visible
graph/UI result is absent) · `visual` (good data, useless/misleading projection) · `trust`
(synthetic/direct-seed/stale/anchor enters trusted retrieval or default view) · `cost`
(unnecessary paid fan-out/retry/provider).

Severity: `blocker` (invalidates the episode result) · `high` · `medium` · `low`.

## Process improvement rule

1. record the leak immediately; 2. classify severity; 3. decide if it blocks THIS episode;
4. continue the real use case when safe; 5. repair during the current episode ONLY when it
prevents a valid result; 6. otherwise add to the ranked **ProcessLeak backlog**; 7. address the
most load-bearing leaks in later episodes. Never derail the KG Question chasing a low leak;
never ship a result a blocker leak invalidated.

## Per-job "does the prompt/skill actually WORK?" self-check

A job's prompt is only trusted when its output passes ALL of:
1. **Real result** — produced the required Role-1 output (not a dump, refusal, or hedge).
2. **Real doorway** — used the actual doorway; did not manufacture state or bypass authority.
3. **In scope** — wrote to the correct project + conversation + Goal.
4. **Expected write** — produced/accepted the canonical write the position owes (or honestly
   reported it missing — never silently skipped).
5. **Report populated** — Section B has real numbers, not placeholders.
Any failure ⇒ the job's prompt/skill is defective ⇒ fix the prompt and **rerun that one job**
before moving up the chain. Log the prompt fix as a `ProcessLeak: authority/execution` note.

## Two end-of-episode verdicts (separate, both required)

- **KG episode verdict** — accepted | needs-revision | rejected. Basis: Question quality, source
  grounding, CodeGraph accuracy, ThinkGraph reasoning, implementation quality, DB proof,
  retrieval proof, visual result, Hermes review, Main explanation.
- **Process/double-agent verdict** — leaks found, severity, money/token risk, wrong boundaries,
  missing writes, scope/visual failures, recommended process changes, and which to implement
  before the next episode.

A good implementation can still expose an expensive process leak; a cheap process can still
produce a poor KG result. Report both honestly.

## Guardrails

No re-import of source material · no paid calls · no duplicate fan-out for mere confirmation · no manufactured
graph state · never call direct-seed data product-runtime proof · no fake Mag One completion ·
never report success when the expected visible graph result is absent · don't let leak-hunting
derail the KG Question.

## Proven job template (2026-07-14, Coder/CodeGraph)

Sonnet stand-in, given only its task, ran real CBM: pulled ~17,500 chars, handed Main ~470
(**37:1** compression), found `run_native_magentic_mission` returns `ok=true` from final text
while writing no graph record (writes are card-opt-in). Role-1 output = 4 CodeFindings;
Role-2 finding = `ProcessLeak {execution+context, high}`. This is the shape of a good job.
