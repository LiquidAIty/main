# Turn report — recovery acceptance and repair in progress

Date: 2026-10-13 (America/New_York)
Primary: Codex /root
Repository: C:/Projects/LiquidAIty/main
Status: PARTIAL — Main ordinary chat passed live after two narrow repairs; Main-to-KnowGraph delivery and valid Entity-attached Know intake remain under investigation.

## Active owner decisions

- Preserve the recovered Main chat and native Hermes Card CLIs; no AgentTerminalManager or another runtime.
- Main is the sole headless Card. Every non-Main Card has its own native CLI; Builder stays bound to builder, mounted, initially collapsed.
- Explicit @Card addresses that Card directly; Main must not execute or reply for the addressed turn. The owner corrected the earlier acceptance item requiring Main first.
- Main normally delegates research to KnowGraph through native Hermes Bot Mode.
- A Know belongs to exactly one Entity. Preserve the customized Graphiti add_memory_to_entity / ABOUT attachment; MENTIONS is independent.
- Preserve saved prompts, grants, profiles, sessions, Cards, Projects, conversations, graph data, Runs, images, and native voice. Do not activate the microphone.
- No Git mutations, data deletion, broad restoration, runtime rewrite, UI design, or renaming. The two topology contracts remain unchanged.
- The owner explicitly authorized running the real SpaceX/Rocket Lab/other space stocks buy-and-hold question and subsequently authorized fixing demonstrated failures and reconciling first-party documentation for an Astra coding workflow.
- Do not create mocks. Existing tests remain only deterministic evidence.
- Use native Codebase Memory MCP. The owner's explicit MCP instruction supersedes the older CLI-only repository guidance.

## Actual changes in this pass

1. apps/python-models/app/python_models/card_run_preparation.py:504:
   replace undefined effective_payload with the existing payload passed to _begin_accepted_run.
2. apps/backend/src/routes/mainSession.routes.ts::finishRun:
   forward providerTurnRef from the actual Hermes message.complete payload.submission_id.
   No fabricated ID, no weakened settlement validation.
3. ARCHITECTURE.md:
   replace the false statement that no chat/terminal/profile-session adapter exists with the restored source owners and corrected @Card semantics.
4. DONT.md:
   correct the obsolete Main/Builder CLI rule to Main headless and all non-Main native CLIs.
5. turn.md:
   current factual handoff. This is not an architecture authority.

No saved prompt, grant, Card revision, graph record, or session was manually changed. No new test or mock was added. Two coordinated reloads used the existing npm run dev:fresh launcher.

## Live Main acceptance

All messages were submitted through the real authenticated composer in the existing project:
cc1deb71-d059-46b8-975d-e2473dacf132, deck_builder, conversation main.

1. req_0983a848a5564d66:
   failed during preparation with configured_card_preparation_failed:
   name 'effective_payload' is not defined.
   No Hermes invocation. The exact submitted user message survived refresh once:
   msg_4829d10b-d479-49de-815e-c0d14ca8325b, seq 203.
2. req_0cb01a7871c945b5:
   after the Python fix, real Main/Hermes executed and delegated to KnowGraph.
   Completion settlement failed with run_provider_transport_evidence_incomplete because the TS adapter omitted the native submission ID.
   Native KnowGraph continued its asynchronous work.
3. req_514d271301614dc5:
   after forwarding actual completion evidence, state completed.
   Saved Card card_main_chat, profile main, model gpt-5.6-sol.
   Native session 20261012_055532_ee1ed6.
   Hermes submission req_514d271301614dc5.
   Accepted 03:41:40.785; finished 03:42:57.653466 EDT.
   Provider receipt: 590 input tokens, 606 output tokens, 0 tool calls.
   User message msg_59b4abe6-1ec8-43ac-b716-b4174b0dd4ec.
   Assistant message msg_2fc520d5-5bd7-41c9-8bde-902eb560bbe9.
   History reply exactly matches Run result: 3346 characters.
   After browser refresh: exact user question once, full answer unchanged, no alert.
   startedAt is still null: Run-start observation remains a separate unresolved defect.

A completed ordinary Main answer is not proof of successful KnowGraph research delivery or Entity-attached Know writing.

## KnowGraph findings

The owner reported visible graph labels but an empty Rocket Lab KnowGraph inspector.

Native Graphiti episode:
- c044a8fc-7fde-48fa-98b0-a2e412bc8545
- Rocket Lab operating progress versus cash-conversion risk
- created 2026-10-13T07:37:17.923503Z
- source text; content is prose with FOR/AGAINST and citation URLs
- existing know_from_properties validator returns false
- six outgoing MENTIONS; zero ABOUT
- Rocket Lab entity: 300e4986-8ef9-4103-8ebc-6e1ccdd6a12c
- other extracted entities: Launch Services, Space Systems, a Form 10-Q title, two citation URLs

This is a real native episode/extraction, but it is not a valid Entity-attached know.v1. Nothing was converted, relabeled, or deleted.

The customization DOES exist:
- GraphitiLatest/mcp_server/src/graphiti_mcp_server.py:541 add_memory_to_entity
- GraphitiLatest/mcp_server/src/services/queue_service.py forwards entity_uuid and entity_name
- GraphitiLatest/graphiti_core/graphiti.py resolves the exact Entity and creates one ABOUT
- apps/python-models/app/mcp_provider_operations.py projects idea/counterIdea and encodes know.v1
- live /api/idd/tools query advertised graphiti.add_memory_to_entity available with entity_name, idea, and counterIdea required
- the saved KnowGraph Card revision b8f364ed-9b52-47af-bb88-0fc3a67b1d92 explicitly requires that exact operation; its saved grant includes it
- current profile SOUL.md matches that instruction; changing the prompt is not the demonstrated fix

Native Hermes read-only session evidence:
- SessionDB(read_only=True), exact knowgraph profile state.db
- canonical Bot Chat session 20260921_093756_5d6349
- latest native records 773–786 contain actual searches, official source opens, generic graphiti.add_memory call, queued receipt, and a detailed cited comparison
- record 779 invokes mcp.codex_apps.liquidaity.graphiti.add_memory with plain text
- record 786 is the completed cited research answer
- therefore research DID occur; it was stored through the wrong tool and stranded from the visible application chat
- native Main log shows process-completion intake at 03:38:29 and completion at 03:38:55

The visible Main event wiring is incomplete:
- backend session event emits hermesSessionId; hook reads event.sessionId
- client event subscription sends nativeSessionId; backend expects hermesSessionId
- hook explicitly discards out-of-request message.complete events
- no application persistence path for the native background reply was found in the restored route
These are source findings, not yet repaired. Do not invent a second runtime or history owner.

Further recipient-authority investigation:
- per-request direct Card path sends exact Dynamic Tools from Python materialization
- native message_agent dispatches to the recipient's canonical Bot Chat without that per-request Dynamic Tool packet
- native recipient used account-level Codex app connector tools
- current saved profile tools are correct; recipient grant/schema delivery is the unresolved seam
- profile card-tools directory contains only __pycache__; do not restore abandoned bytecode/plugin code blindly

Exact custom-tool history confirmed after the owner's clarification:
- commit 01c12d84e introduced the new Graphiti add_memory_to_entity tool and the application title "Add Know to Entity".
- the commit adds the Entity-specific sibling of add_memory, the exact Entity arguments, native ABOUT creation, and the application idea/counterIdea schema projection together.
- the custom tool has not been deleted from current source and the loaded application advertises it as available.
- the native KnowGraph Bot Chat's persisted system prompt also explicitly requires add_memory_to_entity.
- its native persisted tool snapshot contains only web_extract and web_search; both root and knowgraph native config files have no mcp_servers entries.
- the actual research turn therefore used the separately connected account-level Codex app connector's generic graphiti.add_memory, which is not the saved Card's chosen custom write operation.
- this is an uncompleted receiving-Card tool-binding integration, not evidence that stock add_memory can satisfy the custom Know contract.
- do not create a second custom tool, convert the plain-text episode into a Know by inference, or distribute the episode to its mentioned entities.

## Verification so far

- Existing controlled preparation-failure route test: 1 pass, 2 unrelated cases excluded by testNamePattern.
  It proves store-call ordering and no Hermes call under its existing isolated harness; it is not a real database proof.
- Existing Python test_card_runs.py: 25 passed.
- Existing Main route and Card-session specs: 4 passed.
- Backend TypeScript check: pass.
- Real backend build through the normal launcher: pass.
- git diff --check: pass.
- No assertions, mocks, or saved prompts changed.
- client/src/pages/agentbuilder.topology.spec.ts remains equal to HEAD. Its two previously reported failures remain unresolved.

## Original bounded acceptance accounting

1. Composer → auth → persistence → real Hermes → completion: PASS for final ordinary Main turn.
2. Refresh retains submitted user message: PASS live, including the first real preparation failure.
3. Controlled preparation failure: PASS existing deterministic test; the real NameError independently demonstrated durable message retention and honest failure before Hermes.
4. Repeating identical message identities: NOT TESTED end-to-end.
   Schema PK(project_id,message_id) prevents duplicate rows, but appendSharedConversationTurn performs unconditional INSERT and would return a unique-key error instead of idempotent retry.
   The client generates new identities each invocation, so repeating text is not the same-identity test.
5. @Card: corrected owner rule passes source inspection; no new live addressed-Card test yet.
6. Image/microphone: transport/event tests only; no live image submission or microphone activation.
7. 123-file summary: original comparison boundary unavailable; do not claim it was this repair.

At acceptance start:
- HEAD 3300e6142d254c76d5855d49025e8b5b2a65820d → working tree: 11 tracked content changes + 35 untracked files = 46 paths.
- styles.css had no content diff despite status.
- cleanup commit 8a8f550dc alone: 119 files, 179 insertions, 17613 deletions.
- 3300e6142 alone: one CBM artifact file.
- 01c12d84edf91a0c9e63c8638ef84b079c72ef28 → actual pre-fix filesystem including untracked: 133 changed paths (22 added, 53 deleted, 58 modified); 8 restored paths equal the baseline.
Those are distinct comparisons, not a claim that this follow-up changed 123 files.

## CBM discovery and limitations

Registered native mcp__codebase_memory_mcp__list_projects worked and returned the correct project/root.
Native search_graph, trace_path, get_code_snippet, and coverage worked.
Generation 2026-10-13T02:42:20Z; cited files reported metadata_changed, so final relationships were verified in source.
Graphiti vendor symbols were not returned; direct-source verification used.

Before reload, live application catalog exposed exactly nine cbm operations:
check_index_coverage, detect_changes, get_architecture, get_code_snippet,
get_graph_schema, query_graph, search_code, search_graph, trace_path.
cbm.list_projects is intentionally absent from that publication subset.
After normal service reload, app MCP reports cbm unavailable and /api/idd/tools?namespace=cbm returns zero.
Registered development MCP is a separate connection. No CBM restart, reindex, cache access, tool resurrection, or configuration repair was performed.
Installed executable resolves to C:/Users/jerem/AppData/Local/Programs/codebase-memory-mcp/codebase-memory-mcp.exe.

## Ordered remaining work

1. Complete the existing Main → native KnowGraph → Entity-specific Know → native reply → visible persisted Main path, using current saved authority.
2. Repair exact message-identity retry semantics and native start/event observation without another manager or store.
3. Diagnose application CBM startup/publication through its existing owner.
4. Reconcile first-party AGENTS/PLAN/ARCHITECTURE/DONT/relevant skills with source and current owner decisions; preserve upstream documentation and label historical material.
5. Add or wire ordinary static undefined-name/import checks using established tooling; current root npm checks do not exercise Python and no ruff/pyflakes module is installed in the rails venv.
6. Perform subsystem-scoped correctness and inverse dependency audits before deletions or mechanical file splits.
7. Keep UI design and the two topology contracts deferred. Do not declare the full repository clean.

## Change snapshot (product/doc files, report still in progress)

0bdc9ff91e466fa88495e641def156f57453ae6ea8195e2bf8b8ed3259866d09  apps/python-models/app/python_models/card_run_preparation.py
a439630b1e681a44cc75e3276a8b5672a80cfe73aeedc87b33919afabde4fe80  apps/backend/src/routes/mainSession.routes.ts
b3bb97334a11c860b0bb7c1e176e6e41e703e2ae2c6475fdfc12ead5e6661e34  ARCHITECTURE.md
1e415d6ba354c115c0b4648e8c5ebe2a37547cb17ddb582a42bf4019f0708946  DONT.md
