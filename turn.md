# Turn Report — OpenStudio dependency repair, 2026-10-20

## Status

PASS / COMPLETE for the installed dependency runtime and its direct engineering/persistence proof.
The broader NRGSIM modeling application remains INCOMPLETE. Saved-Card execution, modeling UI
acceptance, interactive performance, and simulation are NOT PROVEN by this repair.

## Requested Delta

Repair the installed OpenStudio/MCP dependency path using the actual upstream runtime and prove
real measure execution and OSM persistence. The owner's latest direction stopped UI work and
prohibited scaffolding, imposters, and fake production substitutes.

## Preservation Set

Trading, shared services, saved Cards/models/prompts/grants/topology, existing OSMs, and unrelated
dirty work remain outside this repair. No Git mutation, vendor-source modification, security
disable, saved-Card mutation, shared-service restart, or UI edit was performed by this repair.
Engineering writes were confined to new scratch proof directories. The prior Trading handoff
below is preserved verbatim; its historical claims are not claims of this dependency review.

## Tasks and Definitions of Done

- T001 — Restore the real dependency runtime. Definition of Done: one pinned upstream MCP process
  serves the existing serialized Project session with isolated paths and no native fallback.
  COMPLETE: official `nrel/openstudio-mcp` 1.2.1 image, digest
  `sha256:5c46c32bb4acc8e008c795d51fcc3ad26b51ef858631ba2688ce0a3f935c6601`,
  OpenStudio 3.11.0, three Project mounts, read-only inputs, no network or published ports,
  unchanged upstream sandbox, and `--pull never`.
- T002 — Preserve engineering state during readback. Definition of Done: host/runtime paths resolve
  only through the Project mounts, authoring reads explicit SDK fields from the saved OSM, and unsafe
  generic Space introspection is refused before the upstream call. COMPLETE for `Space`, `OS:Space`,
  and `OS_Space`; serialization, revision/selection refusals, and original tool contracts remain.
- T003 — Prove actual dependencies and persistence. Definition of Done: real Python and Ruby
  measures execute, geometry starts from an empty SDK model, and saved geometry/name/adjacency
  survive an MCP session restart and reopen. COMPLETE for the bounded proofs below.

## Actual Changes

- `agent-products/nrgsim/nrgsim/launch.py` — replaces the broken native Windows MCP launch path
  with the pinned official image; builds isolated mounts and translates mounted paths.
- `agent-products/nrgsim/nrgsim/session.py` — uses that launcher in the existing session owner,
  resolves returned artifacts, reads authoring results through the existing explicit SDK projection,
  and refuses the known destructive Space introspection call.
- `agent-products/nrgsim/authoring_proof.py` — exercises empty-model authoring, two stories,
  three Spaces/zones, rename, save, actual session restart, and reopen.
- `agent-products/nrgsim/tests/prove_runtime.py` — opt-in real upstream dependency proof with
  Python measure creation/execution, geometry, save/reload, and evidence receipts.
- `agent-products/nrgsim/tests/test_launch.py` and `test_session.py` — bounded mount/path,
  missing-runtime, and unsafe-read refusal contracts.
- `ARCHITECTURE.md` — records the pinned runtime and the upstream Space-introspection limitation.
  Its earlier UI prose and other pre-existing dirty hunks are not acceptance claims of this slice.

## Verification

- Source: PASS. Independent direct reads covered the seven frozen files and relevant unchanged
  projection, measure packaging/entry point, SDK authoring, and provider callers. The Primary's CBM
  generation was `2026-10-20T16:41:36Z`; `session.py` had `metadata_changed`, so direct source was
  authoritative. The reviewer did not operate CBM. The replaced native MCP launch path has no live
  fallback; upstream SDK/MCP source was not changed.
- Deterministic: PASS. Reviewer rerun: launch 5/5, session 11/11, provider 4/4. Primary also passed
  7/7 direct OpenStudio SDK tests and Python compilation. Scoped `git diff --check` passed.
  Mocked coordination tests are contract evidence only; they do not establish engine execution.
- Direct runtime: PASS. `agent-products/nrgsim/.data/66aa1377-db61-46f6-822c-afbcc7dc72e5/runtime-proof.json`
  has `ok=true`, discovers 197 upstream tools, executes a newly created Python measure, authors one
  80 m² Space from an empty model, and saves/reloads it with its ThermalZone. The installed image
  digest was independently reread. `ruby-runtime-proof.json` in that same directory has `ok=true`;
  the Primary's independent SDK read found the saved Ruby result's north axis at 30 degrees.
- Engine executable: the Primary ran the actual
  `/usr/local/openstudio-3.11.0/EnergyPlus/energyplus-25.2.0` version command successfully:
  `EnergyPlus, Version 25.2.0-cf7368216c`, exit 0. Upstream `get_versions` still reports its
  EnergyPlus field as null. No simulation was run; executable presence is not simulation acceptance.
- Persistence: PASS for the scratch proof. The independently read
  `agent-products/nrgsim/.data/b57dc567-ab26-42fb-a47c-5534b0c2fd77/authoring-proof.json`
  has no error and records `persistedAcrossSessionRestart=true`. Model
  `314163e2-1d42-40c1-b648-63ff956884f3` contains two stories, three Spaces, three ThermalZones,
  240 m², and four reciprocal Surface boundaries. Names are Office East, Office West, and
  Upper Studio. The Primary independently verified these through the SDK after the restart;
  the reviewer verified the receipt, paired-handle projection, and saved-file hash:
  `6496edec799da9f86b35ce167a2a7c3091c7cec989ae509efe3e04a97f725cc3`.
- Loaded application: health only. During concurrent work, the shared MCP PID changed from 6088
  to 40612; this repair did not restart it. The Primary's latest health read reported ready and
  `sourceCurrent=true`. That does not prove the loaded modeling workflow or saved-Card execution.
- Live saved Card: NOT RUN. Visual/owner acceptance: NOT PROVEN. No modeler UI was opened or
  imported for this repair. Simulation and baseline/proposed comparison: NOT RUN.
- Resource cleanup: the reviewer independently found no running container for the pinned image;
  the isolated proof containers had exited and been removed.

Python rails restart/reload required: yes, for a running process that predates these changes.
This statement authorizes no shared-service restart.

## Findings, Limits, and Remaining Work

- No blocking defect was found in the dependency-repair slice. No new regression was found among
  the exercised isolation, serialization, refusal, tool-contract, runtime, and persistence invariants;
  the regression ratio for those exercised invariants is 0.000.
- Upstream 1.2.1 generic introspection calls `Space.unmatchSurfaces()` because its skipped prefixes
  omit `unmatch`; the Primary measured paired boundaries falling from 2 to 0. The repair avoids that
  readback and explicitly refuses generic Space inspection. The existing generic human-properties
  route therefore reports the refusal for Space; that broader UI path remains unfinished.
- Upstream detailed Building inspection divides by zero for an empty model. The dependency proof
  uses the existing model-summary operation to assert the same actual Building name. No upstream
  patch, fabricated read, or success fallback was introduced.
- Measured authoring-measure calls took roughly 18–58 seconds on the pressured host. These are
  functional runtime results, not interactive-performance acceptance.
- Broader authoring/UI changes already present in the dirty tree remain UNFINISHED and outside
  this acceptance. Complete loaded modeling, saved-Card, UI, and simulation acceptance separately.
- `ARCHITECTURE.md` now describes the repaired runtime and its refusal accurately; `PLAN.md`
  continues to label the first modeling checkpoint incomplete. No unrelated documentation changed.

## Changed-File Snapshot

Exact full-file bytes for the seven files changed in this dependency slice, including any preserved
pre-existing hunks in those files. The report and unrelated dirty files are excluded. Lines are sorted
by repository-relative path and joined with LF plus one final LF for the combined checksum.

```text
9302e0a2c88ec9eada44d60acea76b81ef7ce86c95c57c5f3b4c4cc8cbcf8b6d  agent-products/nrgsim/authoring_proof.py
98de6c9e8539119f1cd12859a538deb3a340b7eccf37d11ac22e804474391a37  agent-products/nrgsim/nrgsim/launch.py
d9b3d930357be96f58c96ba929326803cfce3125399dedaef57ec8bc89f0f4cb  agent-products/nrgsim/nrgsim/session.py
79772b0dce7d7a632d0f45f468422a69c4a111f81b1f775d386936843a550074  agent-products/nrgsim/tests/prove_runtime.py
12b989fa1c8793d67ff0c3d3a244a4a620f844cac0de1f6db0d6a8d63aec0226  agent-products/nrgsim/tests/test_launch.py
70a4eb276d9ce977693b55448a9622ceb52d87e5324da9db344978f686f58eda  agent-products/nrgsim/tests/test_session.py
0644c84f380773385e8efffcbabc394fb43f57ea63abb4edf7ee5025c00c6016  ARCHITECTURE.md
```

REVIEW_SNAPSHOT_SHA256: 242c20a949fd1aea3beef02d5b7ada5e59f374b2304ee6fced02bf6dab73622d

---

# Prior Trading handoff — preserved, not this cleanup's claims

## Status

PARTIAL

## Requested Delta

- Treat the earlier trading conversation as failed visual acceptance because its completed ThinkGraph settlement did not refresh the loaded graph workspace.
- Make each completed ordinary Main pair refresh the visible ThinkGraph only after that exact Run's real settlement, then repeat the natural space-investment conversation through Preview.
- Preserve KnowGraph as the sourced-research Card and verify Main uses it without directly invoking Trader or Magnetic.
- Undo the partial top-level `gods-eye-view`, `Kronos`, and `shadowbroker` move and restore those products under `agent-products` using Git, without losing runtime data.

## Preservation Set

- Preserve the accepted unified graph canvas, original inspector pull tab, Think/Know/Code layer behavior, Bot Mode, wires, topology, saved Card grants, authentication, startup repairs, Entity/Relationship headers, and all unrelated dirty-tree work.
- Preserve Engraphis as the sole ThinkGraph writer, Graphiti as the sole KnowGraph writer, and the saved Cards as prompt/tool authority.
- Do not create a graph poller, second writer, prompt queue, direct worker shortcut, trade, order, position, decision, portfolio mutation, branch, commit, push, stash, reset, or broad restore.

## Tasks

### T001 — Restore imported products to `agent-products`

- Key Objective: remove only the partial root duplication while preserving product source and non-reproducible runtime state.
- Definition of Done: the three top-level duplicate roots are absent, the authoritative product roots exist under `agent-products`, Kronos is checked out at its pinned Gitlink, and startup resolves only the retained paths.
- Result: COMPLETE. Git history proved commit `fb07682d1` accidentally added 40 top-level cache/log/generated/runtime files without moving any authoritative product source. God’s Eye cache/log data and ShadowBroker identity/ledger data were moved to the corresponding ignored `agent-products` paths. Git reversed the accidental tracked additions and removed verified generated dependency/build residue. The empty top-level Kronos residue was removed, and `agent-products/kronos` was initialized from the local pinned Git object `67b630e67f6a18c9e9be918d9b4337c960db1e9a`. The stale `.git/index.lock` was not deleted or modified.

### T002 — Refresh ThinkGraph after exact completed-Run settlement

- Key Objective: make the loaded graph show the Think created by a completed Main pair without polling or delaying Main chat completion.
- Definition of Done: Main completion triggers one projection read correlated to the exact Run; the read waits for an in-flight settlement; rapid completed Runs settle serially; later refreshes may supersede earlier reads without losing a settlement.
- Result: COMPLETE. `thinkGraphCaptureSynchronization` now serializes the existing saved-ThinkGraph capture per Project/deck and exposes one exact active-Run barrier. Main registers the capture before its completion frame. The graph hook issues one post-completion projection read with `afterRunId`; the backend waits only for that Run's active capture, then reads Engraphis. No polling, visible transport state, graph writer, or alternate data path was added.

### T003 — Keep legitimate long research Runs connected

- Key Objective: repair the exact loaded failure that stopped the second Main research turn.
- Definition of Done: a legitimate silent research/tool phase survives the former 45-second cutoff while actual socket closure and the existing 30-minute request timeout remain enforced.
- Result: COMPLETE. Run `req_ac72a99f79dc47c0` failed after 46.8 seconds with `hermes_gateway_closed_during_turn` while the Hermes process remained live. The LiquidAIty-owned Gateway client now uses a five-minute heartbeat deadline; upstream Hermes heartbeat code and request behavior are unchanged. The retried Run remained live past 45 seconds and completed after 5:07, including a 3:11 KnowGraph consultation.

### T004 — Repeat the natural conversation in Preview

- Key Objective: prove the normal Main -> KnowGraph research -> Main answer -> automatic ThinkGraph flow through the loaded product.
- Definition of Done: natural user prompts are visibly present, Main and the saved child Cards complete, the final Think appears in the inspector, and no direct Trader/Magnetic or trading-state action occurs.
- Result: COMPLETE for Main and ThinkGraph. User message `msg_62ced559-7542-4e04-b921-832f2fee2776` is exact Run evidence for Main `req_b625f23de6d94607`. Main created KnowGraph child `__bot_dm__fadd0f09b95b28490deeb2dc21c36670f4b3f074321fe127f56986c00b1be5ff`, completed its sourced comparison, and then completed. Automatic ThinkGraph child `req_ea8a322046a54934` settled the pair. The visible Rocket Lab Think inspector showed the new 2:37:29 AM record, `Rocket Lab remains a strong business but an unproven purchase at the current valuation`, above the prior 2:08:26 AM record.

### T005 — Audit KnowGraph persistence

- Key Objective: distinguish using KnowGraph for research from creating a confirmed saved Know.
- Definition of Done: report whether the research created a new cited Know through Graphiti and identify the exact authority if it did not.
- Result: BLOCKED by the current saved Main task wording, not by tools or grants. The current KnowGraph Card grants `graphiti.add_memory_to_entity`, and its saved prompt requires useful verified findings to be persisted. Main nevertheless sent this exact instruction in the real Bot delivery: `Do not write graphs/memories/Cards...`. KnowGraph correctly obeyed that narrower task, used two tools, returned cited research, and explicitly reported no graph or memory change. The visible Know tab therefore retained the older cited Rocket Lab Know. Fixing this requires an authorized saved Main prompt revision; no deterministic TypeScript prompt filter or hidden grant widening was added.

## Actual Changes

- `apps/backend/src/services/thinkGraphCaptureSynchronization.ts` — one in-process active-Run settlement barrier and per-Project/deck capture lock.
- `apps/backend/src/routes/mainSession.routes.ts` — registers each background completed-pair capture before sending Main completion and serializes repeated captures through the existing capture owner.
- `apps/backend/src/routes/thinkGraph.routes.ts` — waits for an optional exact `afterRunId` capture before returning the provider projection.
- `client/src/features/agentbuilder/state/useAgentBuilderKnowledgeGraphs.ts` — exposes an explicit Run-correlated ThinkGraph refresh.
- `client/src/features/agentbuilder/console/useAgentBuilderMainChat.ts` and `client/src/pages/agentbuilder.tsx` — trigger that refresh only after a completed, non-addressed Main answer with an observed Run ID.
- `apps/backend/src/services/hermesGateway.ts` — application adapter heartbeat deadline increased from the upstream 45-second default to five minutes; request timeout remains 30 minutes.
- Focused backend/client tests cover capture ordering, projection waiting, completion-triggered refresh, steer exclusion, and Gateway construction.
- Removed 40 mistakenly tracked top-level runtime/generated files under `gods-eye-view/**` and `shadowbroker/**`; preserved non-reproducible data at the corresponding ignored `agent-products/**` locations.
- Initialized `agent-products/kronos` at its existing pinned Gitlink without a network fetch or dependency update.

## Verification

- Source: PASS — all current callers resolve `agent-products/gods-eye-view`, `agent-products/kronos`, and `agent-products/shadowbroker`; no top-level duplicate root remains. The completed-pair writer remains the saved ThinkGraph Card plus Python settlement rails; the client only refreshes provider output.
- Deterministic: PASS — six focused backend/client files passed 26/26; the earlier five-file graph set passed 23/23; backend and client source/spec typechecks passed through `npm run typecheck:all`; Python trading tests passed 11/11; `git diff --check` passed with only pre-existing line-ending warnings. The complete TypeScript run passed 508 tests with one intentional skip and one environment test timeout; that exact environment file then passed 8/8 alone.
- Loaded: PASS — canonical `npm run dev:fresh` rebuilt and loaded backend, Hermes, Python rails, KnowGraph, MCP, WorldView, WorldSignals, and Vite from the retained product roots. MCP published 58 tools. The current saved deck revision remained `5c09ee33-8941-4e82-b3bf-1f5eec4fec6b`.
- Live Agent: PARTIAL — Main, KnowGraph, and ThinkGraph all completed through the real saved-Card path. The prior 45-second transport failure was reproduced and then absent after repair. KnowGraph research succeeded, but a new Know was not requested by Main's actual child task and therefore was not written.
- Persistence: PASS for ThinkGraph; FAIL for the intended new Know. Main pair evidence, Run IDs, and the new Engraphis Think read back durably. No Card, deck, grant, topology, trading, order, position, portfolio, or Auth0 state changed.
- Visual: PASS for the submitted prompts, Main researched answer, joined graph, and two new visible Think records. FAIL for a new Know because the Know tab truthfully retained its prior cited record.

## Baseline or Unrelated Failures

- The first follow-up Run `req_ac72a99f79dc47c0` is retained as truthful failed evidence with `hermes_gateway_closed_during_turn`; it was not deleted or rewritten.
- The existing `.git/index.lock` predates this work and remains untouched. No index mutation, commit, branch, reset, stash, or lock removal occurred.
- The pre-existing untracked `jeplus.err` and all unrelated dirty-tree work remain untouched.

## Documentation Coherence

- No architecture, plan, Entity/Relationship header, or unrelated documentation was changed. This `turn.md` is the factual current-run handoff.

## Remaining / Blocked

- A new sourced Rocket Lab Know was not persisted because Main's real child task explicitly prohibited graph/memory writes.
- The smallest correct next change is one saved Main prompt revision, mirrored in the source default, stating that a bounded KnowGraph research consultation must not suppress KnowGraph's own authorized persistence policy. This changes saved Card authority and is not authorized by the current preservation set.
- No further normal trading conversation should be used as proof of Know accumulation until that saved-prompt decision is approved and repaired.

## Proposal — Not Implemented

- Authorize one bounded Main prompt revision: restrictions on trades, portfolios, files, Cards, or unrelated saved state must not be copied into a KnowGraph research task as a prohibition on KnowGraph's own cited Graphiti write. KnowGraph would still decide whether findings are useful enough to persist, and its existing saved grant ceiling would remain unchanged.

## Changed-File Snapshot

```text
1686ab58650aa508b2986b0d9dea3a7c35ac7e3abde172dffc52ab133b510621  apps/backend/src/services/hermesGateway.ts
16d469156558fd710af751c1960cac60b8c14749a72e3a04cbd1ba6906c53e80  apps/backend/src/routes/thinkGraph.routes.spec.ts
39d39d1f658e792ea23a23d9d234b3daa9e96af6811c901c8e6cf9d0898ee3b1  client/src/features/agentbuilder/state/useAgentBuilderKnowledgeGraphs.ts
3c5f532f7c69f5bce1c0e9a7998173438f041d51128fb012eff951842f385690  apps/backend/src/routes/mainSession.routes.ts
57cad0ada8e6aeae10745c39b2b60f85f9b62a544887735bee2d4ee1bd4e0e61  client/src/features/agentbuilder/console/useAgentBuilderMainChat.spec.tsx
67d6520f75fa41b133c0c7ff5ec2ec10de5029e1988f3f42b6270f667a7710b0  client/src/features/agentbuilder/state/useAgentBuilderKnowledgeGraphs.spec.ts
9d731e4b8296cf2dc7cdd2840f26aa5e4fa05d82f2c3b906666b7162ec85d86f  apps/backend/src/routes/thinkGraph.routes.ts
a2b8ae209444b43b6d60a0b7060f3637e7735c475e6ce75110569c5c6fca55dd  apps/backend/src/services/thinkGraphCaptureSynchronization.ts
bc9aa3d75d22179f1d9f4f1537fd5f485600ce8cc51f03ab606b81f0703dd261  client/src/features/agentbuilder/console/useAgentBuilderMainChat.ts
d73041087dd04312f156cc0f7a43213fb6cfaa4548a985c8239417e8f14ac52e  apps/backend/src/services/hermesGateway.spec.ts
dac7ce58ac183d1dfb56b27507139dc440adb49d8323a23cb3211eec5b81ee6d  client/src/pages/agentbuilder.tsx
dcf2a0fd9b39a0fdce9d39a28aa7adaf5603af616f91a3622557c1b93e71a63b  apps/backend/src/services/thinkGraphCaptureSynchronization.spec.ts
DELETED  gods-eye-view/.gev-cache/* (11 files)
DELETED  gods-eye-view/.gev-logs/realtime-conversations.jsonl
DELETED  shadowbroker/backend/backend.egg-info/* (5 files)
DELETED  shadowbroker/backend/data/* (22 files)
DELETED  shadowbroker/frontend/next-env.d.ts
```

CHANGED_SNAPSHOT_SHA256: ca92f3ee34ec535aca7b5859eddde8589f75189c8c2cb2bf67e392d4c3bb2343
