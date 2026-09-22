# Tool Ownership Ledger

Audit date: 2026-09-22

Scope: Main, Builder, ThinkGraph, KnowGraph, Magnetic, and Team

Authority: current saved deck, current materialized Hermes profiles, current LiquidAIty source, current vendored Hermes source, and current official Hermes documentation

## Decision

LiquidAIty needs one user-facing Tools surface, not one implementation mechanism.

```text
Hermes execution mechanics                 -> Hermes native
LiquidAIty application operations          -> existing card-tools plugin bridge
Independent systems and data authorities   -> external MCP
Card-specific deterministic composition    -> future Card Python
Instructions and procedures                -> skills
Semantic judgment                           -> the visible Card model turn
```

The effective grant remains:

```text
capability available
intersection saved Card selection
intersection current Run authorization
= model-facing tool
```

No new tool registry, lifecycle owner, wrapper server, or plugin pilot is justified by this audit.

## Evidence and measurement method

- Saved-Card data came from the current `deck_builder` read API for project `1b1a6958-0658-4b1a-bf13-e2066582adb4`, deck revision `f0fa0895-42c7-4e1b-abab-6de60b50b444`.
- Effective direct tool definitions were generated through current vendored Hermes with Tool Search assembly disabled, then serialized as compact UTF-8 JSON. The token estimate is bytes divided by four; it is directional, not a provider billable-token measurement.
- External Graphiti schemas were measured from the currently installed native Graphiti catalog. Builder CBM schema bytes were deliberately not fetched without a real authorized Builder turn, because this audit must not create another CBM frontend or weaken the late-bound lifecycle.
- “Observed use” below means current saved prompt/runtime/source evidence. It does not claim a live model tool call unless explicitly stated.
- Current official references: [Plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins), [plugin developer guide](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins), [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp), [hooks](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks), [Tool Search](https://hermes-agent.nousresearch.com/docs/user-guide/features/tool-search), and [tools reference](https://hermes-agent.nousresearch.com/docs/reference/tools-reference).
- Current execution truth is the vendored Hermes 0.21.3 commit `73521a8e375a867fae14ec0579f2dfb47aa0017e`. Official 0.21.4 (`v2026.9.21`) contains relevant Gateway, Windows worker, MCP discovery, Bot delivery, Kanban, and Codex reliability work, but it is a high-risk separate rebase because LiquidAIty's saved-Card, exact-roster, Kanban-ceiling, and no-profile-OAuth divergences are not upstream. No Hermes update belongs in this audit.

## Current System-Card surfaces

| Card | Saved identity | Job | Saved LiquidAIty/application tools | Hermes-native surface | External MCP, only during an authorized turn | Skills | Observed use |
|---|---|---|---|---|---|---|---|
| Main | `card_main_chat` / `liquidaity-main` | Front door, framing, context selection, direct Card communication, approval, review, Magnetic invocation | `canvas.inspect`; `engraphis_recall_context`; `engraphis_get_memory`; `engraphis_remember`; `run_mag_one` | `memory`; native Bot messaging is topology-scoped runtime capability | None | None saved | Saved prompt uses ThinkGraph, selected context, connected Cards, and Magnetic; no CBM grant |
| Builder | `builder` / `builder` | Repository and product construction | `canvas.inspect`; `card.create`; `card.update_configuration` | `memory`; toolsets `web`, `terminal`, `file`, `browser`, `vision`, `code_execution` | `cbm.search_graph`; `cbm.trace_path`; `cbm.get_code_snippet`; `cbm.check_index_coverage`; `cbm.detect_changes`; `cbm.search_code`; `cbm.query_graph` | `agent-builder-inspection` | Saved prompt explicitly uses CBM, source inspection, editing, tests, and exact Card operations |
| ThinkGraph | `card_a52fd511ecb14f53` / `thinkgraph` | Persistent project reasoning, decisions, questions, assumptions, corrections, constraints | `engraphis_recall_context`; `engraphis_get_memory`; `engraphis_remember`; `engraphis_update_memory`; `engraphis_correct`; `engraphis_link`; `engraphis_ingest` | None saved | None | None saved | Saved prompt is a focused Engraphis read/reconcile/write specialist |
| KnowGraph | `card_knowgraph` / `knowgraph` | Sourced research, provenance, entities, relationships, evidence, contradictions | `canvas.inspect`; `engraphis_get_memory`; `write_mag_one_instructions`; `card.load_graph_references` | `memory`; toolset `web` | `graphiti.get_entity_edge`; `graphiti.get_episode_entities`; `graphiti.get_episodes`; `graphiti.get_status`; `graphiti.search_memory_facts`; `graphiti.search_nodes`; `graphiti.add_memory`; `graphiti.add_triplet` | `grounded-citations` | Saved prompt uses web only for needed verification and Graphiti for source-backed knowledge |
| Magnetic | `card_magentic` / `card_magentic` | Native task/dependency orchestration, exact blue roster, same-root synthesis | None saved | Runtime-owned Kanban/task/dependency surface; no ordinary Card tool grants | None | None saved | Saved prompt assigns only through the blue roster and uses no broad catalog |
| Team | `card_team` / `team` | General fallback for one bounded Magnetic assignment | `canvas.inspect`; `engraphis_recall_context`; `engraphis_get_memory` | `memory`; toolsets `web`, `terminal`, `file`, `browser`, `vision`, `code_execution` | `graphiti.search_nodes`; `graphiti.search_memory_facts`; `graphiti.get_episodes` | `grounded-citations` | Saved prompt is a wildcard fallback; current permanent surface is much broader than that job proves necessary |

## Model-facing schema weight

| Card | Idle direct tools | Idle schema bytes | Approx. tokens | Authorized-turn addition | Authorized-turn total | Finding |
|---|---:|---:|---:|---|---:|---|
| Main | 6 | 13,962 | 3,491 | None | 6 / 13,962 bytes | Narrow enough for the baseline; consider exposing `canvas.inspect` only for an actual Canvas task later |
| Builder | 20 | 32,730 | 8,183 | 7 exact CBM tools; live catalog bytes intentionally not fetched outside an authorized turn | 27 / more than 32,730 bytes | Broad by job, but browser-vault and other bundled browser schemas should be reviewed against real use |
| ThinkGraph | 7 | 15,103 | 3,776 | None | 7 / 15,103 bytes | Purpose-specific but description-heavy; observe use before hiding receipts behind a compound wrapper |
| KnowGraph | 7 | 8,434 | 2,109 | 8 exact Graphiti tools / 12,227 bytes | 15 / 20,661 bytes, about 5,165 tokens | A future high-level wrapper could reduce schemas, but only after exact per-tool authorization and provenance are proven |
| Magnetic | 0 saved ordinary tools | 0 | 0 | 14 runtime-owned Kanban tools / 23,634 bytes | 14 / 23,634 bytes, about 5,909 tokens | Correctly narrow in ownership; the runtime ledger is the job, not an extra Card catalog |
| Team | 20 | 32,259 | 8,065 | 3 exact Graphiti tools / about 3,793 bytes | 23 / about 36,052 bytes, about 9,013 tokens | The clearest bloat: broad construction tools plus graph research are permanently present for a fallback job |

These figures measure full model-facing definitions before Tool Search. Tool Search may progressively disclose a large already-authorized plugin/MCP catalog, but it cannot grant tools outside the current session ceiling and must not become another registry.

## Capability ledger

| Capability | Current owner | Current transport | Current Cards | Actual job | Data authority | Needs Hermes session context? | Needs independent service? | Needs external clients? | Schema/tool cost | Observed duplication | Recommended owner | Migration risk | Recommendation |
|---|---|---|---|---|---|---:|---:|---:|---|---|---|---|---|
| Conversation, session, streaming, profile memory | Hermes | Native Hermes runtime/toolset | Main, Builder, KnowGraph, Team | Durable Card conversation and bounded profile memory | Hermes profile/session | Yes | No | No | Native `memory` schema where granted | None worth replacing | Hermes | High | KEEP HERMES-NATIVE |
| File, terminal/process, code execution, vision | Hermes | Native Hermes toolsets | Builder, Team | Construct, inspect, test, and transform local work | Filesystem/process owners | Yes | No | No | Major part of the 20-tool Builder/Team idle surface | Team inherits Builder-like breadth without task evidence | Hermes, selected per Card or mission | Medium | KEEP HERMES-NATIVE |
| Web and browser | Hermes | Native Hermes toolsets | Builder, KnowGraph, Team | Research and interactive browsing | Remote sources/browser state | Yes | No | No | Included in Builder/KnowGraph/Team figures | Browser bundles vault/session tools that may not serve every mission | Hermes, selected narrowly | Medium | KEEP HERMES-NATIVE |
| Skills and native learning | Hermes | Native skill loader | Builder, KnowGraph, Team | Progressive procedures and domain guidance | Profile skill store | Yes | No | No | Prompt-loaded only when selected | Risk of duplicating SOUL and tool descriptions | Hermes | Low | KEEP HERMES-NATIVE |
| Direct Card messaging and Bot roster | Hermes plus LiquidAIty saved topology | Native `message_agent`; existing `card-tools` prompt/hook maps visible one-word title to stable profile | Topology-authorized Cards, especially Main | Send one bounded mission to an exactly connected saved Card | Saved topology and Hermes session | Yes | No | No | Native tool plus a bounded roster prompt | Materialized `card-bot-dm` runtime copies overlap the current `card-tools` title mapping | Hermes primitive with current thin mapping | Medium | KEEP HERMES-NATIVE |
| Native delegation/subagents | Hermes | Native `delegate_task` toolset | Only Cards explicitly selecting leaf or recursive native delegation; absent from the six-card baseline above | Bounded internal child work, not saved-Card orchestration | Parent Hermes session | Yes | No | No | One tool plus inherited narrowed toolsets | Historical Team/auto-team experiments should not be confused with this native capability | Hermes | Medium | KEEP HERMES-NATIVE |
| Magnetic tasks, dependencies, attempts, review, completion | Hermes | Native Kanban/task runtime | Magnetic | Decompose one approved mission, assign exact blue workers, synthesize same root | Hermes SQLite task ledger | Yes | No | No | 14 tools / 23,634 bytes in the Magnetic runtime | Old LiquidAIty Kanban/UI adapters would be duplicate owners | Hermes | High | KEEP HERMES-NATIVE |
| Card/Canvas inspection | LiquidAIty application | Existing profile-scoped `card-tools` Hermes plugin to signed loopback application host | Main, Builder, KnowGraph, Team | Read current saved application state | PostgreSQL/AGE and saved deck | Yes for identity, no for data ownership | No separate plugin service | Yes, through application APIs where authorized | One schema per granted operation | None in current live path | LiquidAIty application via existing plugin bridge | High | KEEP LIQUIDAITY CARD TOOL |
| Card create/update configuration | LiquidAIty application | Existing `card-tools` plugin; canonical application auth and revision guards | Builder | Explicit saved Card construction and configuration | Saved Card store | Yes for Card/Run identity | No | Yes where application exposes it | 2 Builder schemas | Direct database mutation from a plugin would duplicate authority | LiquidAIty application via existing plugin bridge | High | KEEP LIQUIDAITY CARD TOOL |
| Selected graph-reference loading and mission staging | LiquidAIty application/Python rails | Existing `card-tools` plugin | KnowGraph | Resolve bounded references; stage existing target editors without executing another path | Native graph owners plus saved Card editors | Yes | No | Yes through application boundary | 2 schemas | Must not become another IDF or graph store | LiquidAIty application via existing plugin bridge | High | KEEP LIQUIDAITY CARD TOOL |
| Magnetic outer invocation (`run_mag_one`) | LiquidAIty application | Existing `card-tools` plugin into canonical outer Run path | Main | Apply saved topology and authorization, create one outer Run, invoke Magnetic | Saved Card/Run/AGE authority plus Hermes task ledger | Yes | No | Yes through application boundary | 1 Main schema | Moving it into Magnetic would bypass outer application authority | LiquidAIty application via existing plugin bridge | Very high | KEEP LIQUIDAITY CARD TOOL |
| ThinkGraph/Engraphis operations | LiquidAIty/Engraphis and Python rails | Existing `card-tools` plugin; local first-party execution | Main subset, ThinkGraph full set, KnowGraph/Team read subset | Persistent reasoning reads and intentional writes | Engraphis | Card/Run identity is useful; graph ownership is not Hermes | No independent server required for Hermes Cards | Possibly, through the application surface | Main 3; ThinkGraph 7; other Cards bounded subsets | A new “ThinkGraph plugin” would duplicate the bridge already in use | Existing LiquidAIty Card-tool/plugin path | High | KEEP LIQUIDAITY CARD TOOL |
| CodeGraph/CBM | Codebase Memory | Native external MCP, exact temporary profile binding | Builder only in this baseline | Structural code discovery and impact analysis | CBM index/graph | No | Yes | Yes: Builder, Codex, ChatGPT/plugin and other clients | 7 granted schemas; bytes pending real authorized-turn capture | Past startup/process binding duplicated upstream lifecycle | CBM external MCP | High | KEEP EXTERNAL MCP |
| KnowGraph/Graphiti | Graphiti | Native external MCP, exact temporary profile binding | KnowGraph 8 exact tools; Team 3 exact reads | Sourced research, provenance, entities, relationships, evidence | Graphiti/Neo4j | No | Yes | Yes | KnowGraph 12,227 bytes; Team about 3,793 bytes | Wrapping all Graphiti calls would conceal rather than remove MCP | Graphiti external MCP | High | KEEP EXTERNAL MCP |
| Codex App Server first-party tool presentation | Hermes/LiquidAIty adapter | App Server Dynamic Tools for exact first-party grants; native MCP remains separate | Codex-backed saved Cards | Present exact effective Card grants to the existing Hermes executor | Saved Card and current Run authorization | Yes | No | No | Exact selected schemas | No duplicate executor; this solves a distinct provider transport need | Current Dynamic Tool boundary | High | KEEP LIQUIDAITY CARD TOOL |
| Tool Search | Hermes | Native progressive-disclosure bridge over the already-granted catalog | Future large worker surfaces; not needed to justify current six-card grants | Reduce initial schema load without widening authority | Current session catalog only | Yes | No | No | Adds search/describe/call bridge only when threshold activates | A LiquidAIty search registry would duplicate it | Hermes | Medium | KEEP HERMES-NATIVE |
| Deterministic context formatting, bounded transformations, reusable recipes | Future Card Python | Saved, immutable, hash-bound Card script over already-granted tools | Card-specific, later | Compose data and shape output without changing authority | Original tool/data owners | Yes for immutable Card version | No | No | One compact Script tool is the approved target | Implementing it as many helper plugins would fragment ownership | Card Python | Medium | FUTURE CARD PYTHON |
| Hidden semantic preprocessing or plugin-owned extra model calls | None approved | Potential `pre_llm_call` or `ctx.llm` | None | Would duplicate visible Card reasoning and spend | Unclear | Yes | No | No | Adds hidden prompt/model cost | Duplicates Card model turn, receipts, and attribution | None | High | REMOVE / RETIRE |
| `liquidaity-card-mcp` profile entry | No current implementation/package found | Stale enabled-plugin configuration on Main and Builder profiles; recovery exports also retain it | Main, Builder profile config only | No current job | None | No | No | No | No live directory/tool schema found | Superseded by current `card-tools` bridge | Remove from profile configuration after focused readback proof | Low to medium | REMOVE / RETIRE |
| `card-bot-dm` materialized profile plugin | Untracked runtime residue; no current tracked implementation source found | Enabled plugin directory on Main, Builder, ThinkGraph | Those three profiles | Historical visible-name/direct-message adaptation | Hermes Bot roster/topology | Yes | No | No | Unknown until isolated readback | Current `card-tools` already performs visible-title mapping and bounded roster injection | Retire after direct Bot messaging acceptance proves no missing behavior | Medium | REMOVE / RETIRE |
| Team `kanban.task_mode: team` profile value | Hermes profile residue inconsistent with current saved Team Card (`team=null`, `subagentType` unset) | Materialized profile config | Team only | Historical automatic-team behavior | Hermes profile | Yes | No | No | Can change the runtime surface despite no saved grant | Conflicts with current saved-Card authority | Saved Card should reconcile it away; then prove profile readback | Medium | REMOVE / RETIRE |
| High-level KnowGraph wrapper that calls Graphiti through `ctx.call_mcp` | Not implemented | Possible future Hermes plugin | Potentially KnowGraph only | Could reduce 8 low-level schemas to 2–3 intentional operations | Graphiti remains data owner | Yes | Yes | No | Potential reduction from 12,227 Graphiti bytes; not yet measured as a candidate | Risks server-level consent broadening, hidden provenance, and duplicate receipts | Undecided | High | NEEDS PROOF |
| Mission-conditional Team grants | Not implemented | Saved-Card/Run grant compilation plus native Hermes/external MCP surfaces | Team | Give the wildcard only the capability needed for the current fallback assignment | Existing owners | Yes | Sometimes | No | Could materially reduce about 9,013 estimated tokens | Must not become a semantic TypeScript router | Undecided | High | NEEDS PROOF |

## System-Card baseline

| Card | Baseline floor | Deliberately absent |
|---|---|---|
| Main | Memory, exact connected-Card messaging, bounded selected context, necessary ThinkGraph operations, approved Magnetic invocation | CBM, Graphiti catalog, files/terminal/browser, Kanban |
| Builder | Files, terminal, code execution, selected web/browser/vision, exact Card construction operations, authorized-turn CBM | Graphiti, Magnetic/Kanban ownership, hidden semantic preprocessing |
| ThinkGraph | Exact Engraphis read/reconcile/write operations only | Web, Graphiti, CBM, Card construction, delegation |
| KnowGraph | Web research, exact Graphiti grants, exact selected-reference/staging operations, memory/grounded-citations | CBM, terminal/files, Magnetic/Kanban ownership |
| Magnetic | Native Hermes task/dependency/worker/synthesis runtime and exact blue roster | General web/files/browser, CBM, Graphiti, Card construction, another board/runtime |
| Team | A bounded fallback mission with only its mission-required native and external capabilities | Permanent Builder-equivalent construction surface; permanent graph catalog without a graph task |

## Bounded residue findings

The direct-source inverse search found three current runtime/profile residues worth a separate cleanup task:

1. Main and Builder still name `liquidaity-card-mcp`, although no current plugin directory or tracked implementation exists.
2. Main, Builder, and ThinkGraph still contain materialized `card-bot-dm`, while current tracked `card-tools` already owns the visible-name mapping and roster prompt. The tracked `packages/hermes-card-bot-dm` path contains only `.gitignore`; ignored bytecode/cache residue is not an implementation.
3. Team's profile still says `kanban.task_mode: team`, while the current saved Team Card has no `team` block and no `subagentType` selection.

These are findings, not authorization to delete runtime state during this audit. Removal needs focused Main/Builder/Bot/Team readback and execution proof. The tracked `subagentType` values `none`, `leaf`, and `recursive` are not classified as residue here: current repository law still explicitly preserves native Hermes subagents as a distinct optional Card capability.

## Process-count clarification

The fresh backend startup did not launch a CBM frontend. A process inventory excluding the diagnostic PowerShell process found zero `codebase-memory-mcp` processes.

It did deliberately launch 11 unique topology-demanded Hermes Card `serve` runtimes and nine TUI runtimes. Windows shows two Python process entries for each logical invocation—the virtual-environment launcher and the base interpreter—so the inventory was 22 `serve` Python entries plus 18 TUI Python entries. This is the likely source of the earlier “22 frontends” observation; those processes are Hermes Card runtimes, not CBM frontends.

Current source makes the fan-out explicit:

- `apps/backend/src/main.ts` starts Python-owned startup work after backend listen.
- `apps/backend/src/startup/pythonOwnedStartup.ts` derives demand from Main, enabled orange Bot rosters, Magnetic, and enabled blue workers, then reconciles every demanded Card.
- `apps/backend/src/hermes/agentTerminal.ts` opens one unique profile runtime, makes Main headless, leaves Magnetic without a TUI, coalesces concurrent starts, and reuses existing profile sessions/TUIs.
- Focused tests cover repeated-reconcile and concurrent-open deduplication.

Therefore the observed count is intentional one-runtime-per-demanded-Card behavior, not duplicate process creation. Whether topology-wide eager startup should become lazy is a separate product/lifecycle decision and is classified `NEEDS PROOF`; it is not safe to remove under a tool-ownership audit.

## Recommended next bounded experiment

Do not add another plugin. First capture real use and schema receipts for one representative mission per System Card. The first design experiment should then be mission-conditional Team grants, expressed through the existing saved Card and Run authorization path. Keep all semantics in the model; deterministic code may only apply an explicit structured grant decision. Success is a materially smaller Team prompt with the same task result and receipts. Failure is missing capability, hidden routing, or a second catalog—remove the experiment if any occurs.
