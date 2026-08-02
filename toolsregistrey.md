# LiquidAIty Tool Registry Audit

This is a human audit of the one canonical Python MCP registry. It is not an executable registry, manifest, router, or second catalog. Tool names, schemas, handlers, and authorization remain owned by `apps/python-models/app/mcp_host.py` and the native Engraphis, Graphiti, and CBM registries it loads.

Native inventory baseline: 70 unique tools: 12 LiquidAIty/control, 31 Engraphis, 14 CBM, and 13 Graphiti. Native inventory is retained so upstream vendor updates remain available; it is not an enabled-tool promise.

## Current enablement — collapse pass one

The public connector has one OAuth grant: `liquidaity.main`. During the current explicit God Mode test window, that one grant exposes all 70 tools. It is only a connector permission: it does not change saved-card tool assignments or vendor implementations.

Saved-card grants are intentionally smaller than the full public test catalog:

| Card | Enabled now | Explicitly off now |
|---|---|---|
| Main | The 19 Main tools above. | `engraphis.why`; CBM list/status/index/architecture/snippet; Graphiti episode-entity expansion. These have known scope, stale-index, or unbounded-context problems, or are not needed for the basic Main loop. |
| System Coder | `run_local_coder`, `cbm.list_projects`, `cbm.index_status`, `cbm.search_graph`, `cbm.search_code`, `cbm.trace_path`. | CBM indexing, change/schema/architecture introspection, snippet lookup, and raw query. They remain available for deliberate connector tests; none are needed for the first bounded coding loop. |
| Hermes | `graphiti.search_nodes`, `graphiti.search_memory_facts`, `graphiti.get_entity_edge`, `graphiti.get_episodes`, `graphiti.get_status`, `engraphis.recall_context`. | Graphiti writes/provenance expansion and delegation writes, plus `engraphis.why`. These are not part of the basic sourced-knowledge retrieval loop. |

Every native tool not named in the three card rows is **off for product cards now**. It remains available through the God Mode connector for deliberate testing. No vendor implementation is patched here.

### Recommended next-off candidates — do not disable yet

- Engraphis approximate code-index family: `engraphis.index_repo`, `engraphis.search_code`, `engraphis.code_path`, `engraphis.code_impact`, `engraphis.export_code_graph`. CBM is the CodeGraph authority and these have stale-result evidence.
- Engraphis lifecycle/maintenance surface: `engraphis.recall`, `engraphis.answer`, `engraphis.timeline`, `engraphis.recall_proactive`, `engraphis.pin`, `engraphis.promote`, `engraphis.link`, `engraphis.record_event`, `engraphis.start_session`, `engraphis.end_session`, `engraphis.ingest`, `engraphis.ingest_postgres_schema`, `engraphis.consolidate`, `engraphis.check_update`, and receipt/stat diagnostics. They are specialist or unproven, not first-loop needs.
- CBM maintenance/introspection: `cbm.index_repository`, `cbm.query_graph`, `cbm.get_code_snippet`, `cbm.get_graph_schema`, `cbm.get_architecture`, `cbm.detect_changes`, `cbm.manage_adr`, and `cbm.ingest_traces`. Keep only after a focused test proves a concrete Coder workflow needs each one.
- Graphiti writes and expensive transformations: `graphiti.add_memory`, `graphiti.delete_entity_edge`, `graphiti.delete_episode`, `graphiti.summarize_saga`, `graphiti.build_communities`, `graphiti.add_triplet`, `graphiti.get_episode_entities`, and `graphiti.clear_graph`. They are not ordinary retrieval tools.

The inventory table below remains complete so each native tool name, intended behavior, evidence, and recommendation survive this collapse. Its placement column is historical audit evidence, not the live enablement authority above.

## Ratings and evidence

- **F** — fast, bounded context suitable for Main.
- **E** — embedding/provider-backed lookup; useful but not a free fast read.
- **J** — write, indexing, model, or background job for a specialist.
- **A** — destructive/difficult-to-recover administration.
- **Live** — safely executed against the current local product in this audit or the immediately preceding verified audit.
- **Focused** — handler/schema behavior proved by focused automated tests without a paid/destructive execution.
- **Contract** — registration, schema, dispatch identity, grant, dependency, and authorization checked; operation intentionally not executed.
- **Blocked** — current data/library defect prevents an honest success claim.

## Complete canonical inventory

| Tool | Intended behavior | Observed audit behavior | Rate | Historical audit recommendation |
|---|---|---|---|---|
| `main.context` | Return server-owned project, deck, conversation, parent-run, and Main-card identity. | Live; bounded identity read. | F | Main + Auditor; keep. |
| `agentgraph.inspect` | Read bounded AgentGraph assignments/results and stable references. | Live; relational/AGE read path is healthy. | F | Main + Auditor; key handoff/view tool. |
| `coder.status` | Report the actual OpenClaude Coder process/session state. | Contract/focused; does not infer running from old assignments. | F | Auditor; Main can use the visible Coder surface. |
| `run_coder_subagent` | Send one approved assignment to the saved connected System Coder. | Contract/focused; no paid run performed. | J | Main + Auditor; keep only as explicit execution. |
| `mag_one.describe_connected_agents` | Describe saved bus-connected workers, models, tools, and readiness. | Live after correcting OpenAI Coder's saved `tools:null` to `[]`; returns four ready workers. | F | Main + Auditor; keep. |
| `run_mag_one` | Execute one approved AgentGraph instruction through native Magentic-One. | Contract/focused; no paid run performed. | J | Main + Auditor; explicit execution only. |
| `write_mag_one_instructions` | Let Hermes persist a proposed exact AgentGraph instruction for Main review. | Contract/focused; no model run. | J | Hermes + Auditor; not Main. |
| `canvas.inspect` | Read a bounded saved-card and wire projection. | Live; eight cards/eight wires. | F | Main + Auditor; keep. |
| `card.update_configuration` | Strictly update allowed saved card fields through canonical persistence. | Live; used only for the authorized tool-list corrections. | J | Auditor; user-directed maintenance only. |
| `canvas.upsert_wire` | Persist one supported `flow` or `magentic_option` edge without running agents. | Contract/focused; not executed. | J | Auditor; UI should normally own this. |
| `web_search` | Run real Tavily research and return sourced results. | Contract only; paid call intentionally not run. | J | Research/Hermes + Auditor; not Main. |
| `card.run_assistant_agent` | Run one saved assistant card with exactly its saved model/prompt/tools. | Contract/focused; no paid run. | J | Main for explicit delegation, Hermes, Auditor. |
| `engraphis.remember` | Store a durable reasoning memory. | Contract/focused; current store is healthy enough to write, but not mutated for audit. | J | Main + Auditor; keep for accepted reasoning. |
| `engraphis.recall` | Hybrid full memory recall. | Contract; local embeddings can make cold calls slower and output larger than `recall_context`. | E | Auditor; redundant for ordinary Main. |
| `engraphis.recall_context` | Return a hard-budget context plus compact source identities. | Contract/focused. | E | Main, Hermes, Auditor; preferred transport read. |
| `engraphis.recall_grounded` | Answer only from stored memories with citations or abstain. | Contract/focused. | E | Main + Auditor; useful grounded read. |
| `engraphis.answer` | Backward-compatible alias for `recall_grounded`. | Contract; explicitly documented alias. | E | Auditor only now; removal candidate after external configs are checked. |
| `engraphis.why` | Return current reasoning and superseded decisions. | Contract/focused. | F | Main, Hermes, Auditor; keep. |
| `engraphis.timeline` | Return bi-temporal versions of a fact. | Contract. | F | Auditor; specialist historical inspection. |
| `engraphis.recall_proactive` | Query-free proactive recall and last-session context. | Contract. | F | Auditor; overlaps `proactive_context`. |
| `engraphis.proactive_context` | Build a bounded agent-ready context before a task is fully specified. | Contract/focused. | E | Main + Auditor; preferred proactive read. |
| `engraphis.forget` | Bi-temporally retire a memory while preserving history. | Authorization checked; not executed. | A | Admin only; details below. |
| `engraphis.pin` | Protect/unprotect a durable memory from decay/pruning. | Contract; not executed. | J | Auditor; explicit maintenance. |
| `engraphis.correct` | Supersede a memory without losing history. | Contract/focused. | J | Main + Auditor; preferred correction path. |
| `engraphis.promote` | Widen memory visibility while retaining provenance/history. | Contract; not executed. | J | Auditor; uncommon maintenance. |
| `engraphis.link` | Explicitly relate two Engraphis memory identities. | Contract; not executed. | J | Auditor; useful only when automatic relationships are insufficient. |
| `engraphis.record_event` | Append a lightweight episodic event for possible later consolidation. | Contract; not executed. | J | Auditor; likely unnecessary for Main. |
| `engraphis.index_repo` | Build Engraphis's best-effort code-symbol graph. | Blocked as code authority: stale deleted symbols and misses were reproduced. | J | Approximate Auditor-only; removal candidate because CBM owns CodeGraph. |
| `engraphis.search_code` | Search Engraphis's approximate code index. | Blocked as current-source truth; returned a deleted symbol. | F | Approximate Auditor-only; do not use for implementation evidence. |
| `engraphis.code_path` | Find best-effort name-based code paths. | Blocked as current-source truth; constructed a path through a deleted symbol. | F | Approximate Auditor-only; removal candidate. |
| `engraphis.code_impact` | Estimate symbol/memory/community impact. | Prior safe test produced excessive cones/noise. | F | Approximate Auditor-only; removal candidate. |
| `engraphis.export_code_graph` | Export Engraphis code graph JSON/Markdown. | Prior safe test was truncated and inherited stale data. | F | Approximate Auditor-only; removal candidate. |
| `engraphis.start_session` | Open an Engraphis work session and resume prior handoff context. | Contract; not executed. | J | Auditor; lifecycle automation candidate, not Main choice. |
| `engraphis.end_session` | Close a session with an idempotent summary/handoff. | Contract; not executed. | J | Auditor; lifecycle automation candidate. |
| `engraphis.receipts` | List content-free hash-chained operation receipts. | Live/safe in preceding audit. | F | Auditor diagnostic. |
| `engraphis.context_savings` | Report context savings and receipt validity. | Live; exposed eight invalid historical payloads. | F | Auditor diagnostic. |
| `engraphis.verify_receipts` | Verify receipt hashes, predecessor links, and anchor. | Live; anchored chain, eight historical `payload_schema_invalid` entries. | F | Auditor diagnostic; current fixture proof required before cleanup. |
| `engraphis.export_receipts` | Export public receipt payload and verification. | Live/safe; invalid historical records remain preserved. | F | Auditor diagnostic; potentially large. |
| `engraphis.stats` | Return memory/workspace/session/schema counts. | Live: 198 memories, 209 rows, eight workspaces, schema 7. | F | Auditor; health summary candidate. |
| `engraphis.check_update` | Check upstream release metadata. | Contract; network-backed and cached. | J | Auditor; should not be a routine model choice. |
| `engraphis.ingest` | Extract durable memories from raw text. | Contract only; stateful extraction not run. | J | Hermes/background ingestion, not Main. |
| `engraphis.ingest_postgres_schema` | Snapshot PostgreSQL schema into Engraphis memory/entity graph. | Contract only; provider-backed and non-idempotent. | J | Auditor-specialist; likely remove unless a real workflow survives. |
| `engraphis.consolidate` | Consolidate episodes and archive fully decayed transient memories. | Authorization checked; not executed. | A | Admin only; details below. |
| `cbm.index_repository` | Refresh the native repository graph. | Live; one native refresh completed but upstream v0.9.0 retained deleted ghosts. Identical concurrent calls now coalesce. | J | Main test baseline, Coder, Auditor; normally Coder-owned. |
| `cbm.search_graph` | Search symbols/routes/entities using graph/BM25/semantic modes. | Live and fast; pagination metadata is explicit. | F | Main test baseline, Coder, Auditor; core CodeGraph read. |
| `cbm.query_graph` | Run bounded read-only Cypher against CBM's documented graph surface. | Live; useful for low-degree/orphan and exact relationship audits. | F | Coder + Auditor; not default Main. |
| `cbm.trace_path` | Trace calls, data flow, or cross-service paths. | Live; useful after symbol discovery. | F | Main test baseline, Coder, Auditor. |
| `cbm.get_code_snippet` | Retrieve a resolved qualified symbol body. | Live, but stale ghost metadata can point at wrong lines; current source remains final authority. | F | Main test baseline, Coder, Auditor. |
| `cbm.get_graph_schema` | Return CBM node and edge types. | Live: 3,395 nodes and 9,902 edges in current generation. | F | Coder + Auditor. |
| `cbm.get_architecture` | Return bounded architecture, dependency, hotspot, and cluster views. | Live. | F | Main test baseline, Coder, Auditor. |
| `cbm.search_code` | Text search enriched/ranked by current graph structure. | Live; good direct-source bridge after graph discovery. | F | Main test baseline, Coder, Auditor. |
| `cbm.list_projects` | List indexed projects and revisions. | Native live in about 2.7s; prior public 502 appears to be stale process/transport, pending restart proof. | F | Main test baseline, Coder, Auditor. |
| `cbm.delete_project` | Delete an indexed CBM project. | Authorization checked; not executed. | A | Admin only; details below. |
| `cbm.index_status` | Return project index status/revision/counts. | Live; currently says ready despite +12 node/+37 edge discrepancy, so readiness is not deletion proof. | F | Main test baseline, Coder, Auditor. |
| `cbm.detect_changes` | Compare code changes and graph impact. | Contract/focused. | F | Coder + Auditor. |
| `cbm.manage_adr` | Create/update CBM ADR records. | Contract only. | J | Off by default; repo law requires explicit ADR request. |
| `cbm.ingest_traces` | Add intentional runtime traces to CBM. | Contract only. | J | Off by default; no current ordinary workflow. |
| `graphiti.add_memory` | Add a sourced episode asynchronously; per-group processing is serialized. | Contract; write intentionally not run. | J | Hermes + Auditor; normal KnowGraph write path. |
| `graphiti.search_nodes` | Semantic entity search. | Safe shape verified; may call paid embeddings/reranker. | E | Main test baseline, Hermes, Auditor. |
| `graphiti.search_memory_facts` | Semantic fact/edge search. | Safe shape verified; may call paid embeddings/reranker. | E | Main test baseline, Hermes, Auditor. |
| `graphiti.delete_entity_edge` | Delete one fact edge by UUID. | Authorization checked; not executed. | A | Admin only; details below. |
| `graphiti.delete_episode` | Remove an episode and cascade data supported only by it. | Authorization checked; not executed. | A | Admin only; details below. |
| `graphiti.get_entity_edge` | Read one stable fact edge UUID. | Contract/safe-read verified. | F | Main, Hermes, Auditor; excellent reference transport. |
| `graphiti.get_episodes` | Read sourced episodes by group. | Live: native returned a 24,469-character body for one episode. Public projection now defaults to previews with explicit full-body opt-in and a hard response budget. | F | Main, Hermes, Auditor; provenance transport. |
| `graphiti.summarize_saga` | Generate/refresh a model-written saga summary. | Safety-blocked because it may call a model and persist. | J | Auditor explicit execution only. |
| `graphiti.build_communities` | Build expensive graph communities and summaries. | Contract only; not run. | J | Auditor explicit job; not routine Hermes/Main. |
| `graphiti.add_triplet` | Write a direct entity-fact-entity relation without episode extraction. | Contract only; bypasses normal provenance extraction. | J | Auditor only; removed from Hermes default. |
| `graphiti.get_episode_entities` | Return entities/facts produced by episode UUIDs. | Contract/safe-read verified. | F | Main, Hermes, Auditor; strongest provenance expansion tool. |
| `graphiti.clear_graph` | Clear one or more Graphiti groups. | Authorization checked; not executed. | A | Admin only; details below. |
| `graphiti.get_status` | Report Graphiti server/database health. | Live; Neo4j connected. | F | Hermes + Auditor; not needed by Main. |

## The six destructive tools

These are excluded from Main and every saved product card. They remain visible only because the user explicitly enabled temporary God Mode for connector testing; they are not a second connector, catalog, or profile.

1. `engraphis.forget` retires one memory bi-temporally. It preserves history but changes recall truth. Prefer `engraphis.correct` when replacement content exists. Require an exact memory ID, a stated reason, and a pre-read of the target.
2. `engraphis.consolidate` can archive decayed transient memories while producing a durable digest. It is broad maintenance, not ordinary reasoning. Require a bounded workspace, a before/after count, and explicit approval.
3. `cbm.delete_project` removes a local code index. It does not delete source, but destroys the navigational graph and may require a costly refresh. Require exact project/root confirmation; never use deletion merely to refresh.
4. `graphiti.delete_entity_edge` removes one knowledge fact. Require the edge UUID, a prior `get_entity_edge`, and provenance impact review.
5. `graphiti.delete_episode` cascades removal of facts/entities supported only by that episode. Require the episode UUID, prior episode/entity inspection, and explicit acceptance of the cascade.
6. `graphiti.clear_graph` clears a whole Graphiti group. This is the highest-risk tool. Require exact server-owned group identity, a bounded backup/export decision, and separate explicit approval. It should never appear on Main or Hermes.

## Best tools for agent-to-agent context transport

The transport unit should be concise text plus stable native references, never copied databases.

- Think/Engraphis: `recall_context` provides compact context plus memory IDs; `why` supplies decision lineage; `recall_grounded` supplies cited claims. These are suitable for a sender to select before an AgentGraph handoff.
- Know/Graphiti: `search_memory_facts` and `search_nodes` discover; `get_entity_edge`, bounded `get_episodes`, and `get_episode_entities` turn selected UUIDs into auditable provenance. Search may cost embeddings; UUID reads are faster.
- Code/CBM: `search_graph`/`search_code` discover; `trace_path` relates; `get_code_snippet` verifies qualified names. `query_graph` is the only raw graph-query doorway and must remain read-only, schema-first, scoped, and bounded.
- AgentGraph: `agentgraph.inspect` is the cross-agent lineage read. A handoff should contain the instruction, selected Engraphis memory IDs, Graphiti UUIDs, CBM qualified names, and any real-time signal identity. AgentGraph stores those references and results, not copies of native graph records.
- No agent-facing raw PostgreSQL, AGE SQL, Neo4j driver, SQLite, or CBM database doorway belongs in the tool surface.

## Literate selection pattern

Readable agent instructions can use these headings without creating a parser or DSL:

```text
QUERY: What current decision controls the graph projection?
SCOPE: project 20ac92da-01fd-4cf6-97cc-0672421e751a
INTENT: retrieve the decision, evidence, alternatives, and superseded decisions
TRAVERSE: Engraphis recall_context -> why
ASSERT: cite returned memory identities; do not infer source code
RETURN: compact text plus selected memory IDs
LIMIT: one context budget and one why traversal
```

Main translates the headings into existing native calls. The headings are prompt language, not saved queries, code, schemas, routers, or another graph layer.

## Evidence-based collapse path

The next plugin round preserves the canonical 70-tool Auditor view so GPT can audit everything while Main remains the enabled 19-tool basic surface. CBM depth stays in Coder and Graphiti depth stays in Hermes until a real test proves Main needs a specific extra tool. This is 27.1% of the native inventory without deleting vendor capabilities.

Immediate collapse candidates, pending external-use confirmation:

- remove the `engraphis.answer` alias after saved/external configs no longer reference it;
- remove the five stale Engraphis code-index tools if no distinct approximate audit workflow is desired;
- keep `cbm.manage_adr` and `cbm.ingest_traces` ungranted until a real task requires them;
- keep Graphiti saga/community/direct-triplet tools Auditor-only;
- keep all six destructive capabilities out of Main and saved cards; test them only through Auditor when explicitly requested.

Do not collapse `search` and `get` tools into generic intent routers. Discovery, stable-reference retrieval, and provenance expansion are distinct graph operations and should stay legible.
