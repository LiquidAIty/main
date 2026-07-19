# Skill: Follow-the-Money Issuer Evidence Case Loop

@skill id=issuer-evidence-case-loop
@type Skill
@status active
@related_to knowgraph-hybrid-retrieval-tool
@related_to no-fake-surfaces-skill
@requires live_knowgraph_read_route

## Vector Summary

Assemble a durable, source-aware evidence case for ONE resolved issuer/instrument by reusing the
existing read-only KnowGraph route plus injectable Alpaca/seed adapters. Reusable for every issuer
via the same code path (no per-issuer branch). It is an evidence-navigation order — Follow the Money
is the organizing principle — NOT a recommendation engine, screener, signal engine, or trader.

## When To Use

- You need one issuer's tradeable identity, EDGAR evidence (business/customers/competitors/capital
  structure/risks/events), Alpaca tradability/market state, and supplemental Follow-the-Money seed
  context, with every fact labelled source-backed vs derived vs seed-only vs unresolved.
- You are about to replay the same assembly for a second issuer — use the identical path, never a
  ticker-specific branch.

## Procedure

1. Resolve the issuer from records by ticker / CIK / graph-id (never hardcode; if unresolved, emit an
   honest unresolved identity — never invent a ticker or map a name to the wrong issuer).
2. Bucket EDGAR evidence by context role (business / risk / management-discussion → capital-control-
   ownership); attach full provenance from each context + its SUPPORTED_BY EvidenceSection.
3. Read tradability via the injected Alpaca snapshot: available → TRADE_KNOWN; unconfigured / module-
   unavailable / error → TRADE_UNKNOWN with the EXACT provider diagnostic. Never "not_tradeable".
4. Attach Follow-the-Money seed via a typed adapter: found / not_found / unavailable; every seed item
   marked `verification_state=unverified_seed` — import never promotes seed to a verified fact and
   never overwrites EDGAR.
5. Leave competitors `unresolved` with `candidates=[]` until structured COMPETES_WITH edges exist;
   point at the business EvidenceSection as the source-backed competitor evidence location.
6. Bucket every item into research_state: source_backed / derived / unresolved / conflicting /
   missing_source, and summarise source_roles (EDGAR primary, ALPACA, SEED supplemental, EXTERNAL).

## Guardrails

@guardrail id=issuer-evidence-case-loop.read-only-no-writes
@guardrail id=issuer-evidence-case-loop.preserve-four-way-distinction
@guardrail id=issuer-evidence-case-loop.alpaca-failure-is-unknown-never-untradeable
@guardrail id=issuer-evidence-case-loop.seed-is-supplemental-unverified
@guardrail id=issuer-evidence-case-loop.never-invent-a-ticker
@guardrail id=issuer-evidence-case-loop.no-score-no-verdict-no-order-no-scheduler
@guardrail id=issuer-evidence-case-loop.every-evidence-item-carries-provenance

## Minimum Provenance (every stored evidence item)

source_kind, source_identifier, source_url_or_provider_reference, retrieved_at,
observed_or_filed_at, effective_or_as_of_date, entity_resolution_status, verification_state,
raw_value.

## Four-Way Distinction (never flatten to scalar issuer properties)

1. persistent entity identity  2. source-backed assertion  3. time-bound event/observation
4. derived research output.

## Query Patterns

@query id=issuer-evidence-case-loop.test [ARCHIVED — implementations deleted in fb300e0e; skill retained as architectural intent]
@query id=issuer-evidence-case-loop.smoke [ARCHIVED — implementations deleted in fb300e0e; skill retained as architectural intent]

## Failure Modes Seen

- System Python lacks pytest → run via the python-models venv interpreter.
- Alpaca module import pulls a transitive `neo4j_graphrag` not installed here → honest
  TRADE_UNKNOWN with exact diagnostic, NOT a generic "unconfigured" and NOT "not_tradeable".
- Idempotence asserted naively fails because `retrieved_at` legitimately varies → fix a retrieval
  timestamp to prove deterministic assembly (it's read-only, so duplication is impossible anyway).
