# LiquidAIty Core v0 Architecture

This document describes current source ownership. `PLAN.md` orders future proof; `FUTURE.md` contains
deferred work; `AGENTS.md` and `DONT.md` are execution law.

## One-line law

```text
TypeScript = transport and pixels
Python rails = runtime and deterministic computation
models = semantic reasoning
saved Cards and graph topology = identity and authority
```

## System map

```text
React/Vite Agent Builder and Chat
  → Node/TypeScript HTTP, SSE, saved-state, and session transport
     → repo-owned Hermes ACP adapter, reusing one process owner per native profile
        ├─ Main: stable native session, home/profile liquidaity-main
        ├─ Coder: stable native session, home/profile coder
        └─ Kanban: stable native session, home/profile liquidaity-hermes-steward
     → official Python MCP client boundary
        → one official Python HTTP MCP host on :8765/mcp
           ├─ Card call/IDD/AGE deterministic rails
           ├─ AutoGen AssistantAgent
           ├─ AutoGen MagenticOneGroupChat
           ├─ ThinkGraph/Constellation Engine
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
| Kanban | `card_hermes_steward` | Hermes `kanban` | `liquidaity-hermes-steward` |

`card_local_coder` and `template_local_coder` are retained identities and now present the Hermes-backed
Local Coder. They do not imply the removed standalone LocalCoder/OpenClaude runtime.

The current default topology preserves:

- Main → Agent Builder: `flow`
- Main → Kanban: `flow`
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
Main, Agent Builder, Local Coder, and Kanban retain separate profile homes, native memory, sessions,
and configuration.
They share the vendored Hermes installation and integration code, not one merged memory database.
Native profile configuration and Hermes' auth resolver remain authoritative. A native `delegate_task` child is ephemeral inside its owning Card's
session. It remains activity of that same saved Card, inherits a Card-bounded native and MCP ceiling
through Hermes' native rules, and is not another saved Card or profile. Every child receives a
distinct Run and `nativeChildId` before execution and uses an opaque host-issued MCP 2 execution
context. Hermes may open a dedicated connection to its owning profile's `state.db` for a child's native
transcript lifecycle; that is not independent Card memory or identity.

The host derives one opaque key from Project, conversation, and Card identity. Hermes stores that key
in its existing native `sessions.session_key` field so an ACP restart recovers the exact session even
when Main and Coder share the repository working directory. The key is routing identity only; it is
not a Card definition, credential, prompt, or second persistence authority.

The backend injects server-owned Card, conversation, Run, and correlation identity. Hermes receives one
Python-materialized Card call plus minimal Card identity. No generic model call or another agent runtime
hides behind Hermes.

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

The initial checked-in fork has no internal AutoGen divergence. Product authority and adaptation stay
in `apps/python-models`; any later fork edit must be registered in
`autogen-main/LIQUIDAITY_FORK.md` with tests and an update/removal strategy.

## MCP and transport

`apps/python-models/app/mcp_host.py` is the one official shared MCP host. Its public catalog is assembled
from current registered owners and is discovered dynamically. A fixed numeric catalog promise is not an
architecture contract.

The literal `LiquidAIty.idd` separates publication/access policy from native MCP side-effect annotations.
Constellation exposes only bounded `context`, `inspect`, and `remember` operations. CBM remains the only
product CodeGraph owner. Obsolete saved tool grants fail unavailable; there is no data migration or
synthetic topology regeneration.
The current 2026-08-29 startup snapshot publishes 43/43 unique tools after the retired Engraphis
family was removed and the three bounded Constellation tools were added. The count is a run receipt,
not a fixed architecture promise. Cached GPT tool descriptors must be reissued in a fresh selected-
connector conversation; restarting an already-ready server does not replace a conversation-cached schema.

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
proof is still separate. A new call from the coding task remains blocked because its connector rejects
prefixed tool calls; this does not invalidate the successful external caller. Browser rendering and
one real Codex-account Kanban Run remain unproven. Do not call the complete launch path live-ready.

Backend routes containing `/api/coder/mcp-bridge/` are retained transport names used by the official
Python MCP host to reach server-owned Card, conversation, Run, and persistence operations. They are not
a second MCP server and do not represent the removed Coder runtime. Rename only with a versioned caller
migration.

Unknown tools, missing grants, unsupported runtimes, provider failures, and missing relationships fail
honestly. There is no alias, provider substitution, duplicate registry, or direct-database shortcut.

## Card Terminal projections

The Card editor has Prompt, Knowledge, Tools, Runtime, and Terminal tabs. Terminal replaces the Task
input/output tab; it does not add a second invocation path. Main still uses chat for input and responses.
Coder's Card invokes its existing Run path and focuses the external Code Console, where the attributed
Card Run view is distinct from the existing interactive native CLI session. No terminal is embedded in
Coder's Card. Kanban keeps its native board and one aggregate Run view; task actions retain their native
command owner. Ordinary agent Cards use the shared adaptive terminal, while Mag One remains an orchestrator.

`apps/backend/src/contracts/runtimeEvents.d.ts` is the shared public presentation contract.
`hermes/cardTerminal.ts` projects existing ACP turns, native transcript replay, Kanban task/attempt records,
and Python Run/AGE lineage. The frontend renderer does not become a runtime, transcript store, or source
of agent capability. Native memory, tools, skills, orchestration, and grants remain with their existing owners.
Main's graph callbacks and technical events use the backend-issued Run identity; the browser does not
mint a competing Run. Native tool-call IDs are shared across live events, status and replay, with changed
partial output updating in place. Transcript commands verify Project, Deck, Card and Run identity and
serialize against native session configuration and execution inside the existing ACP owner.

Current limits are explicit: some native sessions contain multiple Runs without per-Run transcript
boundaries; exact Run transcript read/deletion is unavailable in that case. Main technical replay after a
full refresh, public skill/autoskill events, and full Kanban worker tool output are not yet integrated.
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
typed objects. Local Coder remains repository-focused and never receives the full IDD. Live proof of
the guided Agent Builder interaction remains outstanding.

Hermes is the runtime platform. LiquidAIty composes and contextualizes its native systems through
saved Card identity, selected capabilities and exact Run input; it does not duplicate native catalogs,
profiles, tool execution or worker scheduling. ACP receives a projection, never the IDD dictionary.
One Hermes Card configures one native agent/profile; native subagents remain children of that agent,
not newly saved Cards. Native prompt/model/tool/profile sections retain their native owners. Further
section consolidation and aliases are deferred; existing non-Hermes saved bindings are preserved.

Optional Python Card Script data and its fail-closed guard are retained in the existing Card
runtime-extension field. Script analysis endpoints, generated names/types, lint, static previews,
autocomplete, formatting and the Script tab are deferred to the second pass. Source identity and
validation/support status never grant authority. Missing/disabled Script preserves materialization.

Script execution is unavailable and an enabled Script fails before graph loading or IDF materialization.
The inspected native `Hermes/tools/code_execution_tool.py::execute_code` runs arbitrary local Python,
permits environment passthrough and broadens an empty tool intersection to its sandbox allowlist;
it is not the required proxy-only isolation seam. No substitute executor or vendor patch was added.
The native tools.show projection supplies names but not parameter schemas; those tools remain visible
with a missing-schema diagnostic. Script preparation, safe execution and its IDF integration remain
unavailable. Future static call-site previews must never be described as executed plans or dry runs.

IDD responsibility reduction:

| Previous responsibility | Current owner/disposition |
| --- | --- |
| Duplicated IDF/graph/Card/model records | Executable Pydantic contracts; duplicate IDD validation deleted |
| Fixed model list and editor-control dictionary | Native/configured models and transport schema projection |
| Bracket-island parser | Deleted; Markdown and Python source are not a second mixed-language runtime |
| Native tool descriptions/schemas/availability | Current native discovery; IDD retains only host effect annotations |
| Global readable-tool allocation | Deleted from host, ordinary Card, registry and Kanban worker paths |
| Runtime template defaults/override writer in selected-Card editing | Removed; saved configuration wins, old overrides read only |
| Initial new-Project/quick-add templates | Retained seed compatibility; not runtime authority |
| Random card.create template IDs | Explicit construction reference or compatible custom-assistant template; persistence does not reload IDD |

```text
capability = native availability ∩ saved Card/profile selections ∩ Run grants ∩ required approval
```

Routing IDs and telemetry remain outside `in.idf`. PostgreSQL retains the existing Run artifact metadata;
the artifact path identifies the one exact retained input file.

`write_mag_one_instructions` loads exact text directly into the saved Mag One Card's transient
Invocation editor. It is not a proposal document, materializer, or store. It resolves the one saved
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

Saved Hermes Cards remain four distinct persistent agents: Main, Agent Builder, Local Coder, and Kanban. A saved `flow`
edge grants an explicit Card-to-Card call; it never starts a profile, queued task, or model. Main may
call Agent Builder or Kanban through `card.run_assistant_agent`. Local Coder is instead eligible only
through Magentic-One's saved `magentic_option`; Agent Builder has no Magentic-One edge. Kanban has no
outgoing saved-Card delegation grant. Each direct call uses the receiving Card's saved Hermes profile and
one explicit mission plus selected native graph references. This is the normal automatic handoff and it
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
| ThinkGraph | Constellation Engine through the Python/Node adapter | project reasoning and operational memory |
| KnowGraph | Graphiti/Neo4j/Python | sourced knowledge, evidence, and provenance |
| CodeGraph | native codebase-memory-mcp | repository structure and impact |
| AgentGraph | Apache AGE/PostgreSQL | Card relationships, delegation, Runs, tools, references, artifacts |

No owner copies another graph into itself. Context uses native IDs, bounded selections, and provenance.
AgentGraph observes execution; it does not own Card configuration or runtime lifecycle.

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
The embedded CodeGraph view starts from returned objects and expands explicitly; it does not auto-load
the entire repository graph. The former standalone CBM UI app/package/demo shell and duplicated UI
primitives are intentionally absent.

ThinkGraph renders through one separate authority chain:

```text
Constellation Engine SQLite
→ Python-owned Constellation child and bounded projection route
→ backend proxy
→ GraphProjectionV1
→ ephemeral browser-only Graphology MultiDirectedGraph
→ LiquidAIty ConstellationSigmaSurface using Sigma v3 WebGL
```

Graphology preserves surviving view positions during keyed native-ID updates but owns no persistent
meaning. Sigma owns camera, hit testing, and drawing. The generic force-graph projection surface owns
KnowGraph only and is not a second ThinkGraph renderer. ThinkGraph attention may decorate an exact ID
already present in the authoritative Constellation projection; it may never create a visual node from an
attention receipt alone. An empty native projection therefore remains visibly and structurally empty.

Valid activation events include native query results, selections, delivery/consumption, traversal,
writes, and run completion/failure. Answer prose and hidden reasoning are never telemetry.

## Persistence

- PostgreSQL: Projects, saved Cards/revisions, provider/model references, conversations, Runs, and
  artifact metadata.
- AGE on PostgreSQL: saved Card relationships and execution/reference observations.
- Neo4j: KnowGraph.
- Constellation Engine SQLite: ThinkGraph.
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
- `apps/constellation-engine/package.json` for the exact pinned Constellation Engine dependency;
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

Hermes is the only vendor boundary required by the three internal Cards. LiquidAIty-owned integration
stays in the backend adapter whenever possible. Any Hermes edit must remain narrowly recorded, tested,
and justified against an unavailable upstream adapter/configuration hook.

The current contained divergence tracks the default `main` branch of
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) (package version `0.20.5`)
at upstream commit `6ce7ab8bfb3fce3ba116f52a11a438d6c7e4c03d`, verified 2026-08-25. That
commit is newer than the latest tagged release at the time of refresh. ACP has no native host contract for publishing a bounded
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
Actual Main/Coder/Kanban execution continues through standard session creation/load followed by the
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
workers remain internal to the one saved Kanban Card Run. One focused vendor correction lets Hermes'
first-run guard recognize an explicitly selected provider only when the normal Hermes auth resolver
reports that exact provider logged in; it does not change provider, model, temperature, profile, or
OAuth storage. The registered files, proof, contribution plan, and rollback live in
`Hermes/LIQUIDAITY_VENDOR_PATCHES.md`.

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
running or another input is pending; omission preserves Hermes' interrupting upstream behavior.
The paired read-only `PluginContext.cli_conversation_snapshot` returns a detached snapshot only while
the interactive CLI is idle. The external plugin projects only user/assistant text over the same
tokenized loopback bridge so browser reconnect reads the live CLI conversation without ACP or direct
session-database access; conversation deletion remains native-CLI-owned and unavailable in Chat.
LiquidAIty's backend admits one active driver, materializes the saved Main Card Run first, and sends
only structured public text to Chat while the complete native bytes remain on the same PTY. Focused
provider-free proof lives in `Hermes/tests/hermes_cli/test_plugin_message_injection.py` and
`apps/hermes-liquidaity-plugin/tests/test_plugin.py`; contribution and rollback details are registered
in `Hermes/LIQUIDAITY_VENDOR_PATCHES.md`.

Current authorization limits: internal Card tokens have a 12-hour lifetime. Current source restricts
ordinary Card reads and effects to explicit grants; only the dedicated internal materializer retains
its bounded read role. Kanban worker grants intersect the exact root IDF and saved revision. Worker
tokens use the saved root Run identity but do not require the separate live ACP execution-context check. A native claim is
validated when the bearer is issued; immediate per-worker revocation is not implemented.
Signed native task/attempt IDs are observation metadata, not additional permissions; they distinguish
worker graph events from direct root-Card materialization without creating another worker identity.
Do not describe this as automatic revocation at Run completion. The grant refactor needs a canonical
reload and live worker proof before it is described as the loaded runtime's behavior.

OpenClaude/LocalCoder is not a vendor boundary, package root, fallback, or supported runtime in Core v0.
WorldSignals and other imported roots remain isolated owners and are not ordinary cleanup targets.

## Known limitations

- Complete loaded-runtime and user-visible model proof is a separate approved run.
- Native Hermes child Run/AGE attribution has no-provider contract proof; loaded-runtime execution and
  persistence readback remain for the separately approved live session.
- Reveal pacing, stacked 3D presentation, and transient-call consumption illumination remain incomplete.
- Constellation semantic embeddings are explicitly degraded until a real configured daemon is approved.
- Some stable route and Card IDs retain historical words for persistence/caller compatibility; they are
  classified legacy identifiers, not active architectures.
