# Trading implementation recovery

Current working branch: `main`. Latest observed owner checkpoint: `66fd88400`
(`WIP: trading team trial and Oracle readiness`). Further verified source edits remain
uncommitted. Find the latest
checkpoint containing this note with `git log -1 --format='%h %s' -- IMPLEMENTATION_RECOVERY.md`.
No source checkpoint proves a live Card run or remote deployment.
Latest owner correction: the user alone saves Git checkpoints. Codex may edit and verify
source, but must not stage, commit or push; notify the user when a checkpoint is ready.

## Active scope

Finish the existing durable Trading company, then run one genuine RDW/RKLB local trial,
repair demonstrated failures, verify affected Oracle images and save source checkpoints.
Use **Investment Category** and **Allocation Lane**, not the old portfolio-group term.
Retain Hermes, its TaskGraph and permanent blue-wire authority. No new runtime, database,
Gateway, permanent specialist beyond Research/Learner, broker orders, or state wipes.

The final specialists are Analyst, Research, Designer, Contrarian, Quant, Trader, Learner,
WorldView and Predictor. Keep Main/ThinkGraph/KnowGraph/Builder and one user Card position.
The rolling portfolio is the anchor. User allocation targets total 100%; the illustrative
High Options preset targets 25% Options without requiring investment or permitting that loss.
Finish current Card/tool integration before expanding numerical capabilities. GARCH is the
only added forecast model; evaluate a small classical optimizer behind `portfolio.optimize`.
No quantum implementation, extra forecast model or autonomous order authority is approved.

## Verified baseline and incomplete stage

- Trading Project `cc1deb71-d059-46b8-975d-e2473dacf132`, deck `deck_builder`, is retained.
- Options became Designer (profile `agent-gjt2ed`, Terra 6.1); Bear became Contrarian
  (profile `bear`, Luna 6). Actual Hermes SOUL readback matched their saved prompts.
- Designer now has 20 explicitly selected application tools and its own credential created
  through the approved on-Card **Connect app tools** action. Hermes connection testing passed;
  raw profile readback retained `gpt-6.1-terra`, Low effort, and the exact selected includes.
  Its saved Goal/introduction now cover a single assigned equity/ETF, option, forex,
  commodity/futures or crypto thesis. Existing Web/skills/memory and all wires remain intact.
  Eight read-only operations reuse the pinned LumiBot BuiltinTools functions, not its agent
  runtime: quote, provider price, bounded history, option chain/strikes/Greeks/market quality,
  and equal-unit spread pricing. Other grants read Project evidence and retain proposals or
  assessments; no order, allocation, graph-write or scheduling authority was added.
  Using Designer's actual saved credential and HTTP connection, the official MCP client
  verified exactly 20 tools and real RDW quote, BTC/USD quote and RDW chain reads. Forex and
  crude-oil futures returned explicit provider-unavailable results. This is real tool proof,
  NOT a new Designer model turn or full-team acceptance. The connected data source remains
  Alpaca; other markets can be researched with Web/documents, but their live feeds are missing.
  Exact derivative terms/currencies/dates are validated; unsupported ratio-spread pricing is
  rejected rather than averaging or mispricing quantities. Multi-leg previews require one
  contract per leg and do not prove capital, collateral or maximum loss. LumiBot history is
  exposed only for its verified minute/daily interval behavior; existing historical-bar tools
  remain available. Provider-derived prices/Greeks are not mislabeled as trades/observations.
- Bull was removed from active Project membership by the owner-confirmed UI operation;
  its profile/history were not deletion targets. Readback showed 13 Cards and 12 wires.
- Research (`card_assist_ahwxjm`, `agent-ahwxjm`) and Learner (`card_assist_xvhztm`,
  `agent-xvhztm`) now exist through the saved-Card/new-profile procedure. Research uses
  Sol 6.1 Low; Learner uses Terra 6.1 Low; both select Luna 6 Low leaves. The owner wired
  Research to `bus-out-6` and Learner to `bus-in-2`. Preserve those wires and placements.
  Research's own app-tool connection passed a native 12-tool probe. Both Cards now have
  saved orchestration introductions; native Hermes SOUL/description readback matched them.
  Learner's own tool connection is awaiting the explicit setup confirmation requested in
  this chat. Its 10 saved grants are unchanged; real workflow proof remains incomplete.
  Do not claim prompts or checked grants prove execution.
- Neo4j contains the real owner-provided 20-page design brief as 20 raw vector passages.
  Exact readback, semantic retrieval, foreign-Project denial and duplicate reuse passed.
  This is design material, not verified financial evidence or an automatically created Know.
- Migration `064_trading_proposal_evidence.sql` is registered and applied locally. It adds
  append-only proposals, specialist assessments and dated Markdown journal entries under
  existing Trading ownership. New product tables were empty before the real trial.
- Proposal inversion, journal immutability, actual author provenance, scoped references,
  concurrency and SHADOW-vs-broker distinctions have focused deterministic/isolated-PG proof.
- Rolling allocation policy and the target/observed pie controls now use Trader's existing
  saved configuration and read model. Python validates new revisions before persistence.
  Targets must total 100%; unknown/unassigned/short or unreconciled holdings never become
  invented category headroom. Reservations include active jobs outside the visible 100-row
  history. Expected proceeds, settled cash, observed cash and buying power remain distinct.
  The High Options preset is displayed but NOT yet saved to the product Card.
- The existing LumiBot Alpaca connection now retains actual buying power and exact position
  instrument IDs through its public SDK client. Its old history convenience method had an
  actual SDK signature mismatch; the application adapter now uses GetPortfolioHistoryRequest
  rather than editing the vendor. Loaded HTTP readback returned an ACTIVE paper account,
  balances/buying power, no open positions and 90 daily equity points. Equity changes are not
  labeled trading P&L. This submitted no orders. History failure no longer erases balances.
- Durable options-book workflow, GARCH, optimization and an actual confirmed-closure Learner
  trigger remain NOT implemented. Current cumulative order snapshots and EXIT recommendations
  are not confirmed closure receipts. The supported SHADOW review path remains the immediate
  acceptance option; no private Hermes callback/dispatcher or polling queue was added.
- On-Card Delete/Cancel replaces the browser confirmation in source; focused tests pass.
  Its loaded visual proof is pending. Do not delete another retained Card just to test it.
- The shared Card now invalidates ReactFlow's cached handle geometry when its bus-facing
  side or orange connector changes. Hover no longer replaces the handle's positioning
  transform. The rebuilt UI was loaded; Learner was dragged across the bus and back with
  the wire following the visible connector. Existing Research/Learner edge IDs and ports
  survived unchanged. Component, real-library geometry and existing canvas tests pass;
  client application/spec typechecks and build pass. No Gateway/session reset was used.
- The same UI build includes the missing ORCHESTRATOR SKILL editor field and the explicit
  app-tool setup readback correction (read raw saved config rather than env-expanded config).
  Their focused tests pass; Learner setup still needs its own product proof. The allocation
  UI loaded its controls and account data, but allocation-policy interactive save proof is
  pending. The earlier zero-width browser capture was traced to a stale tab binding; the
  current app tab works. Designer's connected-tool screenshot was saved under
  `.tmp/proofs/designer-market-tools-connected.jpg`. No alternate browser-control stack
  was introduced and its temporary viewport override was reset.

## Verification and current failures

The latest broad Python/KnowGraph run passed 654 tests, including the opt-in isolated
PostgreSQL tests. The prior 11 failures were repaired against current contracts, without
changing production authentication or restoring OAuth. Real HTTP/official SDK tests cover
invalid credentials, profile mismatch, concurrent context isolation, changed grants, key
rotation and catalog-reader non-execution. Their CBM provider seam is a test double, not
live CodeGraph proof or an extra frontend. Two upstream deprecation warnings remain.
The current focused frontend run passed 132 tests across 16 files. Client/backend production
and specification typechecks passed. The client build passed with its existing WorldView
node:fs externalization and large-chunk warnings. Real saved-Card
research-to-Know promotion, competing model calls, Quant/Trader handoff and Learner feedback
are still unproven. A Graphiti index-initialization cancellation warning appeared during a
short document read/close; data readback succeeded, but the warning was not repaired/suppressed.

The latest Designer/LumiBot/catalog/Streamable-HTTP focused run passed 92 tests. All 29 new
LumiBot adapter tests also passed inside the actual Linux AMD64 Python image, read-only and
network-disabled. They exercise real upstream bindings with fixtures, argument rejection,
equal-unit spread arithmetic, default forwarding, grants and unavailable-market behavior.
The actual Designer-credential provider reads above are separate from those fixture tests.
Deployment input tests passed 6/6; the current Caddy image tests passed 2/2, including the
other coder's numeric-host TLS configuration. `git diff --check` passed.

## Commands, configuration and persistence

Local secrets: existing ignored `apps/backend/.env`; do not copy values into Git or this note.
Required names are documented in `deploy/oci/env.example`: retained `DATABASE_URL`,
`NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`, `LIQUIDAITY_INTERNAL_MCP_SECRET`, model-provider
credentials for each saved profile, embedding provider credentials, and applicable
`ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY`. Public globe build inputs are `CESIUM_ION_TOKEN`
and optional `GOOGLE_MAPS_API_KEY`. Presence is not provider-execution proof.

Normal local start: `npm run dev:fresh` (explicit full restart only), or the existing
`npm run dev:backend`, `dev:python-rails`, `dev:knowgraph`, `dev:mcp`, `dev:worldview`,
and `dev:hermes-webapp` commands for intentionally stopped owners. Do not start duplicates.
Refresh browser sign-in without rebuilding with `./scripts/start-hermes-webapp.ps1 -SignInOnly`.
Hermes/UI uses 9120; backend 4000; Python rails 8003; MCP 8765; KnowGraph 8001; WorldView 4174.
PostgreSQL/AGE and Neo4j remain the root Compose authorities. Never run `down -v`.

Build from root with the existing Python: `python deploy/oci/build.py --tag oracle-prep`.
Reuse a completed base with `--skip-hermes-base`; choose only changed targets using `--target`.
Then run `python deploy/oci/smoke.py --tag oracle-prep` and `python deploy/oci/preflight.py`.
The backend, Python rails, KnowGraph and Hermes UI AMD64 image set passes the existing
container smoke checks. Hermes UI now includes the latest Card editor/connector/allocation
source; Python rails now includes the corrected Designer tools. The proxy-test image includes
the parallel coder's current Caddy files. These checks do not restore live persistence or
prove Oracle model calls. Current local image identities:

- `local/hermes-ui:oracle-prep`: `sha256:3d649f96eec6b152274e841ce8634ad875155fddd76fd7b324573f3ffe265a82`
- `local/python-rails:oracle-prep`: `sha256:09cc892f000164acbbadb5642700112f947c84ca18a9ca2bc9575f98f8628c95`
- `local/proxy-test:oracle-prep`: `sha256:d86b2ebff9f415dd9cb25ab17cf3a319b1bddb56b8924b386fa9f5986d070842`

The first Python rebuild stopped on a partial CPU-wheel download/hash mismatch. One retry
downloaded the complete wheel and passed the ORIGINAL hash; no verification was bypassed.
The final source-only rebuild reused that verified dependency layer. Do not transfer an
older image merely because its mutable tag is also `oracle-prep`.
LumiBot stays `4.6.48+mcp2.1`, MCP major 2, and Oracle uses Torch `2.14.0+cpu`.
The existing import-only Kronos dirty-submodule change is reproduced by the root deployment
patch helper. Do not discard it or commit an unrelated vendor revision.

Read `deploy/oci/README.md` before deployment. OCI is AMD64; historical E5.Flex capacity is
1 OCPU/12 GB, not a current capacity measurement. The owner's parallel-coder handoff reports
the NEW Oracle Linux target `147.224.155.144`, user `opc`, SSH key path
`C:/Users/jerem/.ssh/oracle_liquidaity`, Docker/Compose installed, database images staged,
and numeric HTTPS verified with retained certificate data. This thread has not independently
accessed that VM. The temporary proxy was reportedly removed; the application is not yet live.
Keep those deployment changes intact and coordinate with that coder, rather than provisioning
another VM or repeating their work. Do not stop/copy local databases without the owner's
coordinated data-copy window. Server Codex OAuth needs its own login, not a reused Windows
refresh token. Demo login/browser acceptance and Linux CodeGraph remain pending.
After verified access, restored owner-managed data and explicit deployment authorization:
`docker compose -p main --env-file /etc/liquidaity/liquidaity.env -f docker-compose.yml -f deploy/oci/compose.docker.yml config --quiet`
validates configuration; the same definition with `up -d` starts it. Do not start the retired
systemd owners beside Compose. Keep only Caddy on public 80/443. Existing external database
volumes and required bind directories must exist; do not initialize replacements.

Persist the full Hermes home, ThinkGraph owner data, Neo4j data, PostgreSQL data, uploaded
documents, workspace state and model cache through their existing owners. They are NOT Git
source or image inputs. Local CodeGraph success is not Linux CBM packaging proof; the existing
deployment document records the Linux binary/index prerequisite.

## Exact next action

For the urgent deployment checkpoint: the owner can save reviewed source now, then hand the
verified image set and current deployment files to the Oracle coder. This thread has not
exported images, copied live data, changed the remote VM, or saved Git. The app images contain
no saved Cards/profiles; the separately coordinated retained-state transfer must include the
latest Designer configuration and its own credential. Preserve the server's newer state on
subsequent code updates. The full Trading company remains PARTIAL, not complete.

For continued implementation: finish Learner's explicitly selected app-tool connection
through the authenticated setup operation, not inherited Main credentials or startup
provisioning. Read effective profiles/grants back. Do not recreate either Card or rewire them.
`portfolio_policy.py` is now connected to the existing Trading read model and saved Card
validation; finish the loaded UI save/readback before claiming full portfolio acceptance.
Keep Team out of
this trading mission and obsolete Bull/Bear participation out of the blue roster. Then complete
the requested portfolio/numerical/UI pieces before the full natural local trial. The goal
created in this chat is ACTIVE; do not mark it complete from this checkpoint. Save only
reviewed source and this note; never stage live databases, credentials, uploads or outputs.
Tracked Engraphis SQLite/SHM/WAL files are currently modified by runtime activity; preserve
them locally and exclude them from the user's source checkpoint.
