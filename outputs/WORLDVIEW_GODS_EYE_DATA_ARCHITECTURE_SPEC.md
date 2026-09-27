# WorldView / God's Eye / ShadowBroker / Data Sources

## Reconciled implementation plan

Canonical starting authority:

- C:\Users\jerem\.codex\attachments\98b387fb-88ac-4aff-b367-5a7c607c2e97\Pasted text.txt
- the owner's later explicit replacement of the WorldView source-control model with one Data Sources view and one ON/OFF control per source

Repository: C:\Projects\LiquidAIty\main

Plan status: **specification reconciliation only; no production implementation has begun in this task.**

The latest explicit decision supersedes every earlier proposal for multiple source views, Project-scoped source palettes, source assignment controls, retained-result presentation controls, and separate user-versus-agent source switches. This document is the one reconciled plan.

---

## 0. Prerequisites and stop gates

These prerequisites come first. They must be resolved in order before the USGS vertical slice is implemented.

### P0. Preserve the current checkout

- Preserve all owner changes and untracked output.
- Do not fetch, pull, switch branches, create a worktree, reset, restore, stash, stage, commit, clean, or delete unrelated work without an exact owner request.
- The current checkout contains a broad concurrent implementation across Hermes, backend, Python rails, client, and Card tools. This planning task does not own those changes.
- This plan is the only file intentionally changed by this task.
- Re-read full Git status and the relevant diff immediately before any future production edit.

### P1. Establish structural discovery and source authority

- The registered Codebase Memory project is C-Projects-LiquidAIty-main at C:/Projects/LiquidAIty/main.
- At reconciliation time it reports ready at current HEAD, but coverage checks mark several relevant files as metadata-changed.
- The imported worldsignal tree is deliberately excluded from Codebase Memory coverage.
- Use Codebase Memory to locate indexed owners, then completely read current source for every affected symbol, caller, contract, and test.
- Use bounded direct-source and rg fallback for excluded vendor paths and any stale or partial projection.
- Do not repair, reinstall, reindex, launch, or bypass Codebase Memory as part of this work.
- Before a deletion or rename, perform the mandatory inverse relationship and residue audit.

### P2. Resolve the separate Hermes saved-Card session prerequisite

The retained product invariant is:

~~~text
ONE SAVED CARD
=
ONE STABLE HERMES PROFILE

one stable profile
→ many simultaneous native sessions
~~~

The current dirty checkout contains an in-progress correction around conversation-scoped native sessions under one stable profile. Its proof remains separate from this feature. The WorldView work must not finish that runtime change, clone a profile, create a Project-local Hermes home, serialize Card use, or introduce a fallback runtime.

Before end-to-end USGS implementation:

1. finish the exact existing profile/session correction in its own authorized boundary;
2. prove two simultaneous native conversations under one saved Card/profile;
3. prove exact history, stop, readiness, profile-global operations, and saved revision behavior;
4. preserve legacy native history without deleting or copying it;
5. obtain green focused source tests and loaded Hermes proof.

The Data Sources plan is accepted independently, but real saved-Card acceptance cannot be claimed while this prerequisite is unresolved.

### P3. Establish the one durable user-owned ON/OFF authority

Current source has no demonstrated durable global per-user owner for Data Sources:

- client/src/components/worldsignal/worldSignalLayerPrefs.ts stores temporary browser preferences per Project and Card;
- God's Eye also has its own browser/share layer persistence;
- the ShadowBroker vendor keeps process-global in-memory layer flags;
- the current WorldView backend route exposes readiness only;
- current Card-runtime Python context does not carry the authenticated user identity needed for a per-user ceiling;
- db/10_myagent_core.sql contains a generic preferences table keyed by UUID, while current authenticated User IDs are CUID/TEXT and no live application reader/writer for that table was found.

None of those may be silently promoted into the new authority.

Before implementation:

1. inspect the live applied-migration ledger;
2. confirm whether a compatible current user-settings owner exists;
3. if none exists, create the smallest safe forward persistence contract for exactly one Boolean per user and source;
4. propagate the authenticated user identity through the existing runtime principal without copying source preferences into the IDF, Project, Card, profile, or Run;
5. prove authenticated readback, cross-session persistence, and user isolation.

The expected minimum relational shape, if a new forward migration is required, is conceptually:

~~~text
user_id    TEXT/CUID foreign key to the real User owner
source_id  TEXT
enabled    BOOLEAN
updated_at timestamp

primary key (user_id, source_id)
~~~

It must contain no Project, Card, Run, credential, OAuth, provider payload, Jev score, agent assignment, visibility, or presentation-retention columns.

Initialization rule:

- existing production sources cut over with an explicitly declared product default;
- USGS begins ON to preserve today's visible earthquake capability unless the owner changes that default before migration;
- a newly introduced source begins OFF unless its product default is explicitly approved;
- Project/Card browser preferences are not merged into the new authority because they conflict and have the wrong scope;
- after the first persisted user choice, that Boolean is the only mutable answer.

Never edit an applied migration or reuse a consumed number. The canonical PromptSpec warns that migration 044 may already be applied even though the tracked checkout observed during reconciliation ends earlier.

### P4. Freeze the ShadowBroker-to-globe capability map

The difficult part is not drawing points on Cesium. It is mapping each provider capability from current ShadowBroker execution into one truthful, bounded result and one appropriate WorldView representation without changing semantics or leaving a duplicate fetch.

Before editing a source, record:

| Required fact | Why it matters |
| --- | --- |
| canonical source identity | joins the one ON/OFF row, Jev candidate, result, and presentation |
| existing provider operation and arguments | preserves the real executable owner |
| every current consumer | prevents breaking agents, map paths, or other products |
| native dataset/feed/query | prevents merging unlike feeds under a friendly label |
| native IDs and time fields | correlates agent evidence with rendered entities |
| filtering, bounds, cursor, and truncation | prevents apparently similar but semantically different results |
| cache and scheduler behavior | makes OFF effective against stale and future data |
| shared producer dependencies | avoids stopping a stream another user or capability still needs |
| spatial, non-spatial, or mixed representation | prevents invented geometry |
| attribution, licensing, and retention | preserves provider obligations |
| exact duplicate path to remove | bounds cleanup after parity proof |

For USGS specifically, current paths are not equivalent:

- ShadowBroker reads a bounded earthquake feed through its own fetch/cache path;
- God's Eye independently reads a different USGS feed, applies its own threshold, and polls on its own timer;
- their retained fields, filters, clocks, bounds, and failure behavior differ;
- the existing Python fake-client test uses a singular layer argument while the native command accepts plural layers.

Freeze the exact feed, query, event inclusion rules, native event IDs, longitude, latitude, depth, magnitude, place, observed time, retrieval time, source clock, truncation, attribution, and error semantics before deleting either path.

### P5. Prove that OFF is a hard ceiling, not a cosmetic layer switch

Current source exposes several bypasses that must be closed for the migrated source:

- ShadowBroker's USGS fetcher stops future fetches when its presentation flag is false, but cached earthquake data remains;
- the dashboard route masks that cache, while native telemetry and agent-command reads can still return it;
- the Python WorldSignals command, batch, and package paths can expose data through broader operations;
- God's Eye independently fetches USGS, so a ShadowBroker flag cannot stop the globe's request;
- a source can be switched OFF after Jev selection but before or during the real provider call.

The implementation must enforce the same persisted Boolean:

1. when building the user view;
2. before constructing Jev candidates;
3. immediately before the actual source operation;
4. before returning cached or newly completed source data to the agent;
5. before projecting the result into current WorldView state.

Do not block unrelated WorldSignals operations. Map the requested native operation/result to the canonical source ID and enforce only that source's ceiling.

### P6. Record the vendored-project packet

Before any nontrivial change under worldsignal/Shadowbroker-main or worldsignal/gods-eye-view-main, record:

~~~text
VENDORED PROJECT
PURPOSE
EXTERNAL ALTERNATIVE CHECK
FILES AND SYMBOLS
UPSTREAM BEHAVIOR PRESERVED
CONTRACTS
TESTS
FORK COST
ROLLBACK
~~~

Prefer current public adapters, commands, bridge messages, and extension points. Do not perform vendor cleanup, broad renames, formatting, dependency changes, terminology rewrites, or unrelated test rewrites.

### P7. Current implementation gate

The source architecture can be reconciled now. Production implementation remains gated by the unresolved P2 runtime prerequisite and the P3 live storage/migration readback.

Current status:

~~~text
SPEC CONFLICT — STOPPED BEFORE IMPLEMENTATION
~~~

This status does not reject the new Data Sources design. It prevents an end-to-end implementation from hiding two real prerequisites inside the USGS feature.

---

# SPEC AGREEMENT

1. **There is exactly one Data Sources view.**
2. **Each source has exactly one primary user control: ON or OFF.**
3. **ON globally enables that source for the authenticated user's LiquidAIty experience and makes it eligible for the shared agent capability pool.**
4. **ON does not inject data, a tool, or a prompt into every agent. It only permits the existing Jev pass to consider the source for the current agent and Run.**
5. **OFF is a hard ceiling for that user: the source is absent from current user access, excluded before Jev, denied at execution, and omitted from current WorldView projection.**
6. **There is no separate Project palette, WorldView palette, Card assignment switch, agent-access switch, or user-visibility switch for the same source.**
7. **Existing saved Card grants, provider credentials, and current Run authorization remain security ceilings; the Data Sources switch does not copy or override them.**
8. **The one existing Jev pre-inference batch performs per-agent, per-Run USE/OMIT narrowing over ON and otherwise authorized candidates. No second selector or TypeScript semantic router is added.**
9. **Agent use is execution evidence, not another source state. Requested-by, used-by, last result, freshness, and error may be shown as row details.**
10. **Spatial, non-spatial, and mixed sources use the same Data Sources control. Only real spatial evidence is projected onto the globe.**
11. **Agent-derived results may update data, rows, entities, tracks, and layers, but never automatically move, spin, or refocus the globe camera.**
12. **Only an explicit user action, such as clicking a result or selecting an entity, may request camera focus.**
13. **God's Eye remains the supervised Cesium visualization and user-started voice surface, not a runtime, database, or universal Card.**
14. **ShadowBroker remains the reusable data/recon provider while overlapping map fetches and controls are migrated one proven capability at a time.**
15. **World Monitor remains deferred.**
16. **USGS earthquakes remain the first vertical slice.**
17. **One canonical provider result feeds both the agent and WorldView; the supervised globe does not permanently refetch the same capability.**
18. **No broad public data tool family, second runtime, scheduler, graph, IDF, registry, data lake, or credential store is introduced.**
19. **System6 and the one-saved-Card/one-stable-profile invariant remain unchanged.**
20. **A wrong or duplicate path is stopped and removed after replacement proof rather than preserved through adapters, fallbacks, or a second authority.**

Agreement result:

- The corrected product model is coherent.
- The previous multi-view and Project-scoped source proposals are superseded.
- Current source does not yet implement the corrected model.
- Work below is an implementation plan, not proof of a loaded feature.

---

## 1. Requested Delta

The smallest complete observable change is:

> The authenticated user sees USGS Earthquakes in the one Data Sources view with one ON/OFF control. When ON, USGS data may be used in the user surface and becomes an eligible candidate for the existing Jev pass. Jev may retain it for a real saved Research Agent Card, the frontier agent may call the existing WorldSignals/ShadowBroker operation, and the same real bounded result is consumed by the agent and rendered by God's Eye without changing the camera. The row shows actual requesting/using Card evidence. When OFF, USGS disappears from current user data, cannot enter Jev, cannot be returned through direct or cached provider paths, and cannot update the current globe.

This is one vertical slice. It is not a generalized provider platform.

---

## 2. Preservation Set

### Saved Card, Hermes, and authorization

- one saved Card remains one stable Hermes profile;
- profile state, model, prompt, skills, tools, memory, credentials, OAuth, and MCP bindings stay with their current owners;
- Projects, conversations, sessions, Runs, Main, Magnetic, Team, Agent Library use, and WorldView never clone a profile;
- saved Card tool grants and current Run authorization remain real execution ceilings;
- the ON/OFF control never edits a Card or profile;
- no provider, model, tool, credential, or runtime fallback.

### Runtime and data ownership

- TypeScript owns transport, authenticated UI, and pixels;
- Python rails owns provider execution, deterministic validation, source gating, and bounded result projection;
- models own semantic relevance and tool choice;
- Jev remains the single existing pre-inference narrowing pass;
- apps/python-models/app/python_models/idf.py::materialize_idf remains the sole IDF materializer;
- raw and bulk data remain with the native provider or existing bounded artifact owner;
- PostgreSQL stores only the user's one Boolean per source and existing Run/artifact facts;
- no second scheduler, task store, tool registry, input format, or data warehouse.

### Graph and System6 boundaries

- System6 remains Main, ThinkGraph, KnowGraph, Builder, Magnetic, and Team;
- ThinkGraph remains Engraphis reasoning authority;
- KnowGraph remains Graphiti sourced-knowledge authority;
- CodeGraph remains native Codebase Memory authority;
- AgentGraph/AGE remains Card relationship and Run-observation authority;
- WorldView creates no graph and copies no graph.

### Product behavior

- one Data Sources view and one ON/OFF control per source;
- non-spatial sources remain first-class without fabricated coordinates;
- agent activity is evidence on the source row, not another toggle or mode;
- errors, provider readiness, pending refresh, stale data, attribution, and current use are row facts;
- agent results can update the globe but never its camera;
- user-started local voice remains in God's Eye;
- a voice request that invokes a provider, Card, or source-control change returns through normal authenticated LiquidAIty execution;
- historical Run evidence remains readable even after a source is turned OFF;
- the legacy ShadowBroker map remains until equivalent required capability is proven, but it cannot remain an independent source-control authority.

### Compatibility contracts

Preserve until exact caller migration proves removal safe:

~~~text
card_worldsignals_agent
profile: worldsignals
worldsignals.*
/api/worldsignal
worldsignalSidecar
signal.package.v1
~~~

Product copy may later say ShadowBroker. This packet does not rename technical identities for branding.

### Data and test integrity

- preserve existing saved Cards, Runs, profiles, sessions, Projects, graphs, provider data, artifacts, and user work;
- do not delete, weaken, skip, or redefine tests to accept a defect;
- do not call a catalog entry, mock, unit test, or source path live-provider proof;
- report source, structural connection, focused tests, build, loaded application, real saved execution, and visual acceptance separately.

Required regression ratio: 0.000.

---

## 3. Current source truth

### 3.1 WorldView has no canonical Data Sources control plane

client/src/features/worldview/WorldViewSurface.tsx currently renders the globe and status information. It does not own the required list or a durable source switch.

client/src/pages/agentbuilder.tsx mounts WorldView as a workspace surface, while the existing drawer exposes older WorldSignals markets/layers controls. Those controls are not the new shared authority.

### 3.2 Existing browser and vendor flags have the wrong scope

- client/src/components/worldsignal/worldSignalLayerPrefs.ts persists enabled layer IDs per Project and Card in browser localStorage.
- client/src/components/worldsignal/WorldSignalSurface.tsx reads and writes those preferences around the embedded ShadowBroker map.
- the ShadowBroker frontend posts a whole layer map to its backend during initialization.
- ShadowBroker's backend stores that map in a process-global in-memory dictionary.
- God's Eye maintains a separate browser/share layer coordinator.

Consequences:

- switching Projects or mounting another iframe can overwrite vendor process state;
- browser state does not provide authenticated cross-device persistence;
- process-global state cannot express different user choices;
- the three stores can disagree;
- none can be the new source owner.

### 3.3 Current provider and Jev paths are reusable, but not yet source-gated

Reuse:

- apps/python-models/app/python_models/worldsignals_client.py for authenticated WorldSignals commands;
- apps/python-models/app/python_models/tool_registry.py for the existing worldsignals.package operation;
- apps/python-models/app/mcp_host.py for provider dispatch;
- apps/python-models/app/python_models/signal_contracts.py for signal.package.v1;
- apps/python-models/app/python_models/card_domain.py for saved Card authorization, the current one-batch Jev decision, Runs, artifacts, and observations.

Current gaps:

- Run-begin transport does not carry the authenticated user identity needed to resolve the global per-user switch;
- current Jev logic starts from saved executable grants but does not intersect the new ON set;
- the current question cap is 128, and its overflow behavior retains an authorized baseline rather than proving every optional source decision;
- the actual WorldSignals command/batch/package dispatcher does not check the user's source switch.

### 3.4 Current USGS producer paths are duplicated

ShadowBroker:

- conditionally fetches and caches earthquake data;
- keeps cached data after its map flag is turned off;
- masks the dashboard route but does not consistently gate native telemetry/agent reads;
- does not necessarily refresh USGS immediately when enabled;
- may share producer lifecycle with other capabilities for other source families.

God's Eye:

- independently fetches USGS on its own interval;
- uses different feed/filter/field semantics;
- can continue fetching regardless of ShadowBroker's layer flag.

The migration must first establish one canonical result, then remove the supervised God's Eye direct fetch. It must not simply point two clients at a new flag.

### 3.5 Current WorldView reads the wrong result scope

WorldView currently reads the latest output for the Card supplied to the surface and takes the first candidate. The target must expose the exact authenticated source result and actual requesting/using saved Card/Run evidence without making WorldView a universal Card or inferring identity from prose.

### 3.6 Current result handling moves the camera automatically

The current path is:

~~~text
new package
→ first candidate
→ candidate-derived focus
→ gev.embed.focus.v1
→ Cesium camera.flyTo
~~~

That directly conflicts with the corrected camera rule.

Remove only the data-derived focus trigger. Keep an explicit user focus lane. A result arrival, source toggle, Jev decision, used-by observation, reconnect, bridge readiness event, or non-spatial update must not produce a focus request.

The vendor's unrelated initial standalone camera position is outside this agent-activity rule and remains unchanged unless the owner separately changes startup behavior.

### 3.7 Agent-use evidence exists only after real execution

A source being ON is not evidence of agent use. A Jev USE decision is not evidence of a provider call. A tool being presented is not evidence of use.

Requested-by and used-by facts must come from the actual saved Card, Run, operation request, and returned result. Historical evidence remains attached to its Run even if the source is later turned OFF.

---

## 4. Target ownership model

| Fact or action | One owner | Explicit non-owner |
| --- | --- | --- |
| source identity and factual metadata | bounded source descriptor adjacent to the existing provider adapter | UI text, Project record, Card prompt |
| the user's source switch | authenticated user-owned PostgreSQL Boolean | localStorage, iframe, Project, Card, Run, Jev |
| tool/security ceiling | saved Card grants, native credentials, and current Run authorization | Data Sources UI, descriptor, WorldView |
| per-agent relevance | one existing Jev pre-inference batch | TypeScript, source descriptor, Project rule |
| real provider call | existing Python rails provider operation | UI, iframe, Jev |
| raw/cache lifecycle | existing ShadowBroker/native provider owner | WorldView, Run table |
| canonical bounded result | existing signal.package.v1 plus necessary factual fields | a second globe fetch or data lake |
| current source-use evidence | actual operation and Run identities | ON/OFF value, Jev, answer prose |
| spatial rendering | supervised God's Eye bridge and Cesium lifecycle | ShadowBroker map as permanent duplicate |
| camera movement | explicit user gesture | agent result, toggle, Jev, reconnect |

The effective agent source candidates are:

~~~text
source is ON for the authenticated user
∩ native provider capability exists
∩ provider credentials are usable
∩ saved Card has the underlying executable grant
∩ current Run is authorized
= candidates presented to the one Jev pass
~~~

Then:

~~~text
Jev USE
→ capability may be presented to this frontier agent

Jev OMIT
→ capability is absent from this frontier agent
~~~

Neither result calls the source. Actual agent use requires the later real operation.

---

## 5. Data Source descriptor and migration map

The shared descriptor is factual metadata above existing executable owners. It is not a runtime, registry, policy database, router, or second authority.

Minimum useful fields:

~~~text
sourceId
displayName
provider
domain/family
capabilities
operation binding
native source/layer/telemetry keys
spatial class: spatial | non-spatial | mixed
spatial representation when real
freshness and limits
provenance requirements
license/attribution
shared producer or consumer notes
initial product default
~~~

It must not contain:

~~~text
per-Project switches
per-Card source switches
agent assignment
Jev decisions
current use
user visibility
presentation retention
credentials
provider payloads
~~~

### USGS descriptor boundary

Proposed canonical product identity:

~~~text
sourceId: usgs.earthquakes
displayName: USGS Earthquakes
provider: ShadowBroker / WorldSignals
operation: existing worldsignals.package path
native presentation key: earthquakes
spatial class: spatial
representation: point entities using real USGS event coordinates and IDs
~~~

The final feed/query and limits are not guessed here. P4 freezes them from current provider evidence before implementation.

### Per-source migration record

Every ShadowBroker capability moved toward WorldView gets one row in an implementation ledger held in the task report, not another repository database:

| Source | Native operation | Current consumers | Producer/cache | User representation | Agent result | Shared dependencies | Duplicate to retire | Proof status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| USGS Earthquakes | existing WorldSignals earthquake read through worldsignals.package | ShadowBroker map, native telemetry/agent reads, God's Eye direct poll | ShadowBroker fetch/cache plus current GEV poll | globe points and inspector detail | signal.package.v1 with native references | none assumed until source proof | supervised GEV direct fetch/poll | unproven |

Later sources must be investigated independently. Aircraft, vessels, imagery, cyber, markets, and weather are not variations of one generic stream.

---

## 6. The one Data Sources view

The interface is a single list. There are no source tabs, browse modes, parallel palettes, or separate user/agent controls.

Example:

~~~text
DATA SOURCES

USGS Earthquakes   [ON]
AIS Vessels        [ON]
Aircraft           [ON]
Weather            [ON]
Cyber              [OFF]
Markets            [ON]
~~~

Each row may show factual detail without creating another state:

~~~text
USGS Earthquakes                       [ON]
Provider: ShadowBroker / USGS
Currently used by: Research Agent
Last result: 2 minutes ago
Freshness: current
Attribution: USGS
~~~

Or:

~~~text
USGS Earthquakes                      [OFF]
Disabled for this user
~~~

Allowed row facts include:

- provider and capability summary;
- spatial/non-spatial/mixed representation;
- provider readiness or missing credential;
- pending first refresh;
- freshness and source clock;
- actual requested-by/used-by Card and Run;
- last current result;
- inline error;
- attribution and license detail.

These facts never become tabs, switches, or a multi-state ontology.

The server response is authoritative. The client does not claim a toggle changed until the authenticated write succeeds. A failed write restores the prior value and shows the error inline.

Legacy ShadowBroker map controls for provider data cannot remain an independent writer. During incremental migration they either forward to this same persisted Boolean or are removed. Pure visual controls such as base imagery or day/night presentation must be classified separately and must not masquerade as Data Sources.

---

## 7. ON semantics

For the authenticated user, ON means:

~~~text
user may access or see the source where appropriate
+
source may enter the agent candidate pool
~~~

ON does not mean:

- fetch continuously without demand;
- render every datum;
- add a source to every prompt or IDF;
- present the source to every agent;
- call the provider;
- prove current use;
- grant a missing Card tool;
- create credentials;
- bypass current Run authorization;
- move the camera.

User-side behavior:

- a spatial source may populate a current God's Eye layer;
- a non-spatial source may populate the Data Sources details/inspector;
- a mixed source may do both;
- if the provider is not yet refreshed, the row truthfully reports that condition.

Agent-side behavior:

- the source joins only the authorized candidate set;
- the one Jev pass decides whether the current agent should receive the capability;
- the frontier model then decides whether to call it;
- actual use is recorded only after a real operation.

---

## 8. OFF semantics

For the authenticated user, OFF means:

~~~text
current user access
→ disabled

current WorldView projection
→ removed or hidden

Jev candidate construction
→ source excluded

provider/tool dispatch
→ source denied
~~~

Required behavior:

1. remove the source from current user-facing data and live globe projection;
2. exclude it before the Jev request, including all overflow/fallback paths;
3. reject direct or generic operations that resolve to that source;
4. reject cached data for that source as a new agent result;
5. recheck immediately before dispatch so a stale prepared Run cannot bypass the switch;
6. recheck before result delivery so a source switched OFF during execution does not re-enter the current UI or model context;
7. preserve prior immutable Run/artifact evidence without presenting it as current source access.

If a provider supports cancellation, use its current cancellation boundary. If not, the upstream call may finish internally, but the result is not delivered as current authorized data; record an honest disabled-during-execution outcome. Do not claim cancellation that did not occur.

In a multi-user deployment, one user's OFF can prohibit that user's access without necessarily stopping a shared upstream producer still required by another authorized user or product consumer. Stop a native stream only when its existing owner proves no authorized consumer still needs it.

---

## 9. One Jev pass

The existing Jev pre-inference owner remains in apps/python-models/app/python_models/card_domain.py.

For each Run:

1. read the authenticated user identity;
2. read the canonical ON set;
3. intersect it with native provider capability, credentials, saved Card grants, and Run authorization;
4. combine those source candidates with existing optional tool candidates;
5. submit one bounded Jev request;
6. present only Jev-retained capabilities to the frontier model;
7. retain Jev evidence as explanation, not authority or use proof.

An OFF source never enters the request.

The current 128-question contract must be handled explicitly:

- the USGS first slice must remain within the existing bound;
- source candidates must not return through the current authorized-baseline overflow behavior;
- an overflow must fail closed for optional source candidates and report the bounded error;
- do not silently truncate with a TypeScript relevance rule;
- any later grouped-candidate schema remains one Jev pass and requires separate source-proven approval.

Jev USE means only “useful option for this agent now.” It does not mean requested, called, returned, rendered, or currently used.

---

## 10. Provider execution and canonical result

### 10.1 Execution gate

The actual operation must map its requested data to a canonical source ID before provider access. For USGS, every in-scope WorldSignals entry that can return earthquakes must consult the same user-owned Boolean.

This includes:

- worldsignals.package;
- broad command/batch operations when their arguments request earthquakes;
- cached telemetry/layer slices;
- any direct backend route used by the authenticated UI;
- the supervised God's Eye data input.

Do not add a broad new public tool. Reuse the existing provider-specific operation and enforce the source ceiling inside the protocol-neutral Python operation boundary so Hermes, application calls, and external publication cannot disagree.

### 10.2 One result

The canonical bounded result must carry, where applicable:

~~~text
sourceId
capability
authenticated user scope
Project
requesting Card and Run
using Card and Run
query/feed identity
provider-native references and event IDs
observed/as-of/retrieved times
source clock and freshness
typed items or bounded artifact reference
provenance
optional spatial projection
truncation/cursor
errors
license/attribution
content hash
~~~

The agent consumes the result. WorldView receives the exact spatial projection from that same result. The globe does not reconstruct, reinterpret, or independently refetch the provider payload.

Raw or bulk source data stays with ShadowBroker or the existing artifact owner. PostgreSQL does not become a data lake.

### 10.3 Agent-use evidence

Record:

- requestedByCard only when an actual source request exists;
- usedByCard only when the real provider operation/result is part of that Card's execution;
- exact Card ID, revision, profile, Run, operation, result identity, and time;
- failure without inventing use.

The Data Sources row may display “Currently used by” or “Last used by” from those facts. It never derives identity from titles, answer prose, or Jev selection.

---

## 11. WorldView bridge and camera contract

### 11.1 Result delivery

Keep the supervised iframe architecture.

The bridge must:

- send enabled source identity and bounded spatial results with string-array layer IDs where required;
- preserve real source clocks and native IDs;
- distinguish host readiness, provider readiness, and render acknowledgement;
- return exact result/projection identity on success;
- return a bounded truthful error on failure;
- carry selection events back to the LiquidAIty host.

### 11.2 Camera isolation

Delete the current automatic chain from first result candidate to focus message.

These events must never send a camera command:

- agent result arrival;
- ON or OFF;
- Jev USE or OMIT;
- requested-by or used-by evidence;
- source refresh;
- bridge reconnect or readiness;
- render acknowledgement;
- non-spatial result;
- background provider update.

An explicit user gesture may send one focus request:

~~~text
user clicks a Data Sources result
or
user selects a rendered entity
→ host creates a fresh gesture/focus request identity
→ bridge sends one bounded focus command
→ God's Eye acknowledges that request
~~~

Do not replay a consumed focus command merely because the iframe reconnects. Do not infer a user gesture from selection state created by an agent result.

Agent activity may update real entities, tracks, layers, and result detail while the user's camera position and motion remain untouched.

### 11.3 User selection wiring

Current host code parses bridge selection messages but WorldView does not connect the callback, and the current earthquake renderer does not emit the same context-selection events as some other layers.

The USGS slice must implement one explicit path:

- row/result click focuses the corresponding real entity; and/or
- native earthquake entity selection emits a bridge selection event and may focus only as the direct consequence of that user pick.

The first slice needs at least one proven explicit-user path. It must not restore automatic first-candidate focus.

---

## 12. Persistence and authenticated transport

### 12.1 Canonical Boolean

The canonical value is global for one authenticated LiquidAIty user across:

- Projects;
- Cards;
- conversations;
- sessions;
- Runs;
- WorldView mounts;
- ShadowBroker presentation;
- browser restarts and devices.

Project and Run remain useful context for results and evidence, but never write source availability.

### 12.2 Backend boundary

Extend the existing authenticated WorldView/data-source route boundary rather than creating an unrelated settings service:

- list factual descriptors plus the user's resolved Boolean;
- update exactly one source Boolean;
- return the persisted resolved value;
- expose current use/result evidence through existing authenticated Run/result owners;
- reject unknown source IDs structurally;
- do not accept Project, Card, agent, visibility, or credential fields in the toggle request.

### 12.3 Python rails boundary

Propagate the authenticated user ID through the existing runtime principal. Python rails reads the same persisted Boolean:

- before Jev candidate construction;
- before provider dispatch;
- before result delivery when a concurrent switch matters.

Do not serialize a mutable ON/OFF snapshot into the canonical IDF as authority. The IDF may contain only the capabilities actually selected for that Run and ordinary result references under its existing law.

### 12.4 Legacy stores

- stop reading per-Project/Card localStorage as source authority;
- stop the embedded ShadowBroker frontend from posting a full saved layer map that overwrites global provider behavior;
- stop God's Eye share/local layer state from overriding the source Boolean;
- preserve unrelated visual-only preferences;
- leave old local values inert rather than performing a destructive merge or cleanup.

---

## 13. ShadowBroker-to-WorldView migration

### 13.1 Why this is the hard part

The port is not “change map coordinates to globe coordinates.” It requires:

- separating true data sources from visual layers and base-map controls;
- mapping friendly source identity to provider operations, telemetry keys, caches, and streams;
- preserving source-specific query and result semantics;
- handling source families whose several visual layers share one producer;
- enforcing a per-user OFF ceiling around a process that may serve several users;
- preventing stale cached data from bypassing OFF;
- producing one bounded result usable by both a model and Cesium;
- acknowledging exact rendered identities;
- removing duplicate fetches only after equivalence;
- retaining non-spatial capabilities without fake globe objects.

### 13.2 USGS migration order

1. Read the exact ShadowBroker and God's Eye USGS implementations and tests.
2. Freeze the canonical feed/query/filter/limit/field/time/error/attribution contract.
3. Add the USGS factual descriptor and one persisted ON/OFF value.
4. Make the authenticated user surface obey that value.
5. Gate every USGS-capable WorldSignals read, including cached and generic command paths.
6. Complete the existing signal.package.v1 projection with the required native evidence.
7. Feed that exact result to the saved Card and supervised God's Eye bridge.
8. Render through the existing earthquake lifecycle without a camera command.
9. Record real requesting/using Card evidence on the same Data Sources row.
10. Prove ON does not inject or automatically call USGS.
11. Prove OFF before Jev, at direct call, against stale cache, during execution, and in current globe projection.
12. Prove exact result and render identity.
13. Remove the supervised God's Eye direct USGS fetch/poll only after parity.
14. Remove or redirect the legacy earthquake source toggle so it cannot write a second value.
15. Residue-search callers, configuration, timers, and network requests.

### 13.3 Later source migration

Repeat the full record per capability. Do not assume:

- one ShadowBroker layer equals one provider;
- one provider equals one stream;
- one stream may stop when one user chooses OFF;
- one source is spatial merely because ShadowBroker displays it;
- two feeds are equivalent because both are called aircraft, weather, fires, or imagery.

A second materially different source is the earliest point at which shared abstractions may be generalized. Until then, keep USGS-specific behavior bounded.

### 13.4 Map retirement

ShadowBroker remains the data/recon engine. Its map can be retired only capability by capability:

~~~text
provider parity
+ user access parity
+ agent operation parity
+ result/provenance parity
+ WorldView render parity
+ failure parity
+ no duplicate fetch
+ preserved non-map consumers
= exact old presentation/fetch path may be removed
~~~

Do not delete the entire map, provider, cache, or stream because one USGS slice succeeds.

---

## 14. Phased route

### Phase A — prerequisites

- settle P2 outside this packet;
- inspect the live migration ledger;
- establish the authenticated user-owned Boolean;
- record vendor packets;
- freeze USGS semantics;
- capture focused pre-edit baselines.

Exit proof: exact owners, schema route, source contract, and clean task boundary are written in the implementation packet.

### Phase B — one source control

- add the USGS descriptor;
- persist and read the one Boolean;
- build the one Data Sources row;
- remove Project/Card/local iframe authority for USGS;
- prove two users/sessions cannot overwrite each other.

Exit proof: cross-session authenticated ON/OFF readback and one visible control.

### Phase C — hard execution ceiling

- intersect ON sources before Jev;
- guard provider dispatch and cached reads;
- guard result delivery;
- preserve unrelated WorldSignals operations;
- handle in-flight OFF honestly.

Exit proof: OFF is refused at all relevant entrances, not merely hidden.

### Phase D — canonical USGS result

- correct native command arguments;
- complete real native IDs, times, provenance, limits, and errors;
- correlate one result identity through Card, Run, and artifact owners.

Exit proof: one real provider result with exact native evidence.

### Phase E — supervised globe projection

- deliver the exact result projection;
- render through the current earthquake lifecycle;
- return exact acknowledgement;
- remove automatic result-derived focus;
- add one explicit user focus path.

Exit proof: result updates entities without camera movement; one user click focuses.

### Phase F — current-use evidence

- expose real requested-by and used-by Card/Run facts;
- show current/fresh/error details on the same row;
- prove non-spatial results remain inspectable without geometry.

Exit proof: agent use is legible but creates no new state or control.

### Phase G — deduplication

- compare provider and render semantics;
- remove the supervised God's Eye direct USGS fetch/poll;
- remove the legacy USGS source-control writer;
- prove no duplicate network request or timer remains;
- preserve standalone/vendor behavior not superseded by the supervised product path.

Exit proof: one canonical source result feeds agent and WorldView.

### Phase H — loaded acceptance

- restart/reload Python rails if changed;
- load the actual application;
- execute a real saved Research Agent Card;
- prove ON eligibility without automatic use;
- prove Jev retention and real model-chosen operation;
- prove OFF refusal and current projection removal;
- prove camera stability and explicit focus;
- obtain Jeremiah's visual acceptance.

Do not generalize to a provider platform before this slice is accepted.

---

## 15. Expected file boundary

This list is a discovery target, not blanket permission. Every changed hunk must map to the USGS packet or a proven prerequisite.

### Persistence and backend

- prisma/schema.prisma or the current SQL migration owner
  - only for the minimal user/source Boolean after live ledger inspection.
- apps/backend/src/routes/worldview.routes.ts
  - authenticated descriptor/toggle/result transport.
- apps/backend/src/routes/cardRuntime.routes.ts
  - only if required to carry authenticated user identity into the existing Python runtime principal.
- apps/backend/src/routes/index.ts
  - only if current router mounting cannot expose the bounded route.
- focused route/store tests beside the exact owners.

Do not reuse db/10_myagent_core.sql::preferences without proving compatible identity type, ownership, and live consumers.

### Python rails

- apps/python-models/app/python_models/card_domain.py
  - ON intersection before the one Jev batch, fail-closed bounds, and actual use evidence.
- apps/python-models/app/python_models/worldsignals_client.py
  - source-aware command execution and cached-result ceiling.
- apps/python-models/app/python_models/tool_registry.py
  - reuse the existing provider operation; only minimal factual binding if required.
- apps/python-models/app/mcp_host.py
  - authenticated user principal and execution-time source check.
- apps/python-models/app/python_models/signal_contracts.py
  - bounded USGS identity, clocks, provenance, and projection.
- apps/python-models/app/python_models/idf.py
  - only if selected-capability/reference representation needs a strictly additive change; never source authority or another materializer.
- apps/python-models/app/main.py
  - only if the existing backend-to-Python boundary cannot provide the necessary authenticated operation.

### Client

- client/src/features/worldview/WorldViewSurface.tsx
  - one Data Sources view, actual result/evidence, no result-derived focus.
- a bounded component under client/src/features/worldview/
  - only if the source list cannot remain clear inside WorldViewSurface; it is presentation, not authority.
- client/src/components/worldsignal/GodsEyeSurface.tsx
  - exact result/selection/focus bridge and no focus replay.
- client/src/pages/agentbuilder.tsx
  - mount the one view and remove duplicate source-control presentation.
- client/src/components/worldsignal/WorldSignalsInspectorPanel.tsx
  - retire or redirect provider-source toggles; preserve distinct markets or visual-only behavior only if still valid.
- client/src/components/worldsignal/WorldSignalSurface.tsx
  - stop per-Project/Card preferences from writing migrated source authority.
- client/src/components/worldsignal/worldSignalLayerPrefs.ts
  - remove migrated source ownership while preserving unrelated presentation preferences until their own migration.

### God's Eye vendor

- worldsignal/gods-eye-view-main/src/embed/hostBridge.js
  - host result delivery, selection, exact render/focus acknowledgement.
- worldsignal/gods-eye-view-main/src/data/earthquakes.js
  - apply host-supplied canonical records and later remove supervised direct fetch/poll.
- worldsignal/gods-eye-view-main/src/data/layerState.js
  - prevent local/share state from overriding the migrated source Boolean.
- worldsignal/gods-eye-view-main/src/data/manager.js
  - only if required for the existing data lifecycle.
- worldsignal/gods-eye-view-main/src/main.js
  - only if needed to prove user-originated focus and no result-originated camera motion.

### ShadowBroker vendor, only where source proof requires it

- worldsignal/Shadowbroker-main/backend/services/fetchers/earth_observation.py
  - canonical USGS fields, fetch lifecycle, and future-fetch gate.
- worldsignal/Shadowbroker-main/backend/services/fetchers/_store.py
  - current in-memory flag remains a native lifecycle input, not user authority.
- worldsignal/Shadowbroker-main/backend/services/telemetry.py
  - prevent cached earthquake reads from bypassing OFF.
- worldsignal/Shadowbroker-main/backend/services/openclaw_channel.py
  - guard native agent command reads.
- worldsignal/Shadowbroker-main/backend/main.py
  - only if the current native layer/producer transition needs a bounded adapter.
- worldsignal/Shadowbroker-main/backend/services/layer_enable_refresh.py
  - only if ON requires an immediate native refresh rather than an honest pending state.

Avoid vendor edits when the LiquidAIty Python adapter can enforce user access and truthfully project existing native data without changing upstream behavior.

### Exact old USGS path expected to be superseded

For the supervised LiquidAIty path only:

- the direct fetch and timer in worldsignal/gods-eye-view-main/src/data/earthquakes.js;
- the result-derived focus path in client/src/features/worldview/WorldViewSurface.tsx;
- per-Project/Card USGS preference ownership in worldSignalLayerPrefs/WorldSignalSurface;
- any legacy earthquake toggle that writes a second source Boolean.

Do not remove standalone God's Eye behavior until supervised-versus-standalone ownership is explicitly separated and tested.

---

## 16. Focused tests and proof

### Source authority and persistence

- authenticated user can read and update one Boolean;
- value persists across Project, Card, conversation, session, reload, and browser/device;
- one user cannot read or overwrite another user's choice;
- unknown source IDs fail structurally;
- toggle requests reject Project/Card/agent/credential fields;
- failed write leaves the prior value intact;
- USGS initialization follows the approved default and does not merge local Project/Card values.

### Jev

- ON plus provider/grant/Run authorization makes USGS eligible;
- ON alone does not inject USGS into the model or call it;
- OFF excludes USGS before the single Jev request;
- one request handles tools and source candidates;
- USE presents the bounded capability; OMIT does not;
- overflow cannot restore an OFF or unselected source;
- source selection does not prove use.

### Provider execution

- real plural native layer arguments are used;
- OFF rejects worldsignals.package USGS;
- OFF rejects generic command/batch USGS access;
- OFF rejects cached layer slices;
- unrelated WorldSignals commands remain unchanged;
- a prepared Run cannot call after the user switches OFF;
- an in-flight switch does not deliver the result as current authorized data;
- ON resumes the existing producer schedule or reports pending refresh honestly;
- shared producer lifecycle is preserved for another authorized user/consumer.

### Result

- real USGS native ID, feed/query, observed/retrieved times, coordinates, depth, magnitude, place, clocks, limits, provenance, attribution, error, and hash/reference are preserved as applicable;
- agent and WorldView consume the same result identity;
- requesting/using Card identity comes from the real Run and operation;
- failure never creates a false used-by fact;
- historical Run evidence remains readable after OFF.

### WorldView and camera

- one Data Sources view renders one ON/OFF switch;
- no duplicate source-control UI remains for USGS;
- agent result updates the row and earthquake entities;
- result arrival sends no focus message;
- ON, OFF, reconnect, readiness, refresh, acknowledgement, and non-spatial result send no focus message;
- current camera position and motion remain unchanged through agent updates;
- one explicit row click or entity selection sends one focus request;
- consumed focus is not replayed on reconnect;
- render acknowledgement includes the exact result/projection identity;
- non-spatial result remains inspectable and creates no geometry.

### ShadowBroker and deduplication

- future USGS fetch behavior obeys the native lifecycle without treating its process-global flag as per-user authority;
- cached data cannot bypass the user's OFF;
- Project switching and multiple iframes cannot flip the source;
- the supervised God's Eye path makes no independent USGS request after cutover;
- exact old timer/fetch callers and configuration are absent after removal;
- standalone/vendor behavior not superseded remains intact;
- map retirement does not stop unrelated shared streams or consumers.

### Existing focused anchors

Likely existing tests to extend include:

- apps/python-models/app/python_models/test_card_domain.py
- apps/backend/src/routes/hermesCardTools.routes.spec.ts
- client/src/features/worldview/WorldViewSurface.spec.tsx
- client/src/components/worldsignal/GodsEyeSurface.spec.tsx
- client/src/components/worldsignal/worldSignalLayerPrefs.spec.ts
- worldsignal/gods-eye-view-main/src/embed/hostBridge.test.mjs
- worldsignal/gods-eye-view-main/src/data/earthquakes.test.mjs
- worldsignal/Shadowbroker-main/backend/tests/test_layer_enable_integration.py
- worldsignal/Shadowbroker-main/backend/tests/test_layer_enable_refresh.py
- worldsignal/Shadowbroker-main/backend/tests/test_openclaw_query_helpers.py
- worldsignal/Shadowbroker-main/backend/tests/test_control_surface_auth.py

Resolve exact commands from current package and test configuration immediately before implementation. Do not invent command names in the plan.

### Evidence categories

Report separately:

1. source exists and current owners were read;
2. structural connection and coverage limits;
3. pre-edit baseline;
4. focused tests;
5. Python static/type checks;
6. backend/client typecheck;
7. affected builds;
8. loaded application health;
9. real saved-Card execution;
10. real native USGS result and refusal paths;
11. result-to-render identity;
12. absence of duplicate supervised fetch;
13. camera stability;
14. Jeremiah's visual acceptance.

---

## 17. Genuine current-source conflicts

### Blocking prerequisite

1. **Stable-profile concurrent sessions:** the canonical one-Card/one-profile requirement depends on simultaneous native sessions. A concurrent correction is in progress and is not part of this packet. End-to-end saved-Card acceptance stops until that boundary is independently green and loaded.

### Required storage decision

2. **No suitable global per-user source owner exists in current source:** browser preferences have the wrong scope, the old generic SQL preferences identity type conflicts with current auth, and runtime context lacks user ID. The plan therefore requires live ledger inspection and the smallest explicit user/source Boolean contract rather than pretending no migration is needed.

### Required source reconciliation

3. **USGS semantic mismatch:** ShadowBroker and God's Eye use different feed/filter/bounds/field/poll behavior. Duplicate removal is forbidden until exact parity is proven.
4. **Cached-data bypass:** current native telemetry/agent reads can expose cached earthquakes after the map flag is false.
5. **Independent globe fetch:** God's Eye currently bypasses ShadowBroker state and fetches USGS directly.
6. **Native argument mismatch:** a current Python test uses singular layer while the real native command accepts plural layers.

### Required UI and camera reconciliation

7. **Duplicate control owners:** Project/Card localStorage, ShadowBroker process flags, and God's Eye local/share state can disagree.
8. **No current Data Sources panel:** WorldView currently has globe/status presentation only.
9. **Automatic camera motion:** the first result candidate currently causes a focus message and Cesium flight.
10. **Selection gap:** the host can parse selection messages, but WorldView does not connect the callback and earthquake entities do not yet emit the same selection event path.

These are implementation facts, not reasons to invent another architecture.

---

## 18. Implementation discipline

For every future phase:

1. restate its Requested Delta and Preservation Set;
2. map every intended file and meaningful hunk to one requirement or proven prerequisite;
3. read current source and run the smallest meaningful baseline;
4. edit the smallest complete boundary;
5. inspect the task diff immediately;
6. prove the replacement before deleting the old path;
7. inverse-search callers, timers, routes, configuration, and dynamic references;
8. report adjacent defects without fixing them;
9. report Python rails restart/reload once if Python changes;
10. report source, tests, build, loaded health, real execution, and visual acceptance separately.

Forbidden expansions:

- Hermes profile redesign inside this packet;
- Project/session/Agent Library/Card identity redesign;
- per-Project source policy;
- per-Card source assignment controls;
- separate user visibility and agent source controls;
- a second source view or browse mode;
- World Monitor;
- Trading or Customer Finder;
- another runtime, scheduler, graph, tool registry, data lake, IDF, or source authority;
- broad schema cleanup;
- universal WorldView seeding;
- broad provider migration before USGS proof.

---

# USGS WORLDVIEW VERTICAL SLICE

## Observable result

> USGS Earthquakes has one persisted ON/OFF control in the one Data Sources view. ON makes it usable by the authenticated user and eligible for the existing Jev pass without injecting it into every agent. A real saved Card may then call the existing ShadowBroker/WorldSignals provider and produce one native, provenance-rich result consumed by the agent and rendered by God's Eye without moving the camera. Actual requested-by/used-by evidence appears on the same row. OFF removes current user/globe access and blocks Jev, direct calls, cached reads, and result delivery.

## Entry conditions

- the stable-profile simultaneous-session prerequisite is independently resolved and proven;
- full Git status and relevant diff are read and preserved;
- Codebase Memory state and direct-source fallbacks are recorded;
- live migration ledger is inspected;
- the authenticated user/source Boolean owner is settled;
- exact Research Agent Card, profile, revision, grants, session, and current Run context are read back;
- canonical USGS feed/filter/field/limit/time/error semantics are frozen;
- required vendor packets are recorded;
- focused pre-edit baselines are captured.

## In scope

- one USGS earthquake descriptor;
- one user-owned global ON/OFF Boolean;
- authenticated read/update and user isolation;
- current user, Jev, operation, cache, delivery, and projection enforcement;
- the existing ShadowBroker/WorldSignals USGS provider path;
- correct native command arguments;
- one authorized USGS candidate in the existing Jev batch;
- bounded signal.package.v1 evidence and spatial projection;
- actual requested-by and used-by Card/Run evidence;
- one Data Sources row with inline readiness/freshness/error/attribution facts;
- host-supplied God's Eye earthquake projection;
- exact render acknowledgement;
- no agent-derived camera motion;
- one explicit user focus path;
- non-spatial no-fake-geometry proof;
- supervised direct USGS fetch removal after equivalence;
- legacy USGS source-writer removal/redirect;
- focused tests, builds, loaded execution, network proof, and visual acceptance.

## Out of scope

- broad provider migration;
- World Monitor;
- full ShadowBroker map retirement;
- broad public data tool family;
- generalized source platform;
- Project source policy;
- Card source assignment;
- separate visibility or agent switches;
- another source view;
- Project/session/Agent Library/Card identity redesign;
- Hermes profile redesign in this packet;
- new runtime, scheduler, graph, tool registry, data lake, or IDF;
- broad database cleanup;
- compatibility renames;
- Trading or Customer Finder.

## Ordered implementation

1. Resolve and prove the entry conditions.
2. Freeze the canonical USGS semantics and fix the fake-test/native-argument mismatch.
3. Add one factual descriptor and the minimal authenticated user/source Boolean.
4. Build the one Data Sources row and make all legacy USGS controls obey it or cease writing.
5. Intersect ON sources into the one existing Jev batch without changing saved Card grants.
6. Enforce OFF at direct operation, generic command, cache, in-flight delivery, and current projection boundaries.
7. Execute one real saved Research Agent Card through worldsignals.package and the native ShadowBroker path.
8. Complete one bounded signal.package.v1 result with real USGS identity, clocks, provenance, limits, and spatial projection.
9. Expose the exact authenticated result and actual Card/Run evidence to WorldView.
10. Deliver and render that result through the supervised bridge without sending a focus command.
11. Add one explicit user click/selection focus path with one-shot acknowledgement.
12. Prove a non-spatial result stays useful without geometry.
13. Prove ON eligibility without automatic model injection or provider use.
14. Prove OFF before Jev, at call, against stale cache, during execution, and in the current globe.
15. Prove exact identity across provider, agent, Run, WorldView, bridge, and rendered entities.
16. Remove only the supervised God's Eye direct USGS fetch/poll after equivalence.
17. Run focused tests, types, builds, loaded proof, duplicate-network proof, inverse residue audit, and visual acceptance.

## Acceptance ledger

### PREREQUISITES

- Stable saved-Card/profile sessions are independently proven.
- Live migration ledger and current user identity owner are read.
- Vendor packets and USGS semantics are recorded.

### AUTHORITY

- One authenticated user/source Boolean is the only mutable source-availability authority.
- Project, Card, Run, localStorage, iframe, Jev, and vendor process flags do not own another value.
- Saved Card grants and credentials remain separate execution/security ceilings.

### DATA SOURCES

- There is one Data Sources view.
- USGS has one ON/OFF control.
- Provider status, current use, freshness, errors, and attribution are row facts, not modes or extra controls.

### ON

- The user may access current USGS data where appropriate.
- USGS may enter the authorized Jev candidate set.
- ON alone does not inject, call, render all data, prove use, or move the camera.

### OFF

- USGS is removed from current user and globe access.
- USGS is absent before Jev.
- Direct, generic, cached, stale-prepared, and in-flight delivery paths cannot return it as current authorized data.
- Historical Run evidence remains readable.

### JEV

- Authorized tools and USGS use one existing bounded Jev request.
- USE/OMIT narrows the current agent only.
- Overflow fails closed for optional sources.
- Jev does not grant, call, or prove use.

### CARD

- One real saved Research Agent Card and one stable Hermes profile are used.
- Exact requesting/using Card and Run identity is retained.
- No Card, profile, grant, credential, or source-assignment clone exists.

### TOOL EXECUTION

- A real worldsignals.package operation reaches the real native ShadowBroker earthquake path.
- Correct plural native arguments are used.
- A mock, catalog entry, or direct unit call is not accepted as live proof.
- Unrelated WorldSignals operations remain working.

### RESULT

- The result contains real USGS event IDs, feed/query identity, observed and retrieval times, coordinates, depth, magnitude, place, clocks, freshness, provenance, truncation, error, attribution, and hash/reference as applicable.
- The agent and WorldView use the same result identity.

### AGENT USE

- Actual requested-by and used-by evidence comes from the real operation and Run.
- ON, Jev USE, or tool presentation alone never creates a used-by fact.
- The row may show current or last use without creating another source state.

### WORLDVIEW

- The authenticated host receives the exact authorized result.
- God's Eye receives the bounded spatial projection.
- Render acknowledgement names the exact result/projection and rendered native entity IDs, or returns a bounded error.
- A non-spatial result remains inspectable and creates no geometry.

### CAMERA

- Result arrival, ON/OFF, Jev, use evidence, refresh, reconnect, and acknowledgement never move or spin the globe.
- One explicit user click/selection can send one focus request.
- The request is acknowledged and is not replayed without another user gesture.

### PERSISTENCE AND ISOLATION

- The Boolean persists across Projects, Cards, sessions, reloads, and devices for one authenticated user.
- One user's choice does not overwrite another's.
- Mounting or switching an iframe/Project does not change it.
- A shared native producer remains running only when another authorized consumer genuinely requires it.

### DEDUPLICATION

- Exact feed/filter/field/ID/clock/limit/failure/render parity is proven first.
- The supervised product performs no second USGS fetch after cutover.
- Only the exact superseded direct fetch/timer and duplicate USGS control writer are removed.
- Inverse caller and residue searches pass.

### BUILD

- Focused Python, backend, client, God's Eye, and conditional ShadowBroker tests pass.
- Touched static/type checks and affected production builds pass.
- No test is weakened or skipped.

### LOADED PRODUCT

- The actual application is loaded.
- A real saved-Card Run reaches the native provider and returns the canonical result.
- ON-without-use, real use, OFF refusal, stale cache, in-flight change, and provider failure are proven honestly.
- Python rails restart/reload is reported if required.

### VISUAL

- Jeremiah can see the one Data Sources list, USGS ON/OFF, actual Card-use evidence, freshness/error detail, and the real spatial result.
- Agent activity updates entities without disturbing the camera.
- Explicit user selection focuses the expected real entity.
- Final visual acceptance remains Jeremiah's decision.

## Required implementation report

Report separately:

- requested delta delivered;
- Preservation Set and regression ratio;
- exact files and hunks mapped to requirements;
- Codebase Memory state and direct-source coverage fallback;
- source and structural evidence;
- migration/user-authority evidence;
- focused test results;
- typecheck/build results;
- Python rails restart/reload requirement;
- loaded application health;
- real saved-Card/provider execution;
- ON/OFF, Jev, execution, cache, and in-flight enforcement;
- result/WorldView/render identity correlation;
- camera non-movement and explicit-focus proof;
- duplicate fetch and residue proof;
- unresolved gaps;
- Jeremiah's visual acceptance status.
