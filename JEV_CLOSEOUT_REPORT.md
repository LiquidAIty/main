# Jev Closeout Report

**Date:** September 25, 2026  
**Repository:** `C:\Projects\LiquidAIty\main`  
**Current checkpoint:** `5bbc1488f` (`Checkpoint: Jev closeout implementation`)  
**Verdict:** **Implementation complete with named live-proof blockers.**

## 1. Executive verdict

The approved Jev stage is closed at eight product functions. The current source has the required owners,
bounded context, numeric validation, invocation-local Card routing, final request-fulfillment Score, and
ThinkGraph carry-through. Focused source tests, transport tests, native Hermes contract tests, typechecks, and
the client production build pass for the affected boundaries.

No ninth Jev is justified before the UI stage. No currently demonstrated code defect blocks moving to UI.
The remaining gap is proof level, not another implementation feature: the local product services and visible
preview were stopped during final verification, so no genuine provider-backed Main or ordinary-agent turn was
run after the last repairs. The code is therefore **source-wired and test-proven**, not honestly
**live-product/runtime-proven** for provider dispatch, actual tool exposure, actual selected model, or a real
Jev Score.

This closeout deliberately did not start the next UI stage, add another selector, install a runtime, change
providers, create another graph or database, or fabricate successful live evidence.

## 2. Inventory: eight active product functions

| # | Function and owner | Trigger and primitive | Decision context and candidates | Effect and failure behavior | Proof status |
|---|---|---|---|---|---|
| 1 | **ThinkGraph relationship classification** — `engraphis.py::classify_relationship`, `relationship_choice_plan`, settlement helpers | One Choice for each accepted directed relationship proposal during native completed-pair settlement | Exact directed source/target pair, the applicable completed User/Main interaction, structured Think data, prior endpoint Thinks, and bounded native one-hop context. Candidates are the full project relationship vocabulary, at most one valid novel proposal when capacity permits, and three control outcomes. | A validated winner can create/update the real native Engraphis semantic edge and, when allowed, promote one project vocabulary label. Invalid/unavailable decisions do not fabricate an edge. Existing raw source Memory remains native authority. | Source-wired; capacity, context, numeric, persistence, readback, and failure paths fixture-tested. No fresh live provider call in this closeout. |
| 2 | **KnowGraph relationship classification** — `knowgraph_jev.py`, `services/knowgraph/ingest.py`, `knowgraph.routes.ts` | One Choice after Graphiti has created or materially changed a native fact | The exact Graphiti fact, canonical endpoint identities, source episode/provenance, temporal context, and bounded nearby native facts. Candidates use the same bounded relationship vocabulary contract. | Stores classification metadata on the real native Graphiti fact. It does not replace the fact, copy the KnowGraph, or discard grounded data when Jev is unavailable. Duplicate/support-only ingestion reuses valid prior classification. | Source-wired; native-ingest, deadline, idempotency, metadata validation/readback, capacity, and failure paths fixture-tested. No fresh live provider call. |
| 3 | **Pre-Main JevAttention** — `engraphis.py::decide_main_graph_attention`, `card_domain.py::_prepare_main_graph_attention`, existing Data Anchor/IDF path | Exactly one incoming-message Choice before ordinary Main inference | The current user message, its effective shared assignment where supplied, and up to sixteen deduplicated canonical native ThinkGraph/KnowGraph entity candidates with legitimate retrieval evidence. It is not a Card router. | Keeps the full raw candidate distribution; selects in descending probability until cumulative mass reaches `0.80`, with **minimum 1** and **maximum 3**; hydrates only exact selected native IDs. Explicit anchors are preserved. Only actually hydrated IDs can become transient attention IDs. Empty graph, timeout, unavailable provider, malformed output, or hydration failure preserves truthful state and lets ordinary Main continue without fake probabilities or highlights. | Source-wired; exact-one-call, dedupe, mass, min/max, explicit-anchor, cold/failure, hydration, and no-false-highlight paths fixture-tested. No live Main turn after final repair. |
| 4 | **JevFocus** — `engraphis.py::decide_graph_focus`, existing combined-graph focus route and surface | Explicit double-click or Focus action only | Fixed native center member(s), accepted bounded native neighbors, their real relationships, and source identities. | Produces one temporary focused local relational view. Expand or empty-canvas exit returns to the existing local view without reranking, refetching, reclassifying, reweighting, or persisting attention. | Existing source preserved; validation and focus/exit behavior fixture-tested. No visible-preview acceptance in this closeout. |
| 5 | **Top-2 Think / Top-2 Know contextual reader** — `engraphis.py::decide_contextual_node_items`, `data_anchor.py::contextual_node_read` | Explicit contextual node read; at most one provider request | Current reader question/mission, exact node/member identities, and all eligible directly attached native items on each source side. Each side with `0–2` items bypasses Jev in native order. A side with `>2` gets one independent Choice question; `3/3` is two questions in one request. | Returns up to two exact native Thinks and up to two exact native Knows. Bypass sides are not sorted, and one item is never compared with itself or with `NONE_RELEVANT`. Hydration uses exact selected IDs. | Source-wired; `2/1`, `2/2`, `3/1`, `1/3`, `3/3`, exact-ID, native-order, overflow, and stale-request behavior fixture-tested. No live provider call. |
| 6 | **All-Card Auto-tools** — `card_domain.py::_decide_card_auto_tools`, `_apply_card_jev_decisions`, canonical IDF, backend/Hermes turn route | Enabled independently on a saved Hermes Card; one bounded request with independent USE/OMIT questions for eligible optional tools | Current request/mission, applicable saved Card instructions/configuration, resolved dynamic input/context/attachments, and only that Card's selected, available, authorized tool definitions including useful descriptions and schemas/effects. | Narrows the invocation only; cannot grant a tool. Explicit/mandatory native facilities remain separately identified. The actual initial Hermes tool surface is checked against the selection. A pre-dispatch selection failure atomically uses the normal authorized Card baseline with explicit fallback status; no partial or stale selection survives. | Source-wired; toggle matrix, authority intersection, tool mapping, actual-use receipt, failure, restoration, and isolation fixture/contract-tested. Actual provider/native execution still needs a live turn. |
| 7 | **All-Card model Auto-select** — `card_domain.py::_decide_card_model_router`, `_apply_card_jev_decisions`, backend/Hermes turn route | Enabled independently and not superseded by an explicit invocation pin | The effective invocation **after tool selection**, applicable saved Card context, selected tool set, and genuinely configured eligible Luna/Terra/Sol records with runtime constraints. One eligible model is deterministic; zero is an honest availability error; more than one uses one Choice. | Applies an invocation-local model/provider route and records requested versus actual runtime identity. It does not rewrite the saved model, select a worker, or switch accounts/providers. Failure may use the saved model only when it remains eligible and records fallback status. | Source-wired; explicit pin, one/zero/multiple candidates, ordered context, actual-model mismatch, restoration, and session isolation fixture/contract-tested. Actual selected model still needs a live turn. |
| 8 | **Final request-fulfillment Score** — `card_domain.py::assess_run_request_fulfillment`, backend `assessGatewayRunCompletion`, migration `042_request_fulfillment_assessment.sql`, Engraphis `source_response_fit` validation/settlement | One bounded post-completion Score for eligible Main and ordinary Card results | Reloaded canonical `in.idf` plus digest, actual final result, actual provider/model/tool receipt, Card/run/output identities, attachments/skills availability, and observable execution evidence. Rubric levels are exact `0–4` fulfillment descriptions. Prior unrelated Card reputation is excluded. | Persists one idempotent response-scoped assessment. Raw Score, level probabilities, confidence, model identity, hashes, and status remain distinct. Missing essential input/evidence is `unavailable`, never fake zero. Main delivery completes first; the assessment/status is then supplied to later ThinkGraph extraction and deterministically attached to native Think metadata as `source_response_fit`, without grading the new Think or recursively scoring extraction. | Source-wired; numeric fidelity, exact-input bindings, unavailable cases, persistence/idempotency, scheduling order, extraction context, native metadata readback, and no-recursion paths fixture-tested. A real provider Score for Main and an ordinary agent remains unproven while services are stopped. |

### Count clarification

The count is eight **product functions**, not eight calls or eight Cards. Two independent source-side questions
in one contextual-reader request are still one reader function. Applying Auto-tools or Auto-select across all
Cards does not multiply the count. Graph physics, transient attention rendering, and Score propagation are
consumers of decisions, not additional Jevs.

## 3. Capacity, context, and numeric contracts

### Relationship vocabulary capacity

The provider Choice limit is 255 total options. ThinkGraph retains three control outcomes, so the shared
project vocabulary contract is:

```text
251 stored labels + 1 genuinely novel proposal + 3 controls = 255
252 stored labels + 0 novel proposal + 3 controls = 255
```

The new-growth ceiling is therefore **252**. A read-only observation during this closeout found **20 current
labels** for workspace `1b1a6958-0658-4b1a-bf13-e2066582adb4`, leaving substantial capacity without a
preselector. Existing-label reuse still works at the ceiling. Concurrent promotion is re-read inside the
native transaction. An oversized legacy vocabulary remains readable and fails classification explicitly at
the provider boundary; no stored label, fact, or edge is deleted or hidden to make the call fit.

This matches the [TypeSafe Choice contract](https://docs.typesafe.ai/primitives/choice): the limit applies to
one question's options, not to graph storage.

### Complete decision context

- Relationship classifiers reject decision-essential overflow instead of silently slicing an interaction,
  fact, or native neighborhood and claiming full-context judgment.
- JevAttention stays intentionally message-based and fast. It does not load a full Card or turn into a second
  Main request path.
- The contextual reader enumerates eligible directly attached items before selection, but hydrates only the
  exact native winners.
- Auto-tools and model routing receive the applicable full effective Card context because their decision is
  about an invocation; cosmetic fields, unrelated history, databases, and credentials are excluded.
- Fulfillment Score uses retained exact input/output and observable receipt content. IDs and hashes bind that
  content; they do not replace it.

### Raw versus derived numbers

One shared Python validator accepts independently two-decimal-rounded distributions when their rounding
intervals can contain a total of one. Thus `0.33 + 0.33 + 0.33 = 0.99` is feasible, while `0.30 + 0.20 =
0.50` is not normalized into a fake valid answer. Exact keys, finite non-boolean values, range, winner/tie
consistency, and Score consistency are validated.

The implementation keeps these meanings separate:

| Field | Meaning |
|---|---|
| Choice distribution | Raw provider probabilities for the exact supplied choices |
| Winning-label probability | The winning relationship label's probability; used by the already-accepted graph-weight mapping |
| Provider confidence | Provider confidence in the answer; not copied into graph weight |
| Raw Score | Provider's weighted Score on the `0–4` fulfillment rubric |
| Display score | `100 × rawScore / 4`; rubric position only, not percent truth or confidence |
| Graph weight | Existing application visualization/edge input derived only where that established mapping applies |

No historical graph weight is rewritten. No malformed, failed, unavailable, non-Jev, or closed edge is given a
synthetic live weight. The numeric rules follow the [TypeSafe Score semantics](https://docs.typesafe.ai/primitives/score)
and the provider's documented two-decimal Decisions transport in the
[OpenRouter provider README](https://github.com/OpenRouterTeam/ai-sdk-provider/blob/main/README.md).

## 4. Clean and predictable behavior repairs

The final audit fixed the following demonstrated surprises without broadening the design:

1. **No hidden JevAttention abstention path.** A late worktree path had changed the approved minimum from one
   to zero and added `NO_RELEVANT_GRAPH_CONTEXT`. It was removed from Python, transport validation, telemetry,
   prompts, and tests. Success now means 1–3 selected native candidates; zero selection is not a second policy.
2. **No false successful highlight.** Backend transport rejects a successful attention payload unless every
   selected candidate was actually hydrated and the exact hydrated references agree. A hydration failure stays
   an error with zero transient activation IDs while explicit baseline anchors continue.
3. **No legacy Card mutation from default UI state.** Missing legacy `autoSelect`/`autoTools` fields render as
   off but remain absent during unrelated edits. A previously explicit field or a real toggle is serialized.
   Manual model selection disables Auto-select; Auto-tools and Auto-select remain independent.
4. **No invocation leakage.** Tool/model narrowing is carried through the existing one-turn Hermes route,
   actual runtime identity is read back, and the saved Card remains root authority. Success, error,
   cancellation, reused sessions, and concurrent run isolation are covered by focused contracts.
5. **No fake evidence grading.** Missing canonical input, actual model identity, attachments, skill material,
   or execution evidence yields a typed unavailable assessment. The answer still reaches the user and normal
   ThinkGraph intake receives that truthful unavailable state.
6. **No revived `needs_evidence` Jev.** Legacy metadata is stripped from new native Think intake and cannot
   enter contextual candidates. It is not reinterpreted as fulfillment Score or research priority.

The design remains one semantic decision owner per operation, one canonical IDF, native graph identities,
invocation-local Card choices, and truthful failure states. There is no new registry, cache, graph, scheduler,
history store, or model loop.

## 5. Verification evidence

### Passing focused proof

| Boundary | Command/result |
|---|---|
| Python Jev/Card/graph integration | `pytest test_card_domain.py test_data_anchor.py test_engraphis.py test_knowgraph_jev.py test_thinkgraph_hybrid.py -q` — **240 passed** after the final minimum-one repair. |
| KnowGraph native ingestion | `python -m unittest -v test_graphiti_ingest.py` — **16 passed**. |
| Affected TypeScript behavior | Vitest for `savedCard.routes.spec.ts`, `AgentManager.spec.ts`, `NativeAuthorityGraphSurface.spec.tsx`, and `jevGraphPhysics.spec.ts` — **180 passed**; the final backend attention contract rerun passed **95/95**. |
| Card editor predictability | `vitest AgentManager.spec.ts` — **42 passed**, including independent toggles and legacy absent-field preservation. |
| Hermes turn-scoped route/contracts | `scripts/run_tests.sh tests/tui_gateway/test_turn_scoped_card_routing.py tests/tui_gateway/contracts/test_generated.py -q` — **7 passed**. |
| Production typechecks | Client app, backend app, and backend specs — passed. |
| Client production build | Vite build — passed; only the existing large-chunk warning remains. |
| Diff hygiene | `git diff --check` — no whitespace error; Git reported only existing CRLF-to-LF warnings for the two generated Hermes contract files. |
| Forbidden attention residue | Repository search found no `JEV_ATTENTION_ABSTENTION`, `NO_RELEVANT_GRAPH_CONTEXT`, `abstained`, or minimum-selected-zero attention contract. |

### Known pre-existing check failure kept out of scope

The full client **spec** typecheck remains red only in unrelated existing tests:

- `client/src/components/knowledge/CodeGraphProductSurface.spec.tsx`: unsupported `exact` property in role-query options.
- `client/src/pages/agentbuilder.topology.spec.ts`: `card.prompt` may be null/undefined.
- `client/src/pages/tradingui.spec.tsx`: unsupported `exact` property in role-query options.

The client production typecheck and production build pass. Those three unrelated test-source issues were not
edited as opportunistic cleanup.

### Live proof blocker

A final read-only port check found these local services closed:

```text
5173 frontend          closed
4000 backend/gateway   closed
8003 Python rails      closed
8001 KnowGraph         closed
```

Accordingly, this report does **not** claim:

- a real provider-backed Main JevAttention turn after the final repair;
- real Auto-tools exposure and actual selected-model dispatch in a live reused Hermes session;
- a real Main fulfillment Score;
- a real ordinary-agent fulfillment Score;
- visible-preview acceptance of the Card controls or transient graph activation;
- measured production latency, token savings, cost reduction, or fallback rate.

Those are the named live-proof blockers. Starting extra or hidden browsers, creating fallback servers, changing
credentials, or beginning UI redesign was outside this closeout.

## 6. Value assessment

The demonstrated value is architectural and test-observable:

- Main can preload a bounded native graph context with one semantic decision instead of hydrating every
  recalled entity.
- Explicit native anchors survive automatic attention and every fallback.
- Node reading avoids paying for comparisons when either source side has two or fewer items, yet allows two
  entries per side when qualifications or disagreements matter.
- Auto-tools narrows only within a Card's real authorization, and model Auto-select judges the actual
  post-tool-selection invocation rather than an isolated message.
- Fulfillment Score gives a response-scoped audit signal that later ThinkGraph processing can inspect without
  turning it into truth, reputation, relevance, or graph weight.
- Raw probabilities, confidence, Score, actual dispatch identity, and UI weight remain distinguishable, making
  failures inspectable instead of success-shaped.

Actual call latency, provider cost, model-quality improvement, tool-use improvement, and aggregate savings are
unknown until genuine product turns are observed. No numerical benefit is inferred from fixtures.

## 7. Additional Jevs

**No further Jev is justified before UI.**

The current stack already covers relationship admission, bounded pre-inference attention, explicit focus,
contextual item selection, authorized tool narrowing, eligible model routing, and response fulfillment insight.
Another selector now would add semantic latency and another failure surface before the existing eight have live
operational observations. Any later candidate must be supported by a concrete unmet bottleneck from real usage
and marked **NOT IMPLEMENTED — AFTER UI / REQUIRES APPROVAL**. None was implemented here.

## 8. Handoff

- **Report:** `C:\Projects\LiquidAIty\main\JEV_CLOSEOUT_REPORT.md`
- **Git:** HEAD and `origin/main` are both `5bbc1488f`. The worktree contains scoped post-checkpoint Jev fixes,
  tests, generated contract/doc updates, and this new report. No assistant commit, push, reset, checkout, stash,
  clean, branch change, or deployment was performed.
- **Reloads:** normal fresh product startup is required because Python rails, backend transport, Hermes gateway
  contracts, KnowGraph service code, client source, and database migration `042` changed. Apply migration `042`
  through the repository's normal migration path before treating persisted fulfillment assessments as loaded.
- **Next stage:** restart the normal visible product once, apply normal migrations, run one benign Main turn and
  one ordinary Card turn, inspect actual tool/model/Score/Think metadata receipts, then proceed to UI work. Do
  not add another Jev unless that real evidence exposes a concrete missing decision.

Jev implementation work stops here.

## Dual-Codex reconciliation and cleanup

### Frozen reconciliation baseline

- Surviving task: one active Codex task. No implementation subagent or second repository writer remained.
- Branch and checkpoint: `main` at `5bbc1488f7d140fdb558df0519ce9971f0b9f49a`; `origin/main` was the same
  commit with divergence `0 0`.
- Initial index: empty. No staged paths existed.
- Initial worktree: 27 modified tracked paths plus this untracked report. The tracked delta was 2,478 insertions
  and 295 deletions. Those paths were frozen before the reconciliation audit.
- Runtime freeze: stale pre-existing `npm run build` / `nx build backend` and `npm run dev:services` process
  trees were stopped. Ports `5173`, `4000`, `8003`, `8001`, and `8765` were closed and remained closed. No
  preview, browser, provider call, service, MCP frontend, migration, or live product runtime was started.

### Reconciliation result

The two working streams converged on one implementation rather than leaving two live alternatives. Direct
source review and Codebase Memory ownership traces found one owner for each of the eight approved functions:

1. ThinkGraph relationship classification;
2. KnowGraph relationship classification;
3. pre-Main JevAttention;
4. JevFocus;
5. the on-demand Top-2 Think / Top-2 Know contextual reader;
6. all-Card Auto-tools;
7. all-Card model Auto-select; and
8. final request-fulfillment Score with later ThinkGraph carry-through.

The post-checkpoint edits are complementary correctness repairs to those owners: bounded decision context,
strict numeric/readback validation, invocation-local Hermes tool/model routing, exact completion evidence,
truthful hydration/attention state, legacy absent-field preservation, idempotent KnowGraph reconciliation,
request-fulfillment persistence, and guarded graph-weight projection. They do not constitute a ninth Jev, a
second graph or store, another runtime-input path, or a fallback runtime.

No source deletion or rewrite was justified. The reconciliation audit found:

- no merge-conflict marker;
- no duplicate Python definition or duplicate Python test name in the changed paths;
- one backend and one native service route for explicit KnowGraph annotation reconciliation, both terminating
  in the existing shared native reconciliation owner;
- one request-fulfillment assessment owner and one idempotent persisted Run field;
- one tracked migration `042_request_fulfillment_assessment.sql`, already part of checkpoint `5bbc1488f`, using
  `ADD COLUMN IF NOT EXISTS request_fulfillment JSONB`;
- no active `needs_evidence` judgment, attention abstention policy, minimum-zero selection path, second model
  loop, copied graph, or durable attention score;
- no `.rej`, `.orig`, generated backup, or temporary collision artifact in the scoped delta;
- no UTF-8 BOM in a changed tracked source path; and
- generated Hermes TypeScript/OpenRPC contracts in parity with the canonical Python contract.

The only collision residue removed during this cleanup was process state: the stale build/dev process trees
named above. No repository file was removed. The only file edited by this cleanup is
`C:\Projects\LiquidAIty\main\JEV_CLOSEOUT_REPORT.md`.

### Decisive offline proof

| Boundary | Final reconciliation outcome |
|---|---|
| Python Jev/Card/graph integration | `240 passed, 4 warnings` in 89.18 seconds. |
| KnowGraph native ingestion/reconciliation | `16 tests`, all `OK`, in 10.583 seconds. |
| Hermes canonical per-file runner | `7 tests passed, 0 failed`; this also proves generated contract parity. |
| Affected backend/client Vitest bundle | Final clean rerun: `4` files, `180 passed, 0 failed`. An earlier run performed concurrently with the other proof suites exposed one timing-sensitive pre-existing AgentManager assertion (`179/180`); the exact AgentManager file then passed `42/42`, and the complete bundle passed `180/180` on immediate rerun. No product/source failure reproduced. |
| Client production typecheck | Passed. |
| Backend production and spec typechecks | Both passed. |
| Client production build | Passed in 1 minute 1 second; only Vite's existing large-chunk advisory remained. |
| Diff hygiene | `git diff --check` found no whitespace error. Git emitted only CRLF-to-LF notices for the two changed generated Hermes contract files. |

The full client **spec** typecheck remains red only in three untouched, unrelated tests: three unsupported
`exact` options in `CodeGraphProductSurface.spec.tsx`, two nullable `card.prompt` accesses in
`agentbuilder.topology.spec.ts`, and two unsupported `exact` options in `tradingui.spec.tsx`. None is in the
working-tree delta, so this cleanup did not broaden into repairing them.

### Final state and save verdict

- Source collision residue: none remains.
- Staged paths: none.
- Modified tracked paths: the same 27 frozen paths; no production or test path was added to the delta by this
  cleanup.
- Untracked paths: only `JEV_CLOSEOUT_REPORT.md`.
- Live-proof blockers remain exactly those already named above because the stack stayed stopped: no final real
  Main attention turn, no real ordinary-Card Auto-tools/model-router turn, no real fulfillment Score, no visible
  preview acceptance, and no application of migration `042` to a live database.
- Reconciliation verdict: safe for one final owner-reviewed Git save as a single coherent eight-Jev change.
  This is a source/offline-proof verdict, not a claim that the stopped product or unapplied migration is loaded.
