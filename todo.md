# Graph recovery: cold-test handoff

Updated November 3, 2026 (America/New_York). Requested by Jeremiah for a new coder.

## Objective and current truth

Prove useful, related Thinks, sourced Knows, and actual CodeGraph file relationships through the existing
application. Prioritize the right context, continuity and compounding over loading more information.
Near-real-time interaction matters. Do not recreate a graph engine, agent runtime, ranking filter or fallback.

**This is an incomplete checkpoint, not a claim that the three graphs work end-to-end.** The rejected
Project graph data has been cleared. A new real conversation/graph-creation test has NOT run after that clear.

Workspace: `C:\Projects\LiquidAIty\main`

Project: `cc1deb71-d059-46b8-975d-e2473dacf132`

Preview: `http://127.0.0.1:5173/agentbuilder?projectId=cc1deb71-d059-46b8-975d-e2473dacf132&workspace=knowledge`

## Required boundaries

- Read the current `AGENTS.md`, `DONT.md`, `PLAN.md`, and installed `promptspec-receiver` and
  `understand-project-design` skills. Current source and the latest owner decision outrank old plans.
- Work alone. Use CBM through the installed CLI only for repository discovery. No CBM database/cache access,
  reindex, restart, second frontend, or provider/grant workaround.
- Main/session, Hermes Gateway, saved profiles, prompts, models, grants and Builder runtime are protected.
  The current graph work did not modify those paths. Ask before a necessary change to those protected owners.
- Do not restore old graph test data, replay old conversations, insert sample nodes, invent relationships,
  invoke a graph Card directly, or submit implementation instructions as test conversation.
- No screenshots requested. If browser automation cannot bind/read the tab, stop repeated recovery attempts;
  explain the blocker and leave the actual acceptance step pending.
- The owner performs Git saves. Do not stage, commit, push, restore, reset, clean, or change branches yourself.
- The only normal launcher is `npm run dev:fresh`. Do not start replacement component services.

## Completed source changes to preserve

- Think: sea-blue `#4FA2AD`; Know: orange `#F2A64A`; mixed Think/Know: recovered Engraphis iridescent
  Cyberpunk geometry with the owner's blue/orange substitutions. Observed heat: light purple `#B8A6FF`.
- Code: shipped Engraphis Cyberpunk palette, with violet `#8D61FF` identity/association rim. Code Files
  remain separate from shared Think/Know Entities; no third Code tab and no visible category hub/spokes.
- Node size uses distinct incoming connected nodes, not word counts, repeated calls, or agent activity.
  Think/Know edge springs/distance/width use existing persisted Jev values; Code uses actual Calls/Imports.
- Existing category-centre/community attraction remains inside the renderer. Knowledge/mixed views use
  Compact with the Jev `galaxy` transfer curve, NOT the separate whole-canvas orbital integrator.
  Code-only uses Communities. Ordinary tuning controls are hidden; source/category controls and inspectors remain.
- Manual Focus/Expand, its black-hole view replacement and its dedicated routes are removed. Normal selection,
  provider evidence tabs, source links, pan/zoom and Code inspection are retained.
- Automatic pre-inference Jev graph relevance ranking and its default Relevant/Recent packet are removed.
  Deleted `project_graph_relevance.py` and its dedicated tests; removed the caller from
  `card_invocation_preparation.py`. Explicit graph selections/readers remain. Optional saved AutoTools/AutoModel
  are different settings and were not changed.
- CodeGraph no longer loops through selected files in the browser or through their symbols in Python.
  Its existing `mode: 'file'` read now takes `filePaths: string[]`. Two CBM `query_graph` set queries return
  incoming/outgoing file-level Calls/Imports. Only provider result-page transport repeats when paginated.
  The old snippet/trace traversal helpers are deleted, not retained as a fallback.
- Enabling Code does not automatically select all categories. Select the needed categories in the existing
  inspector; All is explicit. Ordinary hide/show preserves selection; Reset sources deliberately clears it.

Relevant owners:

- `client/src/components/knowledge/KnowledgeAuthorityGraphSurface.tsx`
- `client/src/components/knowledge/KnowledgeGraphFramework.tsx`
- `client/src/components/knowledge/codeGraphProjection.ts`
- `client/src/components/knowledge/jevGraphPhysics.ts`
- `client/src/vendor/engraphis/engraphis-graph.js`
- `client/src/features/agentbuilder/state/useAgentBuilderKnowledgeGraphs.ts`
- `apps/backend/src/routes/codeGraphRead.routes.ts`
- `apps/backend/src/services/pythonRailsClient.ts`
- `apps/python-models/app/python_models/codegraph_reference_reads.py`
- `apps/python-models/app/python_models/card_invocation_preparation.py`

## Rejected data removed and independently read back

The owner rejected the displayed disconnected/malformed data and authorized clearing it before a cold test.
Only this Project's exact inspected graph records were removed:

- Engraphis: 3 entities (Kronos, Trading, Market Data), 3 malformed memories and their incidence/FTS/vector rows.
  The graph had no relationships and no valid attached typed Thinks before cleanup.
- Graphiti/Neo4j: 3 entities (Kronos, OHLCVA, AAAI), 1 Know/episode and 3 relationships. One was the incorrect
  Kronos-to-itself DESCRIBES relationship. No records from another Project were targeted.
- Main's 16 `conversation_message` events were preserved byte-for-byte; the workspace and session rows remain.
  Their event-row SHA-256 was `91dc13eed0bf5b1d0ab6f34096ce08c392ddcdcad465c0817a3f48f8af94293b`.
- SQLite integrity and foreign-key checks passed.
- Fresh loaded `/thinkgraph/projection` and `/knowgraph/projection` reads both returned 0 nodes / 0 relationships.
  The combined entity directory also returned 0 / 0 / 0. Engraphis generation advanced to 113.

Ignored, local-only recovery files:

`C:\Projects\LiquidAIty\main\.tmp\rejected-graph-cleanup-20261103\engraphis-before.sqlite`

`C:\Projects\LiquidAIty\main\.tmp\rejected-graph-cleanup-20261103\neo4j-before.sqlite`

The second file contains exact node/relationship properties and typed temporal values in snapshot JSON rows.
The exact-ID maintenance script is `.tmp/graph-cleanup-20261103.py`; it is NOT application code, not a runtime,
and must not be committed or rerun. It refuses to overwrite the recovery directory. Do not restore the rejected
records merely to make the graph appear populated. The older `db/engraphis.sqlite` was not the cleanup target.

## Remaining work, in order

### 1. Resolve the CodeGraph read grant without bypassing authority

The source-default Builder includes `cbm.query_graph`, but this Project's persisted Builder does not.
The real loaded Python rails read using two selected trading files returned:

`status: unavailable`, `codegraph_saved_tool_not_granted`, operation `cbm.query_graph`.

That 316.6 ms response was a permission refusal, NOT a successful graph-read benchmark. No saved grant or
profile was changed. The prior request to add only this read grant has not been approved; do not treat it
as permission. Ask for the exact saved-tool change, or for a different explicit authority decision.

Direct CLI queries did return CBM file-pair rows. The confirmed query shape is:

```cypher
MATCH (a) WHERE a.file_path IN ["apps/python-models/app/python_models/trading_forecast.py"]
OPTIONAL MATCH (a)-[r:CALLS|IMPORTS]->(b)
RETURN DISTINCT a.file_path AS selected, b.file_path AS neighbor, type(r) AS predicate
```

Use the inverse directed pattern for incoming connections. The installed engine does not accept a variable
inside the node property literal in the attempted UNWIND form. A broad OR/suffix edge scan timed out; do not
revive it. Do not claim microsecond end-to-end reads from CBM's internal-query reputation. Measure the real
product corridor, including authorization, transport, query and render separately where observable.

CBM returned some surprising cross-vendor paths in direct queries. Do not invent replacement edges or silently
call them source-verified. The cold acceptance should inspect important returned relationships against source.

### 2. Recover the automatic database-to-ThinkGraph path through its real owner

Main's current browser chat route submits directly to Hermes `prompt.submit`; it does not call the removed
Card relevance preparation. Main conversation storage writes raw Engraphis events. The storage-to-ThinkGraph
automatic handoff is still disconnected. A chat response therefore does NOT prove new Think creation.

The retained preparation/extraction/settlement owners exist:

- `apps/python-models/app/python_models/thinkgraph_completed_pair_preparation.py`
- `apps/python-models/app/python_models/thinkgraph_completed_pair_extraction.py`
- `apps/python-models/app/python_models/thinkgraph_completed_pair_settlement.py`
- `apps/python-models/app/python_models/thinkgraph_relationship_classification.py`

`thinkgraph_automatic.py` is an untracked, disconnected historical recovery candidate, NOT an accepted running
processor. Do not stage it or connect it as a shortcut. Do not restore the deleted custom map plugin, generic
runner, new prompt queue, poller, callback wrapper, or old Main-session bridge. The owner specifically rejected
exposing Main's authenticated Gateway connection for a replacement processor. Recover the actual prior
working database/Engraphis-owned path from evidence, and ask if that requires crossing a protected boundary.

### 3. Run the cold acceptance through the existing UI

The browser inventory can list tab 26, but binding/reading it repeatedly timed out. One earlier reload waited
through a long host/control interruption; later reads were stopped after a bounded timeout. Do not spend
another hour repeating that operation. The application and Python rails/MCP health were responsive afterward.

Once the real delivery path and browser are usable:

1. Confirm both Project graphs are still empty; retain Main history, Cards, source styles and CBM.
2. Through ordinary Main chat, ask: "Tell me about publicly traded space stocks worldwide. I'm comparing
   shares over the next two years and can consider US, Canadian, European and Japanese listings. Which
   businesses look most interesting, and what would make their investment cases succeed or fail?"
3. Let Main answer normally; do not call ThinkGraph directly and do not run KnowGraph yet. Verify the exact
   newly stored conversation pair produces nonempty typed Thinks through the real owner, with correct Entity
   attachment and meaningful directed relationships. Inspect their text, not just node counts.
4. Follow naturally with a question about launch cadence versus margins/cash generation. Verify continuity
   and progression without repeated copies, unrelated entity creation or fabricated links.
5. Only then ask Main to check current sourced evidence. Verify actual KnowGraph research, provenance,
   exact persisted Know readback and correct relationships; reject a title-to-itself extraction like the old
   Kronos DESCRIBES self-loop.
6. For Code crossover, discuss Kronos the candle/OHLCVA predictor already in the repository, and Tauric Research
   TradingAgents as a proposed future integration. Select relevant Code categories, inspect actual caller/import
   edges and file annotations, and verify source selection/context behavior. TradingAgents is not already installed.
7. Check Think-only, Know-only, Code-only and mixed views, both authority tabs on a shared Entity, separate Code
   Files, colors, sizes, movement, arrows and preserved inspector navigation. No fake graph seeding.
8. Measure visible response and graph-availability timing. Record source, deterministic, loaded, real-agent,
   persistence and owner visual acceptance separately. Do not call this complete if any required tier is missing.

## Last verified checks

Before this data-only cleanup, the changed source passed:

- Python Card/ThinkGraph/CodeGraph focused tests: 99 passed.
- Graph/UI/hook/CodeGraph transport Vitest suite: 101 passed across 10 files.
- Client and backend production/spec TypeScript checks: passed.
- Backend build and normal application reload: passed; loaded Python rails and MCP health responded.
- `git diff --check`: passed (an existing CSS line-ending warning is not a test failure).

These do NOT establish fresh Think/Know creation, successful product CBM retrieval, or visual acceptance.
No new test files were added for the set-query change; existing tests were updated for the explicitly changed
contract. The removed relevance-only tests belonged to the removed feature.

Protected Main hashes, unchanged through this work:

- `apps/backend/src/routes/mainSession.routes.ts`: `0E9A91FA3518CC7531D06D56F5D6E58F7AFDC794575A2F873B380AD2A4628CA8`
- `client/src/features/agentbuilder/console/mainSessionClient.ts`: `50BC04BF33E64D8197C7E175CE1C1F51A43B71F43CFE70B0B6CFC5358451D0C3`
- `client/src/features/agentbuilder/console/useAgentBuilderMainChat.ts`: `1771A5E679C8749D9A9625417303CAE8D0FB9672D601143571E95984829C0B15`

The working tree was already extensively dirty. Do not discard unrelated changes or confuse this checkpoint
with a clean baseline. Main-related dirty files include earlier requested recovery; their presence does not
authorize fresh edits. Do not commit runtime databases, CBM artifacts, ignored backups, or the disconnected
untracked ThinkGraph candidate. The current branch is `main`, tracking `origin/main`.
