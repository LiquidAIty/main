# LiquidAIty Core v0 Architecture

This document describes current source ownership. `PLAN.md` orders future proof; `FUTURE.md` contains
deferred work; `AGENTS.md` is execution law.

## One-line law

```text
TypeScript = transport and pixels
Python rails = runtime and deterministic computation
models = semantic reasoning
saved Cards and graph topology = identity and authority
```

## System map

### Finding the owner before coding

Use this source map for navigation, then resolve symbols through CBM and read current source.
It is not a claim that every feature is live-proven. `PLAN.md` owns acceptance gaps; the controlled
vendor divergence register below owns local upstream changes. Library behavior comes from the
installed source/documentation, not an assumption based on model training.

| Work | Existing owner | Contract / next evidence |
| --- | --- | --- |
| Card input and context size | [idf.py](apps/python-models/app/python_models/idf.py): `materialize_idf`, `runtime_projection`, `model_task` | One retained/reloaded input; actual provider request before context removal |
| Saved Card execution | [card_domain.py](apps/python-models/app/python_models/card_domain.py): `_retain_run_idf` | Saved identity, prompt, model and grants; receiving Card owns its Run |
| HTTP route ownership | [routes/index.ts](apps/backend/src/routes/index.ts), [cardEditor.routes.ts](apps/backend/src/routes/cardEditor.routes.ts), [cardRuntime.routes.ts](apps/backend/src/routes/cardRuntime.routes.ts), [codegraph.routes.ts](apps/backend/src/routes/codegraph.routes.ts) | Authenticated domain mounts; Main conversation, saved Card Run, Hermes terminal, IDD and CodeGraph transport |
| Hermes profile selections | [mainAdapter.ts](apps/backend/src/hermes/mainAdapter.ts): `materializeHermesProfileSelections` | Parent/child model distinction, installed selected skills, readback |
| Native provider request | [conversation_loop.py](Hermes/agent/conversation_loop.py), [chat_completion_helpers.py](Hermes/agent/chat_completion_helpers.py): `build_api_kwargs` | API mode, transport preparation and hooks; vendor excluded from CBM |
| Hermes procedural context | [system_prompt.py](Hermes/agent/system_prompt.py), [prompt_builder.py](Hermes/agent/prompt_builder.py): `build_skills_system_prompt` | Profile-scoped index versus opened contents; no assumption of whole-library injection |
| GPT connector | [mcp_host.py](apps/python-models/app/mcp_host.py): `_gpt_public_catalog`, `_authenticated_main_context`, `_dispatch_tool` | SDK initialization instructions, IDD publication, canonical handlers and authentication |
| ThinkGraph operations | [engraphis.py](apps/python-models/app/python_models/engraphis.py), [thinkgraph.py](apps/python-models/app/python_models/thinkgraph.py) | Engraphis authority, native IDs, extraction and attributed notes; accepted layout locked |
| KnowGraph intake | [ingest.py](services/knowgraph/ingest.py), [KnowGraph procedure](skills/knowgraph.md) | Fetch/parse versus Graphiti extraction, temporal evidence and recall |
| Deletion impact | [CBM procedure](skills/codebasedmemory.md) | Coverage, inverse callers, dynamic registrations and current source |
| Native observations | [native_attention.py](apps/python-models/app/python_models/native_attention.py) | Real events/IDs; observations do not authorize work |
| Agent usefulness | [double-agent procedure](skills/double-agent-standin-skill.md), [test plan](PLAN.md#controlled-agent-test-plan) | Real role task plus separate evaluation, stopwatch and provider receipts |

When changing a feature, update its existing section with the owner, public entry, persisted
identity, dependency/version source, focused proof and unresolved limit. Keep full schemas,
library manuals and source bodies in their existing owners. Read relevant checked-in library
documentation first, then exact-version primary documentation when local evidence is insufficient.
Preserve compatibility names until actual callers and saved references can migrate together.

Repository procedures are Markdown under `skills/`; native Hermes skill availability is a separate
profile contract. Read relevant procedures once per unchanged task. This map, the whole diary and
the complete skill library do not belong in Main's dynamic input.

Collaborator readiness is a launch requirement. The ordered
[cleanup sequence](PLAN.md#collaborator-readiness-and-cleanup-sequence) distinguishes reviewed
source from unaudited areas and defines preservation checks. The
[Card-matched double-agent procedure](skills/double-agent-standin-skill.md#bind-a-coding-subagent-to-the-actual-card)
uses an explicitly selected coding subagent, actual tools and separate diagnostics to investigate
the saved Card's job. It is a testing procedure, not another product runtime; native Hermes parity
and performance improvement require actual evidence.

`builder` is the requested replacement Card/profile; `Agent Builder` names the workspace for building
Cards, their UI and selected run context. The old Builder and Local Coder Cards are still saved;
their requested removal/replacement is incomplete. The lower terminal belongs to Builder. Route names describe responsibilities,
not identities inferred from historical filenames. The former 2,014-line `coder.routes.ts` mixed
editor, graph, Main and execution transport. Editor/IDD and CodeGraph read now have separate modules;
`cardRuntime.routes.ts` retains shared execution/session transport without changed handler bodies.
`routes/index.ts` now mounts `/api/main`, `/api/cards`, `/api/hermes`, `/api/idd` and `/api/codegraph`,
each behind the same `authMiddleware`. Current client and Python MCP/control-plane callers were
migrated together; the old global `/api/coder` mount is absent, with a 404 regression check.
These are transport addresses, not five runtimes or a semantic agent router. No Card identity,
saved profile, tool name, handler schema or session history changes as a result of this migration.
The owner-authorized September 10 `npm run dev:fresh` loaded the changed backend/Python callers
together. Authenticated Main/CBM reads, all 11 saved Card status reads, editor options and native
terminal listing work; retired global Coder HTTP returns 404. PLAN records exact startup/source
identity. Fresh selected-plugin acceptance and new model execution remain separate proofs.
The runtime module remains large, especially configured-Card dispatch. Complete source review found
a specific lost-usage defect: Builder used `finishRun: false` for its native CLI call, then the outer
finish call discarded returned usage. The existing finish call now retains all five supplied usage
fields; route/bridge tests and backend typecheck pass. Missing usage stays unknown. No additional
module extraction was justified solely by line count; loaded behavior still needs separate proof.

| HTTP entrance | Responsibility |
| --- | --- |
| `POST /api/cards/run` | Execute, inspect or stop the exact saved Card Run using its existing action schema |
| `POST /api/cards/connected` | Read connected-agent relationships |
| `GET /api/cards/options`, `POST /api/cards/script/validate` | Ordinary Card editor choices and selected-tool Script validation |
| `POST /api/main/context`, `POST /api/main/chat` | MCP's authenticated Main context and external Main conversation transport |
| `/api/main/session/*` | Existing browser Main chat, history, driver, attention and exact-Run Stop routes |
| `POST /api/hermes/execution-context` | Existing internal native execution-context lookup with its existing checks |
| `/api/hermes/terminal/sessions/*` | Existing persistent Hermes terminal transport |
| `GET /api/idd/card-editor`, `/api/idd/tools`, `/api/idd/script-tools` | IDD-backed editor and tool projections |
| `POST /api/codegraph/read` | Existing saved-workspace CodeGraph read |

The five MCP backend operations retain their process-secret and timeout behavior through a literal
URL map in `mcp_host.py`. No legacy HTTP alias remains. The 65 route/bridge tests and 12 focused
MCP catalog/transport tests pass; production TypeScript checks pass for both backend and client.

### Using Builder and finding its tools

Open the Agent Builder workspace. Main stays in the upper conversation; the lower coding surface is
the saved Builder Card's terminal/session presentation. Card selection and its Tools/Script controls
belong to the existing inspector. Select the actual saved tools and skills there; availability is
checked against native/MCP catalogs. Ordinary prompt, research and implementation work does not need
a create/edit operation. This describes current entrances, not completed acceptance of the new profile.

| Need | Existing owner / entry | Current limitation |
| --- | --- | --- |
| Inspect current Cards and wires | Public `canvas.inspect` → `control_plane.canvas_inspect` | Bounded identity/runtime/tool view, not full prompt/configuration editor |
| Select Card settings/tools or validate Script | Card inspector → `cardEditor.routes.ts` → IDD/Python owners | Native choices come from the bound profile; no invented callable schemas |
| Create or edit a Card | `card.create` / `card.update_configuration` → `control_plane.py` | Writes currently require prefilled Builder operation authority; general tool workflow remains incomplete |
| Run an ordinary Builder assignment | Saved Card Run → `cardRuntime.routes.ts` → existing native profile/CLI | Saved new `builder` binding is not activated yet; do not confuse a passing test with a working replacement |
| Inspect implementation | Selected application `cbm.*`, then current source | Native CBM remains app-owned; no direct frontend or indexing |

The new local profile `Hermes/.hermes/profiles/builder` was created through native Hermes profile
creation with no clone. Only `hermes-agent` and the revised `agent-builder-inspection` skill were
selected; no old memory, sessions or credentials were copied. Profile creation does not establish
account authentication, a saved Card binding or effective native tool availability.

#### Builder capability inventory — observed September 10

The saved Card is still `card_61d994e5044b4e44`, title `Agent Builder`, bound to
`liquidaity-agent-builder`. The clean `builder` profile is not its replacement until the saved binding
and loaded application agree. The following is an inventory of selections and source owners, not a
claim that every selected tool has passed a live call.

| Selected MCP tool | Owner and effect | Target / evidence limit |
| --- | --- | --- |
| `canvas.inspect` | Python control plane; read | Current deck, bounded Cards and wires; not full selected-Card configuration |
| `card.create` | Python control plane → saved Card domain; write | Current deck; currently requires a prefilled create operation and generates a profile name |
| `card.update_configuration` | Python control plane → saved Card domain; write | Exact Card; current Builder operation restricts fields and values in advance |
| `cbm.search_graph` | App-owned native CBM; read | Repository symbols and native identities |
| `cbm.trace_path` | App-owned native CBM; read | Callers, callees and structural paths |
| `cbm.get_code_snippet` | App-owned native CBM; read | Source for a resolved symbol; partial coverage remains possible |
| `cbm.check_index_coverage` | App-owned native CBM; read | Projection coverage, not authorization to index |
| `cbm.detect_changes` | App-owned native CBM; read | Repository change impact |
| `engraphis_recall_context` | Native Engraphis; read | ThinkGraph context |
| `engraphis_get_memory` | Native Engraphis; read | Selected ThinkGraph memory |
| `graphiti.search_nodes` | Native Graphiti; read | KnowGraph nodes |
| `graphiti.search_memory_facts` | Native Graphiti; read | KnowGraph facts |
| `graphiti.get_episodes` | Native Graphiti; read | KnowGraph source episodes |
| `card.load_graph_references` | Python Card/graph adapters; native read plus transient receiving-Card context handoff | Write-class grant; does not persist a Card change, write graph knowledge or start a Run. Self-target is restricted except Main's self-selection |

The six individually selected native tools are `memory`, `session_search`, `todo`, `skills_list`,
`skill_view` and `skill_manage`. They cover native profile memory, prior sessions, task notes and
profile skills; memory, todo and skill management can write their corresponding native state.
Selected skills are `hermes-agent` and `agent-builder-inspection`.

The six selected toolsets expand in the checked-in Hermes `TOOLSETS` definitions as follows:

| Toolset | Native tool names | Effect / target |
| --- | --- | --- |
| `web` | `web_search`, `web_extract` | Fetch/search external web content |
| `terminal` | `terminal`, `process` | Execute commands and manage their processes in the configured workspace |
| `file` | `read_file`, `write_file`, `patch`, `search_files` | Read/search/edit workspace files |
| `browser` | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_back`, `browser_press`, `browser_get_images`, `browser_vision`, `browser_console`, `browser_cdp`, `browser_dialog`, `browser_exec`, `web_search` | Read and interact with browser pages; actions can change external state |
| `vision` | `vision_analyze` | Analyze supplied image input |
| `code_execution` | `execute_code` | Native code execution and tool composition |

There are 23 unique toolset names plus six individually selected native names. This is a static
selection count, not 29 proven callable tools. Native environment, credentials and browser backend
can change availability. The existing session projection also unions saved Card toolsets with native
profile toolsets. The old profile pins `computer_use` and `hermes-acp`; these can widen its effective
catalog beyond the six saved toolsets above. The clean profile has only the six CLI selections and no
such pin. Effective schemas and grants must be read back before the replacement or a stand-in test.

The loaded old-profile readback confirms native name `liquidaity-agent-builder`, Sol parent,
materialized child selection, pinned toolsets, enabled `computer_use`, the two selected skills and no
native MCP servers. The checked-in `hermes-acp` set also contains `delegate_task`; together these yield
31 candidate native names, not 31 available tools. Saved delegation remains off. The profile response
and static expansion are complementary evidence, not a substitute for the actual per-Run schemas.

The saved parent is `openai/gpt-5.6-sol` with ChatGPT-account access; its native child selection is
`openai/gpt-5.6-luna`. Reasoning effort and generation-limit overrides are not saved, so native defaults
are unknown here. Delegation is off. Script is blank and disabled, version 8. CBM `search_code` and
`query_graph` are absent from these saved grants despite their use in the repository audit procedure.
There is no selected or published `card.delete` tool; the existing HTTP deletion operation refuses
Cards with retained history. Neither missing capability is silently supplied through a substitute.

#### Proposed general Builder contract — deferred until Main works and owner review

Builder remains an ordinary Hermes Card in Agent Canvas and the existing lower terminal. It receives
the actual request and deliberately selected context through the single IDF materializer. It can
research, author prompts, edit code or build UI without first declaring a create/edit operation.
It chooses tools; TypeScript transports requests and Python validates and performs operations.

For creating an agent, the proposed interaction is:

1. Read the current deck and the applicable IDD/template/model/tool choices. Extend the existing
   inspection doorway to expose an explicitly selected Card's editable configuration and revisions;
   its current bounded response does not yet supply this. IDD remains the definition owner.
2. Builder chooses concrete Card values from the request: name, prompt, Hermes/AutoGen binding,
   model, selected tools, skills, native toolsets and any requested UI. It presents these for review
   when requested, or saves within the owner's existing authorization. There is no new approval
   framework, hidden prompt rewriting or predetermined create packet choosing those values.
3. Builder calls the existing `card.create` with the reviewed values. Honor an explicit short profile
   name instead of generating one. Keep authentication, effective permissions, schema validation,
   current catalog checks and revision conflicts. Save and read back the Card; saving does not run it.
4. For changes, inspect the exact target and call `card.update_configuration` with an explicit patch
   and current revision. Preserve unspecified fields, other Cards, profiles and histories. Remove
   the requirement that another caller pre-author every eventual field value in an operation packet.
5. Build agent UI/pages through selected file and terminal tools against the existing app, then
   compile/test the affected UI and saved-Card path. The terminal is Hermes infrastructure, not a
   revived Local Coder runtime. A real saved-Card Run is a separate, explicitly requested proof.

The construction tools need their actual accepted schemas aligned with the fields they advertise,
including native selections and model settings. Add the missing selected CBM `search_code` and
`query_graph` capabilities so Builder can follow the existing audit procedure. Do not grant the whole
catalog. This proposal does not merge graphs, remove IDD/skills/PlanFlow, invent a new agent runtime,
or impose a classifier that forces every assignment through agent creation.

Card removal is a separate unresolved storage contract: both old Cards have retained completed Runs,
and canonical deletion rejects those references. No archive mode, dummy Card, history deletion or
database bypass is approved here. Review that concrete conflict before changing the deletion rule.
The general create/edit changes above have not been implemented or live-proven; this is the contract
to review before changing their behavior.

#### Main, Builder and graph design review — September 10

This review uses saved Card configuration, native profile readback, app-published CBM discovery and
complete current source. It changes documentation only. It does not change saved prompts, tools,
models, graph data or delegation. The clean `builder` profile remains unbound.

| Saved agent | Current responsibility and settings | Material limits |
| --- | --- | --- |
| Main Chat / `liquidaity-main` | Sol parent, Luna native child, profile delegation; answers directly, reads graphs, writes ThinkGraph, delegates useful work | Enabled Script v2 compacts ten selected reads; graph preload adds automatic bounded reads. Magentic-One is on hold by saved instruction |
| Agent Builder / `liquidaity-agent-builder` | Sol parent, Luna child, delegation off; native implementation tools, graph reads, optional Card creation/editing | Old profile/skill and control-plane restrictions below remain active; new `builder` is not bound |
| ThinkGraph / `thinkgraph` | Luna parent with saved low effort, Luna child selection, delegation off; seven Engraphis tools for focused extraction/reconciliation | No web, KnowGraph or Card writes. Native ingestion uses an additional extractor completion when needed |
| Graph Agent / `liquidaity-hermes-steward` | Sol parent, Luna child, Team delegation; web research, KnowGraph reads/writes, ThinkGraph and CBM reads | No ThinkGraph mutation; no outgoing saved-Card delegation. Its prompt still assigns detailed reports/plans/prompt writing to Builder |

Only ThinkGraph saves an explicit low reasoning effort among these four Cards. Missing effort on the
others is native default/unknown. Main has directed flow edges to Builder, Graph Agent and ThinkGraph.
Builder has no Magentic-One edge. Graph Agent's native Team workers are not extra saved Cards.
The product graph and its engine are different concepts: ThinkGraph is stored/queried by Engraphis;
KnowGraph is stored/queried by Graphiti/Neo4j. The similarly named ThinkGraph Card is a model worker,
not the Engraphis runtime. Several authorized callers may use the same native graph writer.

The remaining Builder restrictions are concrete, not inferred from old route names:

- Its saved prompt prohibits editing Main, Graph Agent or itself, changing wires, running the target
  Card and joining Magentic-One. It permits ordinary writing/implementation without a create/edit task.
- Its selected old inspection skill says exact AutoGen assistant creation, mandatory public-repository
  research even for prompt-only work, a prefilled operation, one effect, and no subsequent Card run or
  wire edit. Some source contracts already support more than this skill describes. The new unbound
  profile's revised skill does not repair the old active profile merely by existing.
- `control_plane.card_create` and `card_update_configuration` require the exact old Builder caller
  profile and prefilled operation authority. Field values must equal the values pre-authored in that
  operation. This constrains what Builder can design after inspecting the task.
- Create rejects native tools, skills, toolsets, MCP connection IDs, subagent model and position even
  though the public schema accepts those fields. It mints an `agent-{uuid}` profile rather than
  honoring the requested short name. General creation/configuration parity is incomplete.
- `canvas.inspect` supplies a bounded deck view, not every editable field and revision needed for
  reliable model-driven editing. Builder also lacks saved CBM `search_code` and `query_graph` grants
  required by its repository procedure. File/terminal capability does not make the tool contract complete.

Keep authenticated project/caller identity, schema typing, actual grants, workspace containment,
revision conflicts and native runtime checks. Review the pre-authored value requirements, role-name
guards, stale skill rules and schema disagreement against the intended general Builder behavior.
These are distinct from necessary authentication; removing one does not justify weakening the other.
Native terminal/file/browser/code tools already confer meaningful workspace/external-action capability.
The prohibition on a Card-management tool is not a full sandbox against all effects those tools can
perform. A precise workspace/credential/external-action authority review is still needed before
describing Builder as isolated or safe for arbitrary untrusted projects.

Main's current prompt no longer forces a short answer or delegation for a long answer. It may write a
concise supported ThinkGraph note, invoke extraction for short material, or delegate substantial
reconciliation to ThinkGraph. It may research directly; Graph Agent handles useful deeper research and
KnowGraph retention. Graph Agent's remaining "not a report" instruction and assigning detailed
reports/plans to Builder is a role-design choice to review, not a runtime necessity.

Main's Script wraps two Engraphis reads, three Graphiti reads, four CBM reads and `canvas.inspect`.
Each invocation selects one exact operation and permits one underlying call, 60 seconds and 20,000
output bytes; these are per-Script-call limits, not an entire Main-Run budget. Recall uses 600 tokens/k6;
Graphiti nodes/facts/episodes are limited to 6/8/4, with episode bodies omitted; CBM searches/traces are
similarly compact. The remaining selected tools, including writes, stay separate. This reduces schema
presentation but also hides some native arguments. Saved validation is valid; executionTested is false.
Do not confuse a static valid Script with current live execution acceptance.

Before Main's IDF, `data_anchor.prepare_main_context` still automatically performs granted bounded
ThinkGraph and KnowGraph reads concurrently under a two-second deadline. Current Main gets up to six
ThinkGraph candidates/600 packed tokens and four KnowGraph facts. Whole-sentence CBM preload was
removed after irrelevant matches. These are automatic reads, not the removed automatic conversation
writes. Evaluate useful recall, timeouts and input relevance before adding or deleting context.

PLAN previously contained both a product vision consumed by Builder and a much larger roadmap. The
repaired heading boundary keeps only the explicit vision in that consumer. PLAN now explains this
exception, restores the MVP outcomes and separates test instructions from product input. Moving the
vision to saved Card authority would be a distinct approved source change; IDD and the single IDF
remain intact. Historical FUTURE guidance still contains conflicting Constellation/Team/Coder language;
it is deferred-review evidence, not permission to revive those paths.

`card_domain._agent_builder_guidance` adds IDD, selected skill and the product-vision section only for
an explicit Builder operation. `_agent_builder_vision` reads from the exact `## Agent Builder product
vision` heading to the next level-two heading in PLAN. A real-file regression demonstrated that
the old heading hierarchy included unrelated roles and implementation history (19,341 bytes).
The corrected section is 1,212 bytes and contains only product guidance. Do not append audit results,
evaluation instructions or other roles inside this runtime-selected section.

```text
React/Vite Agent Builder and Chat
  → Node/TypeScript HTTP, SSE, saved-state, and session transport
     → repo-owned Hermes ACP adapter, reusing one process owner per native profile
        ├─ Main: stable native session, home/profile liquidaity-main
        ├─ Agent Builder: stable native session, home/profile liquidaity-agent-builder
        ├─ Coder: stable native session, home/profile coder
        └─ Graph Agent: stable native session, home/profile liquidaity-hermes-steward
     → official Python MCP client boundary
        → one official Python HTTP MCP host on :8765/mcp
           ├─ Card call/IDD/AGE deterministic rails
           ├─ AutoGen AssistantAgent
           ├─ AutoGen MagenticOneGroupChat
           ├─ ThinkGraph/Engraphis
           ├─ KnowGraph/Graphiti
           └─ CodeGraph/native CBM through one app-owned AppData frontend
```

ngrok is a readiness-gated child of the canonical service tree and forwards only to the official MCP
host. OAuth remains enforced at the MCP resource boundary.

## Saved Cards and runtime binding

A saved Card is the permanent authority for identity, prompt, provider/model/profile, runtime binding,
enabled state, and tool/capability grants. Callers supply input and references, never replacement Card
definitions.

Current internal Cards:

| User-facing role | Stable Card ID | Runtime | Profile |
| --- | --- | --- | --- |
| Main Chat | `card_main_chat` | Hermes `main` | `liquidaity-main` |
| Agent Builder | saved server-minted Card ID | Hermes `delegate` | `liquidaity-agent-builder` |
| Local Coder | `card_local_coder` | Hermes `delegate` | `coder` |
| Graph Agent | `card_hermes_steward` | Hermes `delegate` | `liquidaity-hermes-steward` |
| ThinkGraph | `card_a52fd511ecb14f53` in the current project | Hermes `delegate` binding | `thinkgraph` |

The September 7 cognition configuration retains Graph Agent as the KnowGraph researcher and preserves
its native Team settings. The ThinkGraph specialist now writes project cognition through Engraphis;
Graph Agent's ThinkGraph mutation grants are removed. Agent Builder retains its identity and construction
authority and gains native graph reads for synthesis. Worker output supplies pointers; Builder reads the
graphs directly. Standalone graph-worker and Builder reads/writing have historical component proof.
The former Main-to-both-graph-workers cascade was not the owner's requested boundary and is removed.
The September 9 saved-Main correction retains graph reads and profile delegation, removes its
one-paragraph limit and mandatory delegation of detailed answers, and selects `web_search` and
`engraphis_ingest`. Main decides when a specific task needs delegation. Its existing Script source,
model, profile, other grants and connections remain. The Script compiler exposes the newly selected
tools as ordinary agent tools; it does not wrap them. Saved readback and Run preparation confirm this
configuration. Actual answer, search and deliberate write quality remain
separate live acceptance checks. Only Main received a new Card revision in this correction.
Main's native profile has Honcho deselected; existing memory data and vendor integration are preserved.
ThinkGraph currently uses single mode for the owner's component comparison; its Luna subagent
selection is retained and native orchestrator remains an option. The September 9 owner correction
removes completed-pair automatic intake, its HTTP endpoint, handler and extraction-context subclass.
Main uses its granted graph tools during its Run. A separately delegated enrichment task remains an
unproven option. KnowGraph receives sourced research through its existing agent. Stable Card output
requirements travel in the system prompt, not the dynamic task. Main/Builder roles and tools remain
saved-Card configuration. No instruction-text classifier or user-word filter is used.

The removed automatic delivery path is not retained as a fallback. Explicit Main tool calls use
`engraphis_ingest` through the existing MCP adapter and Engraphis's `StructuredLLMExtractor`.
`engraphis_recall_context` and `engraphis_get_memory` supply reads. The account adapter preserves the
saved ThinkGraph model selection for the extractor; there is no conversation-specific extraction
subclass or appended role-context block. The separate review adapter remains for already supported
visual review; it does not launch extraction. A useful Main read/write/retrieval cycle still requires
live semantic evaluation.

Before configuring a native ACP execution session, the adapter applies the exact saved parent model
through `session/set_model`. Updating only native profile configuration does not update a restored
session's older model. Session history, profile identity and native model execution remain Hermes-owned.
Native asynchronous profile delivery is now live-proven: Main returned before its one Builder child
completed, and Hermes delivered that child's result once. The adapter uses the native asynchronous
delegation registry and completion queue; it observes the already accepted Card Run and never restarts
an interrupted child. Deterministic tests exercise native queue claims and interruption. The lower
surface is restored to the saved Builder's native CLI and full-height pull-up; it is not a retained-output
report panel. Full artifact revision/execution binding and fast useful Main context remain incomplete,
as recorded in PLAN.md.
The CLI plugin now sums native per-request token buckets for the bound parent session using Hermes'
`CanonicalUsage`, deduplicated by request ID. Another session's usage is excluded and an absent or
incomplete report leaves totals unavailable. Backend transport forwards those totals to the existing
Run completion fields and chat completion event. Provider-free plugin, bridge and route tests cover
the path; loaded native-session measurement after this repair remains unproven. No cost is inferred.
Main context preparation uses bounded concurrent reads through the application MCP host, under existing
saved grants, before the one IDF materialization. The existing Main preparation endpoint can preview the
same reads without starting a Run or creating an IDF. Preload uses public typed MCP requests without a
catalog refresh; its enforced HTTP-loopback transport avoids unnecessary TLS certificate loading.
Accepted native packed ThinkGraph context retains every included source reference and appears once
in the input. Context plus references remain byte-bounded; the prior four-reference truncation and
duplicate per-source input entries are removed for accepted packed results.
Whole-sentence CodeGraph preload was rejected after live evidence of irrelevant test matches influencing
Main's answer. CodeGraph remains available through focused saved tools and deliberately selected native
references; there is no deterministic keyword router replacing the rejected automatic lookup.
The September 8 owner correction explicitly rejects automatic conversation/ThinkGraph-to-KnowGraph
delivery. KnowGraph's delegated research and sourced ingestion path remains. Useful entity/relationship
linking and Main context search/injection are separate unfinished work, to be inspected and proven one
boundary at a time. Optional Question/evidence support is not a required conversation or research mode.
Background profile handoffs carry source identity in authenticated system context, never public MCP
arguments. Python binds that identity before the existing Card runner validates the directed handoff.

`card_local_coder` and `template_local_coder` are retained identities and now present the Hermes-backed
Local Coder. They do not imply the removed standalone LocalCoder/OpenClaude runtime.
`031_graph_agent_continuity.sql` gives an existing `card_hermes_steward` one new current revision named
Graph Agent with Hermes `delegate` mode. It copies the prior revision's prompt, profile, provider/model,
grants, runtime extensions, and presentation state, then advances only the current-revision/deck pointers.
Historical revisions, Runs, memory/session homes, and AGE relationships are not rewritten or deleted.

The current default topology preserves:

- Main → Agent Builder: `flow`
- Main → Graph Agent: `flow`
- Main → ThinkGraph: `flow` in the current project
- Main → Magentic-One: `magentic_control`
- Magentic-One → Local Coder: `magentic_option`
- Main → Local Coder: no direct connection
- Agent Builder → Magentic-One: no connection
- explicit production-agent → Magentic-One edges: `magentic_option`

AGE/ReactFlow relationships authorize who may call whom. They do not select providers, rewrite model input, or
start runtimes.

## Hermes ownership

`apps/backend/src/hermes/mainAdapter.ts` owns persistent Hermes ACP construction and sessions.
`apps/backend/src/hermes/coderTerminal.ts` owns the Coder terminal lifecycle. The ACP adapter reuses
one process owner per normalized native profile. Named profiles select
`Hermes/.hermes/profiles/<profile>` as `HERMES_HOME`; the unprofiled extension owner uses the root home.
Main, Agent Builder, Local Coder, and Graph Agent retain separate profile homes, native memory, sessions,
and configuration.
They share the vendored Hermes installation and integration code, not one merged memory database.
Native profile configuration and Hermes' auth resolver remain authoritative. A native `delegate_task` child is ephemeral inside its owning Card's
session. It remains activity of that same saved Card, inherits a Card-bounded native and MCP ceiling
through Hermes' native rules, and is not another saved Card or profile. Every child receives a
distinct Run and `nativeChildId` before execution and uses an opaque host-issued MCP 2 execution
context. Hermes may open a dedicated connection to its owning profile's `state.db` for a child's native
transcript lifecycle; that is not independent Card memory or identity.

Native `delegate_task(role="team")` is a headless capability of an authorized ordinary Hermes Card;
it is not a Card type or a standalone Kanban/Team Card authority. The adapter creates one durable native
Team task-graph root correlated to the originating profile/session. Delegate task selects the capability;
the existing Hermes configuration owns Team models and internal limits. The later Card policy and
forced-origin assignment are removed. The restored decomposer uses the native profile roster and
task assignments. Card-facing Hermes sessions expose Team when selected and expose `profile`
only for exact enabled outgoing orange `flow` targets. Native Leaf and Orchestrator remain internally
compatible without new LiquidAIty controls. Every worker task
is a dependency of the original root, so Hermes' existing parent-result context gives the resumed Team-lead
pass all worker reports. That pass returns one native task result to the existing originating Hermes
session and Card Run. ACP Card sessions and persistent Main CLI turns use one backend-owned host child
lifecycle for exact-once Run allocation, native-root correlation, terminal closure and recovery. Main
binds that opaque lifecycle before injecting the accepted turn. If the persistent CLI has not lazily
constructed its native agent yet, the profile-scoped native plugin manager holds one immutable pending
execution/request/session binding and consumes it onto the exact new agent immediately after construction,
before provider inference. An already-initialized agent keeps direct binding. The same CLI owner then
appends the terminal Team result with native-task idempotence once the session is idle.
If bounded delivery retries expire, the native completion and active child Run remain available for the
existing restart-rejoin owner rather than being converted into a false failure.
Existing Hermes SQLite dependencies, retries, recovery, notifications, Stop and
rejoin remain the execution substrate; no board controls or UI state are exposed.

The first canonical post-repair acceptance exercised this exact fresh-process path: parent Run
`req_f4dc226f` bound before inference, created one correlated child Run
`hermes_child_ca3d74c5-0e66-4e9a-88f3-cb543946f36b` and one native root `t_0c8618b6`, completed exactly
two Luna workers (`t_0a5610dc`, `t_91562520`), ran one Terra synthesis, and appended that synthesis once
to originating native session `20260830_170231_2b1e6f`. Native and host owners both reached terminal
success without provider fallback, duplicate allocation, nested delegation or a second acceptance call.

LiquidAIty's trusted session projection exposes `team` when the saved Card policy is Auto and adds
`profile` only when the current Card revision has an enabled outgoing orange edge to another enabled,
top-level Hermes `delegate` Card. The model sees compact target profile/title/description choices; the host
keeps Card and revision identity private, revalidates the current deck revision, direction, target profile,
and enabled state, then forwards any optional canonical `dataAnchors` selection unchanged to the
canonical saved-Card Run/IDF handler. Python remains the sole native-reference resolver and IDF
materializer. Native Hermes keeps `leaf`,
`orchestrator`, `team`, and `profile` on its one `delegate_task` implementation; Leaf/recursive settings are not fully exposed in the current UI;
the approved Runtime editor target must use their real supported settings. A process-only
Team marker blocks every Team worker and synthesis pass from calling any nested delegation role or
creating another native task, so the first-party MVP recipe cannot recurse.

Each saved Hermes Card may additionally own a desired `subagentModel`. At Run start the existing backend
adapter projects that selector into Hermes' native top-level `delegation.provider/model`,
then reads the same profile back before inference. The source repair preserves independent
`auxiliary.background_review` settings; focused tests pass and loaded proof remains pending. The parent Card
keeps its own saved model. A native child Run records the provider/model actually used and whether
Hermes fell back. External-memory provider choice remains Hermes profile state, not saved Card state.
Main alone exposes a native Honcho selection/setup/status control; it never reconfigures or contacts
Honcho during generic Run-start materialization. Card Save changes only desired PostgreSQL state, so a
stale or unavailable subagent selection stays
visible until an eligible Run either materializes it or fails honestly.

When an ordinary saved Hermes Card first runs and its bound native profile does not yet exist, the
same adapter asks Hermes' native profile manager to create it with the saved account-backed parent
model and shared native authentication, then rereads it before inference. It never writes profile
files or copies credentials. A non-empty saved Card skill selection is likewise materialized through
native profile configuration: unselected non-essential installed skills are disabled, Hermes' one
non-disableable operating skill remains, every selected skill must exist, and exact enabled-skill
readback is required. Cards without an explicit skill selection preserve their existing native profile
skill state.

The host derives one opaque key from Project, conversation, and Card identity. Hermes stores that key
in its existing native `sessions.session_key` field so an ACP restart recovers the exact session even
when Main and Coder share the repository working directory. The key is routing identity only; it is
not a Card definition, credential, prompt, or second persistence authority.

The backend injects server-owned Card, conversation, Run, and correlation identity. Hermes receives one
Python-materialized Card call plus minimal Card identity. No generic model call or another agent runtime
hides behind Hermes.

### Memory and knowledge authorities

There are **seven durable memory/knowledge authority types**. The first four are private to one Hermes
profile; the final three are shared project authorities reached through granted tools. Holographic and
Honcho are alternatives inside item 3, not two extra layers. The native Hermes Learning Journey/SkillGraph
is a projection over items 2 and 4, not an eighth store.

1. **Conversation history — Hermes `state.db`, per profile.** Serves continuity inside that Card's
   sessions: transcript load, search, and pagination. It does not become curated long-term memory and is
   never shared with another Card profile.
2. **Curated personal memory — `memories/MEMORY.md` and `USER.md`, per profile.** Serves durable facts,
   preferences, and user/profile guidance intentionally kept by that Card. The native memory tool is its
   writer and reader.
3. **One optional external-memory provider — native per profile.** Serves semantic recall beyond the files
   while remaining subordinate to the profile boundary. Hermes profile configuration selects `builtin` or
   one provider; `MemoryManager` loads at most that one provider. LiquidAIty exposes only Main's Honcho
   selection/setup/status, while preserving other profiles' existing Holographic configuration without a
   generalized Card control. Honcho owns its account/workspace/peer/session records. Holographic owns one
   profile-local `memory_store.db`. Selection, installed state, connection reachability, credential status,
   and effective turn policy are separate facts.
4. **Native profile skills — `skills/*/SKILL.md` plus `.usage.json`, per profile.** Serves reusable how-to
   knowledge learned or installed for that Card. The bounded native background-review child may create or
   patch only the owning profile's skills. `build_learning_graph()` reads these files and curated-memory
   chunks under that profile's `HERMES_HOME`; the Card Knowledge tab stores no copy.
5. **ThinkGraph — one Engraphis SQLite authority.** Serves project reasoning, hypotheses, relationships,
   operational knowledge, and semantic embeddings. The pinned engine
   is its sole writer.
6. **KnowGraph — one Graphiti/Neo4j authority.** Serves sourced entities, facts, episodes, temporal truth, and
   provenance, isolated by native project `group_id`. `Episodic` is a label inside this authority, not another
   memory layer.
7. **CodeGraph — the app-published CBM projection.** Serves derived repository structure, callers, symbols,
   and code-navigation evidence. The official CBM watcher/indexer is its sole writer; source remains final
   truth.

These authorities support a bounded cascade without copying or universal access tokens:

```text
current Card turn
  → that profile's state.db + curated memory
  → that profile's one selected external provider (when configured and allowed)
  → that profile's native skills / Learning Journey projection
  → deliberate tool reads from ThinkGraph, KnowGraph, and/or CodeGraph
  → one Run-scoped in.idf with bounded native IDs, data, and provenance
```

The cascade is guidance, not mandatory injection. An agent can search/read any healthy authority exposed by
its effective catalog; writes remain explicit saved Card grants with the authority's confirmation contract.
Cross-authority handoff passes native IDs and provenance, never copied subgraphs or credentials. Contextualized
plugin Main bypasses automatic Honcho prefetch/observe/write for that turn; direct native Main uses its own
Honcho fail-open. Workers and background-review children never inherit Main's Honcho context.

PostgreSQL Card configuration, Runs/artifact metadata, AgentGraph telemetry/topology, native Hermes Team tasks, the Hermes
project registry, attention events, the Run-scoped `in.idf`, browser state, and IDD are operational or transport
state. They may preserve evidence, but they are deliberately **not counted as memory/knowledge authorities**.

The other installed external-provider implementations (`byterover`, `hindsight`, `mem0`, `openviking`,
`retaindb`, and `supermemory`) are available alternatives, not simultaneously active layers.

#### Holographic SQL and context contract

Each active Holographic profile owns exactly one `memory_store.db`. Its schema contains `facts`
(unique content, category/tags, trust/usage counters, timestamps, optional HRR vector), `entities`, the
many-to-many `fact_entities`, the FTS5 `facts_fts` virtual table and synchronization triggers, and
`memory_banks` for category-level HRR vectors. A process-wide registry shares one WAL connection and
re-entrant lock per resolved DB path; refcounted shutdown closes the last handle. Parameterized SQL,
the unique constraint, atomic SQLite statements, and deterministic HRR serialization provide integrity.

`fact_store` reads with `search`, `probe`, `related`, `reason`, `contradict`, and `list`; the public
result limit is now schema-declared and enforced at 1–100, preventing SQLite `LIMIT -1` from becoming an
unbounded read. Its `add`, `update`, and `remove` actions write. `fact_feedback` adjusts trust, built-in
memory `add` may be mirrored as a fact, and optional session-end extraction writes only when
`auto_extract` is explicitly true. `sync_turn` is otherwise a no-op. Automatic context uses a five-result
trust-filtered search, then `MemoryManager` fences the text as `<memory-context>` and fails open on provider
errors/timeouts. Provider tool writes remain inside the saved native `memory` toolset grant; broad
application-catalog read discovery does not silently grant them.

This layout is mostly well separated, not one accidental stack of duplicate databases. The confusing parts
are projections and labels: Learning Journey/native SkillGraph shows profile files, Graphiti `Episodic` is a
node label, and attention repeats only stable IDs as observations. None is another durable memory authority.

## AutoGen ownership

The checked-in `autogen-main` fork at Microsoft AutoGen tag `python-v0.7.5`, commit
`83afbf5857aac683340d4c692194e548b1e8edda`, is first-party LiquidAIty execution infrastructure.
That upstream base is frozen; later Microsoft AutoGen versions are not an upgrade path for this
product. Python rails install its three packages directly from that tree and own both AutoGen modes:

- direct Assistant Cards use native `AssistantAgent`;
- team Cards use native `MagenticOneGroupChat`.

Saved Card configuration and graph edges define participants. LiquidAIty does not reconstruct private
Task/Progress Ledgers or add a TypeScript participant classifier. Mag One receives approved transient
Card input through the official MCP/Card boundary; it does not consume Main's internal subagents.

Every callable saved `magentic_option` worker remains in the native participant set. Native
Magentic-One selects speakers; there is no per-Run worker subset or Main-owned speaker order.
The saved Card subtitle supplies its native capability description without copying its prompt,
model, tools, memory, or execution configuration into a second agent. The worker still runs through
its saved-Card MCP adapter. Native public selection events, child identities, usage, terminal reason,
and secret-safe failures are output evidence, not a copied Task or Progress Ledger.

The current source retains that evidence and the final result through the existing Run artifact
catalog as `native-result.json`. Exhaustion (`Max rounds reached.` in pinned 0.7.5) is not successful
task completion. The native defaults are 20 rounds and three stalls; a saved override remains saved
Card authority. This source change is **not live-proven**: the September 3 full-team acceptance is
still gated on native characterization tests, and the saved two-turn override has not been changed.

The initial checked-in fork has no internal AutoGen divergence. Product authority and adaptation stay
in `apps/python-models`; any later fork edit must be registered in
`autogen-main/LIQUIDAITY_FORK.md` with tests and an update/removal strategy.

## MCP and transport

User-directed external MCP `card.update_configuration` uses the authenticated project context and
the existing field allowlist/revision-checked save. It requires no Builder task or approval. Internal
Card calls retain their saved grants and bounded Builder edit authority. Caller arguments cannot
assert the external-user privilege.

`apps/python-models/app/mcp_host.py` is the one official shared MCP host. Its public catalog is assembled
from current registered owners and is discovered dynamically. A fixed numeric catalog promise is not an
architecture contract.

The SDK initialization instructions direct GPT to `main.context` first, then published canonical
schemas and returned native evidence. This is connector entry guidance, not another saved Card
prompt or plugin package. Local source/test validation does not prove a cached external connector
loaded new instructions; reconnecting or publishing requires separate owner authorization.

Python rails pins OpenAI 2.41.0, the installed Graphiti MCP server's minimum, to retain its existing httpx
transport. OpenAI 3/httpx2 loaded standalone truststore after Windows pip-system-certs injected pip's
vendored copy, causing recursive SSL verification before provider requests. The pin restores actual
OpenRouter embedding/search and Graphiti ingestion without changing graph/model authority or disabling
TLS verification. Engraphis's long native semantic writes retain their scoped 190-second
engine and 210-second HTTP allowances through a 220-second outer MCP deadline; ordinary calls retain
the 30-second deadline. An earlier outer cancellation could lose a write result while the native write
continued, inviting a duplicate write. Existing affected links require separate data-quality repair.

The external GPT connector publishes every IDD `external-mcp` operation exactly once under its canonical
unprefixed ID. LiquidAIty is the app/plugin name; it is not a server-side tool-name prefix because ChatGPT
derives the client namespace from the selected app. Public, Card, catalog-reader, and stdio clients use the
same canonical IDs, schemas, grants, handlers, and receipts with no compatibility alias or duplicate registry.

The MCP host owns OAuth/resource metadata, catalog readiness, schemas, and dispatch. The canonical startup
launches ngrok directly against that one host; the tunnel is transport only and does not duplicate or gate MCP
metadata, catalogs, authentication, or application readiness.

The literal `LiquidAIty.idd` separates publication/access policy from native MCP side-effect annotations.
The published catalog keeps every known tool visible even when a Card disables it or its native source is
temporarily unavailable. `all_healthy` Cards receive every currently healthy bounded read/search/discovery
tool except their explicit disabled-read set; write/effect tools still require exact saved Card grants and
their existing confirmation gates. CBM remains the only product CodeGraph owner. Obsolete saved tool grants
stay visible as unavailable and fail honestly; there is no data migration or synthetic topology regeneration.
Catalog counts are startup/revision receipts, not fixed architecture promises. Cached GPT tool descriptors must be reissued in a fresh selected-
connector conversation; restarting an already-ready server does not replace a conversation-cached schema.
The `card.create` and `card.update_configuration` schemas carry the saved Hermes `subagentModel` field;
its available values come from the configured model catalog rather than IDD copies. Run-start readback,
not schema presence, proves materialization. Main Honcho setup/status uses the profile Inspector's explicit
native operation and is absent from Card create/update schemas.

Graph attention reuses AGE `USED_TOOL` events, `USED` native references and materialized `READ` edges.
The external-Main mapping is designed to establish an idempotent AGE observation Run under its existing
Main Card/conversation; no model runtime is launched. Missing persistence is explicitly reported in
the execution receipt. `agentgraph.inspect` does not observe itself; queries apply exact Run, Card,
conversation and Project/Deck scope before limits, and only event-backed completed calls count.
The existing attention endpoint also streams the same `session`/`native_attention` records for all
runtime surfaces. Card selection requests its current direct Run, excludes native-child observations,
and clears when dormant/finished. It introduces no Card-face payload, graph store or event bus.
Graphiti's existing queue retains observation identity; its public SDK completion result resolves the
same pending event with actual UUIDs. Queue acceptance is not rendered as a completed graph write.
Where native CBM declares a JSON output format, the host advertises and uses that default for structured
attention IDs. Explicit format choices are preserved; non-structured results do not fabricate attention.

Current proof boundary: real AGE 1.6 `EXPLAIN` tests accept the production `SET`/`coalesce` queries and
reject the former `ON CREATE SET` clause without inserting fixture records. Migration 028 completes the
existing producer's missing `READ` label through the existing PostgreSQL schema owner. It grants only
`SELECT/INSERT/UPDATE` on that label and `USAGE` on its sequence; the application retains no schema-create,
base-label access or READ-delete privilege. The canonical migration runner recorded it once and verified
an idempotent second pass. Inspection always executes the typed READ query, even with no selected Runs;
schema failure is explicit, not a metadata-based omission. Focused attention, SSE, bearer and UI-hook
tests pass. The canonical `npm run dev:fresh` now loads source revision
`07ec833e833bbf72c7f63d7a639d3446707969fc` and reaches readiness with 43/43 public tools. Loaded AGE
inspection and the existing SSE endpoint return 200; four retained Main
events replay chronologically with direct-only attribution. The existing UI projection consumes those
real SSE events without animating the completed Run. The saved Deck and all six Card and six edge hashes
remain unchanged. The authenticated external `cbm.list_projects` read at 2026-08-27T23:07:20Z also
persisted: AGE inspection and SSE return its exact external Main Run, conversation, Card and native
project reference, and the existing projection consumes the actual event. There is no proven missing
Run-registration defect. Native tool-read observations use `USED_TOOL`/`USED`; `READ` separately records
references resolved during canonical input materialization. This external tool read did not materialize
an input, so its `materializedNativeReferences` remains empty; literal input-materialization `READ`
proof is still separate. The August 29 connector failure occurred before dispatch because a server-side app
prefix duplicated the namespace ChatGPT already derives from the selected LiquidAIty app. The canonical
unprefixed catalog and dispatcher are the source-side repair. The official MCP SDK contract proves canonical
dispatch and bounded invalid-name receipts, but a loaded-process readback and a genuinely fresh selected-plugin
conversation remain separate product proof. ChatGPT owns its approved app-action snapshot;
refresh or recreate/publish that app definition through the applicable workspace control after a public schema
  change, then test from a fresh chat with LiquidAIty selected. Browser rendering and one real Codex-account
  Team Run also remain unproven. Do not call the complete launch path live-ready.

The official Python MCP host reaches server-owned Card, conversation, Run and persistence operations
through the domain routes documented above. It remains one MCP server. The September 10 source
migration moved Python and browser callers together and retained authentication, schemas and timeouts.
No external persisted consumer of the old global Coder HTTP prefix was identified. The September 10
canonical reload supplies loaded route/catalog readback; fresh-connector and agent execution proof
remain separate from those reads and the passing source tests.

Unknown tools, missing grants, unsupported runtimes, provider failures, and missing relationships fail
honestly. There is no server-side app prefix, prefix-stripping alias, provider substitution, duplicate
registry, or direct-database shortcut.

## Card Inspector projections

The approved configuration target is one IDD-backed field and option projection for the Card editor and
Agent Builder's template/configuration tools, including custom Card UI configuration. Current source
partially meets that target: `materialize_runtime_options` and `materialize_card_editor` now resolve
the same IDD field definitions against executable schemas. Focused tests pass; loaded proof, complete
field coverage and shared creation/validation remain incomplete. The added Team settings overlay is removed.
Live MCP/model catalogs retain their existing owners and are referenced through this shared projection.

Ordinary Cards have CLI, Prompt, Runtime, Memory, and Tools tabs. Main and Agent Builder open on Prompt
without a CLI tab; the existing Main chat and Builder pull-up CLI retain their input/session ownership.
CLI remains the ordinary Card Run/session projection, without a second invocation path. Prompt exposes
the saved bracketed and Markdown sections as independently editable blocks, including unrecognized and
repeated headings. Editing one body preserves other bytes; code-fenced headings remain literal text.
Unsectioned text is Instructions, not Role. The profile Soul and output-contract editors retain their
separate existing owners. Runtime contains parent
and subagent model selections plus Delegate task. Memory contains
installed skills, the profile learning graph, and the existing external-memory control below them.
`HermesSkillGraph` imports the unchanged Hermes desktop `starmap` simulation and Canvas renderer directly;
the previous custom SVG implementation is removed. The import boundary and production build pass;
real graph-node editing and complete save-on-leave persistence acceptance remain unproven.
The Description editor, profile-status panel, runtime conversion selectors, and Card-control checkbox
are absent from these settings. Saved bindings and canvas authority remain separate.
Tools retains saved grants and modes, with the existing Python Script editor below the list. The saved Python recipe
compiles into one typed optimized model tool that may call only Card-authorized operations; Hermes decides whether to call it.
Card configuration has no added Team policy controls or status panel. Historical overlay values remain
readable saved data, but are neither validated as runtime policy nor sent to execution.
Main still uses chat for input and responses.
Coder's Card invokes its existing Run path and focuses the external Code Console, where the attributed
Card Run view is distinct from the existing interactive native CLI session. No terminal is embedded in
Coder's Card. There is no global Kanban workspace, manual task movement, or Card `kanban` execution doorway.
Native Team workers remain execution processes observed through the existing Card Run and telemetry paths.
Ordinary agent Cards use the shared adaptive terminal, while Mag One remains an orchestrator.

`apps/backend/src/contracts/runtimeEvents.d.ts` is the shared public presentation contract.
`hermes/cardTerminal.ts` projects existing ACP turns, native transcript replay, native Team task/attempt records,
and Python Run/AGE lineage. The frontend renderer does not become a runtime, transcript store, or source
of agent capability. Native memory, tools, skills, orchestration, and grants remain with their existing owners.
Main's graph callbacks and technical events use the backend-issued Run identity; the browser does not
mint a competing Run. Native tool-call IDs are shared across live events, status and replay, with changed
partial output updating in place. Transcript commands verify Project, Deck, Card and Run identity and
serialize against native session configuration and execution inside the existing ACP owner.
For Main, `conversation.input` and `conversation.answer` feed Chat only. Existing structured
`execution.*` projections feed the lower terminal only, both live and on browser reload. Stable projection
IDs reconcile repeats; raw text, ANSI output, DOM hiding, and content matching never decide routing. The
terminal row summary uses a constrained two-column layout so its name and status stay intact, with long
structured detail available only in the existing expandable body.

The Script editor's optional ThinkGraph and KnowGraph examples are source templates only. They call the
canonical `engraphis_recall_context`, `engraphis_get_memory`, `graphiti.search_nodes`,
`graphiti.search_memory_facts`, and `graphiti.get_episodes` operations through the existing Script tool
contract. There is no `think.context`, `know.context`, `code.context`, graph-recipe registry, or second graph
execution owner. Script failure may restore the exact selected MCP presentation only before any operation
has begun; once a tool receipt records an operation, failure is terminal so the model cannot replay it.

Current limits are explicit: some native sessions contain multiple Runs without per-Run transcript
boundaries; exact Run transcript read/deletion is unavailable in that case. Main technical replay survives
browser reload while the startup-owned backend bridge remains alive; a full backend restart does not yet
reconstruct structured execution projections from a second store. Public skill/autoskill events and full
Team worker tool output are not yet integrated.
The AutoGen adapter returns completion output rather than a live public terminal stream. These are
observation gaps, not restrictions on native execution. Loaded-runtime proof remains separate from tests.

## IDD and transient Card calls

`LiquidAIty.idd` is the source of composable Agent Builder data: types, named objects, templates,
relationships and LiquidAIty effect/publication annotations. It is not an authenticator, checksum gate,
native catalog owner or a competing IDF schema. Python reads this data mechanically; Pydantic owns
executable transport contracts. The existing tool registry takes one startup projection of effect
metadata; ordinary Runs do not load the builder palette or use its visibility as grants.

Main leads Chat and may propose composing agents. After user agreement, Main directs the dedicated
Agent Builder Card to perform IDD-backed construction/configuration with reusable templates or custom
typed objects. Saved grants and current native discovery determine available CodeGraph tools;
this document does not impose a second capability list. Follow `skills/codebasedmemory.md`
for coverage and direct-source discovery. Local Coder never receives the full Builder dictionary. Live proof of
the guided Agent Builder interaction remains outstanding.

Hermes is the runtime platform. LiquidAIty composes and contextualizes its native systems through
saved Card identity, selected capabilities and exact Run input; it does not duplicate native catalogs,
profiles, tool execution or worker scheduling. ACP receives a projection, never the IDD dictionary.
One Hermes Card configures one native agent/profile; native subagents remain children of that agent,
not newly saved Cards. Native prompt/model/tool/profile sections retain their native owners. The approved five-tab consolidation remains in progress; existing non-Hermes saved bindings
are preserved without adding aliases or a second execution path.

### Card-managed subsystem attachments

An ordinary saved Card may declare product-neutral `runtimeOptions.subsystems` entries. Each entry names
one Python adapter contract, its bounded `state`, `events`, `commands`, `artifacts`, and `readiness`
capabilities, an optional structured-configuration schema, and whether the subsystem's named Card tab is
visible. The declaration is saved Card configuration; it does not start the subsystem, create an agent,
grant a tool, or replace the subsystem's native lifecycle. Python rails validate the same
`card-subsystem.v1` structure before a Card can run. Agent Builder may change an attachment only when the
exact attachment value and field are present in the current Run's edit authority.

| Surface | Owns |
| --- | --- |
| Card/IDF workspace | Agent identity, stable prompt, Hermes profile/model/runtime, tools, skills, memory policy, Team policy, graph context, dynamic mission, Script, wires, and presentation attachment |
| Named subsystem Card tab | Native adapter contract, capabilities, readiness, lifecycle, and native-agent policy; never the end-user dashboard or another Card editor |
| Agent UI | Live domain product: observations, dashboards, charts, evidence, artifacts, status, and authorized interventions |
| Agent UI Inspector | Durable domain settings such as risk, cadence, chart density, broker references, and subsystem parameters; never the agent prompt, model, skills, or tools |

The preferred composition is Python-first: saved Hermes Card -> one saved Card Script -> a bounded
LiquidAIty Python adapter -> the repository's public Python API or public protocol. A JavaScript,
TypeScript, Rust, or other subsystem remains compatible when its supported public HTTP, MCP, stdio, gRPC,
or file/artifact contract is reached through that Python boundary. The adapter may supervise an existing
agent system without flattening its workers into saved Cards. Any subsystem-owned model calls must be
disabled unless they execute through the saved Card's account-backed Hermes authority; no end-user
provider credential is introduced.

Multiple Cards may use the same subsystem kind or the same connected Magentic-One support team. Their
Card IDs, profiles, sessions, memory, configurations, Scripts, Runs, and subsystem state remain isolated.
For Trading, this permits multiple sandboxed strategy Cards with different theses and risk envelopes to
reuse ordinary source, processor, and support Cards. System 3 Cards remain protected and are not this
support grouping. Paper results may be compared by a separate evaluator, but no result promotes a Card to
live trading or changes broker authority.

The current Trading UI is scoped to `card_trading_workbench`. Add trade is its initial tab and opens
a searchable TradingView chart, followed by Portfolio and Journal. Portfolio is a responsive collection of
TradingView candlestick charts for its recorded trades, opening one selected trade into a large chart.
Journal combines each trade's plan with recorded events and fills. Settings remain in the existing UI
inspector through its shared edge pull tab; agent configuration remains in the canvas Card.
The owner's target is for Enter to add a chosen trade to Portfolio
and Exit to remove it. Those two controls remain disabled until that persistence path is implemented;
they must not be treated as broker-order or agent-start/stop commands.
The layout is not proof of autonomous paper execution. The current adapter reads broker state and records
plans/decisions; its fixed local lifecycle replay does not establish configurable paper trading.

Trading lifecycle receipts are Python-owned deterministic results persisted under the saved Card and
Card revision after both identities are reread from canonical Card storage. The database stores the fixed
paper-only mode, normalized state/events, artifact metadata and completion/failure truth. The authenticated
backend transports the initial snapshot, SSE reconciliation stream and fixed local-proof command; the UI
does not manufacture broker or lifecycle activity. Runtime migrations intentionally do not add foreign-key
authority from lifecycle tables into protected Card tables because the least-privilege runtime migrator
does not own them. Canonical Card deletion performs the corresponding explicit inverse-reference check.

Python Card Script source is retained in the existing Card runtime-extension field with version,
source/compiled hashes, palette fingerprint, compiled bounds, validation state, native support and
rollback identity. The same Monaco Python editor appears on every Card only in Agent Builder. It obtains
current IDD/native contracts through a bounded backend projection, but autocomplete and executable
handles are limited by the Card's effective Tools-tab selection. Human Card Save remains the existing
deck/revision path. Script mutation through MCP additionally requires the authenticated caller to be the
saved Hermes Card whose profile is `liquidaity-agent-builder`; it cannot rewrite its own active Script.

Python rails parses the source without execution, requires one literal `CARD_SCRIPT` object, safe imports,
one or more `output.emit()` calls and literal `tools.call()` IDs, then validates those IDs against the
effective saved Card grants. Under `all_healthy`, implicit healthy reads are authorized for Script use but
default to `OFF`; only explicitly saved tools default to `AGENT`, and a literal Script assignment may move
an authorized tool to `SCRIPT` or `BOTH`. A valid Hermes Script projects one compact
`execute_host_script` definition plus the `AGENT`/`BOTH` tools it does not wrap; wrapped component schemas
are absent from the model request. Blank, disabled or invalid source projects the Card's ordinary saved MCP
presentation. A native Script failure before any operation begins may remove the compact definition and
activate only its already-registered wrapped handles for the current model iteration. Once an operation has
begun, failure is terminal and cannot replay through the model. Neither mode exposes IDD, `all_healthy`, or
the complete catalog. Hermes' native `web_search` remains outside the MCP alias/state projection; a Script
cannot take it over as a LiquidAIty MCP handle.

Hermes freezes the source/version/hashes/schemas/aliases/budgets in trusted session configuration before
the turn. The external LiquidAIty plugin executes that immutable source through Hermes'
`tools.code_execution_tool.execute_code`, existing local child process, tool RPC, approval gates, timeout,
termination and secret scrubbing. Canonical aliases are mapped to already-registered native tool names;
the child receives no registry, token, filesystem, shell, network, database or credential handle. Ordinary
`execute_code`, CLI and remote execution behavior remain unchanged. Native tool events return the Script
identity, timings, output status and underlying canonical/native tool-call receipts on the Card Run.

IDD responsibility reduction:

| Previous responsibility | Current owner/disposition |
| --- | --- |
| Duplicated IDF/graph/Card/model records | Executable Pydantic contracts; duplicate IDD validation deleted |
| Fixed model list and editor-control dictionary | Native/configured models and transport schema projection |
| Bracket-island parser | Deleted; Markdown and Python source are not a second mixed-language runtime |
| Native tool descriptions/schemas/availability | Current native discovery; IDD retains only host effect annotations |
| Global readable-tool allocation | Deleted from host, ordinary Card, registry and native Team worker paths |
| Runtime template defaults/override writer in selected-Card editing | Removed; saved configuration wins, old overrides read only |
| Initial new-Project/quick-add templates | Retained seed compatibility; not runtime authority |
| Random card.create template IDs | Explicit construction reference or compatible custom-assistant template; persistence does not reload IDD |

```text
capability = native availability ∩ saved Card/profile selections ∩ Run grants ∩ required approval
```

Routing IDs and telemetry remain outside `in.idf`. PostgreSQL retains the existing Run artifact metadata;
the artifact path identifies the one exact retained input file.

`write_mag_one_instructions` loads exact text directly into the saved Mag One Card's transient
CLI input editor. It is not a proposal document, materializer, or store. It resolves the one saved
Mag One Card read-only and returns that Card identity with the exact mission. In an active Agent Builder
session, the existing Hermes tool-result/SSE path places the text in unsaved per-Card React state.
It creates no Run, revision, hash, approval object, or saved prompt and never starts AutoGen.

`card.load_graph_references` is the review-only Card-editor loader for native graph pointers. The MCP host injects
the trusted source Card/Run/project/deck identity; the caller supplies one target Card, native identity,
reason, order, and bounds. Python rereads the current native authority, returns actual transient context
to the target Card's existing Knowledge tab, and records the proven read/handoff on the source Run in
AGE. It never materializes an IDF or starts a Card. The outer Mag One Card is materialized only when an
automatic handoff or reviewed manual submission runs it; each saved worker Card then materializes its own
task through the same receiving-Card path.

Saved Hermes Cards remain four distinct persistent agents: Main, Agent Builder, Local Coder, and Graph Agent.
Each Card maps one-to-one to one native Hermes profile and may invoke the existing automatic Kanban Team; there is
no second product persona/profile layer. An enabled outgoing orange `flow` edge grants the source's native
`delegate_task(role="profile")` exact target profile; it never starts work by itself and its reverse direction
is not implied. Blue `magentic_control` and `magentic_option` edges authorize only Magentic-One. The host maps
the selected native profile back to its saved Card outside model input, and the private
`card.run_assistant_agent` handler remains the one canonical receiving-Card Run/IDF owner rather than a
second model-facing tool. Local Coder is eligible only through Magentic-One's saved `magentic_option`;
Agent Builder has no Magentic-One edge, and Graph Agent has no outgoing saved-Card delegation grant.
Each direct call uses the receiving Card's saved Hermes profile and
one explicit mission plus selected native graph references carried as the existing optional `dataAnchors`
selection. This is the normal automatic handoff and it
executes immediately through the canonical receiving-Card Run path. Python rejects copied parent context,
message windows, prior-result packets, and caller-authored native-reference bodies; it rereads each
selected native identity and resolves current graph data before the one graph-first IDF materialization.
Main's Hermes memory remains private to Main. The root Run retains only its one exact `in.idf` runtime-input
file through the existing artifact catalog. Native Hermes subagents remain an
optional per-Card/profile capability; they do not replace these saved Cards or become AutoGen Assistants.
When the user requests review first, `write_mag_one_instructions` and `card.load_graph_references` load the
mission and bounded selection into the existing target Card editors. One later manual Run uses the same
canonical receiving-Card path; review never creates a second input or executes twice.

The serialized `in.idf` order is fixed: actual bounded native graph data and provenance; stable receiving-
Card context from PostgreSQL; selected tools and effective saved grants; then the current dynamic mission
and images. `apps/python-models/app/python_models/idf.py::materialize_idf` is the sole materializer.

## Graph owners

| Graph | Native owner | Meaning |
| --- | --- | --- |
| ThinkGraph | Engraphis through the Python-rails adapter | project reasoning and operational memory |
| KnowGraph | Graphiti/Neo4j/Python | sourced knowledge, evidence, and provenance |
| CodeGraph | native codebase-memory-mcp | repository structure and impact |
| AgentGraph | Apache AGE/PostgreSQL | Card relationships, delegation, Runs, tools, references, artifacts |

No owner copies another graph into itself. Context uses native IDs, bounded selections, and provenance.
AgentGraph observes execution; it does not own Card configuration or runtime lifecycle.

Engraphis is pinned to Python package `engraphis==1.7.1`. Python rails owns the one `MemoryService`
against `db/thinkgraph.sqlite`. Its immutable local embedding selection is
`sentence-transformers/all-MiniLM-L6-v2`, revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`.
Engraphis supplies graph scenes; the application no longer supplies authored graph objects through
added MCP fields. The adapter preserves Engraphis's configured graph extractor (package default:
regex) and connects its `StructuredLLMExtractor` to the saved ThinkGraph Card's existing account/model
through the private completion transport. The regex component performs heuristic entity extraction;
it is not merely preprocessing. The LLM extractor distills supplied material into facts. Failed LLM
extraction may return package-marked text chunks; that is not successful structured extraction.
The custom `ConversationMemoryService`, full dashboard mount, and automatic completed-conversation
intake are removed. Main chooses explicit notes, corrections, links, or a focused delegation to the
saved ThinkGraph Card. Operating instructions live in those Cards. Normal local-agent writes retain
the package's immediate eligibility; no application human-approval queue is added. Engraphis retains
its own handling of external/untrusted input. The graph entry's Remove note action calls Engraphis
retirement and reloads the scene. Retirement preserves history; it is not permanent erasure or an
arbitrary entity/edge deletion operation. Provider-backed semantic quality remains unproven after
this repair. Retention supervision remains disabled.

### Main-to-graph entry alternatives and remaining quality risks

Post-chat pairs, direct notes and delegation answer different questions. A pair specifies source
material; delegation specifies who interprets it; an automatic trigger specifies when it happens.
A focused ThinkGraph assignment can receive an attributed pair without restoring the removed
always-on conversation hook. The owner reopened pairs for comparison on September 10. No automatic
intake, historical replay, new queue or ThinkGraph-to-KnowGraph promotion was enabled.

Direct `engraphis_remember` embeds/stores Main's supplied note and performs native conflict resolution
and eligible graph enrichment. It does not invoke the structured LLM fact extractor. `engraphis_ingest`
invokes that extractor using the saved ThinkGraph Card's account/model through the private completion
route; it does not by itself execute a full ThinkGraph Card Run or use that Card's entire saved prompt.
Delegating to the ThinkGraph Card adds its own model/tool loop, which may then call ingestion and incur
another extractor completion. Count actual provider requests across both paths when measuring cost.

The native graph writer can feed validated structured entity/relation metadata and then its configured
regex extractor for the same memory. Regex recognizes capitalized names, email/mention/tag forms and
relations from names near a recognized verb (a 60-character window on each side). This is heuristic
semantic extraction, not just text cleanup. Its stopword list does not establish acceptance, speaker
identity, negation or temporal correction. It is a plausible contributor to noisy entities or wrong
relationships, not proof it caused every historical bad graph. No vendor regex/policy was changed.

A memory-free call to the installed `RegexGraphExtractor.extract` demonstrated a specific negation
error: both `Acme uses Graphiti.` and `Acme no longer uses Graphiti.` return the same positive
`(Acme, uses, Graphiti)` relation. This is a native heuristic limitation, not a stale test expectation.
The diagnostic opened no graph store, called no model and retained no product data. It does not prove
that every end-to-end ingestion preserves that incorrect relation; native conflict resolution,
structured metadata and projection must be inspected separately in the later authorized comparison.

Native enrichment failures can be warned while the note remains stored; ingestion can return marked
passthrough/text chunks after extraction failure. A write receipt therefore cannot establish useful
structured graph creation. The UI intentionally hides memory-only nodes and weak co-occurrence edges;
successful recall and a visually sparse scene can coexist. Inspect native notes and evidence before
concluding that an invisible note was lost or changing the accepted graph presentation.

Engraphis also retains upstream secret rejection and trust/quarantine/conflict-resolution policies.
The app does not insert an approval queue for ordinary trusted local-agent notes. These native policies
are separate from the retired application prompt filters; changing them needs specific evidence and
vendor-boundary review. Do not claim all filtering or deterministic logic has been removed.

KnowGraph ingestion remains sourced research through Graph Agent and Graphiti. Distinguish web fetch,
source content, queued episode, completed entity/fact extraction and later retrieval. An accepted URL
or queue response proves neither extracted knowledge nor a useful answer. Main currently has Graphiti
reads, while Graph Agent has `graphiti.add_memory`; Main's answer alone is not automatic retention.
The MCP boundary rejects caller-supplied Graphiti group scope and injects authenticated project scope;
Engraphis similarly binds workspace. This is inspected structural protection, not complete cross-tenant
penetration-test proof for every native-ID lookup or native file/browser capability.

The recommended first comparison is existing direct entry versus one focused extraction/delegation
alternative on a small set of real attributed material, followed by independent later Main recall.
Keep the candidate pair boundary explicit and compare regex separately rather than changing source,
worker, model and extractor together. PLAN defines isolation prerequisites and quality/usage criteria.
No new model work, graph writes or quality improvement was measured in this review.

`engraphis.py` derives the exposed schemas from native classic/smart MCP tools. IDD owns publication
and effect policy. The authenticated project supplies workspace identity. The source catalog contains
35 classic tools plus nine smart-interface tools, with two shared names,
for 42 distinct names. Shared names use the classic argument contract. Repository, session, and
visibility arguments remain Engraphis fields; they are not silently removed. Gateway capability
execution binds the same project when the discovered action has a workspace parameter. This uses
the installed package's private capability resolver and must be checked when upgrading Engraphis.

`engraphis_recall_context` retains the application's read-only recall contract: the engine runs
without reinforcement or receipt writes, and returned sources retain titles and provenance.
Its read-only/idempotent annotations describe that application behavior.
Its complete argument schema remains exposed; the package response-budget helper applies the requested
response limit. Other tools retain their package behavior and annotations. Semantic unavailability
fails honestly. Synchronous native work runs off the shared HTTP event loop. Semantic writes retain a scoped
190-second MCP allowance; ordinary reads and the two-second Main preload keep their existing budgets.
This does not make cold embedding initialization fit inside preload.

The MCP host and `data_anchor.py` exact-reference hydration call the existing Python-rails operation
route. They never create another memory service. A bounded exact read preserves native IDs, directional
composite link identities, reasons, layers, and provenance in the receiving Run's canonical IDF. Native
memory links have no supplied numeric strength or agent-authorship classification; the projection must
not invent either. `thinkgraph_analysis.py` and its original test are restored: they calculate NetworkX
communities and centrality from supplied topology without creating stored knowledge. The active Engraphis
scene does not call that helper; it keeps the engine's own layout and analysis.

The optional Question/evidence contract is retained; ordinary entities, thoughts, and relationships do
not require a Q&A workflow. Saved-agent attribution, current-source research, synthesis, and restart/UI
acceptance are tracked separately in PLAN.md. The owner's subsequent recovery instruction authorizes
removing obsolete Constellation code and dependencies now; this does not turn partial product proof
into success. The old adapter and bridge are removed, with no fallback or dual writer.

## Native attention and Reveal

`useAgentBuilderGraphAttention` consumes compact attention events from real graph/tool activity.
`KnowledgeGraphFramework` selects ThinkGraph, KnowGraph, and CodeGraph. CodeGraph renders through:

```text
/agentbuilder
→ AgentBuilderRail Graphs control
→ CompanionSurfaceHost
→ KnowledgeGraphFramework
→ NativeCodeGraphSurface
→ embedded GraphTab
→ GraphScene
```

`NativeAuthorityGraphSurface.tsx` converts bounded native projections without changing native IDs.
The embedded CodeGraph view remains present. Its existing read endpoint obtains selected symbols and
directed relationships through app-published `cbm.query_graph` on Python rails. Stored qualified names,
node IDs, edge IDs and relationship types are read from the query result. The browser renders those
records and decorates matching IDs with activity; it never reconstructs edges from call-tree rows.
The table decoder validates the CBM column contract and rejects changed formats. Empty reads remain empty.
The former standalone CBM UI app/package/demo shell and duplicated UI
primitives are intentionally absent.

ThinkGraph retains this data authority chain:

```text
Engraphis SQLite
→ Python-owned MemoryService and bounded projection route
→ backend proxy
→ GraphProjectionV1
```

The September 9 replacement imports Engraphis 1.7.1's unmodified Every-node WebGL2 renderer
and its unmodified layout worker. ThinkGraph selects the package's `radial` preset; KnowGraph
selects `original`. This is the shipped renderer embedded in the existing application surface,
not the complete Engraphis dashboard. The app retains its tabs, shared 24px paper, zoom/fit
controls, stored-evidence inspector, and exact-ID context selection. It supplies records and
selection/highlight IDs; it does not implement node painting, label placement, layout forces,
clustering or semantic extraction. The former modified `engraphis-graph.js` is deleted with its
custom rendering API extensions. The package handles pointer/keyboard navigation and rendering;
app zoom buttons forward the package's own +/- keyboard controls. Relationships are inspected
from an entity's stored relationship list. Attention may highlight an existing ID through
`setHighlight`; the removed renderer's custom per-edge colour and edge-click extensions are absent.
Activity/evidence refresh does not call `setData` again unless entity/relationship topology changes.

ThinkGraph requests Engraphis's complete scene with memory nodes and weak co-occurrence disabled.
The full scene preserves engine-supplied relationship support references; the compact `all` payload
omits those references and is not used as the inspector's evidence source. Engine capacity errors
remain errors, not truncated or fabricated replacement graphs. The account extraction adapter supplies
Engraphis's own JSON output schema through its supported `extract_json` interface. The engine's
context argument frames both messages as one evolving project exchange and includes the engine's
2000-token recall context, read before extraction without reinforcement or receipt writes. There is
no extra extraction model, regex cleanup, or browser knowledge writer. Prompt quality still requires
actual account-backed conversation acceptance; passing structural checks is not that proof.

The owner explicitly authorized clearing the rejected dataset again on September 9: Engraphis deleted
8 memories in project `1b1a6958-0658-4b1a-bf13-e2066582adb4`; the same project's Graphiti group deleted
13 nodes and 26 relationships. Both returned empty afterwards. The 7,284 unrelated Neo4j nodes were
unchanged. Conversations, Cards, libraries, CodeGraph and other projects were not deleted or replayed.

KnowGraph projection reads first select a deterministic, project-scoped node window (default 200,
maximum 500), then return only relationships whose endpoints are inside that window (maximum 1,000).
Embedding-vector properties are excluded from projection and expansion payloads while native UUIDs,
element IDs, provenance, and all non-embedding properties remain intact. Graphiti's native bounded MCP
reads remain the semantic search doorway; the UI projection is not a bulk database export.

Valid activation events include native query results, selections, delivery/consumption, traversal,
writes, and run completion/failure. Answer prose and hidden reasoning are never telemetry.

## Persistence

- PostgreSQL: Projects, saved Cards/revisions/grants/facets, provider/model references, conversations,
  Runs, and artifact metadata.
- AGE on PostgreSQL: saved Card relationships and execution/reference observations.
- Hermes profile stores: native `state.db`, optional built-in memory files, one selected external
  provider authority, profile skills/usage, and Kanban/project stores where that profile uses them.
- Neo4j: KnowGraph/Graphiti only.
- Engraphis SQLite: active ThinkGraph records, native relationships, provenance, and semantic embeddings.
  Retained old Constellation files are not active data authority and are not incidental cleanup targets.
- The checksum-pinned native CBM binary under LiquidAIty AppData: CodeGraph. Its official daemon, watcher,
  embedded UI, and disposable cache remain outside the repository; the Python MCP host owns the only stdio
  frontend. Docker does not own or launch CBM.

No cleanup task may reset or reseed these stores.

## Repository and dependency ownership

The root npm workspace owns root, `client`, and `apps/backend` through one `package-lock.json`. Separate
locks under upstream-managed Hermes and independently versioned imported roots remain owned by those
projects and are not part of ordinary Core v0 install. The checked-in AutoGen Python packages are
installed only through `apps/python-models/requirements.txt`.

`.npmrc` disables dependency lifecycle scripts, saves exact direct versions, and requires npm locks.
`.nvmrc`, `engines`, and `packageManager` carry one Node/npm pin. Prisma generation is an explicit
first-party command after install; it is never enabled as an install hook.

Python dependency owners remain:

- `apps/python-models/requirements.txt` for official MCP, deterministic Card/IDD/AGE rails, and AutoGen;
- `services/knowgraph/requirements.txt` for Graphiti/Neo4j;
- `services/esn_rls/requirements.txt` for the separately retained ESN service boundary.

The canonical `C-Projects-LiquidAIty-main` Codebase Memory project indexes the exact source allowed by the
root `.cbmignore`. It indexes the canonical host checkout `C:/Projects/LiquidAIty/main`; no alias or second root
exists. Runtime homes, credentials, virtual environments, caches, builds, and excluded vendor/imported trees
remain outside the derived projection. Indexing never transfers vendor ownership or relaxes the controlled-
vendor patch law.

## Canonical startup

`npm run dev:fresh` is the only supported full-product start. It uses the already-installed LiquidAIty-owned
Hermes entry-point plugin in the preserved Hermes environment, stops the six product ports, creates one
ephemeral internal MCP secret, and supervises frontend `5173`, backend `4000`, AutoGen rails `8003`,
KnowGraph `8001`, official MCP `8765`, ngrok inspector `4040`, and the Hermes gateway. The gateway and
every backend-launched Hermes child receive an environment with the host-only signing secret removed.

Component commands remain private children of that tree. A partial service start is diagnostic only and
is not product readiness proof.

Tunnel publication requires the existing `/health/ready` owner's successful HTTP status and complete
CodeGraph readiness, matching public resource/scope metadata, the canonical anonymous OAuth challenge,
and a successful catalog read through the backend's existing authenticated MCP client. The tunnel owns
neither a credential nor an MCP/native process. These checks do not prove model execution.
The tunnel preserves ngrok's existing request-inspection behavior and Authorization headers. The sole
local owner accepts that the local inspector may retain request headers as a local-development risk;
this is not a GPT plugin readiness blocker. Do not print, copy, export, or replay captured credentials.

## Controlled vendor divergence

The final September 9 owner decision replaces the application drawing callbacks with the unmodified
Engraphis 1.7.1 `dashboard_assets/engraphis-graph.js`, plus its shipped D3 7.9.0 and force-graph 1.51.4
assets in `client/src/vendor/engraphis`. Source: installed PyPI distribution `engraphis==1.7.1`.
The renderer SHA-256 is `a76d482781de76bccdf8e3955fadf6e8b2de71129511e90f3832b30de78bbde0`.
There are no vendor edits or replacement drawing/physics functions. The owner rejected Galaxy/Cyber
startup visuals and then the radial preset; the host uses the public setters for `original` on both graphs,
`classic` style and enabled labels. Preset force/size values remain Engraphis-owned. The host supplies graph
records, selection callbacks, existing inspection and navigation. ThinkGraph transports the complete
Engraphis scene, including its engine-owned layout metadata. Graphiti records use supported field
aliases. CodeGraph remains separate. Asset upgrades require comparison with the installed package;
these copies add distribution maintenance, not a second graph algorithm. Loaded data acceptance is
separate from empty-render and transport checks.

The owner requested no product-name or profile-name prefix in the embedded terminal UI.
`Hermes/cli.py::HermesCLI._get_tui_prompt_symbols` therefore renders only the native skin symbol.
The existing skin hook controls the symbol but cannot suppress the hardcoded profile prefix;
changing that display method avoids renaming saved profiles or filtering terminal output.
Profile selection, sessions, memory, model/tool authority, prompt assembly, and native input remain
unchanged. The upstream is the pinned NousResearch Hermes fork described below. Proof is
`Hermes/tests/cli/test_cli_skin_integration.py::TestCliSkinPromptIntegration` plus live terminal
readback after reload. The fork cost is one removed display block; rollback would restore that block
only, and an upstream profile-label display setting would allow removing this divergence.

The September 9 owner request also removes the classic CLI's rotating idle composer example.
`Hermes/cli.py` no longer selects an example during initialization and its idle `_get_placeholder`
branch returns empty text. The pinned upstream has no display setting for this example. Command,
approval, secret-entry, voice and parked-draft hints remain native; input, model selection, prompts,
profiles and sessions are unchanged. Validation uses the existing CLI skin tests and a live idle
terminal check. The fork cost is two small display blocks; rollback restores only example selection
and its idle display. No terminal-output filtering or replacement renderer is involved.

Hermes is the vendor boundary shared by the internal Hermes Cards. LiquidAIty-owned integration
stays in the backend adapter whenever possible. Any Hermes edit must remain narrowly recorded, tested,
and justified against an unavailable upstream adapter/configuration hook.

The current contained divergence tracks stable release `v2026.8.31` of
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) (package version `0.21.0`)
at upstream commit `29112bef099274229cadff79cdff7bf7b99c4b77`. The 2026-09-06 update integrated
reviewed upstream changes against base `6ce7ab8bfb3fce3ba116f52a11a438d6c7e4c03d`, retaining all
24 individually reconciled overlaps and the 53 local paths enumerated in the preserved snapshot.
The existing patch register records the retained seams, verification limits and later upstream PR intent.
This source update does not implement asynchronous application profile delivery or restart interrupted work. ACP has no native host contract for publishing a bounded
session tool surface or allocating an execution context before a native child starts, so
`Hermes/acp_adapter/host_profiles.py` plus marked hooks in `acp_adapter/session.py`,
`acp_adapter/server.py`, and `tools/delegate_tool.py` accept only trusted
`_meta.hermes.sessionConfig`, the generic `_session/configure_host` ACP extension, and generic child
lifecycle requests. The extension contains no LiquidAIty Card types, product policy, or credentials.
The backend projects each top-level saved Card's prompt, model, native toolsets/tools, and official MCP
connection into its stable native session. Native Hermes' `ephemeral_system_prompt` is the only
session-scoped prompt hook; Hermes still owns prompt assembly. Native subagents inherit the bounded
parent ceiling and remain Runs of the owning Card. Sessions without the metadata retain upstream
Hermes behavior. Focused no-provider tests live in
`Hermes/tests/acp_adapter/test_host_profiles.py` and `Hermes/tests/tools/test_delegate.py`. The generic
child execution-context extension additionally touches `Hermes/tools/mcp_tool.py` so official MCP 2
per-call `meta=` carries only an opaque host-issued context ID. A separate one-condition correction in
`Hermes/acp_adapter/tools.py` preserves Hermes' generic structured `tool_error()` status across ACP;
its focused proof is `Hermes/tests/acp/test_tools.py`. The complete rollback and upstream-contribution
plan is owned by `Hermes/LIQUIDAITY_VENDOR_PATCHES.md`. Hermes is pinned. Updating, refreshing,
downloading, replacing, rebasing, or reinstalling Hermes is prohibited unless Jeremiah explicitly
requests a manual Hermes upgrade in the current message. Git save, Git checkpoint, commit, startup,
testing, and general maintenance never imply that request. Only during a separately requested manual
Hermes upgrade, remove a divergence if upstream supplies the equivalent public hook; otherwise reapply
only its marked symbols and rerun the registered tests.

ACP also has no read-only persisted-transcript or host-owned deletion method: standard `session/load` restores executable
runtime state and registers supplied MCP servers before replaying history. The contained generic
`_session/read_history` extension accepts only a native `sessionId`; it reads native persisted
messages and emits the existing ACP replay updates without constructing an agent, configuring a
model/tool/MCP surface, minting authority, or mutating persistence. LiquidAIty's browser history route
uses only the saved Main Card's Hermes profile and opaque session key to locate that transcript.
The companion `_session/delete_history` accepts that exact resolved native session ID, refuses an
active turn, and uses Hermes' existing session manager deletion; the UI/backend never opens the
native database directly or creates another transcript authority.
ACP also does not distinguish streamed model text from deterministic command/status prose. The
contained model-origin patch tags only native model chunks and returns the exact final persisted
assistant text through ACP `_meta`; the backend ignores untagged prose for transcript authoring and
the browser reconciles the completed streamed bubble to those exact native bytes. Provider-exposed
reasoning and tool events may appear only as transient UI activity outside the transcript.
Actual Main/Coder/helper execution continues through standard session creation/load followed by the
trusted `_session/configure_host` boundary with a real per-Run execution context. The exact patch,
test, upstream-contribution, and rollback records live in `Hermes/LIQUIDAITY_VENDOR_PATCHES.md`.

A Windows process-lifecycle correction in `Hermes/tools/environments/local.py` routes the pre-search
Git Bash health probe through Hermes' existing bounded process-tree helper. The bounded-probe caller
in `Hermes/hermes_cli/_subprocess_compat.py` supplies a shorter Windows cleanup allowance through the
optional parameter in `Hermes/agent/deadline.py`; every ordinary tree-kill caller retains the existing
15-second default. It changes no tool, shell, workspace, or provider policy and prevents an MSYS
descendant holding a captured pipe from pinning native file-tool initialization beyond the declared
probe timeout. Focused proof lives in `Hermes/tests/tools/test_find_shell.py` and
`Hermes/tests/tools/test_file_tools.py`; rebase and rollback details live in
`Hermes/LIQUIDAITY_VENDOR_PATCHES.md`.

ACP has no standard native-Kanban task method. The LiquidAIty-owned subclass in
`apps/python-models/app/python_models/hermes_acp_bridge.py` adds only exact native-root lookup,
idempotent Triage creation, and task readback over the stock Hermes ACP agent. It never calls
`session/prompt`, decomposes work, dispatches workers, or synthesizes a response. The persistent
Hermes gateway remains the sole automatic decomposer and dispatcher; native child tasks and profile
workers remain internal to the receiving saved Card Run. LiquidAIty rejects new Card execution through
the retired `kanban` mode; legacy values remain readable only where saved-history continuity and recovery
require them. One focused vendor correction lets Hermes'
first-run guard recognize an explicitly selected provider only when the normal Hermes auth resolver
reports that exact provider logged in; it does not change provider, model, temperature, profile, or
OAuth storage. The registered files, proof, contribution plan, and rollback live in
`Hermes/LIQUIDAITY_VENDOR_PATCHES.md`.

The headless per-Card Team doorway is a separate contained divergence over Hermes' same native
`delegate_task`, SQLite task graph, decomposer, dispatcher and worker context. The generic host
allocation callback accepts the durable native root ID before activation; LiquidAIty creates one child
Card Run for that root and monitors/rejoins it through the existing Kanban read path. ACP and persistent
Main both enter the same backend host lifecycle. Persistent Main binds the lifecycle to its live CLI
agent before turn injection; on the first post-launch turn, the native plugin owner instead stages one
minimal immutable binding until lazy agent construction completes, verifies CLI/profile/session/request
identity, and consumes it before provider inference. Initialization, route, session, request, teardown,
or cancellation mismatches clear or reject the staging slot without allocating a child. The live CLI
transcript owner appends the terminal native result to the exact idle originating session before the child
Run closes. Recovery on September 6 restores `kanban_team.py`, `kanban_decompose.py`, `kanban_db.py`
and their original Team acceptance test from Git `b78b79ac` (August 30). After that exact recovery,
the owner explicitly rejected its added 2–4 task-count restriction. That clamp and its count-specific
prompt instruction are removed; the original SQLite dispatcher concurrency settings remain unchanged.
The upstream
project remains https://github.com/NousResearch/hermes-agent. This recovers an existing local divergence;
it introduces no executor or alternative runtime. The later Card policy projection, host policy validator
and forced-origin routing are removed. Apart from the rejected count instruction, original prompts,
profile roster and SQLite lifecycle remain as that revision. Profile delegation, Script and host Run correlation remain separate.
Focused tests exercise recovery and 1/5/9-task decomposition; loaded execution is not newly proven. Fork cost decreases by removing
the overlay. Git retains the removed implementation for rollback; saved data is not reset.

The default native Kanban worker lane also exposes one generic registered pre-spawn environment
provider. The provider receives only bounded native task/run/board/profile/workspace/claim identity
and may add new values to that child process without replacing inherited or stock Hermes values.
LiquidAIty's external `apps/hermes-liquidaity-plugin` package loads through stock Hermes
`hermes_agent.plugins` entry-point discovery. It resolves the already-persisted native-root to
saved-Card Run/revision/grant correlation over strict loopback, asks the existing signer for one
expiring Card bearer, and adds `LIQUIDAITY_CARD_BEARER` plus a non-secret `HERMES_MCP_SERVERS` template;
canonical startup and every
backend-launched Hermes boundary remove the host-only signing secret first. Hermes' normal MCP
`${ENV_VAR}` header interpolation can consume the bearer when a native worker MCP connection is
configured. Main/Coder do not depend on a static profile entry for their application MCP connection:
`buildHermesOfficialMcpServer` and `buildHermesHostSessionProjection` supply authenticated `mcpServers`
through `AcpProcess.configureHostSession` to native `_session/configure_host`. Native registration is
process-local. The separate Kanban path persists task identity through the LiquidAIty ACP bridge;
the gateway's default spawn passes the plugin-provided bearer environment to a fresh profile CLI
process, but does not copy the parent ACP server configuration. The plugin reconstructs exactly one
required loopback MCP configuration using the existing backend URL and the child's bearer placeholder.
Native config loading merges it once, rejects conflicts and missing interpolation, and the existing
pre-agent discovery gate requires that connection before constructing the worker. No config file is
written. Bearer/configuration/interpolation have provider-free contract proof; actual live worker
execution remains a separate explicitly authorized acceptance test. Model OAuth and ordinary workers without the
enabled provider remain unchanged. Focused proof and rollback are registered in
`Hermes/LIQUIDAITY_VENDOR_PATCHES.md`.

The same external plugin drives the one persistent native Main CLI through Hermes' existing message
injection and structured stream/turn hooks. One generic optional argument on
`PluginContext.inject_message` makes an external human input driver fail closed while the agent is
running or another input is pending; omission preserves Hermes' interrupting upstream behavior. The
paired host-request identity argument proves that a queued remote message matches the directly attached
or single pending host lifecycle. The bridge does not claim `/next` until the CLI exposes its native
session identity, so canonical readiness cannot race the CLI owner. The
same call may carry the trusted one-turn `external_memory_mode=bypass_automatic` marker used by the
contextualized GPT/plugin Main entrance. That marker suppresses only automatic external-memory
turn-start, prefetch, and sync for the injected root turn. A direct Main turn keeps the profile's
native provider path, unknown values fail open to normal Hermes behavior, and the provider's explicit
tools remain callable. The marker is not projected into worker or background-review child input.
The paired read-only `PluginContext.cli_conversation_snapshot` returns a detached snapshot only while
the interactive CLI is idle. The external plugin projects only user/assistant text over the same
tokenized loopback bridge so browser reconnect reads the live CLI conversation without ACP or direct
session-database access; conversation deletion remains native-CLI-owned and unavailable in Chat.
LiquidAIty's backend admits one active driver, materializes the saved Main Card Run first, and sends
only structured public text to Chat while the complete native bytes remain on the same PTY. Focused
provider-free proof lives in `Hermes/tests/hermes_cli/test_plugin_message_injection.py` and
`apps/hermes-liquidaity-plugin/tests/test_plugin.py`; contribution and rollback details are registered
in `Hermes/LIQUIDAITY_VENDOR_PATCHES.md`.

After an eligible completed Hermes root Run, the existing native background-review subsystem may
allocate one generic ACP child and run the owning profile's saved `auxiliary.background_review`
selector. Its enablement and model remain independent from the Card's saved `subagentModel`.
The source repair no longer turns review on or replaces its settings when materializing delegation;
focused regression tests cover enabled, disabled and unset state. Loaded proof is pending. The child is asynchronous, deduplicated by profile/root Run,
profile-contained, and instructed to create or patch a native skill only when the completed work
contains a durable reusable lesson. A legitimate no-op is success; allocation, provider, tool, and
completion failures remain visible on the child receipt. The child skips external-memory prefetch and
sync and cannot inherit Main Honcho context. The Card Inspector shows desired, native and effective
selection state; Card Save does not mutate the native profile, while the next eligible Run applies and
reads back the exact native fields before inference.

Current authorization limits: internal Card tokens have a 12-hour lifetime. Current source restricts
ordinary Card reads and effects to explicit grants; only the dedicated internal materializer retains
  its bounded read role. Native Team worker grants intersect the exact root IDF and saved revision. Worker
tokens use the saved root Run identity but do not require the separate live ACP execution-context check. A native claim is
validated when the bearer is issued; immediate per-worker revocation is not implemented.
Signed native task/attempt IDs are observation metadata, not additional permissions; they distinguish
worker graph events from direct root-Card materialization without creating another worker identity.
Do not describe this as automatic revocation at Run completion. The grant refactor needs a canonical
reload and live worker proof before it is described as the loaded runtime's behavior.

The current Hermes base also lacks a trusted host-supplied immutable Script contract over its existing
Python child runner. The contained divergence adds optional host Script aliases/input to
`tools/code_execution_tool.py` and validates/projects the session tool in
`acp_adapter/host_profiles.py`. LiquidAIty's external plugin registers the single compact
`execute_host_script` model tool and delegates to the same native `execute_code` function through Hermes'
ordinary tool dispatcher. There is no host pre-execution extension: Hermes decides whether to call the
tool. The change does not add a second executor, sandbox, MCP host, workflow engine or credential path.
Sessions without trusted host Script metadata and all ordinary `execute_code`/CLI callers retain upstream
behavior. Exact files, contracts, proof, fork cost and rollback are recorded in
`Hermes/LIQUIDAITY_VENDOR_PATCHES.md`.

Normal MCP refresh now resolves the active host session through the same Python
`host_session_tool_definitions` projection as initial setup. This preserves exact tool selection,
Script input schemas and delegation targets without disabling refresh or registering another toolset.
The projection bypasses native tool-search assembly because the saved Script already owns compact
presentation. The existing selected-tool failure fallback updates only that session's configuration;
ordinary sessions keep their existing refresh path. This extends the same NousResearch/hermes-agent
fork in `acp_adapter/host_profiles.py` and `tools/mcp_tool.py`; the focused host/refresh suite passes
30 tests. Fork cost is one shared projection call at refresh; rollback is the bounded change to these
two files and corresponding tests. After canonical reload, Main Run `req_94b760ad` recorded the
Script and all six selected direct tools among 14 pre-model definitions, without separate wrapped
read schemas. Execution then failed at the model API because the existing
`card.load_graph_references` schema was rejected; Script execution and native graph attribution
remain unproven. The existing plugin receipt records pre-model tool names and Script schema.

The same fork's `_normalize_mcp_input_schema` now treats schema maps (`properties`,
`patternProperties`, definitions and dependent schemas) as maps rather than schema nodes.
Previously an argument named `required` caused object repair to insert `properties.type =
"object"`, invalidating the otherwise valid graph-reference contract. The existing traversal
now repairs each subschema without editing the map. Regression tests extract the real Python
catalog literal and check exact preservation through conversion and host refresh, including a
nested schema. This bounded divergence adds no schema owner; rollback is the contextual traversal
change and its tests. After canonical reload, Main UI Run `req_5315fc6d` completed with the same
14 model-facing tools. Its saved Script successfully called `cbm.search_graph` and `cbm.trace_path`
through the existing Python executor and application MCP. AGE records both reads under Main,
including `native-attention:f6ba8ea0-54ff-4f5a-98b6-f89e4cbcad54`, with zero graph writes.
All 692 saved fields and nine profile configuration hashes remained unchanged. The provider
accepted the tool list and the recorded graph-reference schema matches the catalog; the native
diagnostic hook depth-limits five other schema copies, so those copies are not full-schema evidence.

OpenClaude/LocalCoder is not a vendor boundary, package root, fallback, or supported runtime in Core v0.
WorldSignals and other imported roots remain isolated owners and are not ordinary cleanup targets.

God's Eye View is a controlled presentation-subsystem fork of
[`GodsEyeView-org/gods-eye-view`](https://github.com/GodsEyeView-org/gods-eye-view), imported as package
version `0.1.0` from the reviewed source archive with SHA-256
`506FE6510BE5EE2EE8D9772072BF1C30FC9E95C2DF32BACA37B4068F482741D7`. LiquidAIty composes the upstream
Cesium application at an isolated loopback origin. The narrow divergence is limited to
`src/main.js`, `src/embed/hostBridge.js`, and `src/data/localLayers.js`: an opt-in supervised embed
handshake exposes bounded selection/layer state and Card-scoped evidence flight, preserves the native
Realtime/voice agent as an explicitly user-started upstream capability, permits the existing keyless
OSM fallback, and omits TeleGeography's CC BY-NC-SA cable layer from this distribution. It does not
replace the upstream data manager, scene renderer, interaction system, scheduler, or voice lifecycle.
The native startup seal receives the serialization registry minus only that omitted layer; the
historical cable URL token remains readable in the unchanged codec. This repairs the distribution's
registration mismatch without weakening the native manager's check for any other missing module.
Focused proof is `src/embed/hostBridge.test.mjs` plus the upstream production build. The generic embed
bridge is a candidate upstream contribution; rollback removes the host-bridge import/installation and
restores the cable registration only after a commercially compatible data license is established.
The upstream application remains MIT, while each surfaced dataset retains its own license and
attribution requirements.

## Known limitations

- Direct saved Main and Local Coder model execution are live-proven. Main-to-Agent-Builder,
  ordinary-Card headless Team, and native Magentic-One team execution remain separate proofs.
- Native asynchronous background review has parent/root Run attribution. The saved-Card selector to
  native-profile to actual-child receipt chain requires one loaded-runtime account-Luna proof after the
  current migration is applied; broader child/reference/artifact attribution remains separate.
- Reveal pacing, stacked 3D presentation, and transient-call consumption illumination remain incomplete.
- Catalog count, uniqueness, hash and source revision are startup receipts. Separate external GPT-plugin
  acceptance must use a fresh selected-connector conversation; an external connector call is not inferred
  from local MCP tests.
- Some stable route and Card IDs retain historical words for persistence/caller compatibility; they are
  classified legacy identifiers, not active architectures.

Card runtime bindings are fixed configuration supplied by their construction authority, not
editable kind/mode dropdowns. Mag One remains Mag One. Hermes `delegate_task` roles are separate
settings of the existing agent, never choices that turn it into Main or another runtime.
