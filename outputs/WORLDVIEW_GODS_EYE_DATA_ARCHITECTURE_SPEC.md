# WorldView / God's Eye / Data Sources

## Canonical Phase 1 plan and implementation ledger

Repository:

```text
C:\Projects\LiquidAIty\main
```

Current authority:

- `PROMPTSPEC — GOD'S EYE FIRST, SHADOWBROKER SECOND` supplied by the owner;
- the later explicit correction that ShadowBroker may not fit this product boundary and is not assumed to be the future provider architecture;
- the owner's instruction to finish God's Eye before doing any ShadowBroker work.

Plan status:

```text
PHASE 1 SOURCE IMPLEMENTED
FOCUSED TESTS / TYPECHECKS / BUILDS PASSING
CONTROLLED LOADED WORLDVIEW PREVIEW PROVEN
PERSISTED SELECTED-PROJECT PROOF AND OWNER VISUAL ACCEPTANCE PENDING
SHADOWBROKER NOT STARTED
```

This document replaces the rejected provider-first/USGS-first plan. It does not preserve that plan as a fallback.

---

## 0. Prerequisites and stop gates

Prerequisites come first and remain separate from higher proof tiers.

### P0. Bound the requested delta

The active delta is only:

```text
selected real LiquidAIty Project
        ↓
WorldView
        ↓
supervised God's Eye surface
        ↓
one truthful Data Sources pane over native God’s Eye sources
```

In scope:

- supervised God’s Eye bridge;
- native source readback and native layer ON/OFF;
- one LiquidAIty Data Sources pane;
- selection round-trip;
- explicit one-shot user focus;
- camera isolation from source/background activity;
- user-started native God’s Eye voice preservation;
- Mooncycler presentation for WorldView;
- loaded and visual proof.

Out of scope:

- ShadowBroker integration or inspection;
- USGS/AIS/aircraft/fire/provider migration or deduplication;
- Jev source eligibility;
- global authenticated-user persistence;
- agent-use evidence without a real Run;
- provider framework, new runtime, graph, scheduler, data lake, IDF, profile system, or Project redesign;
- unrelated repository health work.

### P1. Preserve the checkout and current platform

- Preserve unrelated owner work and the dirty tree.
- Do not mutate Git history or staging.
- Reuse the current Project, saved WorldView Card attachment, Agent Library, Hermes, and Agent Builder architecture.
- `agentBuilderStore` remains the existing Project/deck/Card persistence adapter. It is not a Data Sources owner, agent brain, provider registry, or reason to redesign the platform.
- Do not change saved Card identity, runtime binding, profile, topology, or source grants in this phase.

### P2. Codebase Memory projection

The canonical CBM project remains:

```text
C-Projects-LiquidAIty-main
C:/Projects/LiquidAIty/main
```

The current imported product roots are:

```text
agent-products/gods-eye-view/
agent-products/shadowbroker/
agent-products/kronos/
```

All three imported roots are excluded from the derived CBM projection by `.cbmignore`.

The earlier blanket `/worldsignal/` exclusion is superseded. A final full projection is performed only after the implementation tree stops changing; no tracked hook, model turn, or extra frontend owns reindexing.

### P3. Current-source and vendor proof

Before implementation, current source established:

- WorldView already mounts in the selected real Project;
- `GodsEyeSurface` already owns the isolated supervised iframe boundary;
- God’s Eye already has a mature `DataLayerManager`, native sources, native persistence, selection events, camera, and user-started voice;
- the old WorldView wrapper incorrectly polled a Card Run, chose the first signal candidate, and automatically focused it;
- the bridge reported a `Set` as enabled-layer IDs, omitted truthful source facts, had no host layer command, and could lose its one-shot host config;
- the native Data Layers panel would duplicate a new LiquidAIty pane;
- Space Missions source enable and a later background TLE lookup could move the camera.

Vendored-project packet:

```text
VENDORED PROJECT
agent-products/gods-eye-view

PURPOSE
Complete its existing supervised bridge and enforce the Phase 1 camera/source contract.

EXTERNAL ALTERNATIVE CHECK
The existing hostBridge, DataLayerManager, LayerStateCoordinator, and Cesium camera are the correct extension points. No dependency or second renderer is needed.

FILES AND SYMBOLS
src/embed/hostBridge.js
src/main.js
src/ui.js
src/data/rocketLaunches.js
focused tests

UPSTREAM BEHAVIOR PRESERVED
Standalone native source UI, providers, rendering, explicit camera interactions, and user-started voice remain. Supervised mode changes only host integration/state authority. Source/background-driven Rocket camera movement is removed.

CONTRACTS
Scoped bootstrap/config/readback, native source ON/OFF, truthful readiness, native selection, and explicit focus acknowledgement.

TESTS
Focused bridge/layer/client tests, production typecheck, vendor/client builds, loaded product proof, and owner visual acceptance.

FORK COST
Four bounded existing seams plus focused tests.

ROLLBACK
Revert only the recorded Phase 1 hunks; no provider or saved-data migration is involved.
```

### P4. Acceptance stop gate

Do not begin a provider plug-in until all of these are separately reported:

1. source connection;
2. focused tests;
3. production typecheck/build;
4. loaded application execution;
5. actual visible interaction proof;
6. Jeremiah’s visual acceptance.

A lower tier never proves a higher one.

---

## 1. Requested Delta

The smallest complete observable change is:

> Jeremiah opens WorldView from the selected real Project and sees the supervised God’s Eye globe. One LiquidAIty Data Sources pane lists the actual native God’s Eye data layers and controls their real manager-owned ON/OFF state. Native selection returns to LiquidAIty. Only an explicit user Focus action may fly the camera. Source changes, data refreshes, reconnects, readiness changes, and background work never do. WorldView uses the existing Mooncycler icon.

---

## 2. Preservation Set

### Project, Card, and runtime

- selected Project identity and existing deck topology;
- saved WorldView Card attachment and exact technical identifiers;
- saved Card/profile/runtime authority;
- existing Agent Library and Agent Builder behavior;
- Main, Builder, graph owners, Magnetic, Team, Runs, and IDF boundaries;
- no alternate runtime or fallback.

### God’s Eye

- Cesium remains the only WorldView renderer;
- all current native source modules and provider fetches remain;
- `DataLayerManager` remains the source/layer lifecycle owner;
- native entity, track, selection, camera, and visual lifecycle remain;
- explicit in-globe user camera interactions remain;
- voice remains native, local-scene scoped, and user-started;
- standalone God’s Eye retains its native Data Layers panel and persistence;
- attribution remains visible through the existing credit owner.

### Source semantics

- Phase 1 ON/OFF is honest native layer visibility/lifecycle control;
- it is not yet described as the final authenticated global user/agent ceiling;
- no fake provider readiness, observation timestamp, agent use, or Jev use;
- unknown availability remains unknown;
- no visual-only preferences appear as Data Sources.

### Camera

- no Card result, first candidate, source toggle, source refresh, source readiness, reconnect, or background provider work moves the camera;
- one explicit user focus request is consumed at most once;
- Project/Card scope changes create a fresh child bridge rather than rebinding a live accepted scope;
- cancelled or impossible camera flights fail honestly.

---

## 3. One Data Sources model in Phase 1

There is one user-facing pane:

```text
DATA SOURCES

Native source                 ON / OFF
Provider
Lifecycle / feed state
Availability when actually known
Count when actually known
Last native refresh when actually known
Error when present
```

The pane is populated only from native manager rows where `showInTogglePanel !== false`.

Therefore it excludes:

- basemap and terrain choices;
- day/night and celestial presentation;
- labels, HUD, filters, detection, and post-processing;
- camera modes and visual effects;
- the hidden `military-awareness` composite/coordinator;
- any registry entry without a distributed runtime module.

The React client does not hardcode a source catalog and does not store Project/Card source preferences. The native God’s Eye manager remains the Phase 1 authority.

Supervised mode hides the iframe’s native Data Layers pane, so the same manager is not exposed through two competing user-facing control surfaces. Standalone mode is unchanged.

---

## 4. Readiness and status contract

Readiness is intentionally split:

```text
iframe loaded
≠
bridge accepted
≠
source state settled
≠
individual provider available
```

The UI reports:

- God’s Eye bridge pending/ready;
- native source state pending/ready;
- each source’s settled ON/OFF and lifecycle state;
- nullable availability;
- nullable native refresh time;
- current native error.

`nativeAgentAvailable` means the native voice-control surface exists. It is not provider/model readiness. The product labels it as a user-started native voice control rather than a second LiquidAIty runtime.

---

## 5. Existing bridge, completed rather than replaced

The existing `postMessage` boundary remains the only bridge. No event bus was added.

### Child to host

```text
gev.embed.bootstrap.v1
gev.embed.ready.v1
gev.embed.layer-state.v1
gev.embed.selection.v1
gev.embed.layer-visibility.result.v1
gev.embed.focus.result.v1
gev.embed.error.v1
```

Every post-acceptance message is scoped by exact Project and Card IDs.

### Host to child

```text
gev.embed.host-config.v1
gev.embed.layer-visibility.v1
gev.embed.focus.v1
```

The child bootstrap closes the late-listener race by causing the host to resend configuration.

Layer requests:

- accept only an actual visible native manager row;
- call `DataLayerManager.setEnabled(layerId, enabled, { origin: 'user' })`;
- wait for native source-state settlement;
- return the exact request ID and a fresh authoritative state snapshot;
- do not optimistically change the checkbox;
- release the pending control only on the correlated result or bridge reset.

Focus requests:

- require exact scope, a distinct request ID, a real selected target, and valid coordinates;
- are bounded against replay;
- invoke the Cesium camera only from the explicit command;
- acknowledge only after Cesium completes;
- report cancellation or scene morphing as failure.

Selection projection returns bounded native identity, type, label, coordinates when real, and the local context `updatedAt` timestamp when present. It does not mislabel that timestamp as a provider observation time.

---

## 6. Camera contract

Allowed camera owners:

- direct pointer/keyboard/touch navigation;
- explicit native God’s Eye entity/scene actions;
- user-started native voice camera action;
- the LiquidAIty Focus button for the currently selected native entity.

Forbidden camera triggers:

- Card Run output;
- first candidate selection;
- source ON/OFF;
- source/provider refresh;
- source-state restoration in supervised mode;
- bridge readiness or reconnect;
- background Rocket TLE/catalog arrival;
- future agent/Jev/provider activity.

The old Card-run/SignalPackage-to-focus path is removed rather than retained behind a flag.

---

## 7. Source authority: now versus later

### Current Phase 1 truth

```text
LiquidAIty Data Sources pane
        ↓ exact scoped command
God's Eye DataLayerManager
        ↓ real native lifecycle
existing native God’s Eye source modules
```

This proves the surface and source UX without inventing global storage.

### Possible later target, not implemented or pre-decided

After visual acceptance, a later packet may inspect the existing authenticated user-settings owner and decide whether a durable global `sourceId + enabled` authority is needed for both user access and Jev eligibility.

ShadowBroker is not assumed to be the provider foundation. If later source evidence shows that one of its capabilities fits, it may be evaluated as one additional Data Source through the already-working surface. The same is true of another provider. That decision requires a new PromptSpec and exact capability proof.

There is no predetermined USGS migration, ShadowBroker map retirement, provider consolidation, or Jev change in this plan.

---

## 8. Phase 1 file ledger

The file paths below are preserved from the Phase 1 implementation checkout. The controlled product
roots have since moved; use the current roots above and in `ARCHITECTURE.md` for live source paths.

### LiquidAIty client

- `client/src/components/worldsignal/GodsEyeSurface.tsx`
  - scoped bridge parsing;
  - bootstrap reconfiguration;
  - one-shot imperative layer/focus commands;
  - exact result correlation;
  - scope-keyed iframe remount.
- `client/src/features/worldview/WorldViewSurface.tsx`
  - one Data Sources pane;
  - truthful status/readback;
  - native selection and explicit Focus;
  - no Card-run polling or automatic first-candidate focus.
- `client/src/features/agentbuilder/core/AgentBuilderRail.tsx`
  - WorldView uses the existing Mooncycler;
  - the existing World entrance uses the displaced globe;
  - technical IDs remain unchanged.
- `client/src/pages/agentbuilder.tsx`
  - removes obsolete WorldView analyst/Card-run props only.

### Controlled God’s Eye fork

- `worldsignal/gods-eye-view-main/src/embed/hostBridge.js`
- `worldsignal/gods-eye-view-main/src/main.js`
- `worldsignal/gods-eye-view-main/src/ui.js`
- `worldsignal/gods-eye-view-main/src/data/rocketLaunches.js`
- focused tests beside those owners.

### Discovery policy and canonical docs

- `.cbmignore`
  - replaces `/worldsignal/` with `/worldsignal/Shadowbroker-main/`.
- this plan;
- the vendored divergence register in `ARCHITECTURE.md`.

No backend, database, Python rails, IDF, Card/profile, Project, graph, ShadowBroker, or Jev production file is part of Phase 1.

---

## 9. Phase 1 acceptance ledger

| Proof tier | Required result | Current status |
| --- | --- | --- |
| Source | Existing bridge/manager owns truthful scoped source control; old automatic focus removed | Implemented; bounded review and final diff audit clean |
| Focused client tests | Handshake, scope, source readback, pending correlation, explicit focus/no replay, icon mapping | 20/20 passing |
| Focused vendor tests | Native projection, bootstrap, source readiness, manager command/readback, focus dedupe/cancel, Rocket camera isolation | 114/114 passing |
| Client typecheck | Production client boundary | Passing |
| Client build | Production Vite build | Passing |
| God’s Eye build | Production Vite build | Passing with documented pre-existing warnings only |
| Loaded services | Client and God’s Eye reachable at `127.0.0.1:5173` and `127.0.0.1:4174`; no persistent backend data was created for proof | Controlled preview passing; persisted selected-Project proof pending |
| Visible WorldView | Supervised globe and one outer Data Sources pane are visibly loaded | Passing in controlled browser-only Card attachment; persisted selected-Project proof pending |
| Native ON/OFF | Native OFF readback changes to authoritative ON readback through the outer pane | Passing: `Datacenters` reported ON with 4,362 native items |
| Camera isolation | Camera pose remains unchanged through a source/background update | Passing: maximum observed pose delta during native Datacenters OFF-to-ON was exactly `0` |
| Selection/focus | Real native selection returns; explicit Focus runs once and settles | Passing in controlled preview: a projected native datacenter was selected, Focus enabled, and the explicit action moved Cesium; exact completion/cancel/replay behavior also has focused test coverage |
| Voice | Native voice remains user-started/local-scene scoped | Loaded status reported `present · user-started`; microphone interaction was not exercised |
| Owner visual acceptance | Jeremiah inspects and approves the surface | Pending; cannot be self-declared |

Phase 1 stops after presenting the loaded product and this ledger. No provider plug-in follows automatically.

### Controlled loaded proof boundary

The loaded proof used the real built client, real supervised God’s Eye iframe, real
`DataLayerManager`, real local Datacenters module, real Cesium camera, and real native marker
selection. The browser supplied only an ephemeral Project/Card attachment and an empty chat
history response because the reachable Project catalog contained no saved Projects. That
fixture existed only inside the validation browser: it did not write a Project, Card, deck,
profile, Run, source preference, or database row.

Observed loaded facts:

- bridge `0.1.0` and source state both reached ready;
- 14 native manager rows appeared in the one LiquidAIty Data Sources pane;
- the iframe-native `DATA LAYERS` panel had computed display `none` and zero toggle children;
- Datacenters changed from native OFF readback to native ON readback with 4,362 items;
- the camera pose delta across that data-source activation was exactly zero;
- a real projected native marker produced the selected entity `Servicio Televisión por Cable`
  from `local-datacenters`;
- the explicit Focus control was enabled and moved the Cesium camera;
- the existing Mooncycler icon was visible on the WorldView rail entry.

The real child bridge was also exercised independently through a disposable parent page, without
mocking the God’s Eye source runtime:

- an exact scoped `Earthquakes (24h)` ON command returned its correlated result with 45 USGS
  events and a real native refresh timestamp;
- the maximum camera difference was zero apart from `9.7e-17` floating-point noise in one up-vector
  component;
- real OpenSky data reported 12,350 flights, a Cesium `scene.pick()`-confirmed billboard received an
  actual mouse click, and the bridge emitted a real flight selection;
- a later real flight click followed by an exact scoped Focus command returned
  `gev.embed.focus.result.v1` with `ok=true` and changed the camera pose.

Visual evidence:

```text
C:\Users\jerem\.codex\visualizations\2026\09\27\01a0e0e8-9272-7e91-b1ae-309f8b78b0bc\worldview-phase1-native-sources.png
```

This proves the loaded client/vendor integration without pretending that an unsaved Project is
a persisted product fixture. Final selected-Project execution requires an existing saved Project
with the God’s Eye presentation attachment; owner visual acceptance remains separate.

---

## 10. Forbidden work

- Do not inspect or integrate ShadowBroker in this phase.
- Do not reintroduce Card-run/SignalPackage automatic focus.
- Do not add ACTIVE/AVAILABLE tabs, Show All, user-versus-agent controls, or another source-state ontology.
- Do not expose the iframe’s native Data Layers pane beside the LiquidAIty pane.
- Do not hardcode a second source catalog in React.
- Do not persist source state per Project, Card, profile, Run, or IDF.
- Do not claim native source ON/OFF already gates agents/Jev.
- Do not fake current-agent-use evidence.
- Do not move the camera because data changed.
- Do not absorb unrelated repository defects.

---

## 11. Final construction order

```text
1. God's Eye supervised surface
2. One native-backed Data Sources pane
3. Camera / selection / focus / voice boundaries
4. Source tests and production builds
5. Loaded visible interaction proof
6. Jeremiah visual acceptance
7. STOP
8. Evaluate a later source only under a new exact packet
```

Do not reverse this order.
