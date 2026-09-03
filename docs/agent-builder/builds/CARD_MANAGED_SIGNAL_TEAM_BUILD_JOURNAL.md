# Building a Card-Managed Signal Agent Team

This journal records externally observable construction decisions for the first repository-backed
signal team. It contains no hidden reasoning, credentials, raw transcripts, copied graph data, or
fabricated runtime receipts.

## Requested capability and preservation boundary

- Preserve `card_worldsignals_agent`, its Shadowbroker-backed command/event path, presentation,
  position, grants, and Mag One edge.
- Add exactly one future saved Hermes parent for the globe-first experience: **WorldView**, profile
  `worldview`, with God's Eye as a supervised presentation/realtime subsystem.
- Add a separate **Signal Analyst**, profile `signal-analyst`, and add **Quant Analyst**, profile
  `quant-analyst`, only through the canonical authenticated saved-Card path.
- Let a granted Card obtain one read-only, bounded, provenance-rich `signal.package.v1` directly, or
  request the existing WorldSignals Card through an explicit wire when source-specialist monitoring or
  watches are needed.
- Keep Trading, Main, Agent Builder, Graph Agent, System 3, providers, saved data, and unrelated dirty
  work unchanged. No broker, order, portfolio, Team, Kanban, or Mag One execution belongs to this build.

## Task ledger

| Task | Owner | Starting anchors | Expected observable result | Proof | Status | Mutations |
|---|---|---|---|---|---|---|
| P0-T1 | Coder | repository law, prior audit/proof documents, current diff, saved Card routes | Trading frozen; source/presentation/runtime authorities separated | read-only Git/source/CBM audit and license inspection | complete | none |
| P0-T2 | Coder | WorldSignals client/route/embed, God's Eye source archive | adopt/reject decision and hardest boundary recorded | public seam and license audit | complete | none |
| P1-T1 | Python rails | `worldsignals_client`, tool registry, IDD | one live-manifest-gated read becomes a typed scoped package | focused contract/client tests | complete | signal contracts and package operation |
| P1-T2 | Python rails | authenticated MCP execution context | model cannot author project/Card/Run scope or invoke a write command as a read | dispatch and schema tests | complete | context injection at existing host chokepoint |
| P2-T1 | UI/vendor adapter | Card-owned rail, companion surface, God's Eye data manager/events | isolated globe, source state, evidence drawer, evidence flight | component tests, host-bridge tests, vendor build | source-complete | WorldView surface and bounded bridge |
| P2-T2 | saved-Card authority | authenticated deck save/readback and Hermes materializer | WorldView, Signal Analyst, and justified Quant Analyst exist independently with Luna/Team-off policy | revisioned API readback and native profile proof | complete | canonical saved Card/profile state |
| P3-T1 | canonical stack | one authorized reload | exact service/catalog/source identity and real harmless source receipt | readiness plus source receipt | blocked at source health | no source mutation |
| P3-T2 | Hermes/UI | real package and normal saved-Card doorway | same package visible to human and assessed by specialist | Run/IDF/provider/UI receipts | source-ready / live blocked | no fabricated Run/artifact state |
| P3-T3 | Coder | final worktree and persisted state | zero unexpected Card/edge/trading/provider effects | inverse audits and sequential tests | complete for implemented slice | none |

Only one ledger task is treated as in progress at a time. A later entry records the loaded-runtime
outcome rather than retroactively describing unproven target behavior as current.

## P0 source and graph decisions

### Source anchors

- Canonical WorldSignals read boundary: `WorldSignalsClient.request`, its HMAC headers, the live
  `/api/ai/tools` manifest, command guard, command channel, poll, and SSE methods.
- Existing human source surface: `WorldSignalSurface` and its authenticated health/embed path.
- Canonical saved identity: deck/Card state and typed `flow` / `magentic_option` edges.
- Canonical Hermes seam: saved runtime/profile/model/tools/skills materialized and read back at Run
  start; no WorldView-only agent runtime was introduced.
- Presentation seam: Card-derived rail visibility and the companion surface host.

The application-published CBM sequence was completed for the WorldSignals/UI, signal tool/envelope,
rail/presentation, and Hermes-profile families. God's Eye and the imported WorldSignals roots are
excluded vendor/source authorities, so their complete relevant source was read directly rather than
changing `.cbmignore`, indexing a second project, or operating CBM lifecycle.

The post-start UI follow-up attempted one application-published `cbm.search_graph` refresh for
`client/src/features/worldview/.*`. It timed out after 30,047 ms with a failed native execution receipt
(`mcp:bfddd961-7243-49f8-b04e-5442e23c7356`), no provider calls, and no substitution. No retry,
frontend/daemon lifecycle, or index maintenance followed. The final follow-up audit used the earlier
resolved slice plus current direct source; post-change graph freshness is not claimed.

### Adopted upstream seams

- Shadowbroker/WorldSignals stays the source/monitor subsystem. Its existing manifest, HMAC command
  channel, task polling, and event stream are reused. Restricted recon/SIGINT/mesh commands stay
  excluded unless an operator explicitly enables the existing extended profile.
- God's Eye stays the native round-globe renderer and interaction application. Its `DataManager`
  subscription, entity selection events, Cesium camera, layer registry, and native Realtime/voice
  controller are composed through one opt-in `postMessage` bridge.
- The native Realtime/voice agent remains available and independent. Embed mode reports it and keeps
  activation user-initiated; Hermes does not silently start it or run a competing plan.

### Rejected alternatives

- No merged WorldSignals/WorldView Card: monitoring and human spatial discovery have different
  lifecycle, presentation, and permissions.
- No second God’s Eye parent Card: WorldView is the one saved parent; God’s Eye is its named subsystem.
- No copied globe, second signal database, deterministic semantic router, or abstract adapter framework.
- No additional H3, River, deck.gl, Kepler.gl, WorldMonitor, VectorBT, or broker dependency: the
  selected sources already cover this slice. WorldMonitor is treated only as a superseded V1 idea;
  God's Eye plus Shadowbroker provide the current visualization, interaction, and source foundation.
- No TeleGeography submarine-cable layer in the distribution because its CC BY-NC-SA data terms are
  not a safe commercial default. ODbL and CC-BY sources still require their native attribution.

### Canonical ownership

- WorldSignals owns source collection and its native task/event state.
- A `SignalPackage` is bounded Run output, not durable global signal authority. Its content-addressed
  source reference, package ID, query, scope, timestamps, and provenance can be retained through the
  existing Run artifact catalog when a real Run emits it.
- AgentGraph may observe Card/Run/reference/artifact lineage; KnowGraph owns accepted external sourced
  knowledge; ThinkGraph owns accepted hypotheses/plans. No fourth graph or new persistence schema was added.
- Python rails validates and executes the source read. TypeScript transports and renders exact typed
  fields. God's Eye renders and emits bounded interaction state; it does not grant access or plan work.

## P1 typed data path

`signal.query.v1`, `signal.candidate.v1`, `signal.package.v1`, and `signal.assessment.v1` use strict,
frozen Pydantic contracts. IDs derive from canonical serialized content. Query scope includes exact
project, deck, requesting Card, and requesting Run. Candidate provenance includes the native source
reference, retrieval method, content hash, and optional source license/attribution. Observation,
hypothesis, and assessment are separate fields.

The private `worldsignals.package` operation exposes only query fields to the model. The existing
authenticated MCP context injects project/deck/Card/Run identity and rejects model-supplied scope.
Immediately before dispatch, the adapter reads the live WorldSignals manifest and accepts only a
command explicitly classified `read`; existing command guards still enforce the restricted-command
boundary. The returned package contains at most the requested bounded result and never copies source
memory, sessions, watches, or WorldView state.

This enables two legitimate consumption modes:

1. **Direct read:** an independently running Analyst or Quant Card with a saved
   `worldsignals.package` grant requests one scoped package. This is the shortest evidence path.
2. **Source specialist:** Main or another explicitly wired Card invokes the preserved WorldSignals
   Card when the job needs monitoring, watch/task lifecycle, command choice, or source-specialist
   reasoning. The receiving Card still owns its Run and IDF.

The caller may not widen WorldSignals permissions through either mode. God’s Eye selections are
display references and possible inputs to a later Card Run, never ambient grants.

## P2 Card and presentation design

### WorldView

- Runtime/profile: ordinary Hermes delegate, `worldview`; parent model account-backed Luna; Team off.
- Stable prompt: discover and explain bounded sourced observations; distinguish facts, hypotheses,
  and analyst results; preserve provenance; refuse to invent location, freshness, or confidence.
- Skills: native `grounded-citations` initially; future globe/source skill only after a real reusable
  lesson is proven.
- Tools: `worldsignals.capabilities`, `worldsignals.package`, and other explicitly saved read-only
  search/reference tools required by a mission. No write command, trade/order, shell, broad files,
  graph administration, orchestration, or skill self-edit grant.
- Presentation: WorldView globe and evidence drawer. Named God’s Eye tab owns subsystem readiness,
  layers, and the user-initiated native Realtime/voice lifecycle.
- Edges: optional explicit source request to WorldSignals; Main/Mag One coordination remains outside
  the Card runtime. A Mag One option is added only after independent proof.

### Signal Analyst

- Runtime/profile: ordinary Hermes delegate, `signal-analyst`; account-backed Luna; Team off.
- Input/output: one `signal.package.v1` or a bounded package query; one linked
  `signal.assessment.v1` with method, observations, inference, evidence, limitations, freshness,
  confidence, and `SUPPORTED | WEAK | REJECTED | INCONCLUSIVE`.
- Authority: read-only source package and mission-approved research. No monitoring writes, trading,
  orchestration, source-state mutation, or WorldView authority.
- UI: ordinary Card/Run evidence and artifacts; WorldView may render the returned assessment without
  editing it.

### Quant Analyst

- Runtime/profile: ordinary Hermes delegate, `quant-analyst`; account-backed Luna; Team off.
- Input/output: one bounded package plus suitable numeric observations; a quantitative linked
  assessment, or `INCONCLUSIVE` when sample, baseline, time alignment, or units are insufficient.
- Tools: only existing read-only market/statistical tools and the scoped package read. No orders,
  portfolio mutations, broker access, strategy lifecycle, or decision-to-trade authority.
- UI: numerical method, sample/window, uncertainty, limitations, and linked evidence in ordinary
  Run artifacts; optional WorldView assessment lens later.

The three new Cards were created once through the canonical authenticated revisioned Deck API and are
identified in the loaded-runtime acceptance below. Component fixtures prove rendering only and are
never called live data.

### Creative features selected

- **Evidence flight:** selecting a genuinely geographic candidate sends a Card-scoped, coordinate-
  validated camera request to God's Eye and opens its evidence chain.
- **Agent lens:** the drawer visibly separates source observation, optional source/agent hypothesis,
  and an independently linked analyst assessment. Non-geographic candidates stay evidence-only.

## Material mutation ledger

- Signal contract/client files: added strict reusable envelopes and live-manifest-gated packaging.
- IDD/tool registry/MCP host: published one private read operation and injected authenticated scope
  at the existing execution chokepoint.
- Backend WorldView route/types: authenticated presentation readiness and saved subsystem shape.
- WorldView UI/rail/host files: Card-derived entrance, globe surface, explicit source state, evidence
  drawer, evidence flight, and strict readback of the latest completed WorldView/Analyst Run outputs
  through the existing authenticated Card status route.
- God's Eye fork: supervised embed host bridge, keyless OSM fallback, first-run suppression in embed,
  and incompatible cable-layer omission. Standalone/native voice behavior remains.
- Root service scripts: the one canonical process tree supervises the isolated globe service and
  includes it in canonical stop ownership.
- No database migration, graph writer, second signal store, provider adapter, or trading file was added.

## Proof and repair log

- Initial Python invocation used the repository root `.venv`, which does not exist. The correct
  existing Python rails environment is `apps/python-models/.venv`; no environment was created.
- Signal contracts: 4 focused tests passed.
- WorldSignals client: 14 focused tests passed.
- Tool registry: 10 focused tests passed after adding the private package operation.
- Authenticated MCP context: 2 focused package tests passed; 82 unrelated cases were deselected.
- God's Eye host bridge: 4 tests passed. Its production build completed with 156 modules; existing
  Node browser-externalization and large-chunk warnings remain visible.
- WorldView component: the first run found only missing jsdom cleanup in the new test. Adding the
  standard cleanup isolated renders. Six tests now pass, including strict typed readback from two
  persisted Card Run status responses, rejection of ordinary prose as a signal package, and rejection
  of cross-project package scope. An initial
  heavily loaded run printed its passing summary after 181 seconds but needed interruption to release;
  the final single-worker, sequential rerun exited cleanly with all 6 tests passing in 24.00 seconds.
- God's Eye host component: 6 tests passed.
- Card-derived rail: 10 tests passed across rail and visibility specs.
- Authenticated readiness route: 3 tests passed.
- Reusable Hermes profile materialization: 3 focused tests passed for missing-profile creation,
  explicit skill narrowing with the native essential skill preserved, and fail-closed missing-skill
  readback.
- Hermes native-manager allowlist: 2 focused bridge tests passed in the Hermes-owned virtual
  environment.
- Existing configured-Card transport: 1 focused Coder preservation test passed with its explicit
  saved skill forwarded.
- Client and backend production typechecks passed independently. Client production typecheck passed
  again after the persisted-output UI seam and strict JSON parsing changes.
- `git diff --check` passed; the existing Windows line-ending warning for `LiquidAIty.idd` remains.
- God's Eye declares Node `>=24.14.0`, while the current host is Node `20.19.4`. Build proof passes on
  this host, but the engine mismatch and the prior `npm audit` result of 9 high findings remain release
  risks; no automatic audit fix or dependency rewrite was applied.

## Agent Builder reproduction candidate

Do not automate this journal or modify Agent Builder from unproven work. A later reviewed Agent Builder
improvement could make the following checklist an explicit, evidence-backed workflow:

1. Freeze the requested delta, preservation set, authority owners, and exact existing Card/topology.
2. Find the repository's public seam, license, notices, native lifecycle, cancellation, data rights,
   update path, and independent provider calls before adopting it.
3. Keep the imported repository native; put the smallest typed adapter at the existing Python rails,
   transport, or presentation boundary that actually owns the missing capability.
4. Define strict Card/project/Run-scoped inputs and outputs; separate sourced observation from model
   inference and retain content-addressed provenance.
5. Prove the source adapter without UI or new Cards.
6. Add one saved Hermes parent only when it owns a distinct mission/lifecycle. Keep internal repository
   agents bounded, visible, and optional; exactly one layer owns each plan.
7. Create saved Cards only through canonical authenticated revisioned APIs. Read back the entire deck
   and prove all prior Card/edge bytes unchanged apart from explicit additions.
8. Materialize saved profile/model/skills/tools at normal Run start and read them back. Never edit
   profile files or substitute a provider.
9. Prove one harmless real operation and the exact same identity through source, artifact/Run, and UI.
10. Run inverse audits for source mutation, provider calls, graph writes, unrelated Cards/edges, and
    domain side effects. Report partial when a live link is absent; never replace it with a fixture.

Candidate later enhancements for Jeremiah to review: a structured repository-intake panel, a native
subsystem-facet selector, saved prompt/tool/skill templates that remain ordinary Card fields, a
license/provenance checklist, and a proof-receipt comparison view. Main voice mode is a separate future
Card/runtime task and is intentionally not part of this WorldView construction.

## Loaded-runtime acceptance

Exactly one canonical `npm.cmd run dev:fresh` reload was performed. The application-owned MCP process
reported startup `be4d6cfbf3994ac8bd75cec1580d29dd`, source revision
`ce6eefb465aae213f0dc58e82518c78ad2c143fe`, public catalog `75/75`, and CodeGraph ready. The supervised
God's Eye service was reachable on loopback port 4174 and the authenticated WorldView readiness route
reported `ready`. The loaded route still reported native Realtime/voice `active: false` even though it
had not observed the browser handshake. The final source audit corrected that field to `null` with
`ui-handshake-required`; that correction awaits the next ordinary reload. The browser handshake remains
the runtime authority for available/active state, and its policy is `user-initiated`.

One canonical authenticated Deck save changed revision
`886fd4d3-0277-42b8-9548-6061a42c4d2f` to `21dcdbf5-de59-48d2-b40a-a2794279dc58` and added:

- WorldView `card_713f345e67ce4fbf`, profile `worldview`;
- Signal Analyst `card_13fba035c83b4823`, profile `signal-analyst`;
- Quant Analyst `card_da2591b04e8e41e7`, profile `quant-analyst`;
- one directed `flow` from each new Card to preserved `card_worldsignals_agent`.

The inverse topology audit then found the Analyst and Quant flows unnecessary: those Cards own direct
package-read grants and explicitly lack Card-delegation authority, so the wires could not be exercised.
A second revisioned Deck save removed only the two newly added unusable edges
`edge_f8ee43b1411a4ad4` and `edge_b8394f1e1c764eda`, producing final revision
`d01483ce-300a-4bf0-b655-93a5fec0bbab`. The final 10-Card/7-edge topology retains exactly one new
source-specialist flow, WorldView `card_713f345e67ce4fbf` to preserved WorldSignals
`card_worldsignals_agent` via `edge_df544c3ebdfa4397`. Analyst and Quant consume scoped packages
directly; no pre-existing edge changed.

All three profiles were created through native `profiles.create` with shared account authentication,
then read back through the authenticated Card profile route. Each has account-backed
`openai-codex/gpt-5.6-luna` as parent and subagent model, Luna background review configuration,
profile-local built-in memory/state, the mandatory native `hermes-agent` operating skill, and the one
saved `grounded-citations` skill. All other installed skills are disabled. Team policy remains off;
configuration does not invoke a Team.

WorldView Run `worldview-inspection-4bf6a9d203d1` completed through the normal saved Hermes Card route
and Card revision `086bfa80-f85e-4285-920c-70dbc467991f`. Its canonical IDF hash is
`953136b88bfb7bd8e6651422fdc6615b3931bc8a95be7e23ec21ff91b783f613`. The receipt records Hermes
delegate mode, profile `worldview`, account-backed Luna, 14,214 input tokens, 55 output tokens, no
provider fallback, and one native session `5d728d61-3c4f-4bd5-b011-fea3108444cd`. The reconciled Run
reports zero tool calls, zero graph reads/writes, zero active workers, no Team receipt, and no Card,
watch, broker, order, trading, Auto-Team, or Mag One action. The response truthfully states that no
source data was inspected.

The live Agent Canvas shows the three new saved Cards and the one explicit WorldView-to-WorldSignals
source-specialist flow.
Its WorldView rail entrance opens the real embedded God's Eye application and the evidence drawer. With
no package attached, the drawer says so and shows no sample candidate. This is live presentation proof,
not live source proof.

After the operator started Shadowbroker, both containers initially reported healthy and LiquidAIty's
authenticated WorldSignals health boundary returned `enabled: true`, `status: ok`, and backend
`127.0.0.1:8000` reachable. The separate prior embed bundle remained missing, which does not block the
supervised God's Eye WorldView presentation.

The harmless live trial then attempted only read-side readiness. An initial unauthenticated
`/api/ai/tools` request returned 403. The existing HMAC-capable client was used for subsequent manifest
requests, but the host `.env` secret and the checked container environment/persisted secret file were
empty; no successful authenticated read is claimed. Direct Shadowbroker `/api/health` and
`/api/ai/capabilities` calls repeatedly returned no bytes before their
10-30 second client deadlines. Container logs showed overlapping slow startup and scheduled collectors,
including 80-131 second telemetry tasks, 121-122 second task timeouts, skipped overlapping scheduler
instances, translation rate limits, and an OpenSky authentication failure. At roughly 25 minutes both
`shadowbroker-backend` and `shadowbroker-frontend` reported `unhealthy`. No container, source, secret,
provider, Card, graph, watch, broker, or trading state was changed in response.

The WorldView UI now reads the latest completed WorldView and Signal Analyst outputs from the existing
authenticated configured-Card status route, parses only exact JSON matching `signal.package.v1` and
`signal.assessment.v1`, verifies project/deck/Card/Run scope plus their natural package/candidate linkage
before display, clears old evidence when the context changes, and otherwise
retains the honest empty evidence state. This is source- and component-proven; because Shadowbroker never
reached its read doorway, no real package existed to render live. The two remaining authorized Luna turns
were deliberately not spent against an unhealthy source. No real `signal.package.v1`, Analyst Run, Quant
Run, or analyst assessment was fabricated.

Verdict: **P0 PASS; P1 SOURCE-READY / LIVE SOURCE BLOCKED; P2 PARTIAL LIVE; P3 PARTIAL.** The Card,
profile, Luna model, memory, skill, topology, globe, evidence-empty state, and harmless Hermes Run are
live-proven. Real source-to-package-to-analyst-to-UI evidence remains blocked at the running but unhealthy
Shadowbroker backend. New profile auto-creation and explicit saved-skill materialization are source-ready
and focused-test proven, but were authored after the one allowed reload; the next ordinary canonical
reload will load that reusable seam. No second reload was performed.
