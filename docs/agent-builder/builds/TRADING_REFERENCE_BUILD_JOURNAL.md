# Trading Reference Build Journal

This journal records material construction decisions for the first Card-managed subsystem reference. It
contains no hidden reasoning, credentials, raw transcripts, or graph writes.

## Build identity

- Card: `card_trading_workbench` (preserved in place)
- Runtime target: Hermes delegate profile `trading`
- Deterministic subsystem: LumiBot through `card-subsystem.v1`
- Execution boundary: paper/sandbox only; order submission blocked pending separate approval
- Outer manager: existing Mag One worker edge
- Started from source revision: `5973deb6e27128b777436159f1acff3ee30fb7f4`

## Material moves

### 2026-09-03T02:28:30-04:00 — P0-T1, source reconciliation

- Read repository law, current source, paused diff, saved-Card defaults, Trading routes/runtime/UI, Agent
  Builder authority, and the attached LumiBot and God's Eye View archives.
- CBM's application-published session returned `Session terminated`; no retry, daemon, cache, reindex, or
  alternate frontend was started. Direct source and read-only Git history supplied the bounded map.
- Read-only history confirmed the existing Trading UI and prior FinRL/forecast/EDGAR/WorldSignals ideas.
  Historical specs are evidence only and do not regain authority.

### 2026-09-03T02:28:30-04:00 — P1-T1/P1-T2, product surfaces

- Preserved the existing Card identity, Hermes profile, model/provider selection, presentation, and Mag One topology.
- Added a product-neutral saved subsystem attachment and a named LumiBot capability/readiness tab.
- Moved durable risk, cadence, chart, broker-reference, and strategy parameters to the Trading UI Inspector.
- Kept prompt, tools, skills, runtime, graph context, Team policy, and Script in the Card/IDF workspace.
- Replaced fake/no-op presentation behavior with a real-or-unavailable portfolio landing view, compact
  per-job candles, selected full chart/evidence, history, status, and fail-closed interventions.

### 2026-09-03T02:28:30-04:00 — P2-T1/P2-T2, runtime and construction seam

- Added strict Python validation for `card-subsystem.v1` and the expanded `trading.card.v1` settings.
- Used LumiBot's public Strategy/Broker observation methods; removed dependency on private broker members.
- LumiBot native model agents remain disabled. Hermes owns all model calls and optional bounded Team use.
- PAUSE/RESUME remain unavailable until a real LumiBot Trader lifecycle exists; no journal-only substitute is presented as control.
- Extended the exact Agent Builder edit operation to authorize an explicit subset of configuration, Script,
  and subsystem attachments through the existing canonical save tool.

### 2026-09-03T02:28:30-04:00 — P3-T1, evidence so far

- Production TypeScript typecheck: pass for client and backend.
- Focused client/backend tests: 40 passed, including Trading state, subsystem attachment, Agent Builder
  operation, topology, routes, and real Trading UI interaction.
- Focused Python tests: 139 passed across Trading, adapter validation, Card domain, control plane, and MCP schema/dispatch.
- A broader Python MCP contract run had 218 passes and one unrelated pre-existing catalog-publication
  mismatch for `card.run_assistant_agent`; it is not treated as Trading success or repaired here.
- Full backend spec typecheck remains blocked by pre-existing migration module-mode, Kanban test fixture,
  and MCP client fixture errors outside this change; touched Trading route spec errors were removed.
- Canonical restart, saved-deck reconciliation, loaded-process readiness, and browser proof were completed
  in the later loaded-process entry below.

### 2026-09-03T02:58:00-04:00 — P2-T3, function-before-form lifecycle

- Added one fixed credential-free local Pandas replay through the installed LumiBot 4.4.56 public
  `Trader`, `Strategy`, `BacktestingBroker`, and `PandasDataBacktesting` APIs.
- The real lifecycle completed a one-share simulated round trip: two fill-status orders, 18 recorded native
  lifecycle/decision/order/fill events, a nonzero final P/L, an equity/drawdown series, a 913-byte LumiBot
  stats CSV, and a normalized JSON receipt. No live broker or LumiBot model-provider path is selectable.
- Added Card-scoped lifecycle receipt persistence with schema checks fixing mode to `local_backtest`,
  `paper_only=TRUE`, `live_orders=FALSE`, and `model_provider_calls=FALSE`.
- Added an authenticated backend command, initial snapshot and SSE read-through, and an Agent UI panel that
  renders the returned replay candles, portfolio/P&L/drawdown, lifecycle events, and artifact hashes.
- Focused proof now includes 11 Trading Python tests, 12 backend migration/route tests, and 8 client
  subsystem/operation/UI tests.

### 2026-09-03T03:20:00-04:00 — P3-T2, canonical loaded-process proof

- The first authorized canonical restart failed closed on migration `032_paper_trade_jobs.sql`: the
  least-privilege runtime migrator does not own the protected Card tables and therefore cannot add a
  foreign-key `REFERENCES` constraint to them. The migration source now keeps child-table foreign keys,
  removes only those cross-authority constraints, validates the current saved Card/revision in Python
  before every write, and performs explicit inverse deletion checks from canonical Card deletion.
- A second canonical restart completed and left the application process tree running. The Trading Card
  was reconciled only through the authenticated, revision-checked saved-deck API. Its ID, six saved edges,
  Mag One worker edge, presentation attachment and every unrelated Card remained byte-for-byte stable.
  The new deck revision is `886fd4d3-0277-42b8-9548-6061a42c4d2f`.
- Loaded readback resolves `card_trading_workbench` to Hermes delegate profile `trading`, account-backed
  `openai` / `gpt-5.6-luna`, and the exact saved LumiBot attachment. Replacing the previous OpenRouter API
  binding was required by the account-only Hermes runtime rule, not a general provider migration.
- Authenticated `POST /api/trading/lifecycle/backtest` produced completed lifecycle
  `e193dc7e-3b82-4dd8-9137-65ceb332ba87`. Authenticated snapshot and SSE returned the same ID, 12 local
  replay candles, 18 lifecycle/decision/order/fill events, two fill-status simulated orders, replay
  portfolio value `$100000.10`, P/L `$0.10`, zero drawdown, and two hashed artifacts.
- The upstream LumiBot statistics artifact is 913 bytes with SHA-256
  `39c66d465bee388bd71aa79e1930af8ae54d69174a61448adc1ba6d7cc9bcb9f`; the normalized snapshot artifact
  is 11,542 bytes with SHA-256
  `399b2e3adb544146821b9252540b0f8a5686cd92f2bfe46d7cbc6375edb68288`.
- Browser readback of the existing left-rail Trading UI displayed that exact lifecycle ID, portfolio/P&L,
  event count, replay bars, candle chart and artifact locators/hashes. The named LumiBot Card tab separately
  displayed installed version `4.4.56`, bounded local-backtest readiness and disabled native agents.
- The same UI reports `provider_unconfigured` for Alpaca, explains that paper credentials are absent, and
  keeps order submission and live controls blocked. This does not invalidate the allowed local-backtest
  proof; a connected paper-account lifecycle remains a separate approval and credential task.

### 2026-09-03T04:12:04-04:00 — P3-T3, final native Hermes Card proof

- The one final canonical reload completed and remains the owner of the application process tree. Final app-owned
  MCP readiness reported 75 tools with catalog hash
  `9060b04cacb698ba7a2c01332dd48c02c403cd096a69abe74c5f2cdd2413af25` and startup ID
  `e97266f7c37f4c358c56cc8d5e711fd5`.
- A new ordinary Hermes Card profile initially failed before inference because the shared run-start materializer
  synchronized only child selections and left its parent `model` unset. The product-neutral seam now materializes
  the saved parent provider/model, rereads the native profile, and fails closed on a mismatch before starting the turn.
- Harmless Run `trading-profile-proof-26bcd12d5486` entered through the normal saved-Card doorway and completed
  with runtime owner `hermes`, native profile `trading`, account-backed `openai` / `gpt-5.6-luna`, 14,732 input
  tokens, 885 output tokens, and `model_fallback_occurred=false`.
- Post-Run native readback reported parent `openai-codex` / `gpt-5.6-luna`, enabled assigned skill
  `grounded-citations`, available installed holographic memory in the isolated `trading` profile, and the exact
  saved `card-subsystem.v1` LumiBot attachment. The response discovered skills and memory without invoking them.
- The Run emitted no native tool event and no Team or Magentic-One receipt. It made no broker, trade, order,
  lifecycle, Auto-Team or outer-manager call. A real Magentic-One invocation was expressly outside this final proof.
- Authenticated post-Run readback retained lifecycle `e193dc7e-3b82-4dd8-9137-65ceb332ba87` unchanged: completed,
  portfolio `$100000.10`, P/L `$0.10`, 18 events, zero current jobs, and the same two artifact hashes. The existing
  Trading Agent UI continued to expose that persisted receipt after the reload.
- Sequential post-reload verification passed production client/backend typechecking, 50 focused backend/client
  tests, and 126 focused Python tests. A final client typecheck also passed after the inverse audit replaced one
  newly introduced branded local-storage key with a product-neutral identifier.
- The Codex-facing application CBM connection required reauthentication, so no new coding-agent CBM query was
  substituted or retried. The canonical app-owned CBM frontend itself initialized successfully during the reload;
  direct source and read-only Git supplied the final bounded audit.

## Open-source intake result

- Chosen now: LumiBot as the deterministic paper broker/strategy/replay/backtest subsystem; use its public Python API and preserve upstream source.
- Rejected for this pass: TradingView Lightweight Charts because it is not installed and adding a dependency
  was outside the approved change; the existing controlled SVG candles remain.
- Promising team processors for later evaluation: PyPortfolioOpt or Riskfolio-Lib for deterministic portfolio
  risk, QuantStats for paper-performance metrics/tearsheets, Qlib or FinRL-X for bounded research/backtest
  experiments, and OpenBB for normalized research data. None was installed, cloned, or made authoritative.
- God's Eye View is a strong future WorldSignals presentation/source subsystem through its public data-layer
  seams. Its direct OpenAI voice path is not eligible under account-only Hermes authority without a bounded adapter decision.
