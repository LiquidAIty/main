# Current system audit — integration pass

Date: November 13, 2026 (America/New_York). Working report required by the supplied Complete Integration PromptSpec. This is an evidence ledger, not runtime input or permission to add features.

## Scope and preservation

One existing local Hermes runtime; all 15 Cards and 14 wires; existing sessions, profiles, Prompt Blocks, grants, corpus, graphs, portfolio and Markdown journal. No Git operations, Oracle changes, broker orders, provider substitution, or OpenRouter spend in this pass. No resets or automatic profile provisioning. Source reads and saved-state reads are current; previous live tests remain labeled historical until repeated.

## Initial baseline (before this pass's repairs)

- Saved Trading Project: `cc1deb71-d059-46b8-975d-e2473dacf132`; deck `deck_builder`.
- Saved count: **15 Cards, 14 wires**. Main has 14 saved Bot targets; Magnetic has 10 saved blue workers.
- All parent Card models use the existing `openai-codex` account provider. Exact selected models below are preserved.
- Existing listeners: Hermes webapp 9120 (not the spec's historical 9119), MCP 8765, Python rails 8003, KnowGraph service 8001, backend 4000. No new service started.
- Current UI/backend baseline: **556 passed, 9 failed, 1 skipped**, 83 files, 115.25 seconds. Command: `npm exec -- vitest run client/src apps/backend/src --maxWorkers=2`.
- Focused Python baseline: **128 passed**, one upstream Pydantic deprecation warning. Dispatch, document operations, Know reads, forecasts, trading evidence, LumiBot and AgentGraph inspection tested with isolated dependencies; these are not live provider proof.
- CBM CLI generation: November 9. Material existing paths report metadata_changed; new numerical files are not tracked. Direct current source is authority. No reindex or Git inspection performed.

## Saved Card authority matrix

| Card / ID | Profile / selected model | Job | Memory | Bot destinations |
|---|---|---|---|---|
| Main / `card_main_chat` | `main` / gpt-6.1-sol | Delegate, review and answer; concise summaries and references. | holographic | builder, thinkgraph, knowgraph, signal-analyst, card_magentic, quant-analyst, team, worldview, trading, bear, agent-ptook1, agent-gjt2ed, agent-ahwxjm, agent-xvhztm |
| Builder / `builder` | `builder` / gpt-6-astra | Build approved prompts, Cards and application work; does not run what it builds. | holographic | None; reply through Hermes completion |
| ThinkGraph / `card_thinkgraph` | `thinkgraph` / gpt-6.1-terra | Retain Project reasoning through Engraphis. | holographic | None; reply through Hermes completion |
| Magnetic / `card_magentic` | `card_magentic` / gpt-6.1-sol | Coordinate the exact saved blue roster using Hermes task machinery. | holographic | signal-analyst, quant-analyst, team, worldview, trading, bear, agent-ptook1, agent-gjt2ed, agent-ahwxjm, agent-xvhztm |
| Team / `card_team` | `team` / gpt-5.6-terra | Bounded wildcard work using existing same-profile Hermes Team. | holographic | None; reply through Hermes completion |
| KnowGraph / `card_knowgraph` | `knowgraph` / gpt-6.1-terra | Research, verify and retain sourced Knows through Graphiti. | holographic | None; reply through Hermes completion |
| Trader / `card_trading_workbench` | `trading` / gpt-6.1-sol | Portfolio-aware decisions and its own Markdown journal; no orders authorized. | Hermes Markdown | None; reply through Hermes completion |
| WorldView / `card_713f345e67ce4fbf` | `worldview` / gpt-6-luna | Read satellite/launch sources and operate the existing globe. | holographic | None; reply through Hermes completion |
| Analyst / `card_13fba035c83b4823` | `signal-analyst` / gpt-6.1-terra | Company and industry screening/research. | holographic | None; reply through Hermes completion |
| Quant / `card_da2591b04e8e41e7` | `quant-analyst` / gpt-6.1-terra | Compare hypotheses, forecasts, supported backtests and numerical evidence. | holographic | None; reply through Hermes completion |
| Contrarian / `card_bear_f4262e1a` | `bear` / gpt-6-luna | Challenge Designer's proposed trade and assumptions. | holographic | None; reply through Hermes completion |
| Predictor / `card_assist_ptook1` | `agent-ptook1` / gpt-6-luna | Prediction-market research as one contextual signal. | holographic | None; reply through Hermes completion |
| Designer / `card_assist_gjt2ed` | `agent-gjt2ed` / gpt-6.1-terra | Instrument/market research, trade design and options-hedge comparison. | holographic | None; reply through Hermes completion |
| Research / `card_assist_ahwxjm` | `agent-ahwxjm` / gpt-6.1-sol | Deep document, filing and contract evidence retrieval. | holographic | None; reply through Hermes completion |
| Learner / `card_assist_xvhztm` | `agent-xvhztm` / gpt-6.1-terra | On-demand review and existing native memory/skill capability; no new refine adapter. | Hermes Markdown | None; reply through Hermes completion |

### Exact saved grants and selected native toolsets

These are saved selections, not a claim that every external provider is available. Missing optional tool/data paths must produce explicit errors without blocking ordinary Hermes conversation.

- **Main** — application operations: `canvas.inspect`, `worldview.set_capability`, `engraphis_get_memory`, `graphiti.get_entity_knows`, `graphiti.get_know`, `graphiti.search_knows`.
  Native toolsets: skills, memory. Explicit saved skill selections: main, hermes-agent.
- **Builder** — application operations: `canvas.inspect`, `card.create`, `card.update_configuration`, `canvas.upsert_wire`, `cbm.search_graph`, `cbm.search_code`, `cbm.trace_path`, `cbm.get_code_snippet`, `cbm.check_index_coverage`, `engraphis_recall_context`, `engraphis_get_memory`, `engraphis_discover_actions`, `engraphis_execute_read`, `engraphis_execute_action`, `graphiti.search_memory_facts`, `graphiti.search_nodes`, `graphiti.get_episodes`, `graphiti.get_episode_entities`, `graphiti.get_entity_edge`, `graphiti.build_communities`, `graphiti.delete_episode`, `graphiti.delete_entity_edge`, `graphiti.clear_graph`, `cbm.query_graph`, `codegraph.configure`, `engraphis_retire`, `graphiti.get_entity_knows`, `graphiti.get_know`, `graphiti.search_knows`, `graphiti.remove_know`, `engraphis_retire_relationship`.
  Native toolsets: web, terminal, file, browser, vision, code_execution, skills, memory. Explicit saved skill selections: builder, agent-builder-inspection.
- **ThinkGraph** — application operations: `engraphis_recall_context`, `engraphis_get_memory`, `engraphis_add_thinks`, `engraphis_discover_actions`, `engraphis_execute_read`, `engraphis_correct`, `engraphis_retire`, `engraphis_retire_relationship`.
  Native toolsets: skills, memory. Explicit saved skill selections: thinkgraph, hermes-agent.
- **Magnetic** — application operations: none.
  Native toolsets: skills, memory. Explicit saved skill selections: card_magentic, hermes-agent.
- **Team** — application operations: `canvas.inspect`, `engraphis_recall_context`, `engraphis_get_memory`, `graphiti.search_nodes`, `graphiti.search_memory_facts`, `graphiti.get_episodes`.
  Native toolsets: web, terminal, file, browser, vision, code_execution, skills, memory. Explicit saved skill selections: team, hermes-agent.
- **KnowGraph** — application operations: `engraphis_get_memory`, `graphiti.get_know`, `graphiti.get_entity_knows`, `graphiti.search_knows`, `graphiti.add_know`, `graphiti.search_nodes`, `graphiti.search_memory_facts`, `graphiti.update_know`, `graphiti.remove_know`, `graphiti.get_entity_edge`, `graphiti.delete_entity_edge`, `engraphis_research`.
  Native toolsets: web, terminal, code_execution, skills, memory. Explicit saved skill selections: grounded-citations, knowgraph.
- **Trader** — application operations: `get_market_snapshot`, `get_paper_account_readiness`, `trading.get_state`, `trading.accept_assignment`, `trading.record_decision`, `get_historical_bars`, `forecast_market_bars`, `trading.get_backtest`, `trading.read_evidence`.
  Native toolsets: skills, memory, file. Explicit saved skill selections: trading, hermes-agent.
- **WorldView** — application operations: `worldview.read`, `worldview.action`.
  Native toolsets: skills, memory. Explicit saved skill selections: worldview, hermes-agent.
- **Analyst** — application operations: `engraphis_get_memory`, `graphiti.get_entity_knows`, `graphiti.get_know`, `graphiti.search_knows`, `get_market_snapshot`, `get_historical_bars`, `trading.list_bots`, `trading.record_assessment`, `trading.read_evidence`.
  Native toolsets: skills, memory, web. Explicit saved skill selections: signal-analyst, hermes-agent.
- **Quant** — application operations: `calculator`, `get_market_snapshot`, `get_historical_bars`, `engraphis_get_memory`, `graphiti.get_entity_knows`, `graphiti.get_know`, `graphiti.search_knows`, `trading.list_bots`, `trading.backtest`, `forecast_market_bars`, `trading.get_backtest`, `trading.compare_proposals`, `trading.read_evidence`, `trading.record_assessment`.
  Native toolsets: skills, memory. Explicit saved skill selections: quant-analyst, hermes-agent.
- **Contrarian** — application operations: `engraphis_get_memory`, `graphiti.get_entity_knows`, `graphiti.get_know`, `graphiti.search_knows`, `get_market_snapshot`, `get_historical_bars`, `trading.list_bots`, `trading.invert_proposal`, `trading.read_evidence`, `trading.record_assessment`.
  Native toolsets: skills, memory, web. Explicit saved skill selections: none in runtimeOptions (custom profile skill may still exist).
- **Predictor** — application operations: none.
  Native toolsets: web, skills, terminal, code_execution, memory. Explicit saved skill selections: none in runtimeOptions (custom profile skill may still exist).
- **Designer** — application operations: `trading.market_quote`, `trading.market_last_price`, `trading.market_historical_prices`, `trading.options_get_chain`, `trading.options_get_strikes`, `trading.options_get_greeks`, `trading.options_evaluate_market`, `trading.options_calculate_multileg_price`, `trading.read_evidence`, `trading.record_proposal`, `trading.record_assessment`, `documents.search`, `documents.get_passage`, `graphiti.search_knows`, `graphiti.get_know`, `graphiti.get_entity_knows`, `get_market_snapshot`, `get_historical_bars`, `current_datetime`, `calculator`.
  Native toolsets: web, skills, memory. Explicit saved skill selections: none in runtimeOptions (custom profile skill may still exist).
- **Research** — application operations: `documents.get_passage`, `documents.ingest`, `documents.search`, `graphiti.search_nodes`, `graphiti.search_knows`, `graphiti.get_entity_knows`, `graphiti.get_know`, `graphiti.search_memory_facts`, `trading.read_evidence`, `trading.record_assessment`, `find_recent_sec_filing_signals`, `current_datetime`.
  Native toolsets: web, skills, memory. Explicit saved skill selections: none in runtimeOptions (custom profile skill may still exist).
- **Learner** — application operations: none.
  Native toolsets: skills, memory. Explicit saved skill selections: none in runtimeOptions (custom profile skill may still exist).

## Exact saved wire matrix

A wire is authority/topology, not a prescribed execution step. Main's saved orchestrator roster includes the full enabled topology. The blue wire's direction on the canvas does not create reverse tool/credential sharing.

| Wire ID | Saved source → target | Purpose / runtime route | Proof |
|---|---|---|---|
| `edge_t0zcb377` | Main → Builder | Direct Hermes Bot reachability | Saved topology verified; current individual live proof pending |
| `edge_smgg1ism` | Main → ThinkGraph | Direct Hermes Bot reachability | Saved topology verified; current individual live proof pending |
| `edge_bh1h7492` | Main → KnowGraph | Direct Hermes Bot reachability | Saved topology verified; current individual live proof pending |
| `edge_5mzbsj2y` | Analyst → Magnetic | Hermes Bot reachability plus Magnetic worker membership | Saved topology verified; current individual live proof pending |
| `edge_06vei7k0` | Quant → Magnetic | Hermes Bot reachability plus Magnetic worker membership | Saved topology verified; current individual live proof pending |
| `edge_bl8sj5ju` | Magnetic → Team | Hermes Bot reachability plus Magnetic worker membership | Saved topology verified; current individual live proof pending |
| `edge_o13d6krj` | Main → Magnetic | Direct Hermes Bot reachability | Saved topology verified; current individual live proof pending |
| `edge_l5s1tyu2` | WorldView → Magnetic | Hermes Bot reachability plus Magnetic worker membership | Saved topology verified; current individual live proof pending |
| `edge_wjm7qb50` | Trader → Magnetic | Hermes Bot reachability plus Magnetic worker membership | Saved topology verified; current individual live proof pending |
| `edge_v7c0hs9v` | Contrarian → Magnetic | Hermes Bot reachability plus Magnetic worker membership | Saved topology verified; current individual live proof pending |
| `edge_dnzeixsv` | Predictor → Magnetic | Hermes Bot reachability plus Magnetic worker membership | Saved topology verified; current individual live proof pending |
| `edge_7qzqo66d` | Designer → Magnetic | Hermes Bot reachability plus Magnetic worker membership | Saved topology verified; current individual live proof pending |
| `edge_v80h83vs` | Research → Magnetic | Hermes Bot reachability plus Magnetic worker membership | Saved topology verified; current individual live proof pending |
| `edge_s24hxoq1` | Learner → Magnetic | Hermes Bot reachability plus Magnetic worker membership | Saved topology verified; current individual live proof pending |

## End-to-end owners and failure boundaries

| Capability | Producer → transport/runtime → tool/store → consumer | Failure behavior / current proof |
|---|---|---|
| Main and specialist chat | MainProjectChat → useHermesMainChat / Hermes browser client → canonical Bot Chat / message_agent → receiving saved profile → Hermes completion → Main | No application /api/main/session route exists. Do not resurrect it to satisfy stale wording. Earlier real Research, WorldView and Trader handoffs completed; new acceptance pending. |
| PDF research | UploadAttachment → /api/knowgraph/ingest → existing Neo4j DocumentVersion/Page/Passage → documents.search/get_passage → Research → Main | Original book retained. Prior import: 249 pages, 352 passages. Search uses paid configured embeddings; exact passage read does not. No automatic Know promotion. |
| Know promotion | KnowGraph Prompt Blocks → graphiti.add_know(documentPassageId) → exact Project passage validation → existing Graphiti writer → graphiti.get_know / inspector | Current prompt universally requires web/file citation procedure and prevents supported document path. Narrow procedure correction authorized; no Research writer privilege. New Entity/Know embeddings use existing OpenRouter configuration. |
| Ranked Know search | MCP authority → existing Graphiti Know candidate search → cross encoder → exact Know records | Prior vendor alignment fix rejects missing/invalid scores. App-owned explicit degraded ordered results are incomplete. No silent score fabrication. |
| WorldView | Main Bot call → WorldView → worldview.read → CelesTrak / Launch Library provider → concise sourced result → Main → optional KnowGraph curation | Prior actual ISS read succeeded; orbital epoch is not live position. No automatic feed or new geospatial storage. |
| Forecast / GARCH | Quant or Trader saved grant → same forecast_market_bars → observed Alpaca bars / Kronos-mini / optional bounded variance comparison → retained forecast → chart/data panel | Shared source and both grants present. Current numerical/source tests pass; fresh live comparison pending. No direction/IV claim from GARCH. |
| Backtests / options | Saved specialist → existing LumiBot wrappers / bounded strategies → result / optional retained reference → Quant / Trader | Research tools do not imply order or all-market backtest support. Daily US stock/ETF backtests remain bounded. |
| Portfolio / risk | Trader configuration and broker read → existing state projection → allocation/risk UI / model evidence | Settings without consumers must be advisory/unavailable, not claimed enforced. No new order regime. |
| Journal | Main → Trader Bot → Trader native file write/read → actual Markdown file → existing Hermes file reader → Journal tab | Prior actual file proof passed. No DB journal; no new Main journal reader in scope. |
| ThinkGraph | Hermes post_llm_call → plugin host → /thinkgraph/completed-pair/process → saved ThinkGraph Card → Engraphis | Current automatic path differs from spec's old chunk-first description. Preserve until decision; do not reset/replay history. Native hook background-lifecycle concern under audit. |
| CodeGraph | current selected categories → app projection + CBM CLI/provider structure → Feature overview / file expansion → UI and compact Entity map | Current map deliberately has no semantic relationships; tests/docs conflict. No new index/service. |
| AGE telemetry | real Hermes hooks → existing plugin seam → existing PostgreSQL/AGE agentgraph → agentgraph.inspect | Current writer for all-Card activity is missing. Existing inspector/old Runs do not prove current telemetry. Native subscription cleanup limitation requires isolated owner decision. |
| Shared team records | authorized Card → optional generic publish/read/search/link → existing PostgreSQL plus optional AGE edges → another authorized reader | Approved incomplete. Must not require a Run/Trade Job, complete trade proposal, record before send, or full transcript. Preserve historical tables. |

## Grouped fault register and repair waterfall

| ID / class | Producer → consumer / broken contract | Evidence and smallest approved change | Regression proof |
|---|---|---|---|
| R1 / A | Research passage packet → KnowGraph instructions → existing writer | Exact passage route exists, but universal grounded-citations file requirement blocks it. Correct only relevant saved Prompt Block/source default; keep web-source checks, exact quote/source validation and own writer. | Exact/mismatched source, quote, Project and retained locator tests; real write/readback if provider spend allowed. |
| R2 / A | Graphiti ranked candidates → model scores → caller | Prior skip/zip mismatch fixed in isolated vendor patch. Remaining app contract must retain ordered candidates and label degraded ranking on invalid/missing scores or provider failure. | Full/partial/duplicate/unknown/nonfinite scores, timeout, citations, exact read and stable candidate order. |
| R3 / B | Hermes current activity → AGE inspector | No current all-Card telemetry producer. Existing native event queue can deliver off-thread, but plugin subscriptions lack unload cleanup. No new scheduler/loop/thread. | Native subscription lifecycle (only if approved), multiple real Cards, no transcripts, AGE failure does not interrupt turns. |
| R4 / B | Optional work result → shared PG/AGE → later Card | Generic immutable content publish/read/search/link missing. Existing runtime tables are not a new work-sharing API. Use same DB, authenticated Card attribution, optional execution refs, independent graph projection. | Scope/forgery, unchanged original + superseding record, PG failure vs AGE-only failure, no required publication before communication. |
| R5 / A/D | source defaults / graph / chat → test fixtures | Nine current UI-suite failures. Preserve intended behavior; repair stale tests only after exact contract review. | Full rerun, no broad snapshot regeneration. |
| R6 / A | stored risk settings → displayed protection | Several values have no active enforcement consumer. Label as advisory/unavailable; do not invent broker controls. | UI tests distinguish observed, configured and actually enforced state. |
| R7 / D | Trader GPT continuation → native file tools / Main | Previous HTTP400 cause unestablished. A later native turn wrote/read real journal and returned. Preserve and test representative continuation; no speculative reasoning adapter. | Existing-session live continuation when dependencies can run within restrictions. |
| R8 / owner decision | newer current runtime → older PromptSpec wording | 9120 vs9119; absent Main session route; automatic saved-Card ThinkGraph vs chunk-first prose. No restoration/new route undertaken. | Owner decision + current-source/UI proof; pending. |

Task order: T001 audit (this ledger) → T002 app-owned evidence/retrieval repairs → T003 optional shared records and allowed passive telemetry → T004 UI/test/risk-contract reconciliation → T005 real per-Card and end-to-end acceptance → STOP for owner Git save. Current-model/provider changes and Oracle are forbidden.

## Unfinished and deferred inventory

- Approved Fix: document-evidence procedure, honest rerank degradation, accurate risk/attachment labels, demonstrated UI/test contradictions.
- Approved Incomplete: all-Card passive AGE observations, generic optional shared publications/links, live full-team hedge comparison, fresh Quant/Trader forecast and journal acceptance.
- Owner Decision: native plugin subscription cleanup patch; exact preservation of current automatic ThinkGraph; bounded live graph-provider credit exception. No decision assumed.
- Future Proposal only: three-choice attachment menu, document chips, PDF-to-chat, persistent per-Card document targeting, OCR/hybrid search/version browser, standalone journal reader, new refine/ADK features, automatic trade-exit learning, extended backtesting/order interfaces, geospatial feed/index extensions, one-second optimization campaign.
- Historical residue: old journal and retired assignment/result tables are not permission to delete data. Only positively unreferenced rejected source paths may be removed in-scope.

## Final state of the independently executable work

The preceding fault register records discovery, not an assertion that every defect remains open. This section supersedes its initial status. **PARTIAL — LOCAL DEMO READY: NO.** The forecast-storage request is implemented and loaded; the full integration acceptance matrix remains incomplete for the explicit dependencies below.

### Repairs and proof

| Boundary | Current result | Proof tier / limitation |
|---|---|---|
| KnowGraph document-passage promotion | Source default and saved KnowGraph Constraints now distinguish retained Project passages from web-file evidence. Existing writer resolves exact passage, Project/source/version/page/offset/checksum. Mismatched URL/quote is rejected; publication dates cannot be invented. | Eight focused evidence tests pass. Research's own MCP credential retrieved the original page-129 passage again. No new Know was written: the configured writer's OpenRouter dependency remains outside the no-spend instruction. |
| Ranked Know search | App-owned search preserves candidate identities and citation projection, validates complete finite score alignment, and returns explicitly degraded original order on missing/invalid scores or provider failure. Existing outer request cancellation remains a tool timeout. | Focused valid/partial/duplicate/nonfinite/timeout tests pass. No arbitrary 15-second cap. Live successful rerank remains unproved; existing configured ranker uses OpenRouter. No vendor edit in this pass. |
| Compact model-facing graph map | Required `relationships` field is empty; visual/deep-read relationships remain unchanged. Default prompt/docs/tests agree with the existing Entity-identity-only contract. | Python and UI tests pass. Saved ThinkGraph explicit-input wording corrected through Prompt Blocks. Saved Main prompt needed no change. Automatic ThinkGraph behavior was not rewritten. |
| Optional shared records | Existing PostgreSQL now has append-only content/link tables; four separately grantable operations publish/read/search/link. Producer identity comes from current authenticated saved Card authority. Original publications remain intact; corrections are linked new records. | Isolated real PostgreSQL/AGE tests prove immutable content, concurrency/idempotency, scope refusal, genuine AUTHORED projection and independent AGE failure. New tools are **not assigned to any saved Card**. Production tables contain zero fabricated test records. |
| Optional storage failure | Completed forecast, comparison and backtest calculations survive optional retention failure with explicit unconfirmed persistence. Broker/tool authorization remains enforced. | Focused failure tests and full Python suite pass. Optional shared-record migration failure does not block ordinary backend startup; required migration behavior remains unchanged. |
| Forecast database | Reuses `ag_catalog.trading_forecasts` in the existing database, with exact input bars, model/settings/revisions, raw predictions, validity, GARCH result and producing Card. Existing `trading.read_evidence` now accepts a direct forecast reference without an assessment, decision or job. | Quant and Trader each successfully invoked the same existing MCP forecast tool using their own saved grants. After application reload, Trader's own MCP connection read Quant's exact saved forecast, preserving Quant attribution and invalid-point flags. This is direct tool qualification, **not a new parent-model Bot Mode turn**. |
| Forecast UI | Existing saved-forecast selector, candle chart and Data panel read the retained run. GARCH is labeled volatility, not direction/IV; outcome comparison is pending before target bars occur. | Browser inspection and screenshot `.tmp/forecast-store-readback.jpg`. Earlier RDW forecast remains available. No new model or forecast browser was added. |
| Risk and attachments | Saved but unenforced risk/lifecycle settings are visibly advisory. PDF button explicitly says Project knowledge import; image attachment remains separate. | UI suite and actual risk-label browser inspection pass. No new risk controller, attachment menu or PDF-to-chat behavior. |
| Trader journal / continuation | Actual existing Trader-authored Markdown file remains unchanged and is rendered by the Journal tab. Earlier successful Bot Mode write/read is retained as historical proof. | Current file/UI readback passes. Former HTTP400 cause is still unestablished; no reasoning-state adapter or provider workaround was added. A fresh representative parent-model continuation remains pending. |

### Actual saved forecasts

All three current Trading records survived the application reload:

| Producer / run | Result | Meaning |
|---|---|---|
| Trader — November 10 retained RDW run; 48 input bars | `available` | Previous chosen example preserved, not regenerated or overwritten. |
| Quant — November 13 evening local / November 14 UTC; 128 RDW daily input bars | `invalid_prediction` | Raw mini output is retained honestly. Open exceeds high and close falls below low. Not suitable for risk calculations. |
| Trader — same current RDW request and seed; 128 input bars | `invalid_prediction` | Same computation path and raw result; independent producing Card/record. No cherry-picking reruns or candle repair. |

The two current runs target November 16, 2026. Their optional GARCH result reports next-bar log-return volatility 6.663603%, 20 held-out bars, variance MAE 54.5184 versus constant-variance benchmark 62.9873. This is a calculation result, **not future directional accuracy, options IV, validated profitability, or an order**. UI outcome comparison returned `pending` without manufacturing an observed outcome.

### Test and loaded-runtime evidence

- Full Python suite: **661 passed, 35 skipped**, two upstream deprecation warnings. Command: `.venv/Scripts/python.exe -X utf8 -B -m pytest app -q --tb=short` from `apps/python-models`.
- Full client/backend suite: **568 passed, 1 skipped**, 83 files. The nine initial failures were resolved by narrowly reconciling current contracts and fixtures, not removing product behavior.
- Explicit real PostgreSQL/AGE shared-record suite: **13 passed**; combined existing Trading/evidence PostgreSQL and SDK suite: **34 passed**. These use disposable isolated test databases, not demo records.
- Migration tests: **30 passed**. Source/spec TypeScript checks and backend/client production builds passed. Existing large-chunk and WorldView `node:fs` browser-externalization warnings remain.
- Non-Git source hygiene check: all **45** ledger paths exist; no merge-conflict markers. Eight whitespace-only lines remain in `client/src/components/knowledge/knowledgeGraphProjection.spec.ts` (162,198,233,247,264,290,300,321). They were not used as justification to reformat unrelated test sections. This is not a `git diff --check` result; Git was not used.
- Loaded MCP: **ready**, **87 tools**, no unavailable catalog families, `sourceCurrent=true` after the final normal application-services reload. Python rails reload was required and completed.
- Existing Hermes process **33160**, started November 13 at 18:15:34 local, remained running throughout. No new Gateway, session recreation or profile reset. Normal `npm run dev:services` owns the reloaded application services.
- Final saved-deck readback: **15 Cards, 14 identical wires**, same profile identities, models, selected tools/native toolsets and skill selections. Absent optional skill arrays remain equivalent to their original empty selections. Only three Card revisions changed through approved Prompt Block corrections: KnowGraph document procedure, ThinkGraph explicit-input map wording, Trader's existing forecast permission wording.
- Canonical conversation checks retained Main 124 messages, Trader 24, Research 12 and KnowGraph 9 in the checked existing sessions; journal contents unchanged. No new parent-model turns were sent in this pass. UI reload preserved the existing Main conversation and restored Send availability.
- No broker orders, Oracle operations, Git commands, new credentials or model/provider changes. No OpenRouter inference/embedding request was intentionally executed during this pass. Ordinary services retain their existing configuration; this is not a claim about unrelated concurrent activity.

### Per-Card qualification in this pass

| Card(s) | Current executed proof | Still not proved |
|---|---|---|
| Quant | Real `forecast_market_bars`, saved raw result; same-Project exact read by Trader | Parent-model interpretation, full pair/hedge comparison and live handoff |
| Trader | Real `forecast_market_bars`, direct `trading.read_evidence` of Quant forecast; actual Forecast and Journal UI readback | New Hermes continuation and live decision/journal round |
| Research | Own saved MCP `documents.get_passage` returns exact retained page129; ungranted `agentgraph.read` correctly refuses and authorized reading still works | New Bot Mode research round and curated Know persistence |
| Main | Existing chat/history and Send survive reload; 14 targets unchanged | New all-team orchestration acceptance |
| KnowGraph | Saved prompt publication/readback; own existing grants preserved; strict writer/ranker contracts tested | Real new write/readback and successful paid rerank |
| ThinkGraph | Saved prompt publication/readback; existing grants preserved; map tests | Automatic completed-exchange processing under current provider restrictions |
| WorldView | Saved two-tool mapping unchanged; earlier real ISS lookup remains historical evidence | Fresh sourced observation and actual Know promotion |
| Builder, Magnetic, Team, Analyst, Contrarian, Predictor, Designer, Learner | Saved identity/model/tools/wiring preserved; relevant deterministic tool contracts included in suite | Required current per-Card legitimate input/output/failure and full-team sequence |

### Exact implementation file ledger

Paths are relative to this workspace. This is the Primary's scoped edit ledger, **not a Git diff or a claim that unrelated worktree changes are absent**.

| Requirement | Files changed / added |
|---|---|
| R1 document citation procedure / strict provenance | `apps/backend/src/decks/prompts/knowgraph.md`; `apps/python-models/app/mcp_provider_operations.py`; `apps/python-models/app/python_models/test_document_know_promotion.py` |
| R2 existing ranked retrieval adaptation | `apps/python-models/app/mcp_graphiti_provider.py`; `apps/python-models/app/python_models/test_knowgraph_ranked_search.py`; `apps/python-models/app/python_models/test_mcp_provider_dispatch_contract.py` |
| R4 optional shared PostgreSQL/AGE | `apps/backend/migrations/065_optional_agentgraph_records.sql`; `apps/backend/src/db/migrations.ts`; `apps/backend/src/db/migrations.spec.ts`; `apps/python-models/app/python_models/agentgraph_records.py`; `apps/python-models/app/python_models/agentgraph_record_operations.py`; `apps/python-models/app/agent_canvas_card_operations.py`; `apps/python-models/app/python_models/operation_definition.py`; `apps/python-models/app/mcp_request_dispatch.py`; `apps/python-models/app/python_models/agentgraph_inspection.py`; `apps/python-models/app/python_models/agentgraph_query.py`; `apps/python-models/app/python_models/test_agentgraph_record_operations.py`; `apps/python-models/app/python_models/test_agentgraph_records_postgres.py`; `apps/python-models/app/python_models/test_agentgraph_inspection.py` |
| R5 Entity directory / matching fixtures | `apps/python-models/app/python_models/project_entity_map.py`; `apps/python-models/app/python_models/test_project_entity_map.py`; `apps/hermes-liquidaity-plugin/graph_context.py` (header only); `apps/backend/src/decks/prompts/main.md`; `apps/backend/src/decks/prompts/thinkgraph.md`; `apps/backend/src/decks/defaultProjectDeck.spec.ts`; `client/src/components/knowledge/codeGraphProjection.spec.ts`; `client/src/components/knowledge/knowledgeGraphProjection.spec.ts`; `client/src/features/agentbuilder/state/useAgentBuilderKnowledgeGraphs.spec.ts`; `client/src/components/main/MainProjectChat.spec.tsx`; `plugin.md` |
| R6 truthful risk / existing attachment surface | `client/src/features/trading/TradingUiInspectorPanel.tsx`; `client/src/features/trading/TradingUiInspectorPanel.spec.tsx`; `client/src/components/knowledge/UploadAttachment.tsx` |
| Section6 / latest forecast-database request / optional calculation retention | `apps/python-models/app/python_models/trading_forecast.py`; `apps/python-models/app/python_models/test_trading_forecast.py`; `apps/python-models/app/python_models/trading_statistics.py`; `apps/python-models/app/python_models/test_trading_statistics.py`; `apps/python-models/app/python_models/trading_backtest.py`; `apps/python-models/app/python_models/trading_evidence.py`; `apps/python-models/app/python_models/trading_tool_operations.py`; `apps/python-models/app/python_models/test_trading_evidence_operations.py`; `apps/python-models/app/python_models/test_trading_evidence_postgres.py`; `client/src/features/trading/KronosForecastPanel.tsx` |
| Required audit and proposal-only ideas | `CURRENT_SYSTEM_AUDIT.md`; `FUTURE.md` |

No source file was bulk-deleted. No historical table, session, graph, document or forecast was removed. Superseded inline relationship-map validation was removed inside its existing owner; no competing replacement runtime was added. New schema is only migration065 in the existing database. Existing forecast table/store is reused, not recreated. No generated SOUL was directly edited.

### Precise remaining dependencies and release boundary

1. **Owner Decision / Approved Incomplete — passive all-Card AGE telemetry:** native Hermes subscriptions currently lack plugin-unload cleanup. An isolated native ownership-ledger fix was proposed and remains unapproved. No new thread/loop/scheduler or private cleanup workaround was introduced. Current AGE tests prove publication provenance, **not all-Card execution telemetry**.
2. **Owner Decision — no-spend live graph acceptance:** document search embeddings, new Know embeddings/writes, reranking and automatic ThinkGraph's Jev selection use the currently configured OpenRouter paths. Local parent Cards use the GPT account, but that does not remove those downstream paid dependencies. Keep no-spend and mark these live checks blocked, or authorize a separately bounded existing-provider test. No silent provider switch.
3. **Owner Decision — stale runtime wording:** current Main uses the Hermes browser client on9120, with no `/api/main/session`; automatic ThinkGraph invokes the saved Card. The supplied spec mentions the older route/chunk-first path. Preserve current behavior pending clarification rather than resurrecting an old route or rewriting the extractor.
4. **Approved Incomplete — shared-tool saved-Card execution:** four optional tools are published but no saved grants were broadened. Isolated database/SDK tests do not substitute for real granted Card publication/readback. Assignments need an explicit scoped selection, not automatic blanket grants.
5. **Approved Incomplete — full acceptance:** fresh Research→Main→Know write/readback, WorldView→Know, every Card's live negative test, complete equity/options comparison through Trader, Learner review and automatic ThinkGraph persistence remain unproved in this pass. Invalid current Kronos samples are retained as failures, not hidden to make the demo appear ready.

No Oracle deployment and no release-ready Git checkpoint recommendation. The owner can preserve current source at any time, but this pass does **not** certify the full local demo for release. Pending decisions do not negate the independently completed forecast database, direct evidence reader, strict document procedure, degraded search handling, optional record layer, truthful UI and passing deterministic checks.
