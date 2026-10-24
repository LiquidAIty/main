# LiquidAIty current plan

[Overview](README.md) · [Execution law](AGENTS.md) · [Known failures](DONT.md) · [Current architecture](ARCHITECTURE.md) · [Deferred work](FUTURE.md)

This file records current status and the next approved boundary. It is not runtime input, a task
ledger, a historical report, or authority to begin deferred work.

## Product outcome

LiquidAIty's MVP is a persistent Project workbench where:

- saved Cards own durable identity, prompt, provider/model/profile, grants, and topology;
- Main is the human-facing Project conversation and bounded orchestration agent;
- ThinkGraph compounds Project reasoning in Engraphis;
- KnowGraph preserves sourced evidence and provenance in Graphiti/Neo4j;
- Builder turns Project reasoning and evidence into PromptSpecs, Cards, applications, code, artifacts,
  and executable missions;
- Magnetic executes one approved mission across an exact saved blue worker roster through LiquidAIty's
  retained modified Hermes Team task contract;
- Team is the direct saved-Card/profile entrance to that reduced Team task contract; it does not first ask
  another agent to delegate a Team;
- specialized domain Cards add bounded capabilities without becoming graph authorities.

One canonical `in.idf` carries the exact saved Card revision, current dynamic input, selected provider
references/data, images, and effective grants into Hermes.

## Current source truth

### Saved Cards and new Projects

The server attaches six core Cards to a new agent Project: Main, Builder, ThinkGraph, Magnetic, Team,
and KnowGraph. The default server topology contains Main → Builder and Team ↔ Magnetic only. Client
seed examples also contain optional/domain Cards, but those examples are not the saved-state authority
for an existing Project.

PostgreSQL current Card revisions and grants remain authoritative. A source seed, title, installed
profile, or historical screenshot cannot establish one Project's current configuration.

### Graph context

- The canonical Entity directory is a complete union of separate Engraphis and Graphiti rows. It does
  not persist a merged identity.
- Exact Data Anchors resolve provider-owned IDs and bounded data before Python materializes the single
  IDF.
- `project_graph.list_entities` returns the complete exact directory. The read-only
  `project_graph.read_entity_context` requires exact directory references plus a current query. It uses
  exact provider Entity reads followed by Jev relevance and defaults to one Relevant plus one distinct
  Recent Think and Know.
- The joined graph may visually pair exact same-name provider members without becoming another graph.
- Only Entities render as graph nodes. Thinks and Knows are attached properties; Graphiti episodes,
  citations, and supporting IDs remain evidence/provenance and never become visible Project nodes.
- The Entity inspector defaults to KnowGraph when both authorities exist and shows at most two current
  provider-projected attached Thinks or Knows. Search/Results and a Relevant/Recent switch are not current UI.
- Main, Builder, ThinkGraph, and KnowGraph receive the current Entity/Relationship map and a non-persisting
  default packet containing one most Relevant and one distinct most Recent record from each authority.
  Engraphis and Graphiti produce provider candidates; Jev alone ranks them. Relevant is presented first and
  outweighs recency, preventing the last exchange from becoming a repeating context loop.
- One unified canvas shows **Think** in blue and **Know** in orange by default. The detailed graph-design
  inspector owns the small color-key visibility controls plus the deliberate default reset; an empty-canvas
  click clears selection and returns to that combined visible-layer view without changing visibility.
- Entity radius scales linearly from least to most attached Think-and-Know words. Jev relationship
  probability remains movement/centrality input and is not replaced by word count.
- The existing Graphs workspace now has an opt-in green **Code** visual layer on the same joined Think/Know
  canvas. Code remains hidden by default and loads only after its inspector control is enabled. It reuses the
  same Engraphis renderer and Inspector and is labeled Repository-scoped until real open-Project filtering is
  proven. Structural File/Symbol identities and edges come only from the official CBM provider through the
  persisted Builder Card's actual grants;
  Feature membership and each file's Relationship statement come from bounded CBM reads of the inline
  source comments. The browser cannot submit a tool, raw query, provider, MCP URL, Card or deck override.
  File selection requests a bounded structural expansion and Symbol source loads only after an explicit
  action. Provider failure remains an unavailable/error state with no cached or empty-success fallback.

### ThinkGraph

Each successfully completed ordinary Main Run now supplies exactly one completed exchange to ThinkGraph.
PostgreSQL retains the ordered user messages, the Run observation retains their ordered message IDs, the exact
authorized saved ThinkGraph Card performs structured extraction through Hermes, and Python rails remains the
sole preparation and settlement owner. An in-flight user addition steers the active Main Run invisibly and does
not create a second Run or a second completed pair.

### KnowGraph

KnowGraph has Hermes Web plus its saved Graphiti read/write corridor. A deliberately supplied Think is
framing, not evidence. Useful sourced findings enter Graphiti through Graphiti's queued `add_know`, which
creates one first-class `Episodic:Know`, reuses an exact supplied or exact-name Entity when present and creates
that Entity otherwise, stores its exact UUID in `entity_uuid`, removes Know `ABOUT` and `MENTIONS` attachment
edges, updates Graphiti communities by default, and may associate the continuing research thread with one Saga. One Know has
one verified source document, one exact evidence passage, one self-contained observation, one separate bounded
interpretation and optional direction relative to an explicit proposition. Its typed citation properties and
plain-text episode content remain inspectable and searchable through Graphiti. Supporting-only,
challenging-only and neutral findings are valid. Distinct sources remain distinct Knows, including several
attached to the same Entity; deterministic content identity prevents repeated copies of the same sourced Know.
Hermes `grounded-citations` verifies the research chain from actual retrieval through exact extracted-page
evidence before the KnowGraph root sends the typed citation to the unchanged Graphiti per-group processing
queue. Python rails preserves Project scope and typed citation transport; it does not operate a second web
retrieval or citation ledger.
The acceptance receipt supplies the deterministic Know UUID and content hash without claiming persistence;
`get_know` provides the exact readback used to establish materialization.
The source-default KnowGraph Card uses Sol; ThinkGraph remains Luna. Queue acceptance does not prove
materialization.

KnowGraph enters its own retained Team Triage for substantial research. Main still consults
the saved KnowGraph Card through its exact saved wire authority. Candidate workers inherit the saved Web research
surface but no profile MCP connection or graph-write capability. The same saved KnowGraph root reviews,
deduplicates and persists accepted findings during synthesis with its exact saved Card Run context and tool
ceiling. This does not invoke the separate Team Card, change Team's Magnetic wildcard role, or create another
scheduler, task store or worker pool.

### Execution

- Ordinary Hermes delegation, direct Team execution, and Magnetic are three different entrances. Team and
  Magnetic rely on the retained modified Hermes Team task contract; neither may silently fall back to the
  unmodified upstream task behavior.
- Main and every non-Magnetic saved Hermes Card have one stable profile plus one hidden session per
  Project. The application supplies only exact profile/session/roster context; Hermes owns inference,
  direct Bot delivery, transcript persistence, and each Card terminal. LiquidAIty never requests or accepts a
  busy-session prompt queue: an additional active-Main message uses Hermes steering inside the same Run.
- Source now prepares one receiving-Card Run and canonical `in.idf` before Main, terminal, and wired
  recipient inference. Direct `@Card` delivery observes the recipient session without a second Main
  synthesis; consultations continue the same open Main Run from Hermes' real completion notification.
- Each Card's saved Hermes Tools section controls ordinary Hermes toolsets independently from its saved Card
  Tools registry. Saved application tools are exact include-filtered profile MCP tools; an empty ordinary-Hermes
  selection does not erase the enabled profile MCP server. AutoTools can narrow that loaded set for one turn but
  cannot grant a tool. The retired application per-turn callback tool protocol is absent.
- Valid enabled Card Scripts execute through Hermes' existing child Python runner and exact profile-loaded
  grants; blank or invalid source is inert. The owner's later general Hooks design remains a separate boundary.
- The saved Team Card/profile enters Team directly: one parked root enters Triage, fans out only to depth-one
  workers under the configured Team policy, and returns to a separate synthesis pass. It does not call
  `delegate_task(role="team")`, add an extra agent, or depend on a profile `task_mode` overlay.
- Magnetic uses saved blue topology as the exact worker ceiling for modified Team execution; its same
  root remains both orchestrator and final result task.
- Hermes owns task rows, dependencies, attempts, dispatch, retries, workers, and synthesis.
- LiquidAIty owns one outer product Run and does not copy the Hermes task ledger.

## Current gaps before live acceptance

These are source/documentation gaps, not permission to repair them during this documentation run:

1. Main's approved quick-Web direction is not present in its source-default toolsets.
2. Main's source-default prompt describes ThinkGraph/KnowGraph use, but the server's default new-Project
   topology does not attach those orange edges.
3. Quick-Web evidence handoff to durable KnowGraph correlation is not implemented.
4. Existing saved Projects remain governed by their persisted Card revisions; the new source-default
   prompts, grants, and KnowGraph model do not silently overwrite saved authority.
5. The 2026-10-14 loaded pass proved ordinary Main, Main consultation, direct Builder/ThinkGraph/KnowGraph/
   WorldView/Trader delivery, refresh retention, and the Builder terminal. The 2026-10-15 cleanup passed a
   fresh loaded health/source check and graph-inspector visual regression, but did not repeat model turns.
   Interactive profile OAuth, enabled Card Script execution/failure recovery, Team, Magnetic, graph writes,
   external clients, and final owner visual acceptance remain separate.
7. The 2026-10-17 CodeGraph implementation passed its focused provider, transport, projection, hook,
   renderer, and shared-Inspector checks. The subsequently authorized daemon recovery and canonical
   reload succeeded: the MCP host froze 57 generated/published/unique tools with no unavailable family,
   and the loaded Code projection rendered 51 real Features and 374 Files with no `read_failed` state or retired
   Feature sorter. Main and Builder then completed one real turn each and their outer Runs read back.
   CodeGraph freshness still reports `unverified`, and final owner visual acceptance remains separate.

## Loaded core checkpoint — reached 2026-10-14

Current source has one connected path from the restored UI through saved Card authority, one Project
session per Card, one IDF/Run lifecycle, Hermes profile tools, wired Bot delivery, blue modified-Team
worker authority, and each non-Main Card terminal. The old combined-conversation runtime, direct target executor,
per-turn application tool callback, transport selector, fake status/limit controls, generic Card-tools host,
and their stale tests are absent from the live application path. The reserved saved-profile `liquidaity`
connection instead uses one short-lived, exact active-Run internal principal against the official MCP host.

The same loaded pass recorded the real Main/Bot/Builder terminal cases in `turn.md`. It did not prove
OAuth-backed tool execution, an enabled Card Script, Team, Magnetic, graph writes, external clients, or
complete owner visual acceptance.

## Oracle, external MCP, and saved-agent publish checkpoint — reached 2026-10-18

The bounded publish-preparation pass now has the following separate results:

- The LiquidAIty MCP host reloaded the current catalog with 58 generated/published/unique tools,
  completed `liquidaity`, `cbm`, and `graphiti` families, no unavailable family, catalog hash
  `1ad9a7da010a924b75815357a13f51b64707668ef6523b48f691d70c7e2fb1c3`, and the complete
  catalog-source hash `47b01fa48c4f1025fe880c8e67ce067e3b68e7759a8bfd0e91cf43d05e2b1163` with
  `sourceCurrent=true`. The connected LiquidAIty tool's real `main.context` returned that receipt.
- The catalog now includes the source-default KnowGraph `graphiti.get_status` grant, human-facing
  provider titles, accurate Engraphis side-effect copy, frozen-catalog `listChanged=false`, and a
  multi-file source identity. The current cached development-plugin surface must still be refreshed or
  reconnected before its discovery snapshot can expose current `main.submit` metadata. Plugin Management
  cannot manage this created-by-owner development reference as a public installed plugin.
- The existing saved Project correctly retained its own revisions and grants. External calls to
  `graphiti.get_status` and `graphiti.search_nodes` returned `tool_not_granted`; no source-default rewrite
  or saved-Card mutation was applied to bypass persisted authority.
- Fresh loaded saved-Card turns completed for Main, Builder, and ThinkGraph. Direct Builder execution
  produced one correlated `message_agent` delivery, its own completed child Run, primary-source research,
  and a persisted Builder reply. The saved-profile MCP repair moved every reserved `liquidaity` connection
  from the public OAuth resource to the internal loopback host without changing Card grants. Ten tool-bearing
  profiles read back `credentialStatus=not_required` with their exact include filters, while Builder retained
  its saved web, browser, terminal, file, code-execution, and vision Hermes toolsets. A fresh direct Trader
  child Run emitted exactly one real `mcp__liquidaity__forecast_market_bars` call for RKLB and returned the
  honest Alpaca `provider_unconfigured` result. Its receipt recorded one tool call; Trading state retained no
  jobs or positions, execution remained unapproved, and no fallback, trade, decision, graph write, or saved-Card
  mutation occurred. Earlier unavailable-tool Trader and WorldView observations remain historical failures,
  not current tool-transport acceptance.
- Canonical `npm run dev:fresh` now starts and health-waits the existing root PostgreSQL/AGE and Neo4j
  Compose services, then withholds Vite until Python rails and the complete MCP catalog are ready. Preview no
  longer lands on `conversation_history_read_failed` during a normal cold start.
- A pre-session Hermes heartbeat timeout exposed an outer-Run settlement defect. The failed test Run was
  settled explicitly, and current source now omits nonexistent provider evidence before a session binding;
  the focused regression and the complete root TypeScript suite pass.
- The controlled ShadowBroker source is a Web/Docker experimental Oracle release candidate: release
  carriers agree at 0.9.83; production frontend dependencies report zero known vulnerabilities; strict
  production-source type checking, Next standalone, Vite embed, backend release gates, Compose parsing,
  and clean source image builds passed. The loaded local backend/frontend containers are healthy, the UI
  returns HTTP 200, MKT remains explicitly off, and Oracle provider search returns the expected 409 refusal.
  No provider-backed market read, signed prediction, settlement, persistence-after-restart, or owner visual
  acceptance was performed.
- ShadowBroker `/api/health` returns HTTP 200 and version 0.9.83, but its aggregate data SLO remains
  `error` because live UAP/NUFORC and global FIRMS have never fetched successfully; other stale/low-volume
  feeds remain yellow. Container health is green, but full data-plane health is not.

Remaining publish TODOs are explicit: refresh/reconnect the development plugin only for external-client
acceptance; run provider-opted-in Oracle read/write/persistence acceptance only after the
operator enables MKT and authorizes test ledger writes; resolve the optional-feed SLO failures; rerun the
frontend image build against the final dev-only lockfile after the last clean `npm ci` attempt stalled; reduce
the five high-severity dev-only Next ESLint advisories when an upstream-compatible fix exists; complete
browser visual acceptance; and keep agent Oracle/governance writes, autonomous agent monitoring, per-agent
credentials, desktop distribution, and stateful Helm/HA as deferred work rather than release claims.

## Cleaned source checkpoint — reached 2026-10-15

The reduction/route/graph/tooling cleanup passed:

- all first-party Python tests: 420 passed; one upstream Graphiti Pydantic deprecation warning;
- all repository TypeScript tests: 389 passed, one intentionally skipped; the focused Magnetic suite then
  passed without its former React act warnings;
- client/backend source and spec TypeScript checks: passed;
- backend and client production builds: passed; the client retains browser-externalization and large God’s Eye
  bundle warnings;
- authenticated streamable-HTTP MCP proof invoked granted `calculator` and denied it to ungranted peers;
- production dependency audit: zero vulnerabilities after non-breaking updates; 14 dev-only advisories remain
  behind separate breaking Nx 23/Vitest 5 migrations;
- `git diff --check`: passed; canonical Markdown links: passed.

The canonical launcher then loaded backend, Python rails, KnowGraph, MCP, Hermes, WorldView, WorldSignals,
and the client. Health/readiness returned HTTP 200; MCP froze 55 unique tools with `sourceCurrent=true`,
startup ID `333ca4c32261466aa05f0b248de6d74f`, and catalog hash
`984322f92548fd5e3a0d5f467999b37673edd099a6ceae9cb506f2c8c5dfd6b47`. Preview loaded the restored Project
with an enabled Main composer, Card canvas, Entity-only graph, and Rocket Lab Know inspector showing separate
cited For/Against evidence and no console warnings. No new model turn, graph write, Team/Magnetic mission,
trade, credential change, or saved Card mutation was performed.

## Next acceptance boundary

Profile OAuth tool readback and Card Script success/failure recovery require their real external or saved
prerequisites. A new model turn, Team, Magnetic, graph writes, external-client acceptance, and Jeremiah's final
visual acceptance remain separate and must not be inferred from health, deterministic, or inspector proof.
CodeGraph's authorized daemon recovery and canonical application reload completed successfully; the exact
positive evidence is recorded in `turn.md`. No additional CBM lifecycle mutation is implied by that result.
Any new CBM restart, repair, reindex, cache access, project mutation, or configuration change still requires
a new exact owner instruction.

## Completed Main capture boundary

Automatic completed-Main capture uses the persisted Main-to-ThinkGraph authority, the current repo-owned
Hermes adapter, the exact saved ThinkGraph Card, and the existing Python preparation/settlement owners. It has
no candidate queue, approval/shadow graph, alternate writer, direct public target runner, or UI-owned semantic
step. Graph optimization, time-sort interaction, entitlement, retention/billing policy, reset, report surface,
and quick-Web evidence handoff remain outside this boundary.

## Proof tiers still separate

1. source and residue inspection;
2. deterministic contract tests;
3. typecheck/build;
4. loaded service health and exact source identity;
5. real saved Card behavior through the loaded Hermes path;
6. persistence/readback;
7. external client acceptance;
8. owner visual acceptance.

A lower tier never proves a higher one. No Magnetic mission, graph write, trading action, or service
restart is authorized by this plan alone.

## NRGSIM — restored modeler and explicit floors

The current owner-approved boundary is the restored Three.js modeler and the existing shared inspector
in **Building Energy Modeler**, Project `38bd1429-e8e1-47ff-afef-d940aa8e8040`. The rejected Pascal/
in-memory starter-model prototype is not current architecture and must not be restored.

Saved OSM case files own engineering state. The authenticated Project route forwards to the single
Python rails operation owner; transaction-scoped OpenStudio MCP/SDK operations stage, validate,
save/reopen and revision-check edits. The original shoebox baseline, both glazing comparisons and their
historical inputs/SQL remain preserved. Named cases, one core/perimeter floor and two explicit matched
floors are implemented; actual annual runs completed with native zero-severe diagnostics. The upper
story was edited through the loaded inspector and rerun. SQL comparisons retain exact channels/time,
include building-energy aggregation with source keys and show floor area and energy intensity.

The separate packaged-rooftop experiment uses the installed System 3 recipe on a shoebox copy, not an
Appendix G transformation. Its executed diagnostic runs and remaining physics warnings are recorded in
`agent-products/nrgsim/CoderReport.md`; engine completion alone is not equipment-model acceptance.

The owner subsequently authorized Modeler's narrow migration: its obsolete six-tool contract is
replaced with `building_model.read_case` and `building_model.edit_inputs`, forwarding to the same
Python rails case owner. The other six Cards and topology read back unchanged. Saved grants and
catalog presence do not yet establish live session discovery; exact agent evidence remains in the
report. The NRGSIM-only long-request dispatcher has also carried a real edit lasting over five minutes.
Construction assignment/R-value controls, a named installed Office/5A library selection, existing
schedule-value editing and Ideal Loads inputs are implemented. The comparison UI now shows baseline
plus one selectable performance case, retaining other files/history. Full OpenStudio feature parity
is not claimed. A new named single-zone HVAC case has now completed with retained design days plus
EPW-defined extreme weeks. Its native outputs and remaining frost/unmet-hours findings belong in the
CoderReport. A genuine multizone system remains the next domain increment; unchanged historical cases
are not to be rerun. The baseline selector and comparison use exact completed-run identities.
Normal whole-app reloads were authorized for this task; no Git
mutation, new container, upstream-source edit or REA-hold change is included.
