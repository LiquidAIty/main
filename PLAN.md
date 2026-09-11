# LiquidAIty MVP plan

[Execution law](AGENTS.md) · [Known failures](DONT.md) · [Source owners](ARCHITECTURE.md) · [Deferred work](FUTURE.md)

PLAN records the current route and evidence gaps. It is human documentation, not a runtime prompt,
task ledger or memory. Changing or removing it must not alter Builder's canonical `in.idf`.

## Product outcome

A user asks Main, receives a useful answer or deliberately invokes a saved Card, inspects truthful
output and evidence, and reloads without losing settings, history or native references. Main remains
the permanent conversation front door. Saved `builder` constructs prompts, Cards, agent apps,
pages and supporting code through explicit tools. Saved configuration and topology own identity,
model, profile, skills, grants and execution eligibility; Hermes and AutoGen own their runtimes.

ThinkGraph/Engraphis holds project reasoning; KnowGraph/Graphiti holds sourced knowledge; CBM owns
CodeGraph; AGE owns Card topology and observed Runs. Preserve graph data and accepted presentation.
Current Main uses explicit writes or focused delegation. Native pending candidates and next-submit
acceptance are an approved target requiring a separate implementation; they are not current behavior.

## Current repair status — September 11, 2026

Baseline: branch `main`, HEAD `b6ff569b68bcfec3601b6db4669ac3aa86abecb1`.
The repair began with 24 modified tracked files and one untracked test. This is a dirty worktree,
not a new accepted release.

| Boundary | Verified in this repair | Remaining proof |
| --- | --- | --- |
| Glass inspector | Existing drawer open/close, details/provenance, resize, detach/move/redock and collapsed reopening contracts; 17 focused tests; client typecheck/build | Real saved surface and Jeremiah's visual acceptance |
| Session/conversation isolation | 85 backend and 14 selected Python/plugin contracts; backend typecheck/build | Loaded native session binding, reconnect and originating-conversation delivery |
| App Server selected tools | 36 transport and 29 Hermes integration tests; dynamic schema dispatch and existing integration behavior under fixtures | Exact saved-tool surface, external MCP availability, real canonical execution and native preservation |
| Graph removal | Existing native graph owner unchanged; an uncalled relationship-removal callback fragment removed | No new native removal/readback or regex change implemented; no database operation |
| Stand-in procedure | Consolidated role/parity procedure and light Gene persona; ten clearly synthetic scenario examples | No user simulation, Card stand-in or model acceptance run performed |
| Documentation | Current-scope guardrails and correction of verified stale/conflicting statements | Documentation is not product execution proof |

The App Server bridge skips external `mcp-*` toolsets other than `mcp-liquidaity-card`, assuming
native Codex connections supply them. That assumption is not proven by this change. Its test
success does not establish that every saved selected tool reaches the canonical executor.

The one live context read reported `loaded_source_changed`: startup
`8b2db75759814d87bf75894c6e6a8c8f` loaded revision
`96b2c057e757b61f5d3ab779884d3475af9bc0b3`, with a different loaded MCP source hash from disk.
No service restart occurred in this repair. Current-source product behavior remains **UNPROVEN**.

Named-Card addressing, Bot Mode, named replies and transcript/parent-wakeup changes are deferred.
The current repair authorizes no product database operation, profile/Card/model/grant change,
outside-repository code, dependency installation, subagents or Git mutation.

## Next decisions and proof order

1. Resolve the exact selected-tool/native MCP gap in the existing App Server boundary. Preserve
   native capabilities and configuration; do not substitute a global tool grant or suppression.
2. After independent source work is stable, ask once before a canonical full restart to load it.
   No partial restart or repair through another process.
3. With current source loaded and a separately authorized bounded product case, verify session
   identity/history, delegated result isolation and real selected-tool execution from saved Cards.
4. Inspect the real glass inspector and obtain Jeremiah's visual acceptance. Passing mechanics
   or source equality cannot replace that acceptance.
5. Only then select an ordinary controlled conversation or stand-in case. Named-Card conversation,
   graph automation and Magentic-One work require their own explicit scope.

## Controlled agent test plan

No model run is authorized by this plan. Follow
[the stand-in procedure](skills/double-agent-standin-skill.md) for a separately approved case.
Read the then-current Card/profile and effective tools; old saved-model snapshots are not authority.
Evaluator expectations and diagnostics stay outside Main's input and graph memory.

| Case | Participants | Useful work and decisive evidence |
| --- | --- | --- |
| Main | Saved Main | One ordinary context-dependent question; attributed recall, useful answer and actual usage/timing |
| Builder | Saved Builder | One bounded construction investigation; real source/tool access, output and Run receipts |
| Main → Builder | Existing saved flow | Exact handoff and receiving Card context, child Run, result consumption and conversation isolation |
| Space-sector user proxy | Evaluator playing the light Gene persona, real Main | Develop a sector theory before considering a paper plan; test judgment with the separately labeled synthetic examples |

Declare deadline, call budget, permitted effects and actual cancellation doorway before a run.
Read-only retained material is preferable. A mutating graph comparison needs an explicitly authorized
isolated native target; do not clear a user's database or coach a prompt to obtain a desired answer.
Missing usage, cost, tools or parity remains unknown. No stand-in is assumed free or equivalent.

## Historical checkpoint evidence

The September 10 record in
`b6ff569b68bcfec3601b6db4669ac3aa86abecb1:PLAN.md` reports the Builder transition, exact removal
of two obsolete Cards, and Run `builder-acceptance-20260910-0746`. It reports real task output,
20 CBM reads and provider usage, with unavailable transcript attribution and unknown cost/tool count.
Those are historical receipts, not proof that the current source is loaded or every native tool works.
No historical deletion or profile-maintenance instruction is standing authorization.

The earlier null-versus-zero source repair and remaining Builder transcript attribution, IDD
consumer parity, graph semantic quality and full native Magentic-One acceptance remain distinct
proof boundaries. Do not erase failed receipts, relax attribution or change saved settings to make
an acceptance run succeed.

## Saved-state and publication boundary

Jeremiah owns Git saves, restores and publication. Catalog identity, installed connector cache and
fresh selected-plugin acceptance are separate. Do not refresh credentials/plugins, reindex CBM,
change profiles, restart services or launch the next feature from this document.
