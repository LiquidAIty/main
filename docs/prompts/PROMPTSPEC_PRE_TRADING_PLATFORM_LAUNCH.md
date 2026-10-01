# PROMPTSPEC — FINISH PRE-TRADING PLATFORM LAUNCH HARDENING

Repository: `C:\Projects\LiquidAIty\main`

Primary evidence: `docs/reports/LIQUIDAITY_SYSTEM_STATE_REPORT.md`

## MISSION

Implement and prove the remaining work needed to make the existing LiquidAIty platform reliably usable, **up to—but not including—the final Trading-system work program**.

The product already has a functional UI. Projects, shared chat, saved Cards, Agent Canvas, native graph views, Google 3D WorldView, Inspectors and the evolving Trader surface are real. Preserve them. This is not permission to rebuild the platform, create another architecture, or spend another day producing an audit without repairs.

The required outcome is:

```text
reliable Main / direct Card chat
→ understandable saved team and native graph surfaces
→ working WorldView perception and bounded actions
→ real research / specialist execution
→ a clear handoff to the separate final Trading build
```

Do the work, not just describe it. Finish and verify one boundary before the next.

## REQUESTED DELTA

Close the current non-Trading runtime, interaction, perception, data-availability and acceptance gaps. Make the advertised research/platform workflows work through the real saved-Card product paths, with truthful loading, errors, provenance and completion.

## PRESERVATION SET

- Preserve the dirty tree and unrelated work. No Git mutation, reset, restore, stash, clean, stage, commit, branch or push without the owner's exact request.
- Preserve Projects, conversations, saved Cards, revisions, prompts, models, profiles, grants, Scripts, graph data, Run history and artifacts. No reset/reseed/duplicate demo identities.
- Preserve the repaired Main startup owner: automatic warming and ordinary Main chat share the canonical `main` conversation owner. Different conversations/Projects remain distinct.
- Preserve restored orange Main → Builder, KnowGraph, ThinkGraph and Magnetic relationships and blue worker membership. Visual repair never creates or removes authority.
- Preserve Google Photorealistic 3D as the configured primary Earth presentation, real satellite positions, selection/reselection, tracking, DENSE controls and focus-only labels.
- Do not retune satellite rendering, add spokes or automatic red orbit decorations, recolor Earth with CSS, or substitute a different basemap merely to make a test pass.
- Preserve the compact navigation, shared-chat layout, Inspector behavior and working Trader chart.
- Preserve Hermes ownership of skills, Learning Graph and execution. Jev does not become a skill router or another agent runtime.
- Preserve graph ownership: Engraphis/ThinkGraph, Graphiti/KnowGraph, native CBM/CodeGraph and AGE/AgentGraph.
- Preserve Python-owned canonical IDF materialization. Images and graph selections go through the existing rich-input path, not another envelope, transcript or input store.
- Leave Trader paper-only and execution unapproved. Do not start a trading strategy or submit an order.

## WORKING RULES

1. Read current `AGENTS.md`, `DONT.md`, `PLAN.md`, the relevant reusable procedures and the report. Verify current source and runtime; report snapshots are discovery seeds, not permanent truth.
2. Follow the installed codebase-memory skill and `skills/codebasedmemory.md`. Use the documented bounded official recovery if needed; then source fallback. No speculative reindexing, raw cache/SQLite manipulation or extra frontends.
3. Work solo. **Do not spawn assistant subagents or separate Codex chats.** Real saved product Cards and their native workers are test subjects, not permission for assistant delegation games.
4. Before each implementation phase, state its small Requested Delta, Preservation Set, affected owner and focused proof. Use the existing adapter/extension boundary first. Follow vendor-edit law when a controlled fork must change.
5. Run the smallest relevant tests. A repeated failure must lead to inspection of the exact receipt/owner and a bounded fix—not repeated prompts or restarts.
6. Use one meaningful cold-start baseline and subsequent warm-use checks. Restart only the affected owner when safe. A coordinated `npm run dev:fresh` is allowed when genuinely required to load coupled changes; do not repeatedly restart a functioning stack.
7. Keep loading, failure and unavailable-provider states distinct. WorldView and the external chart can take time to load. Wait for a meaningful readiness/error signal; a premature blank screenshot is not a diagnosed defect.
8. Use the visible real preview for acceptance. CLI/API checks may diagnose transport, but cannot replace saved-Card Runs, real tool execution or visual proof.
9. Do not override a saved Card's prompt/model/tools, enable Jev globally, widen grants, invent native IDs, or use manual model calls as stand-ins.
10. Ask only for genuinely new authority, required credentials, licensing/deployment decisions or consequential contract changes. Do routine in-scope engineering autonomously. Never print secrets.
11. A defect outside this packet is recorded, not opportunistically fixed. No new framework, runtime, queue, graph, scheduler, wrapper hierarchy, semantic TS router or persistent registry.

## BASELINE — VERIFY, DO NOT REBUILD

Start from the existing Trading Project `cc1deb71-d059-46b8-975d-e2473dacf132`, deck `deck_builder`. Read back its current identities and revision before acting.

The recorded baseline has eleven saved Cards. Main's orange roster is Builder, KnowGraph, ThinkGraph and Magnetic. Magnetic's blue workers are Trader, WorldView, Analyst, Quant and Team; WorldSignals is not currently a blue member. Do not silently change this topology to make a demonstration easier.

Current evidence includes:

- One post-fix Main turn completed with the saved `liquidaity-main` profile, Sol model and no fallback: about 24 seconds of recorded Run time, about 47 seconds including preparation.
- Main startup/terminal focused tests: 60 passed. Canvas tests: 34 passed.
- Composer/queued-image focused tests: 47 passed; native image-projection tests: 46 passed.
- Healthy Google Earth, current CelesTrak satellites, both graph canvases and selected native graph content are pictured in the report.
- The Redwire candle chart subsequently loaded; no chart repair was implemented in that pass.

These facts are the starting point—not a reason to rerun every test or claim everything is accepted.

## PHASE 1 — MAIN, SESSION REUSE AND RUNTIME RELIABILITY

### Implement / harden

- Trace any remaining delay through preparation, profile/session readiness, tool/catalog work, native App Server initialization, inference and delivery. Do not attribute it to Jev without an actual Jev receipt.
- Eliminate source-proven unnecessary startup/discovery/rebuild work on ordinary warm turns while retaining saved authority and required readback.
- Prevent duplicate automatic Main hosts and stale/retired-session reuse. Preserve deliberate separate conversation owners.
- Make connecting, queued, generating, interrupted, failed and completed states intelligible. Cancellation must reach the real active Run; late events must not complete another turn.
- Preserve shared history, direct `@Card` addressing and correct speaker/target attribution across reload and navigation.
- Verify existing HTTP/MCP/runtime credentials and grants through their existing owners. No replacement MCP host or transport.

### Acceptance

- One cold-start question and two ordinary warm continuity/direct-address checks, only after readiness. Record preparation separately from inference and delivery.
- Confirm one automatic Main host for the actual owner; launcher/interpreter child processes are not automatically duplicates.
- Stop the sequence on the first failure, inspect its exact receipt, fix the responsible boundary and only then run the relevant acceptance again.
- Use a declared latency target based on the cold/warm baseline; demonstrate whether it is met. No arbitrary larger timeout presented as a fix.

## PHASE 2 — SHARED CHAT PRESENTATION AND REAL IMAGE INPUT

### Implement / harden

- Preserve wrapped, growing input, hidden composer scrollbars, Enter/Shift+Enter, pasted text, `@Card` completion, voice and PDF ingestion.
- Render supported Markdown correctly instead of exposing raw `**` and `##`, using the existing presentation pipeline. Preserve exact stored answer text; no backend prose rewriting or semantic sanitizer.
- Preserve Pretext/Virtuoso sizing, scroll position and return-to-latest behavior for long, streamed, multiline and image-bearing messages.
- Reconcile per-image/count limits with the production aggregate HTTP limit. Validate the whole payload before clearing the draft. Do not blindly increase the global parser limit or add another upload/input store.
- Preserve queued submission snapshots: exact target Card, text and selected images. Add current viewport images without discarding uploads, substituting stale pixels or silently pretending capture succeeded.
- Complete any necessary endpoint-specific limit alignment through existing transport owners; seek approval if it materially expands resource/security exposure or changes a public contract.

### Acceptance

- Long pasted text stays usable at wide and narrow panel widths.
- Rich replies render without changing their stored bytes or breaking scroll behavior.
- A user-uploaded image reaches a real saved Card and produces visible-detail understanding, not just `[image attached]` or filename/metadata repetition.
- Invalid/oversized/over-count images fail clearly without losing the draft or widening grants.
- The obsolete 140-character restriction remains absent; do not rebuild a dual tweet/full-answer format.

## PHASE 3 — GRAPH CLICK, FOCUS, EXPAND, BACK AND CONTEXT

### Implement

```text
CLICK
→ inspect the selected native node, its Think/Know content and relationships
→ no automatic Jev relevance filter against an old question

FOCUS
→ deliberate bounded native-neighborhood Jev judgment
→ correct selected-node identity and fresh applicable context

EXPAND
→ reveal native relationships without an automatic rerank

BACK
→ restore the previous local view
```

- Remove the obsolete ordinary-click contextual filtering path when its replacement is implemented; do not leave both live.
- Do not interpret a failed/unpersisted latest chat as permission to silently reuse an unrelated older question for node inspection.
- Preserve native IDs, Think versus Know distinction, source URLs, dates, validity and exact context-selection provenance.
- Fix dependable KnowGraph expansion and CodeGraph/Builder read/hydration through their current owners. A single timeout is not an empty dataset.
- Make Use in chat create an exact bounded native selection which Python rereads into the receiving Card's IDF. Show actual consumption, not animation inferred from prose.
- Refine unreadable label collisions and Inspector overlap inside the existing visual system. No new ontology, graph writer or wholesale visual redesign.

### Acceptance

- Open a Think proposal/current observation and a KnowGraph entity/source in the actual UI.
- Ordinary click displays its native content without a Jev request. Focus performs its one bounded decision; Expand/Back preserve truthful local navigation.
- A selected native record is delivered to and used by Main with identifiable provenance.
- Cancellation/stale responses cannot overwrite a newer selection, Project or request.

## PHASE 4 — WORLDVIEW READINESS, IMAGE GROUNDING AND BOUNDED ACTIONS

### Implement / harden

- Preserve the accepted Google 3D/native satellite stack. The primary work is lifecycle, truthful loading and perception—not visual retuning.
- Show meaningful loading progress while imagery, tiles and feeds initialize. A missing optional provider must not make the otherwise functional globe appear permanently broken.
- Handle reopen, fast navigation, resizing, Inspector dock/move and Project changes without overlapping live mounts, stale cleanup, lost imagery or UI-induced layer displacement.
- Preserve independent selection and tracking, selecting a second satellite, real orbital time/positions, DENSE behavior and focus-only labels.
- Keep viewport capture bounded to the real exposed scene. Include current capture/camera/selection provenance; never supply an old report screenshot as the current viewport.
- Verify required provider configuration and commercial-use rights for the intended launch. Do not buy an upgrade, change credentials or claim licensing acceptance on the basis of a rendered image.

### Acceptance

1. Wait for the healthy Google/native scene and capture it. Verify selected map-stack/provider state, not attribution alone.
2. Place it over one distinctive real feature. Run the saved WorldView Card once and ask it to separate visible pixels from structured metadata. Pass requires details absent from coordinates/layer counts.
3. Inspect current native eligibility, then have the saved Card focus exactly five currently renderable real satellites and clear the focus. Correlate tool selection, action receipt, native result and visual before/after. Preserve the rest as context.
4. Check selection/reselection/tracking and a small reopen/resize/Inspector cycle set. No screenshot during unfinished loading is counted as a failure by itself.

Manual action calls may diagnose transport; they do not replace the saved-Card acceptance.

## PHASE 5 — JEV AND EFFECTIVE TOOL BOUNDARIES

- Keep Hermes autoskills/Learning Graph independent from Jev tool/model selection.
- Keep Jev inputs bounded to the actual task, deliberately selected evidence and authorized candidate schemas. Do not pass the entire conversation, graph, skill library or global tool registry unnecessarily.
- Prove Auto-tools with the Card's existing skills and exact saved grants. Fix a source-proven accidental coupling rather than create a second skill router.
- Preserve explicit unavailable/refusal results for unsupported material; never call them successful selection.
- Verify model routing only where the current saved configuration enables it. No global enablement, saved-model override or fallback to obtain a green test.
- Make existing user-facing routing/rating status truthful and understandable. Advanced visibility not required by the launch promise may remain explicitly deferred.

### Acceptance

One enabled saved-Card example correlates the actual Jev choice with the authorized tool execution and result. Negative tests prove ungranted tools/cross-owner calls are refused and saved state is preserved.

## PHASE 6 — BUILDER, SAVED CARDS AND NATIVE MULTI-WORKER PROOF

### Implement / prove

- Prove Main → Builder uses the same saved Builder and real lower coding/CLI surface. Run one bounded read-only repo inspection, not an unrequested code-writing mission.
- Verify current Card selection, Library/saved reuse, Prompt/Runtime/Skills/Tools/Script views and profile identity. Do not create duplicate identities or reset data just to fill a demo.
- Keep native learning/skills inspectable. Do not turn an unimplemented Memory panel into a new memory-provider architecture; expose its real supported state honestly.
- Make Magnetic's identity and worker membership readable in the existing Canvas.
- Run one bounded research-only mission through the saved Main/approved Magnetic handoff and Hermes' existing task/dependency runtime. Use the actual blue roster; do not add WorldSignals or another Card merely because the conceptual workflow mentions it.
- Show actual worker lineage, failures/results and root-owned final synthesis. No legacy executor, second scheduler, separate synthesis Run or assistant-created stand-in workers.

### Acceptance

- One real Builder result with correct Card/profile/tool provenance.
- One real Magnetic mission uses at least two authorized non-Trader research workers and completes native synthesis. Preserve the Trader member but do not invoke trading execution in this packet.
- Saved Card/profile/model/grant readback and conversation ownership remain correct across reload and existing Project navigation.

## PHASE 7 — EXISTING RESEARCH DATA AND ONE USEFUL JOURNEY

### Implement / prove

- Restore availability of the existing WorldSignals service and one useful granted read package where configured. Repair its existing lifecycle/configuration; do not replace it with a new service.
- Make missing-key/offline/stale states explicit. Optional AIS or another unavailable feed must not disable unrelated Google/satellite research.
- Read one actual dated company/source record through KnowGraph and preserve its provenance.
- Complete one falsifiable physical-world thesis using supported evidence, then obtain business/source evaluation from Analyst and a test design from Quant through actual authorized product paths.
- Preserve the distinction between direct user `@Card` addressing, Main's orange roster and Magnetic's blue roster. Do not fake autonomous peer handoffs that the saved topology does not authorize.
- The package must state claim, evidence, economic dependency, counterevidence, missing evidence, horizon and falsification condition. Unsupported facts/market exposures stay missing; a weakened thesis is a valid result.

### Boundary

Stop at a research package ready for the later Trader work program. Do not convert it into an invented trade assignment, fill in budgets/stops/quantities, record a trading decision or start a Trade Job.

OSIRIS, WorldMonitor, new market providers and broad new datasets are future work unless an existing advertised non-Trading launch workflow demonstrably requires one. Do not expand feeds across every category.

## PHASE 8 — PLATFORM UI, ACCESS AND LAUNCH CONSISTENCY

- Exercise the real Project selector, Card selection/reuse and workspace switching with existing data. Check that profile/session authority and native graph scope do not leak across Projects.
- Verify Inspector open/close, resize, detach/dock/move, tabs and navigation through the same existing component system.
- Keep the existing Trader chart functional, with honest loading/unavailable feedback. Do not alter broker/strategy execution as a chart fix.
- Finish critical shared-chat, Canvas and graph readability defects. Calm technology should not require an instruction manual, intrusive labels or a new controller design.
- Verify existing authentication, Project ownership, Card revision and tool-grant boundaries with focused positive/negative tests. Preserve refusals, cancellation and saved state; never weaken protection to pass.
- Verify clean startup and stop/recovery through canonical commands. No leaked extra runtimes, secrets in logs or invented process/health success.
- If the launch includes remote MCP/plugin use, prove the existing published/authenticated route separately from internal MCP. Missing public-tunnel authentication does not mean Main's internal transport failed. Request genuinely needed owner credentials; do not create a replacement host or expose a new public endpoint.
- Resolve provider/licensing/distribution decisions required for the advertised launch. This packet does not authorize purchasing, accepting terms, production deployment or public exposure.

## OUT OF SCOPE — MY TRADING SYSTEM COMES LAST

Do not implement or activate:

- Alpaca/broker account setup or order execution;
- Turtle/Basic Perfect, ATR sizing, stops, exits, pyramiding or additional bots;
- Kronos/forecast-to-trade consumption, indicators/regime/calendar strategy logic;
- Jev trading action selection;
- position/P&L/fill reconciliation, intervention/order lifecycle or paper iteration;
- live trading.

Read-only inspection may identify the exact handoff boundary. Do not use the incomplete Trading loop as an excuse to hold the entire functional research UI hostage or to claim trading is ready.

## RESOURCE AND TEST DISCIPLINE

- Preserve working features; do not repeatedly re-prove closed visual repairs.
- Plan the minimum real model turns per phase before sending them. Native child Runs in the one Magnetic mission must be counted and reported honestly.
- One failure → exact receipt/owner inspection → bounded source/configuration repair → focused regression → relevant product proof. Never run the same failing prompt over and over.
- Reuse successful evidence that is still applicable. Use fresh proof for the changed boundary, not a new whole-system audit after every hunk.
- No long screenshot expedition, report-writing rabbit hole, polling storm or optional-feed integration campaign.
- If an essential external decision/credential blocks one phase, complete independent in-scope work, state the exact dependency, and do not fabricate acceptance.

## ACCEPTANCE AND DELIVERABLES

Maintain one concise checklist in the task and update the existing report's acceptance/work-remaining sections. Each required item is:

```text
IMPLEMENTED + VERIFIED
EXTERNAL DEPENDENCY — exact missing authority/credential
EXPLICITLY DEFERRED — outside first launch, with reason
```

For verified work keep separate evidence for source/structure, focused tests, build, loaded readiness, actual saved-product execution and visible acceptance. Link real Run IDs, native references and meaningful current screenshots. No fabricated telemetry or success inferred from answer prose.

Update canonical PLAN/ARCHITECTURE and the vendor divergence register only where the authorized implementation changes current truth. Do not add incident diaries or another runtime authority.

Deliver:

1. The completed non-Trading launch-hardening changes and focused proof.
2. A short partner report update showing functional progress and remaining work in the correct categories.
3. One explicit handoff list for the **separate final Trading work program**, with its existing owners, dependencies and outstanding operational proofs—not a claim of completion.

## STOP CONDITION

Stop when the non-Trading advertised platform journey is usable and truthfully proven: Main/direct chat, saved team/Builder, native graph inspection/context, Google/satellite WorldView perception/actions, and bounded specialist/native worker research.

Do not start the Trading build. End with:

```text
PRE-TRADING PLATFORM
verified items:
remaining external dependencies:
explicitly deferred enhancements:

TRADING — NEXT, NOT STARTED BY THIS PACKET
handoff items:

EVIDENCE
focused tests/build:
real Runs:
screenshots:
```

Do not declare the whole platform launch-ready while a required advertised workflow is still unproven. Do not declare the UI nonfunctional because an optional feed or a premature screenshot was unavailable.
