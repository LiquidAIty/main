# LiquidAIty MVP plan

[Execution law](AGENTS.md) · [Known failures](DONT.md) · [Source owners](ARCHITECTURE.md) · [Deferred work](FUTURE.md)

PLAN is the long-form route from the existing application to an accepted MVP. It records the product
target, current evidence, remaining capabilities, dependencies, tests and unresolved decisions. The
September 10 scope below limits what may execute now; the longer roadmap is not permission to launch
every future activity. Coding agents read and maintain this file when implementation, proof or an owner
decision changes it. A completed test does not turn an untested product target into current behavior.

PLAN is not a saved Card prompt, task packet, model memory or replacement for IDD. There is one current
exception: explicit Builder operations read only the bounded `Agent Builder product vision` section
below. That existing consumer is preserved. Keep roadmap, audit findings, evaluator instructions and
test results outside that section. Whether to move this product guidance into saved Card authority is
a design-review decision; this documentation update does not remove the mechanism or IDD.

## September 10 execution scope and current checkpoint

Finish collaborator and existing-plugin readiness through evidenced repairs, complete source reads,
CBM inverse audits, focused preservation checks and usable documentation. Working code has no
rewrite quota. Do not expand features, replace architecture, change accepted graph layout, run agent
benchmarks, reconnect/publish the plugin, reindex CBM, start another stack or mutate Git.

Latest owner decisions supersede the earlier preservation of the Local Coder Card:

- Remove saved Local Coder `card_local_coder` and its attached option wire. A future downloadable
  Coder will be a new Card; OpenClaude and its former standalone runtime remain abandoned.
- Replace the old Agent Builder Card `card_61d994e5044b4e44` with a general Card named `builder`,
  using the clean native Hermes profile `builder`. Do not inherit the old profile's memory,
  sessions, credentials, extra instructions or overrides. Profile and Card names must agree.
- Builder authors prompts, agents, agent apps, UI pages and webpages. Creating and editing a Card
  are tools it can use; they are not a mandatory classification or fixed workflow for every task.
  Preserve useful create/edit tools while tracing the restrictions around them.
- Inventory every selected tool and show the exact create/edit interaction for owner sign-off before
  changing that behavior. The concrete current inventory and proposed contract are in ARCHITECTURE.md;
  the proposal is not a completed or approved implementation.
- Preserve Builder's current capabilities while Main is made working. Detailed Builder design and
  create/edit behavior changes are deferred for the owner's later review; no new workflow is imposed.
- One Graph Card handling both ThinkGraph and KnowGraph is exploratory, not an approved merge.
  Keep native graph authorities and current saved graph Cards until an explicit decision.

Preserve Main, accepted graph presentation/data, Card controls/settings, authentication, sessions,
retained Run history, native runtime ownership, the single IDF materializer and unrelated dirty work.
Deleting a Card does not silently authorize cascading deletion of its historical Runs or profiles.

### Ordered work and proof gates

| ID | Outcome / current evidence | Remaining result |
| --- | --- | --- |
| P0-T1 | Canonical reload complete; loaded MCP revision `8e1e61f` and source-byte hash match current source; authenticated Main/CBM reads work | Fresh selected-plugin acceptance remains separate; no reconnect here |
| P0-T2 | UI → route → Card → IDF → native-owner audit performed; Builder usage loss and PLAN context leak demonstrated | Complete new `builder` binding/replacement and prove its general task/tool path in the loaded app |
| P1-T1 | Two catalog failures repaired as stale test assumptions; discovery isolated. Builder native token/cost forwarding repaired | Actual native model usage and retained Run totals still need same-request proof; no additional route split without evidence |
| P1-T1 route follow-through | Global Coder HTTP prefix replaced by Main/Card/Hermes/IDD/CodeGraph addresses; tests, typechecks, backend/client builds and loaded read/auth checks pass | Actual post-reload agent execution remains unproven; all 11 saved Cards remain readable |
| P1-T2 | Existing feature seams and composition root inspected; no independently justified root extraction selected | Conditional only; a long file alone is not a defect |
| P1-T3 | Local Coder deletion lock removed in source; exact-target deletion and Main protection tests pass | Actual Card deletion/replacement, history-reference resolution and profile/caller migration remain incomplete |
| P2-T1 | MVP roadmap restored alongside current evidence; Main/Builder/graph design audit and entry alternatives documented; Builder product-vision boundary preserved | Owner review of the proposed Builder contract and graph comparison; no prompt/grant changes implied |
| P2-T2 | Stand-in procedure includes actual measurement and parity traps | Resolve missing parity/cancellation evidence before declaring either case launch-ready |
| P3-T1 | Single-Card case defined below; no model run performed | Deferred by owner |
| P3-T2 | Main → Builder two-role candidate defined below; no actors launched | Deferred by owner; use actual final saved topology |
| P3-T3 | Focused tests and source audit for completed changes | Final inverse/diff review, remaining replacement proof and truthful CoderReport; no Git save |

### Concrete findings and next implementation

1. Complete the two Card changes through the canonical Card/deck authority. The existing deletion
   operation requires exact deck/Card revisions and refuses retained Run, trace, assignment, trading
   and AgentGraph references. The source no longer special-cases Local Coder as undeletable, but the
   canonical reload has loaded the repair. Application readback confirms both Cards have retained completed Runs: Local Coder
   `external-mcp:d0e29749-b090-4887-98cc-a1b540b7c6f5` and old Builder
   `external-mcp:7ed33033-e722-4812-aace-2f8f13a78d12`. These references block the existing
   deletion operation even after reload. Do not bypass the checks with SQL or call disabling a Card
   deletion. Resolve how removal preserves this history before applying the replacement.
2. The clean local `Hermes/.hermes/profiles/builder` exists with native defaults and only the selected
   `hermes-agent` and `agent-builder-inspection` skills. It is not bound to a saved Card yet. Parent
   selection is `openai-codex/gpt-5.6-sol`; native child selection is `openai-codex/gpt-5.6-luna`.
   CLI toolsets are web, terminal, file, browser, vision and code_execution. No old credentials,
   memory or sessions were copied. Native availability/authentication still require readback.
3. Coordinate the exact profile references in the existing terminal, Card routes, Card domain,
   control-plane, workspace and seed with the saved replacement and Main's target. Do not add aliases,
   rename historical Runs, or switch only the frontend while the loaded backend still expects the old
   profile. The lower terminal belongs to Builder, not the removed downloadable-Coder experiment.
4. Trace `control_plane.card_create` / `card_update_configuration` and their authenticated callers.
   Current writes require a prefilled Builder operation; create also mints a random profile name.
   These are current restrictions, not the approved general Builder target. Retain authentication,
   grants, field schemas and optimistic locking while removing demonstrated obsolete workflow limits.
   `canvas.inspect` is a working bounded public read; it is not a complete Card-editor API.
5. Keep create/edit operations optional. Current `_agent_builder_operation` accepts no operation for
   ordinary work. `_agent_builder_guidance` reads PLAN only for an explicit operation. Its product
   section previously swallowed subsequent role and implementation history until the next level-two
   heading. The section below now contains product guidance only; the regression exercises real PLAN.

### Verified local proof and limits

- Catalog baseline: two failures, both stale expectations (removed AutoGen-only runtime schema and
  treating a private canonical tool as absent before public projection). Public/private filtering,
  OAuth metadata, native descriptors and exact schema validation remain asserted. Six focused
  catalog tests pass; native CBM/Graphiti discovery is guarded so unit tests cannot launch a frontend.
- Builder CLI returned usage but outer `finishRun` discarded it. A failing route test demonstrated
  the loss; the existing finish call now receives input/output/cached/reasoning tokens and cost.
  Absent usage remains unknown. The 64-test backend route/bridge set and production typecheck passed.
- UI preservation: 43 unchanged chat/terminal/split/editor/deck-load checks passed. Two seed tests
  expected retired Team fields; corrected to actual delegationRole ownership without changing seed
  behavior. All 25 setup/topology tests then passed; frontend production typecheck passed.
- IDF/IDD/Builder materialization/account-backed AutoGen selection: 37 focused tests passed.
- Deletion baseline proved Local Coder's hardcoded lock; five focused checks pass after removing it.
  This is source/unit proof, not proof of deleting either saved Card.
- The real-PLAN context-leak regression failed before the heading repair; all four focused product-vision/Builder-guidance checks pass afterward. Python compilation, native skill validation, local document targets and `git diff --check` pass.
- No actual agent work, latency, token usage, context-quality improvement or cost saving has been
  measured in this audit. Test duration is not agent latency. Unknown measurements are not zero.
- The coordinated domain-route migration passes 65 backend route/bridge tests (14.82s), 12 focused
  MCP catalog/transport tests (12.93s), eight control-plane Run tests (0.20s), and both production
  TypeScript checks. The ten affected frontend suites contain 135 tests; all pass after correcting
  the invocation directory for two suites. Their eight initial ENOENT failures were isolated test
  environment errors (`client/client/...`), not product defects; their 54-test rerun from repo root
  passed in 16.08s without changing assertions. An initial mistyped pytest selector selected no
  tests; the explicit `TestRunAssistantAgent` run above supplies the actual proof.

CBM used the application-published `cbm.*` tools against `C-Projects-LiquidAIty-main` at
`C:/Projects/LiquidAIty/main`. It reported 5,008 nodes, 20,414 edges and 35 partial files during the
identity audit; these counts are an observation, not freshness proof. CBM exposes no matching Git
revision. Hermes and AutoGen are excluded and require current direct source. Some callback/test
constructs are partial. Native graph IDs, source reads and inverse queries remain necessary.

Before the canonical reload, MCP process 25280 reported startup `b4c814c7b0954af9a4c644401a234d57`, source `8ebccf2`,
81 unique public tools and catalog SHA-256
`dedce0b1ed46fba346ab11f7d3231f9f9b3c98d83a6ec697b7d772d650321844`.
The initial source/loaded difference was SDK Main-first initialization instructions, not the two
catalog failures. Current connector descriptors still include obsolete Constellation descriptions.
Fresh package/catalog and connection proof is incomplete; never call retired tools to investigate it.

Existing plugin inspection found the cached personal `liquidaity` package
`0.1.0+codex.20260830025707`, enabled in Codex configuration, with the existing canonical HTTPS MCP
endpoint. Its description still claims Docker owns CodeGraph/CBM, contrary to the actual native
owner. An app-backed LiquidAIty package version 1.0.0 is also cached; cache presence alone does not
prove both are active. No package, credentials or connection was changed. Correct the existing
package description during the owner's eventual refresh, not by creating another plugin.

### Authorized canonical reload and loaded proof

The owner subsequently requested `npm run dev:fresh`. Docker 29.7.2 was running. The existing script
stopped the configured ports, built the backend successfully and brought up the existing stack;
no parallel stack, reconnect or agent benchmark was launched. The client workspace's own Vite 7.1.3
production build passed in 2m 1s to an isolated temporary output directory. Large-chunk warnings
remain; the initial root-Vite 6.3.5 build is not used as workspace-version proof.

Authenticated `main.context` now reports MCP process 19296, startup
`828d71b0ae3f46e5b5f6ec1251487467`, source revision `8e1e61f6420a035baa430b52818b239fe8b35d2c`
and source SHA-256 `6da236594212b352d030fa9e554f04c31f8ba2bc86f9a66785c56f73ee4cd348`, matching
the current `mcp_host.py` bytes. Public catalog remains 81 unique tools with the unchanged hash above.
App-published CBM works after reload; one frontend (30328) is owned by MCP and one native child daemon
(29452) is owned by that frontend. No direct CBM maintenance was performed.

The loaded deck still has 11 Cards and 10 wires at revision `f1805643-9eea-4643-b419-4386f1dfcb39`.
Every Card's `inspectOnly` status read returned HTTP 200 through `/api/cards/run`. Existing Magentic-One
and WorldSignals latest Runs are failed; the other nine retained results are completed. These are
historical results, not new execution tests. Main's native driver reports ready; editor options and
Hermes terminal listing return 200. Missing external-Main process secret returns 401, unknown Hermes
execution context returns 403, and the retired global Coder route returns 404. Agent Canvas and its
saved Card labels render in the browser. No prompt, settings or graph layout was edited there.

Remaining startup observations are separate from the route repair: the default Hermes gateway
warned that root AGENTS.md exceeds its 20,000-character context limit, and reported unavailable optional
tools. This does not establish the effective Builder Card catalog. Native SQLite fallback/deprecation
warnings and historical missing-deck lookups also remain; no vendor upgrade or policy rewrite was made.
The fresh selected-plugin snapshot and real Main/child model work remain separate acceptance steps.

The later design-review update changes canonical documentation only. Three focused Builder-guidance
and real-PLAN boundary tests pass (7.93s); the selected product vision remains exactly 1,212 UTF-8
bytes, excludes the roadmap and graph-test section, and has content SHA-256
`2e5a8717c25f6e0fa77ff8bd3688dca5c4c134b0593955f56343becf299c36df`. `git diff --check` passes
with existing line-ending warnings. No additional reload, agent run or graph write was performed.

## MVP target and delivery order

The MVP is a usable saved-Card application: ask Main, use appropriate tools or connected Cards,
inspect useful results and native graph evidence, retain the right knowledge, and resume the work
without losing configuration or history. Collaborators must be able to understand and exercise that
loop through the existing app and authenticated plugin. Passing builds is a prerequisite, not the
whole product. Trading remains an application on this shared platform, not the identity of its agent,
graph or editor implementation. The recorded longer-term Trading-delivery/platform split remains a
product direction; it does not expand this September 10 scope or authorize live trading.

### Main conversation and continuity first

Main must answer ordinary requests directly at the necessary depth, use relevant graph/source context,
and delegate when the assignment benefits. Its permanent chat/voice surface, native session, history,
Stop and selected Card/Run inspection must remain understandable and work together. Saved parent and
child models, tools, prompt, Script, skills and memory configuration must reach the actual native Run
without another prompt owner or silent fallback. Existing historical execution proof is retained;
new loaded behavior needs a bounded real task before declaring Main ready again.

Acceptance: a useful ordinary answer, a grounded tool-assisted answer, correct saved settings in the
native receipt, truthful usage or explicit missing measurements, recoverable result/history, and
same-Run cancellation proof where supported. Inspect Main's automatic graph preload and compact Script
against actual useful input, not an arbitrary token-reduction target. Honcho success remains separate
from Main's ability to complete when that optional service is unavailable; do not reconnect it here.

### Builder and the ordinary Card workflow

After Main's baseline, resolve the old Cards' retained-history removal contract and activate the exact
`builder` Card/profile without importing old private state. Review its current tool inventory and the
proposed general create/edit contract in ARCHITECTURE before changing those tools. Builder must work
as a general author/implementer; Card creation is one capability, not the reason every task must exist.

Acceptance: an ordinary read-only assignment and Main-to-Builder handoff through actual tools; then
an authorized create and edit with full configuration readback, exact requested names, preserved
unspecified fields, profile isolation and honest revision conflicts. Agent UI/pages use existing
workspace/native tools and saved Card ownership. A saved configuration is not proof its agent runs.
Verify the inspector and Builder agree on IDD fields, live model/tool choices, skills, Script and
supported configuration; do not rebuild those catalogs in parallel. Keep the single Python IDF.

### Useful graphs and context

ThinkGraph must retain attributed project intent, accepted decisions, unresolved alternatives and
relevant operational knowledge. KnowGraph must retain useful sourced evidence with dates, entities,
claims and provenance. Main must retrieve and apply that knowledge in a later task. CodeGraph and
AgentGraph retain their existing structural and lineage purposes. Accepted graph layout stays fixed.

Acceptance: inspect the source passage, stored note/fact, entity/relationship evidence, later native
recall, materialized context and resulting answer. A visible graph or successful write alone is
insufficient. The graph-entry comparison below determines which intake strategy deserves adoption;
neither automatic pairs nor a combined Graph Card is approved for production by this plan update.

### Existing execution capabilities after the core loop

Preserve ordinary Hermes and AutoGen Cards, selected native delegation, immutable per-Run Script,
native profile learning/memory and subsystem attachments. Prove only the capabilities needed for the
chosen MVP scenario, through their current owners. Hermes Team is internal Card execution; native
AutoGen Magentic-One is a separate saved topology/controller path. Do not recreate a scheduler or
private ledger projection. Magentic-One execution remains on hold until explicitly resumed.

Acceptance when authorized: receiving-Card input/settings, actual root/child models and tool calls,
parent/child lineage, one result delivery, failure/rejoin, and bounded same-Run cancellation. Later
Magentic-One proof uses actual eligible saved edges; the requested old Coder removal means historical
rosters are not the future roster. PlanFlow cannot execute invented task objects; retain its honest
unavailable state until a separately approved real execution path exists.

### Collaborator and existing-plugin acceptance

Keep the canonical stack/build/test instructions reproducible, document current owners and meaningful
failures, and inspect the final source/diff without discarding unrelated work. Exercise the existing
plugin only after the remaining Card/profile and native behavior proofs. Check fresh public schemas,
private-tool absence, authenticated project identity and actual task results. Saved graph data,
history, credentials and native process ownership must survive. Git save remains an explicit owner
action after review. The longer roadmap adds no new service, workstream or permission to publish.

## Agent Builder product vision

Builder is a general Hermes agent for building and improving prompts, agents, agent apps, UI pages
and webpages from the actual user or Main assignment. It chooses appropriate selected tools and
skills. Research, explanation and code investigation do not require a create/edit operation.

For Card creation or editing, read the current Card and applicable IDD definitions, use the actual
create/edit tool schemas, and retain supported runtime/model choices, saved grants and revision
checks. A new Card does not require an existing target. Do not impose AutoGen-only creation or
prompt/tools-only editing. When an explicit operation carries approved fields and revisions, honor
that exact operation. Use current catalogs rather than inventing tools or silently substituting them.

Use CBM for covered repository work and complete current source for the affected boundary. Missing
coverage permits bounded direct-source discovery. Use selected native tools for implementation and
verification. Preserve unrelated Cards, profiles, sessions, graph data and authentication. Report
actual changes, artifacts, readback and proof; saving configuration is distinct from a successful Run.

## Collaborator readiness and cleanup sequence

The heading is retained for existing links; the work is demonstrated defect repair and readiness,
not cosmetic rewriting. Follow [CBM discovery](skills/codebasedmemory.md), then complete source and
inverse callers. Pick one observable defect, prove the baseline, make the smallest complete repair,
prove the affected preservation set, typecheck the production boundary and inspect the exact diff.

[ARCHITECTURE.md](ARCHITECTURE.md) maps routes, Card/IDD/IDF, terminal and graph owners.
[DONT.md](DONT.md) retains complaints and successful repairs from the Constellation transition.
Fourteen restored procedures were reviewed against current owners; history is evidence, not permission
for bulk restoration, obsolete tooling, automatic graph writes or old approval machinery.
The accepted graph layout and recovered controls remain the baseline. Do not reopen them based on a
filename or a speculative architectural preference.

## Controlled agent test plan

Agent testing comes later under [the stand-in procedure](skills/double-agent-standin-skill.md).
Evaluator instructions/results stay outside product prompts, profile memory and graphs. Real actors
receive only the frozen task and actual selected Card context. Do not run these cases in this audit.

### Main baseline before Builder acceptance

Start later live acceptance with case A through the real saved Main path, following the owner's
Main-first priority. A Card-matched external stand-in is a separate comparison and remains blocked
where its host cannot supply Main's exact Script/profile-delegation interface. Do not use an external
approximation as proof the app works. No model test is authorized to launch in this documentation audit.

### Builder single-Card dispatch candidate

Use the final saved `builder` Card for one read-only repository question: identify the current owners
of the Card editor, saved execution and Builder terminal, with real source references. The Card must
perform an actual selected `canvas.inspect` or CBM read. Exactly one fresh-context stand-in mirrors
that Card; no helper, controller or hidden synthesis actor. Expected result: correct existing owners,
no source writes, no fabricated tool availability and no required create/edit operation.

The intended parent is `gpt-5.6-sol`, child model `gpt-5.6-luna`, native delegation off. Resolve the
final saved Card ID/revision, prompt hash, profile, grants, skills, Script, effort and native toolsets
at launch. Current old Builder has no saved effort override, blank disabled Script and 14 MCP grants;
that is not a launch record for the new Card. Missing effort is native default/unknown, not low.
Use target90s/hard180s, at most4 model requests,6 tool calls and3,000 output tokens per arm. Confirm
same-Run cancellation and child cleanup before launch. Never change saved settings to make parity fit.

### First multi-role dispatch candidate

After the single case works, use the smallest actual Main → `builder` flow. Main supplies the bounded
question, Builder performs the source work, Main returns a grounded answer. N=2 only if native
execution creates no other software role. Main handles both conversation and synthesis in one role;
do not invent another synthesizer. Mirror two fresh actors with explicit directed handoffs. If the
real native graph differs, recount N and change the record rather than silently dropping roles.

Current Main is `card_main_chat`, `liquidaity-main`, `gpt-5.6-sol`, child `gpt-5.6-luna`, delegationRole
profile. Its enabled Script v2 exposes a compact native `execute_host_script` for selected reads.
Codex currently lacks that exact native interface and the profile-delegation doorway. These are
unsupported parity settings, not equivalent to standalone MCP calls. Card-replacement topology,
native context/skills, effective effort and cancellation remain unresolved. The case is not
launch-ready; do not substitute a manual handoff and claim native integration proof.

Measure actual work, time from submission, per-request usage, tools/results, context sources and
handoff loss. Aggregate once per request ID; record unavailable counters as unknown. Keep role-task
quality, integration parity and runtime performance as separate verdicts. Host capacity changes waves,
not the required number of actors. A failed or unsupported first arm does not justify a larger run.

### Future case inventory

The following definitions are ready for scenario resolution, not claims that current saved models
or team counts have already been read. Exact values must be filled before dispatch. One stands in
for each actual participating role; counts expressed as N below must resolve to an integer roster.
Targets are proposed expectations, not measured performance or permanent Card restrictions.
Later execution starts with Main's baseline, then the eligible Builder single-Card case and smallest
safe multi-role case after their prerequisites. No case executes in this audit. Do not run the entire matrix.

| Case and purpose | Participating scenario, input and actual tools | Expected product/native result | Time/call/output budget | Pass, fail or inconclusive |
| --- | --- | --- | --- | --- |
| A - Main ordinary fast response | Saved `card_main_chat`, current runtime/settings; one ordinary bounded request answerable with one granted read where available; no requested delegation. One role, one stand-in | Useful short answer grounded in an actual returned result, correlated Run and real tool receipt; no unnecessary worker barrier | Target first useful text <=10s and completion <=30s warm; hard120s per arm; <=3 model requests, <=4 calls, <=2,000 output tokens | Pass useful answer and real permitted call; fail unsupported facts, needless waits or deadline. Unexpected delegation means this was not a single-role proof |
| B - Final-provider-input weight | Retained Main input and receipts first; existing materializer, runtime projection and final request boundary. Replay uses zero stand-ins; an authorized capture inherits A's one actor | Account for supplied context and exact same-request duplicates where present; distinguish metadata, cached reuse and useful content | Read-only analysis <=10min; zero new model calls; a live capture shares A's budget | Pass source/receipt accounting; missing final payload is inconclusive, not permission to remove schemas |
| C - Ordinary selected-tool Card | Resolve one enabled saved single-role Card with a safe selected read and clear task; exactly one actor; same selected tool interface | Complete the task using the actual granted tool, relevant facts and native references; no extra host capability | Target <=60s; hard120s per arm; <=3 requests, <=4 calls, <=2,000 output tokens | Pass real call and required assertions; fail extra tools, fake results or altered settings. May serve as the selected single-Card proof if A cannot |
| D - Agent Builder direct run | Resolve actual Builder Card/profile and direct Run doorway; bounded read-only repository/IDD question, no source or Card edits; one actor if native configuration invokes no additional roles | Full capability preserved, focused source-backed answer through actual tools; no Local Coder state or identity substitution | Target <=90s; hard180s; <=4 requests, <=6 calls, <=3,000 output tokens | Pass actual Builder result and selected context; fail invented restrictions, IDD leakage or wrong Card. Extra native roles require exact N and cease to be a single-Card case |
| E - Downloadable Coder (deferred; old Card removal requested) | Only a proven operational current Local Coder entrance and explicitly selected local repository; read-only code question using selected CBM/source tools; N actual roles | Correct folder/owner, real references, separate profile/session; no Agent Builder palette or modification | Target <=90s; hard180s per role, <=6 requests/8 calls per arm, <=3,000 output tokens | Missing real entrance is blocked; never restore an old runtime to make the case runnable |
| F - ThinkGraph-aware conversation | Main plus only the actually invoked graph role(s); real preserved conversational material and useful existing native references; N actors | Relevant attributed intent/uncertainty informs answer and later use; no fake entities, operating instructions or immediate readback loop | Main target <=30s; hardMain120s, graph role240s, arm300s; <=8 requests/12 calls total, <=4,000 output tokens | Pass useful supported context and correct IDs; wrong attribution/meaning fails. Empty useful data makes recall proof inconclusive; do not fabricate a fixture |
| G - KnowGraph research | Real existing research Card with Main only if participating; preserved actual links/page evidence; selected web/Graphiti tools, N actors | Source-backed answer or real retained knowledge where writes authorized; provenance and source dates; distinguish URL fetch, parsing, extraction and recall | Main useful response <=60s; hardMain120s, research300s, arm360s; <=8 requests/12 calls, <=6,000 output tokens | Fail repeated unnecessary research or bare URL claimed as parsed content. Queue receipt alone is incomplete; no unapproved graph writes |
| H - Mag One multi-role team | Resolve current saved eligible topology, controller/planner, actual workers and synthesizer; include Main only if it participates. Exactly N actors, no invented roster or fixed team size | Each real role works, supported handoffs reach intended recipients, final answer grounded in worker results; native root/child receipts and explicit mirror handoffs | Target <=180s arm; hard120s per role/360s arm; <=3 requests and4 calls per role; aggregate input review point declared from N before launch; <=2,000 output tokens per role | Pass one-for-one count, isolation, handoffs and useful outcome. Waves limit speed parity. Missing exposed role context or safe native path blocks exact behavioral parity |
| I - Failure and rejoin | Existing retained failure or one safe bounded invalid read; actual affected Card/roles, N actors if live; existing status/rejoin tool only | Honest failure, stable operation identity, no duplicate launch/write, previously retained result recoverable; no synthetic success | Prefer replay zero models; live target <=60s, hard120s; <=3 requests/5 calls, <=2,000 output tokens | A timed-out status read must not become false child failure. Do not disrupt a service or cancel unrelated work to create a test |
| J - Tool/model optimization | One quality-passing baseline above and the smallest justified changed test surface or explicitly selected available stand-in model; same N and task | Required output/actions preserved, context/time/cost measured and differences explained; saved Card unchanged | Reuse baseline case limits; one alternative arm, no matrix; actual receipts or unknown | Improvement requires preserved quality and measured evidence. Different runtime/tools prevent a model-only claim; changing saved grants to win is forbidden |

For single-role A/C, use a 75,000 aggregate-input-token review point; other simple cases use
150,000 per arm. For multi-role work declare a finite aggregate budget from the actual N and task
before dispatch, rather than multiplying an unknown team size or silently truncating roles. Stop
before the next request when a declared review point is reached, using available receipts; an
in-flight request can exceed it. If counters are unavailable, enforce observable time/call limits
and report missing usage. Do not install token-limiting code in Cards.

Hard deadlines start at submission, including queue/startup. Use existing supported cancellation
for the same Run; verify whether it stopped and whether children remain. Never restart to hide a
failure. One failed command gets one different read-only diagnosis and one retry only after a
specific repair. Do not rerun unchanged tests or repeatedly poll an unchanged status. Ordinary
commands stay under60s; announce the purpose and bounded maximum of a necessary longer build,
then monitor that one command.

## Graph and attention plan

Accepted graph layout is frozen. ThinkGraph remains Engraphis, KnowGraph remains Graphiti/Neo4j,
CodeGraph remains CBM, and AgentGraph remains AGE. Automatic completed-chat-pair extraction is removed;
Main selects explicit writes or delegates focused graph work. Do not reintroduce automatic replay or
KnowGraph promotion. Preserve sourced knowledge and project intent without turning evaluation chatter
into memory. Semantic attribution, useful retrieval, native context consumption and Reveal pacing
still need real task evidence; node counts and static tests cannot establish them.

A combined Graph Card is a final-review decision, not another implementation stream now. Existing
research and ThinkGraph Cards, native data and selected writes remain unchanged.

### Graph-entry comparison proposed September 10

The owner reopened post-chat pairs as a candidate for evaluation, not an instruction to restore the
removed automatic pipeline. A pair is a source unit; direct write or delegated extraction is an
execution choice. These are not mutually exclusive architectures: a focused ThinkGraph task can
receive an attributed completed pair. An always-on trigger is a separate decision.

| Candidate | What to compare | Principal question |
| --- | --- | --- |
| Main writes a concise note with `engraphis_remember` | Current direct path; Main states the knowledge and calls the native writer | Does it preserve needed context and relationships without writing every chat exchange? |
| Main calls `engraphis_ingest` with bounded source material | Current native structured extractor; saved ThinkGraph model supplies the extraction completion | Are facts/entities/relations more accurate than a direct note, and is the additional work justified? |
| Main delegates reconciliation to ThinkGraph | Current saved Card reads relevant memory, receives attributed material and chooses native writes | Does correction, context and deduplication improve enough to justify another agent's work? |
| Completed-pair source supplied explicitly to the existing extraction path | Candidate experiment only; keep exact user/assistant roles, order and available source references | Does fuller context reduce omissions without treating assistant proposals or evaluation instructions as facts? |

Do not compare all changes at once. First inspect a small owner-selected body of real retained material
and existing graph results without writing. Cover accepted decisions, unresolved proposals, negation,
later correction, repeated entities and supported research. Record the expected knowledge separately
from actor input; evaluator criteria never enter product memory. Do not invent product facts to fill
a test. If independent write arms cannot be isolated through an existing supported native boundary,
report that limitation and resolve it before writing; do not reset the accepted graph, copy its store,
launch another stack or invent a tenant ID. Research/source reuse should also respect its existing scope.

Then, only after explicit execution authorization, compare one current path and one alternative on
the same eligible material and comparable initial knowledge. Record natural Card/model choices; if
models, prompts or prior graph state differ, attribute that difference rather than claiming a pure
intake-method comparison. Begin with source-grounded content, not a bulk replay of historical chatter.
An automatic hook, new persistent pair queue or broad historical ingestion is not part of the test.

Engraphis already combines structured LLM extraction with its configured regex graph extractor.
Regex can recognize names and regular text structure, but the native relation heuristic uses nearby
entities; it is not proof of negation, speaker attribution or acceptance. After the first method
comparison, a separate authorized native regex-on/off comparison may establish its incremental value.
Keep the structured extractor, source material and other settings fixed; do not replace semantic
reasoning with another stopword list or keyword policy. A direct memory write can still invoke native
graph enrichment, and a successful stored note does not guarantee successful or useful enrichment.

Audit evidence: a memory-free native regex call returned the same positive `uses` relationship for
`Acme uses Graphiti.` and `Acme no longer uses Graphiti.` No graph store or model was invoked. Include
negation/changed decisions in the later real-material comparison; this demonstrates the heuristic's
limitation without claiming it caused every previous bad graph or changing the installed extractor.

Judge each arm by supported retained facts, missed useful facts, wrong attribution, lost uncertainty,
entity splits/false merges, meaningful directed relationships, source/date provenance, duplicate and
correction behavior, then useful recall in a later independently phrased Main task. Inspect retrieval
and IDF context before blaming generation. Keep storage, graph enrichment, recall, answer quality and
visual event truth as separate outcomes. A queued Graphiti episode is not completed extraction;
Engraphis `extracted: false` or an extraction-fallback receipt is not successful structured extraction.

Measure submission-to-first-useful-answer and completion latency, tool work, extraction requests,
delegation requests, usage/cost where available, and selected context bytes/relevance. An Engraphis
extractor completion is real model work even without a separate saved Card Run. A delegated ThinkGraph
Run may call that extractor as well: count both without double-counting one provider request. Unknown
counters remain unknown. Carry successful observations into the existing stand-in procedure; defer
any automatic trigger or Card consolidation decision until these results exist.

## Product boundary

Continue the one saved-Card/Run product: ask, select a Card, provide dynamic input and deliberately
selected native references, execute through its saved native owner, inspect the result, and reload.
Python `idf.materialize_idf` owns the one retained/reloaded UTF-8 `in.idf`; TypeScript transports and
renders it. IDD remains the literal `LiquidAIty.idd` definition source. Consumer parity is still
unproven. Generic parameterized SQL/Cypher remains retained; no per-query wrapper system.

Main conversation/voice stays permanent. Builder owns its lower terminal and implementation tools.
AutoGen 0.7.5 and Hermes remain existing execution owners; private Magentic-One ledgers stay private.
PlanFlow Run Task remains unavailable until approved task-node execution is truly wired. Do not infer
execution from text or fake task objects. Further product ambitions remain in [FUTURE.md](FUTURE.md).

## Plugin refresh and owner-save readiness

Before refresh: finish the outstanding Card/profile changes and general Builder tool proof; review
focused tests, source/diff, docs and native history preservation. September 10 canonical reload and
loaded route/catalog readback are complete above; new Python changes would need the same owner
lifecycle again. No additional restart is needed for this documentation-only review. Do not launch
another stack or silently reconnect credentials.

Then the owner may refresh the existing plugin. Verify in a fresh selected-plugin context: authenticated
Main scope, startup/source identity, exact public names and schemas, private-tool absence, unchanged
OAuth and grants, and removal of obsolete cached descriptors. Current source/unit tests are not that
proof. Do not create another plugin, publish, stage, commit or push in this task.

Final review items: retained-history handling for the requested Card deletions; exact new Builder
activation and general tool authorization; native default effort/tool availability; stand-in Script
and profile-delegation parity; cancellation; possible Graph Card consolidation. Separate decisions
from observed defects. Return the CoderReport in conversation, not in another handoff file.
