# MVP tool exclusions

This document records the launch decision for capabilities that are deliberately
absent from the LiquidAIty Card catalog or from a system Card's default selection.
It exists so a later review does not turn every provider operation back on merely
because it exists.

These are product-surface decisions, not claims that the underlying provider
implementation is useless. A provider may retain an operation for its own engine,
CLI, tests, or explicit operator maintenance without making it a model-selectable
Card tool.

## Return-to-catalog rule

An excluded capability returns only when all of the following are true:

1. a named user or Card workflow cannot be completed by the retained capabilities;
2. one exact Card is identified as its normal owner;
3. its result is materially different from every retained tool;
4. its read, write, destructive, external, and idempotency effects are truthful;
5. its canonical definition, presentation, callback, authorization, dispatcher,
   and real result are proven end to end; and
6. adding it does not recreate functionality already supplied by Hermes or another
   provider.

"It might be useful someday" is not sufficient. A concrete workflow and proof are
required. Restoring one tool never authorizes restoring the rest of its provider's
catalog.

## Not in the MVP Card catalog

### Codebase Memory

| Tool | Why it is excluded from the MVP Card catalog | Underlying owner / future route |
| --- | --- | --- |
| `cbm.compare_graphs` | Compares two indexed snapshots. No launch Card workflow needs cross-snapshot comparison, and it is not part of Main's orientation or Builder's normal five-tool investigation path. | Codebase Memory retains the operation. Add it only for a named repository-migration or snapshot-comparison Card workflow. |
| `cbm.delete_project` | Deletes derived index state. It is administration, not agent work, and a mistaken model call could damage the development index. | The official Codebase Memory administrative boundary remains the owner. |
| `cbm.get_file_outline` | A legitimate file-first declaration view, but it is not needed by the MVP path and its current effects metadata incorrectly describes it as write/destructive. | Reconsider only after the provider metadata is corrected and a Card workflow needs file-first outlining. |
| `cbm.index_repository` | Index creation and refresh belong to the official Codebase Memory lifecycle, not model choice. | The official watcher/administrative operation remains responsible. |
| `cbm.index_status` | Infrastructure readiness is useful to operators but is not part of an agent's semantic task. | Existing health and development diagnostics remain the route. |
| `cbm.ingest_traces` | Its current contract says graph-edge creation is not implemented. Publishing it would advertise behavior it does not perform. | It may return only after the upstream capability exists and a real Card workflow requires it. |
| `cbm.list_projects` | Project discovery is Codebase Memory administration. LiquidAIty uses its configured canonical repository identity. | Keep in the development/operator boundary. |
| `cbm.manage_adr` | Mixes document reads and whole-document mutation while Builder already has Hermes file tools. It would create overlapping document authority. | Builder edits repository documents through Hermes file/terminal capabilities. |

Retained CBM catalog candidates include the normal search/trace/source/coverage
path plus `detect_changes`, `get_architecture`, and the paired
`get_graph_schema`/`query_graph` advanced path. Main receives only search and
trace; Builder receives its normal investigation subset, while the advanced
options remain visible but OFF.

### Engraphis

| Tool | Why it is excluded from the MVP Card catalog | Underlying owner / future route |
| --- | --- | --- |
| `engraphis_update_memory` | Changes metadata rather than performing normal Think recall, creation, or historical synthesis. | Engraphis retains metadata maintenance for a future explicit Builder maintenance workflow. |
| `engraphis_conflict_review` | Governance/quarantine review is maintenance, not the ThinkGraph Card's ordinary automatic-intake or Bot-synthesis work. | Retain in Engraphis for explicit operator governance. |
| `engraphis_session` | This is an Engraphis memory-session/handoff mechanism, not a Hermes conversation session. No launch workflow owns it, and exposing both concepts would be confusing. | Engraphis retains the capability until a named memory-session workflow exists. |

Retained Engraphis candidates are bounded recall, exact-memory read, remember,
and the Smart discovery/read/action gateway. ThinkGraph receives discovery plus both read and stateful execution so
it can inspect timelines/decision history and perform deliberate relationship or
correction work.

### Graphiti

| Tool | Why it is excluded from the MVP Card catalog | Underlying owner / future route |
| --- | --- | --- |
| `graphiti.add_triplet` | Directly inserts a relationship and bypasses sourced episode extraction. Routine model access risks unsupported graph spaghetti. | Graphiti retains the operation for explicit operator repair if ever required. KnowGraph writes sourced episodes with `add_memory`. |
| `graphiti.build_communities` | Full-group community building is expensive graph maintenance, not normal sourced research. | Graphiti remains the owner; add only for a concrete community-analysis product workflow. |
| `graphiti.clear_graph` | An empty or nearly empty model call can erase the authenticated Project graph. It must never be a normal Card tool. | Explicit operator/database maintenance only. |
| `graphiti.delete_entity_edge` | Destructive exact-edge repair is not required for research, recall, or sourced ingestion. | Explicit operator repair only, after exact owner intent. |
| `graphiti.delete_episode` | Cascading episode deletion can remove derived entities and facts. It is not part of ordinary KnowGraph work. | Explicit operator repair only, after exact owner intent. |
| `graphiti.get_status` | Service health is infrastructure state, not a research capability a model should choose. | Existing health/readiness surfaces remain responsible. |

The MVP uses Graphiti's focused search, provenance, exact-read, and sourced-ingest
operations that are required by Main and KnowGraph. Saga summarization remains
available but OFF on KnowGraph until its lifecycle is designed. Direct triplet
insertion, community building, exact deletions, service status, and whole-graph
clearing stay outside the Card catalog. A future combined cited-recall
operation is deliberately deferred; it is not a launch prerequisite and must live
with the Graphiti provider rather than an application-side semantic merger.

### LiquidAIty and Python rails

| Tool | Why it is excluded from the MVP Card catalog | Underlying owner / future route |
| --- | --- | --- |
| `web_search` | The redundant LiquidAIty Tavily adapter is deleted. KnowGraph receives Hermes's Web toolset and owns outside research, citation, and Graphiti persistence; a second search doorway would split that authority. | HermesLatest already supplies selectable Tavily and Firecrawl web providers. Configure the intended provider on KnowGraph's reusable profile instead of restoring an application tool. If that path fails, report the gap rather than adding a fallback. |
| Hermes internal `message_agent` capability (not a catalog ID) | Bot delivery is Hermes session behavior authorized by the saved orange roster, not a Card-catalog tool. | Hermes Bot Mode and saved Project topology. |

`current_datetime` and `calculator` remain ordinary Card-eligible utilities.
They are available to every Card in the editor and stay OFF unless that Card's
saved selection enables them. They are not forced lifecycle hooks and do not
execute automatically.

## Retained in the catalog but absent from particular MVP Cards

These tools remain valid choices for new or specialized Cards. They are omitted
from the named Card because another Card owns that job or because the capability
would broaden the Card beyond its launch role.

### Main

Main does not receive:

| Capability | Reason |
| --- | --- |
| Hermes Web | Every outside-research request goes to KnowGraph. |
| Hermes Files, Terminal, Browser, Vision, or Code Execution | Main is the fast conversation/orchestration front door, not the implementation worker. |
| Graphiti writes | KnowGraph owns sourced persistence. |
| Card create/update/wire tools | Builder owns agent construction and configuration. |
| Broad CBM tools | Main needs only enough structural awareness to identify the owner and direct Builder. |
| Direct ThinkGraph metadata maintenance | Normal User/Main pairs enter the approved completed-pair intake; explicit deeper memory work can be addressed to ThinkGraph. |

### Builder

Builder does not receive:

| Capability | Reason |
| --- | --- |
| `run_mag_one` | Builder authors and stages the PromptSpec; Main and the user approve execution. |
| Trading writes | Trader owns paper-trading state and decisions. |
| WorldView actions | WorldView owns the mounted spatial interface. |
| Routine ThinkGraph/KnowGraph writes | The graph Cards remain the normal writers. Explicit maintenance requires a separately selected, reviewed task. |

Builder does receive the broad user-level Hermes toolsets because building and
repairing agents and applications is its defined job. Hermes internal profile,
session, Bot transport, process, and Kanban control operations remain internal.

### ThinkGraph

ThinkGraph does not receive Hermes Web or development toolsets. Its jobs are the
automatic completed User/Main-pair intake and explicit historical reasoning,
recall, durable Think creation, and deliberate relationship/correction work.

### KnowGraph

KnowGraph does not receive Canvas editing, direct triplet insertion, graph
deletion, graph health, Magnetic staging, or general development toolsets. It
receives Hermes Web, grounded-citations, focused Graphiti reads, sourced episode
ingestion, provenance verification, and bounded graph-reference handoff.

### Magnetic

Magnetic receives no LiquidAIty product tools. Hermes owns its task/dependency
ledger, blue-roster dispatch, retries, worker attempts, and final synthesis.
`run_mag_one` belongs to Main.

### Team and specialist Cards

Team remains an explicitly reviewed wildcard selection for MVP. It may enable AutoTools to narrow
its broad saved grant, but it never receives the whole catalog automatically and Jev cannot widen its
saved ceiling. Trader, WorldSignals,
WorldView, Analyst, and Quant keep their existing domain grants until their real
workflows are separately exercised. Their preservation is not approval to add
their tools to unrelated Cards.

## Deferred, not rejected

The following ideas are intentionally outside MVP and do not justify widening the
launch catalog:

- agents may later submit ordinary capability requests to Main, Builder, and the
  user, but may not create, publish, activate, or grant themselves durable tools;
- a provider-owned combined cited KnowGraph recall may later replace several
  low-level reads after exact citation joins are proven;
- `graphiti.summarize_saga` remains available in the Card catalog but OFF on
  KnowGraph until saga naming, continuation, discovery, readback, and UI
  presentation have one approved tested design;
- one invocation count may later appear beside a tool switch using the existing
  latest completed Run data, but no metrics controller, scheduler, or new receipt
  system will be created for it; and
- additional Hermes skills may be made selectable after they have a named Card
  job and successful load/readback proof.
