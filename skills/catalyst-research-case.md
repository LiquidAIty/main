# Skill: Catalyst Research Case

@skill id=catalyst-research-case
@type Skill
@status active
@related_to issuer-evidence-case-loop
@related_to no-fake-surfaces-skill
@requires live_knowgraph_read_route

## Vector Summary

Assemble a source-aware, dated **Catalyst Research Case** for one resolved issuer by wrapping the
reusable Issuer Case Loop and layering dynamic source observations + supplemental seed context +
derived research. Follow-the-Money is ONE contextual lens, not the product. This builds the
research case LATER experiment work consumes — it is NOT a screener, signal engine, score,
recommendation, or trader.

## When To Use

- You have a dynamic, dated source observation (EDGAR filing/section, Alpaca market, existing
  forecast) and need the evidence-backed research case around one issuer/instrument.
- You are replaying the case for another issuer — use the identical assembler, never a per-ticker
  branch.

## Four Layers (keep DISTINCT — never flatten)

1. dynamic_observations — dated, source-backed (EDGAR_FILING, EDGAR_FILING_SECTION,
   ALPACA_MARKET_SNAPSHOT/BAR_SERIES, EXISTING_FORECAST_OBSERVATION). Never a permanent issuer prop.
2. persistent_context — seed atlas (Follow-the-Money / ownership / founder / brand), every row
   `unverified_seed`, source-preserved, never current truth, never overwrites EDGAR.
3. derived research — explainable derived relationships + STRUCTURAL `open_evidence_gaps` (typed
   records: gap_kind, issuer_or_entity_ref, related_source_refs, reason_code, severity_or_priority,
   status). NOT natural-language research questions. NO score, NO trade direction, NO classifier.
4. later experiment layer — thesis / trade-type / paper portfolio. OUT OF SCOPE.

## Source Priority

EDGAR (primary issuer disclosure: stored sections + live filing signals) → ALPACA (instrument /
market state / bars) → existing forecast ONLY if a persisted output contract exists → seed atlas
(supplemental). News / patents / contracts attach ONLY when a real source path exists; otherwise
`source_not_integrated` in capability metadata — never a fabricated "unavailable" evidence object.

## Date Rules — by filing family (SPEC requirement 1+2)

- NEVER derive a date from accession number / ticker / URL filename / current time / filing year.
- Preserve the raw provider `source_period_of_report` INDEPENDENTLY, then map by family:
  - 10-K, 10-K/A, 10-Q, 10-Q/A → `period_end_date` (only when source supplies a period).
  - 8-K, 8-K/A → `reported_event_date` — NEVER `period_end_date`.
  - other/unknown form → keep raw period in `source_period_of_report` only; `date_reason_when_unknown
    = unknown_form_period_semantics`; never map it to a typed date.
- `filed_at` = acceptance date; `event_effective_at` only when explicitly source-supported (else "").
- Display priority — 10-K/10-Q: period_end→filed→retrieved→unknown; 8-K: reported_event→filed→
  retrieved→unknown; unknown form: filed→retrieved→unknown. Always name `display_date_kind` +
  `date_precision`. Stored sections recover real family-typed dates by joining accession→filing signal.

## Minimum Provenance (every dynamic observation — flat contract)

form_type, source_period_of_report, filed_at, period_end_date, reported_event_date,
event_effective_at, retrieved_at, observation_timestamp, display_date, display_date_kind,
date_precision, date_reason_when_unknown, source_kind, source_identifier, provider_or_source_system,
source_url_or_provider_reference, entity_resolution_status, verification_state, raw_value.

## Seed source contract (SPEC requirement 4)

ONE explicit config: `SEED_ATLAS_PATH` (or explicit path arg). NO Downloads/candidate scanning, no
copy into repo, no shadow DB. Absent → `seed_context_unavailable` reason `seed_atlas_path_not_
configured`; missing file → reason `seed_atlas_path_missing_file`. Every row preserves source_id,
non-sensitive `configured_locator` (home-relative `~/...`, never a raw home path), workbook,
worksheet, row_index, workbook_modified_at, SHA-256 `workbook_fingerprint`, raw values, source_as_of,
imported_at, `verification_state=unverified_seed`.

## Import Boundary — durable package fix (learned, reusable)

Root cause: `apps/python-models/app` was a NAMESPACE package (no `__init__.py`); a regular
`services/knowgraph/app.py` shadows it regardless of sys.path order, dragging in `neo4j_graphrag`.
DURABLE FIX (no runtime hacks): `apps/python-models/app/__init__.py` makes `app` a REGULAR package,
so it wins whenever `apps/python-models` precedes the colliding entry. The production importer
`issuer_case_loop.import_app_python_models_module(name)` is now a plain `importlib.import_module`
with NO sys.path mutation and NO sys.modules purge. Launch with correct roots: the uvicorn sidecar
runs from `apps/python-models`; the smoke runs `python -m catalyst_research_case` with
`PYTHONPATH=apps/python-models;services/knowgraph`; the `services/knowgraph/conftest.py` pre-caches
the real `app.python_models` once so pytest's per-module prepend can't reshadow it. Never a bare
`import alpaca_market_data`; never install GraphRAG as a band-aid.

## Guardrails

@guardrail id=catalyst-research-case.read-only-no-writes-no-orders
@guardrail id=catalyst-research-case.four-layer-distinction
@guardrail id=catalyst-research-case.dynamic-vs-persistent-seed-separation
@guardrail id=catalyst-research-case.no-accession-year-dates
@guardrail id=catalyst-research-case.alpaca-failure-unknown-never-not-tradeable
@guardrail id=catalyst-research-case.seed-supplemental-unverified-never-overwrites-edgar
@guardrail id=catalyst-research-case.forecast-only-if-persisted-contract
@guardrail id=catalyst-research-case.no-fabricated-news-patent-forecast-evidence
@guardrail id=catalyst-research-case.no-score-no-direction-no-classifier

## Query Patterns

@query id=catalyst-research-case.test [ARCHIVED — implementations deleted in fb300e0e; skill retained as architectural intent]
@query id=catalyst-research-case.smoke [ARCHIVED — implementations deleted in fb300e0e; skill retained as architectural intent]
@query id=catalyst-research-case.current "apps/python-models/.venv/Scripts/python.exe -m pytest services/knowgraph/test_seed_atlas_source.py -q"

## Guardrails (added by hardening)

@guardrail id=catalyst-research-case.8k-period-is-reported-event-never-period-end
@guardrail id=catalyst-research-case.no-syspath-or-sysmodules-mutation-in-service-path
@guardrail id=catalyst-research-case.seed-explicit-config-no-downloads-scan
@guardrail id=catalyst-research-case.structural-gaps-not-generated-questions
@guardrail id=catalyst-research-case.structural-not-lexical-safety-tests

## Known Failure Modes

- Backend (:4000) down → live KnowGraph read fails; start ONLY `npm run dev:backend` (leave the
  running sidecar on :8003 alone), or fixture the real-shaped records.
- sec-api returns gzip JSON; a bare `.decode('utf-8')` raises UnicodeDecodeError — decompress when
  Content-Encoding is gzip / magic 0x1f8b.
- sec-api stores CIK without leading zeros; query by ticker (or zero-stripped CIK) or you get 0 hits.
- Running the smoke as a bare script (`python services/knowgraph/catalyst_research_case.py`) puts
  services/knowgraph first on sys.path and reshadows `app` — use `python -m` with the package roots.
- Live filing-signal window (limit/forms/date range) may not include an older stored filing, so its
  section stays date-unjoined (honest) — widen the window only if needed.
