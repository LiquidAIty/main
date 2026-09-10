# LiquidAIty MVP plan

[Execution law](AGENTS.md) · [Known failures](DONT.md) · [Source owners](ARCHITECTURE.md) · [Deferred work](FUTURE.md)

PLAN is the human route to an accepted MVP: current product direction, verified state, remaining
work and testing decisions. It is not a model prompt, operation packet, task ledger or memory.
Changing or removing this file cannot alter Builder's runtime input. IDD and the one canonical
`in.idf` pipeline remain part of the product.

## MVP target

A user can ask Main, receive a useful answer or deliberately invoke a saved Card, inspect truthful
output and evidence, and reload without losing settings, history or native references. Main is the
permanent conversation front door. Builder constructs prompts, Cards, agent apps, UI pages and
supporting code. A Card's saved model, profile, grants, skills, settings and topology control its Run.
Hermes and AutoGen retain native runtime ownership; TypeScript transports and renders.

ThinkGraph/Engraphis holds project reasoning and operational knowledge. KnowGraph/Graphiti holds
sourced knowledge and provenance. Native CBM owns CodeGraph. AGE owns Card topology and Run
observations. Keep current graph data and accepted visualization. Main chooses explicit graph writes
or focused delegation; no automatic post-conversation extraction or graph merger is approved here.

## September 10 implementation and current evidence

The approved Builder contract replaces the older design-review hold. Saved Card `builder`, display
Builder, binds to clean profile `builder`, preserving the intended Sol parent/Luna child selections.
It has 16 selected MCP tools, six native selections, two skills and six construction toolsets. The
existing Main flow targets Builder. No old prompt, memory, session or credential state was copied.

Inspect/create/update use real arguments and current catalog choices. Card updates require exact
revisions and saved grants, preserve unspecified fields and return saved readback. Card creation
honors a valid requested native profile name. The full inventory and restrictions are in ARCHITECTURE.
No legacy create/edit operation task, hidden effect target or PLAN-derived instructions remain in
runtime execution. Requests carrying retired fields fail explicitly. Canonical IDF materialization,
graph selection, images, saved instructions, tools and history inspection remain.

Focused evidence: 103 IDF/Card-domain tests passed; the later revision-readback repair passed all
96 Card-domain tests. Python control-plane/MCP focus passed 63 tests. Backend runtime/transport
focus exercised 116 passing contracts after isolated PTY fixture repair. Additional binding checks
passed 12 PTY, seven catalog and 49 frontend tests. Frontend/backend production typechecks and
builds pass. Final canonical `npm run build --workspace client` used Vite 7.1.3 and completed
in 1m38s after the last UI predicate repair; all 17 affected tests and frontend typecheck passed.
A preceding root-Vite 6.3.5 invocation was stopped at its four-minute cap; it was the wrong build
entry point, not a demonstrated production error. Frontend retains its existing large-chunk warning
(500 kB advisory threshold; largest GraphTab 1,143.40 kB minified / 321.27 kB gzip). Backend spec typecheck still reports
12 diagnostics in existing fixtures/imports; it is not a passing check.

The owner specifically authorized removing `card_local_coder` and `card_61d994e5044b4e44`, their
wires, old profiles/selections/sessions and exclusively owned blocking Run/receipt history. This
supersedes retention for those two Cards only. No general history lifecycle or permanent database
grants are added. Unrelated Cards/Runs and shared authentication must survive unchanged.

Exact deletion is complete: the existing revision-checked application endpoint removed both Cards;
10 unrelated Cards and nine remaining wires read back exactly unchanged, including Main to Builder.
The one-time maintenance transaction removed 51 exclusively owned Runs, 35 blocking artifact records
and their incident AGE telemetry. It verified all 244 unrelated Runs and 175 artifact records unchanged.
The native Hermes profile deletion removed exactly `coder` and `liquidaity-agent-builder`, including their
profile-owned sessions/settings. Four old persisted running records had no live profile process; they
were deleted under the exact owner instruction, not falsely marked cancelled. No general deletion
framework, permanent grants or Builder delete tool was added. Generated artifact files outside those
profiles were not deleted; their exact old-Run catalog blockers are gone.

The additional owner-approved canonical reload succeeded after the MCP script-import ordering repair;
an isolated no-PYTHONPATH import test and three focused catalog/dispatch tests passed. Loaded Main
context matches the on-disk MCP source hash and reports 81 unique public tools with all families ready.
Builder's live IDD catalog returns 200, 193 options and 10 fields after removal of an identical duplicate
skill entry from native discovery. One redundant skill copy remains outside discovery because the host
blocked recursive deletion. The first real Builder Run failed before inference because the clean profile
disabled the required app bridge plugin. Enabling only `liquidaity-card-mcp` and replacing its stopped
Builder PTY through the existing owner restored native execution without another stack reload.

Real Run `builder-acceptance-20260910-0746` completed in 328,898 ms on saved/native Sol with no
fallback. It produced a current-source explanation of the Card Run → persistent PTY → native plugin
bridge chain. AGE retains 20 completed CBM reads (eight searches, six traces, six snippets), zero graph
writes; the PTY showed real file reads. Canonical IDF is 50,442 bytes with SHA256
`2f544aedeb842103b35d9890303350da561ef6301fa79d6eae9a1d3b44ca1018`; native session
`20260910_034517_934336`. All 16 selected MCP tools appear in the IDF presentation; native selections
and toolsets remain configured, not individually exercised. Neither forbidden plugin pin nor
`delegate_task` appears in those selections.

Provider-reported aggregate usage: 1,447,626 input, 5,921 output, 1,295,360 cached and 1,733 reasoning
tokens. These are multi-call totals, not one prompt size. Cost and aggregate tool count are null in the
stored Run, despite normalized status displaying zero. They are unknown, not measured zero. File reads
have observer evidence but no separately exposed persisted receipt; transcript retrieval reports
`native_session_shared_or_unmapped_runs`. These observability limits prevent claiming complete receipt
parity or that every selected native tool is usable. External connector acceptance remains separate.

## Remaining product route

1. Complete the remaining Builder receipt/availability proof: preserve null measurements, resolve
   transcript attribution and inspect effective native availability. The bounded actual Run above
   already proves task execution, CBM reads, observed file work, output and provider token usage.
2. Use the controlled tests below to evaluate Main, Builder and their actual delegation. Resolve
   unsupported Card-to-host parity before dispatch; do not fit Cards to test-host limitations.
3. Evaluate graph retrieval quality and entry options on eligible real material with approved
   isolation. Compare source material, executing role, extraction method and scheduling separately.
   A completed user/assistant pair may be selected material; this does not reinstate an automatic
   post-chat hook. Attribution, useful later recall and final-answer quality are acceptance criteria.
4. Prove IDD editor/tool parity and the saved-Card loop under real construction tasks before broader
   rollout. Preserve existing Script, native subagent model, provider, session and Card controls.
5. Resume Magentic-One only by explicit owner decision, through its existing native runtime and
   saved worker topology. Future downloadable Local Coder and wider product expansion remain deferred.

## Controlled agent test plan

No Codex stand-in benchmark is launched in this implementation pass. Follow
[double-agent-standin-skill](skills/double-agent-standin-skill.md) for a separately authorized run.
Evaluator instructions/results stay outside product prompts, conversations and graph memory.

| Case | Actual participants | Useful product work | Required parity and proof |
| --- | --- | --- | --- |
| Main | Saved Main only | Answer one context-dependent project question | Actual Main prompt/history/model/effort/grants; relevant recall, useful answer, attribution, real usage/latency |
| Builder | Saved Builder only | Inspect a bounded code/Card contract and produce an actionable result | Saved Builder prompt/profile/skills/model and actual application CBM/native tools; current source, output, receipt |
| Main → Builder | Both saved Cards with their existing flow | Main delegates a specific construction investigation and explains the returned result | Separate role contexts; real handoff payload, child Run, output consumption, no invented worker response |

Main and Builder currently select Sol parents and Luna native children; unspecified effort is
unknown/native default, not an inferred setting. A stand-in must match the actual Card, even if a
lower-cost implementation helper would normally suffice. If the host cannot reproduce a Script,
native history, capability or model setting, report the exact mismatch before claiming parity.

Proposed first-case bounds (not an authorization to launch): Main 2–5 minutes with a five-minute
cap; Builder 3–8 minutes with a ten-minute cap; Main → Builder 5–12 minutes with a fifteen-minute
cap across both roles. These are planning estimates, not measured latency. Stop immediately for
settings mismatch, unauthorized writes, missing tools, lost native ownership or provider substitution;
use the exact native Run stop doorway at the cap and verify termination. Provider cost before these
account-backed runs is unknown; do not describe them as free. Read the then-current Cards and preserve
Main's saved Script rather than substituting the supervisor's tools or prompt. Exact prompt/history
and effective catalog capture precede each separately authorized case.

Record wall time, actual calls/outputs, input/output/cached tokens, provider-reported cost and useful
context delivered/consumed. Missing measurements are unknown, never zero. Predeclare a bounded
wall-time/call budget and an actual cancellation doorway; polling timeout is not native cancellation.
No test requires graph mutation, fake Cards or another runtime merely to manufacture evidence.

## Plugin refresh and Git-save boundary

This pass does not commit, stage, push, publish, reconnect credentials, refresh installed plugin
packages or reindex CBM. The repository connector definition, loaded MCP catalog and installed
connector cache are separate states. Jeremiah owns Git save and the later selected-plugin refresh.
External acceptance requires a fresh selected-plugin context with actual Main/CBM/schema receipts.

## Remaining acceptance boundaries

The normalized cost/tool-count display is a demonstrated backend presentation defect: `Number(null)`
turns missing receipt values into zero. The source repair now preserves null and real numeric zero
separately for cost/tool count; both focused cases passed in 7.01s and backend production typecheck
and the canonical backend build passed. Loaded readback requires the next explicitly authorized
application reload. No further restart was performed after the owner-approved additional reload.

The completed Builder transcript is intentionally unavailable while a same-Card historical Run has
no native session mapping. The preceding failed delivery Run is such a record. Keep this attribution
check closed: simply ignoring every null historical mapping could expose another Run's content.
A later bounded repair needs native per-Run attribution evidence and privacy assertions, not removal
of the safety condition or deletion of the failed acceptance receipt. This does not erase the completed
Run's ordinary final output, IDF, provider usage or its 20 retained CodeGraph reads.

## Deferred review

Review remaining spec-typecheck diagnostics, native capability/environment availability, Main Script
acceptance and graph context quality against evidence. Do not use old Constellation/Coder/operation
wording in recovered historical documents as authority to revive those designs. Card deletion remains
application maintenance; adding a normal Builder delete tool is a later explicit product decision.
