# Next turn — Think allocation and native mentions

## Status and scope

Targeted allocation and persisted-mention repair implemented and exercised through the real Trading
preview. The owner said the result looked good. No claim of exhaustive extraction coverage or native
plugin completion. Work alone, CBM CLI only, PowerShell, preview-only UI interaction.

Latest decisions override the earlier visibility experiments:
- No new content-based visibility filter remains.
- Clickable mention targets must resolve to a real node on the current canvas; otherwise plain text.
- No ABOUT fanout, copied Thinks, new Entity registry, or database-only draft promotion system.
- A mere mention does not create an Entity or semantic relationship.
- Agent context depth, native Project-map plugin, and perceived startup delay are next-turn work.

## Demonstrated cause

Original Trading source pair:
- User: msg_9a737929-071d-4efd-9808-8ec39de2af16
- Assistant: msg_cb8ba53d-957c-4f28-b161-134305778480
- Think pair: pair_59004a0e26524a18ab1491c2057471cb7f9cc4aca88356eafb3323d44e1e9658
- Think admission: 15a0c1b41f2c4973947bec97966b3948
- Think session: local-9485b8fe16a810c30ba228a939c7d892bc93bf3389f24bb9eed6d33870628a3f

The retained native prompt.receipt final_response contained seven facts. It assigned ASTS/LUNR
reasoning to “Speculative space call options” before settlement. The writer faithfully persisted that
assignment. SQLite had seven nonempty Thinks, not blank bodies, and four Entity-only endpoints.
The source response contained distinct ASTS financing/deployment/dilution concerns and LUNR
mission/timing/concentration concerns. Shares/calls reasoning was retained under a general strategy.

Git 01c12d84e replaced a Think's multi-Entity metadata/incidence loop with one exact primary Entity
and remember_entities. It was not merely a display-label change. The native memory_entities store
still exists. Current primary reads require source_kind=structured_extractor and one exact owner.
Do not restore the former fanout.

## Actual production changes

1. apps/python-models/app/python_models/thinkgraph_completed_pair_extraction.py
   Clarifies Entity-specific allocation, distinct strategy reasoning, incidental mentions, canonical
   reference wording, and uncertainty. Removes the mandatory-relationship instruction; a grounded Think
   need not invent a relationship to qualify its Entity. No schema or model change.
2. apps/python-models/app/python_models/thinkgraph_completed_pair_settlement.py
   Removes the old new-Think relationship gate. Uses existing native engine._link_memory_entities in
   the current batch's transactional finalizer, after Entities exist. This records native text_mention
   and edge_support incidences, not another primary attachment or Entity-edge writer.
3. apps/python-models/app/python_models/engraphis.py
   Reads native outgoing mentions and incoming reference links separately from exact primary Thinks,
   retaining Project/workspace and canonical Entity IDs.
4. apps/python-models/app/python_models/thinkgraph_projection.py
   Projects those persisted references into evidence/inspector data. Shared map and stored Entities
   are not content-filtered.
5. client/src/components/builder/canonicalEntityLinks.ts
   Reuses existing text segmentation for persisted native mention IDs, with exact Project/directory
   checks and case-insensitive spelling for native references. Ordinary Main matching keeps its defaults.
6. client/src/components/knowledge/KnowledgeAuthorityGraphSurface.tsx
   Renders persisted body references and “Mentioned in” links; resolves only current canvas targets.
   Existing no-Think state is explicit. The temporary content filter and off-canvas lookup path are removed.
7. client/src/components/knowledge/KnowledgeGraphInspector.tsx
   Allows linked Think text and exposes existing longer detail under More.
8. PLAN.md / nextturn.md
   Narrow current-status and handoff updates.

Main/Bot Mode, handoff connection, Hermes/Engraphis vendor source, saved model/tools, activity-count
code, and KnowGraph writer were not edited. No new tests, mocks, fixtures, registry, or plugin.

## Authorized wipe and test 419

The owner then explicitly requested a wipe and repeat test. Used Engraphis delete_workspace for
Trading only. It removed workspace ws_01M63C25D56GBT62730BMN0QGZ and seven old Thinks.
Readback: zero old workspace, memories, Entities, edges, events, and memory_entities rows.
No backup was created; no Hermes transcript, saved Card, or other Project was deleted.
Current workspace: ws_01M63PBQNWDGFVEC9XTR65JJG4.

Sent through preview:
“What are some publicly traded space stocks I might consider for call options or buying and holding shares?”
- User: msg_5422d00e-bda2-43ba-94eb-0f3b90128aac
- Assistant: msg_7248dc7d-ab09-4be5-a48f-39881162c693
- Pair: pair_8dd3b37f6514560f0015063d250e01f67752fe40ff556d34d7c6db0faef089d1
- Think admission: 6891ac0613b046b1834c24124fd6aa99
- Think session: local-086b5f851d64c6ebdc40da3a330ce745efab4b9c98fbbd9760071a0f74f3ae7b

Result: nine distinct nonempty Thinks, nine Entities, twelve active Entity relationships.
ASTS, LUNR, Call options and Buy-and-hold shares each received their own reasoning.
Other owners: RKLB, PL, KRMN, MDA Space, RDW.

Sent one natural follow-up:
“How do ASTS and LUNR differ in the risks that matter for calls versus buying and holding shares?”
- User: msg_8840af84-21ed-4777-a532-b356e6d6a8a9
- Assistant: msg_30f803cd-c54c-4722-912f-204f5e7371b9
- Pair: pair_e6f3f25e479c17ce85d111650181d8440fd7657cee8addd3c7d064dbb046600c
- Think admission: f890eb823ee04704a2819a1696a04e90
- Think session: local-f018f4532601d56cd5b9e5bcadc2be456b1bbe8b73ac3d0749eb2bc425d7bfa9

Four new Thinks reused ASTS, LUNR, Buy-and-hold shares, and Call options.
Current readback: 13 memories, nine Entities, 14 active semantic edges; zero blank or duplicate
bodies; exactly one primary incidence per Think. Native incidence counts: 13 structured_extractor,
19 text_mention (including self mentions), 34 edge_support. References are not semantic edges.

Primary examples:
- ASTS Entity ent_01M63PEXT89FABP31QNGJ4ZDW0:
  mem_01M63PY2RQGC0NRJVH82N5JER2, financing/deployment/commercialization versus expiration risk.
- LUNR Entity ent_01M63PEXTBZXJERCN99E8MDK9X:
  mem_01M63PY2S4NKR7GGMXBAHHK4G5, mission/contract concentration versus event/volatility risk.
- Call options Entity ent_01M63PEXTHGB5DSH0AG4T0VMFZ:
  mem_01M63PY2SP0GYGJ1AXYPWMQE6Q, distinct instrument reasoning.
  Its native ASTS mention is edg_01M63PY2VXPC7S19NNTSX0DAH0.
  Clicked ASTS in this Think in preview: correct ASTS inspector opened, original Think still owned
  by Call options, and ASTS exposed it under Mentioned in rather than as an attached Think.

Saved Card and observed model unchanged:
card_thinkgraph, revision 19a0e5b1-a543-4c41-a4cb-7b12fd3b2ace (41),
saved gpt-5.6-luna / low; runtime openai-codex / gpt-5.6-luna.
No stronger-model comparison performed.

## Verification and limits

- Real automatic flow and SQLite readback: demonstrated for the two preview turns.
- Preview: separate ASTS/LUNR Thinks, canonical chat tags, actual persisted mention click and references.
- Final lower-case mention rendering and More control were visible. The final attempt to open More
  encountered a selector timeout after the UI state changed; do not claim that last interaction passed.
- Client typecheck passed on final source; Python compilation and git diff --check passed.
- Backend rebuild and full application restart loaded Python changes, without restarting Hermes.
  Current application supervisor: execution session 23642.
- Client production build passed (4m49s) with existing browser-externalization/large-bundle warnings.
  Later small text-rendering changes were typechecked and loaded by Vite, not followed by another build.
- CBM CLI found the relevant functions; final coverage reported metadata_changed on seven files.
  Direct source verified. One discovery call hit daemon acceptance timeout. No lifecycle/index repair.
- No general promise that every substantive Entity in arbitrary output will be retained: the first
  response also mentioned FLY and diversified defense names without resulting Thinks. No hidden nodes
  or manual graph inserts were used to manufacture a pass.
- KnowGraph linked-mention persistence was not changed or proven; do not claim all-authority parity.
- The source flash reset local React view state during Vite refresh, not another data wipe. Both
  completed pairs read back and the chat returned. Avoid more live UI editing during owner use.

## Activity and context follow-ups

No activity code was changed. A real “1” and glow were observed on ThinkGraph during the comparison.
Ordinary AgentCardNode Cards share runtime/count rendering; selection/inspection also uses the glow.
The current activity route counts working/streaming sessions, not a proven full recursive model tree.
The separate MagenticBusNode has no corresponding count/glow implementation. Do not claim every
Card/child model was exercised. The existing five-second refresh runs after each request completes,
and failures currently clear displayed counts. Startup/history/profile work precedes Main's stream.
The perceived extra 40 seconds was not measured by stage; leave tuning separate.

The recovered handoff still uses its committed connection and inline Entity directory. No native
Project-map plugin was added. Agent context depth and complete Entity/Relationship hook delivery remain
separate. Do not infer supplied relationships from the existence of stored edges.

## Other preserved pending work

Per-user SQLite migration, CLI lazy PTY, Focus/Expand, KnowGraph persistence, and future learning remain
deferred. No Git mutation occurred; the owner saves.

Earlier cleanup reported a disabled plugin junction and four pyc files that the command host refused
to delete. Not reattempted in this slice; inspect before any future plugin installation:
- HermesLatest/.hermes/profiles/thinkgraph/plugins/project-graph
- apps/python-models/plugins/project-graph/__pycache__/__init__.cpython-311.pyc
- apps/python-models/plugins/__pycache__/test_project_graph_registration.cpython-311-pytest-9.1.1.pyc
- apps/python-models/app/python_models/__pycache__/test_project_graph_hook.cpython-311-pytest-9.1.1.pyc
- apps/python-models/app/python_models/__pycache__/test_project_graph_hook.cpython-311-pytest-9.0.3.pyc

## Reviewed source snapshot

The live database/WAL changed through the explicitly authorized wipe and real app turns; those mutable
data files and this self-referential report are excluded from this production-source digest.

```text
2d6404fabe9b3ad4b38d39fee7266baa9cd332fe4d967af34204b74db81b2200  apps/python-models/app/python_models/engraphis.py
bfc056eafb6dcee403ffe03bf6941a15c6d026508a4afa136c2c16a9c34798da  apps/python-models/app/python_models/thinkgraph_completed_pair_extraction.py
0e077161c5fc72ea4c264b852e03ca918073fe695aa0fe486a3bdb1fd07242b6  apps/python-models/app/python_models/thinkgraph_completed_pair_settlement.py
f628ec391a17be21527f439abb4e2f2788169899a29cb987682c647603b747a3  apps/python-models/app/python_models/thinkgraph_projection.py
e79d7cb25a5b5e8a1e1a9786fe18de3e522e5f0eb19e1953603b34f804651efe  client/src/components/builder/canonicalEntityLinks.ts
472051c77de82542aeb770739c8e561476b02736cb677074a1c436e8e052ccf5  client/src/components/knowledge/KnowledgeAuthorityGraphSurface.tsx
d1d5b16b4809b62b60b037cd81656569161039fc867fccc2f12a0e070ff2b821  client/src/components/knowledge/KnowledgeGraphInspector.tsx
d492a18a3239732a25cd2426fa189c7ebf752dcafaa05f112f1a126ee0e2ed97  PLAN.md
```

SOURCE_SNAPSHOT_SHA256: 705c591e83090d4df1cca3e0d85c3c6dc58ca72600139b54bac89129b4b9ae12
