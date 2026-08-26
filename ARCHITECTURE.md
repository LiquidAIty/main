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
     → one persistent repo-owned Hermes ACP process and native home
        ├─ Main: stable native session, logical profile liquidaity-main
        ├─ Coder: stable native session, logical profile coder
        └─ Kanban: stable native session, logical profile liquidaity-hermes-steward
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
| Coder | `card_local_coder` | Hermes `delegate` | `coder` |
| Kanban | `card_hermes_steward` | Hermes `kanban` | `liquidaity-hermes-steward` |

`card_local_coder` and `template_local_coder` are retained database identities from an earlier runtime.
They no longer imply LocalCoder or OpenClaude behavior. Renaming them requires a deliberate stored-data
migration; source must not infer runtime ownership from those strings.

The current default topology preserves:

- Main → Coder: `flow`
- Main → Kanban: `flow`
- Main → Magentic-One: `magentic_control`
- explicit production-agent → Magentic-One edges: `magentic_option`

AGE/ReactFlow relationships authorize who may call whom. They do not select providers, rewrite model input, or
start runtimes.

## Hermes ownership

`apps/backend/src/hermes/mainAdapter.ts` owns persistent Hermes ACP construction and sessions.
`apps/backend/src/hermes/coderTerminal.ts` owns the Coder terminal lifecycle. Main, Coder, and Kanban
share one genuine repo-owned Hermes process, one `Hermes/.hermes` native home, one root OAuth/provider
configuration, one `state.db`, and one Holographic `memory_store.db`. Each saved Card maps to its own
stable native Hermes session, working directory, saved model, system prompt, and bounded tool surface.
The Card `profile` field is a stable logical product binding; it does not select another home or
duplicate Hermes installation. A native `delegate_task` child is ephemeral inside its owning Card's
session. It remains activity of that same saved Card, inherits a Card-bounded native and MCP ceiling
through Hermes' native rules, and is not another saved Card or profile. Every child receives a
distinct Run and `nativeChildId` before execution and uses an opaque host-issued MCP 2 execution
context. Hermes may open a dedicated connection to the same shared `state.db` for a child's native
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

Backend routes containing `/api/coder/mcp-bridge/` are retained transport names used by the official
Python MCP host to reach server-owned Card, conversation, Run, and persistence operations. They are not
a second MCP server and do not represent the removed Coder runtime. Rename only with a versioned caller
migration.

Unknown tools, missing grants, unsupported runtimes, provider failures, and missing relationships fail
honestly. There is no alias, provider substitution, duplicate registry, or direct-database shortcut.

## IDD and transient Card calls

`LiquidAIty.idd` is the one native input declaration language. It defines legal variables, types,
constraints, tools, native operations, and output forms. The canonical one-call materialization law is
defined only in `AGENTS.md`; this file maps component ownership without defining another format.

```text
capability = Card grants ∩ IDD requirements ∩ current input selections ∩ AGE relationship ∩ approval
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

Saved Hermes Cards remain three distinct persistent agents: Main, Coder, and Kanban. A saved `flow`
edge grants an explicit Card-to-Card call; it never starts a profile, queued task, or model. Main may
call Coder or Kanban, and Coder may call Kanban, through `card.run_assistant_agent`. Kanban has no
outgoing saved-Card delegation grant. Each such call uses the receiving Card's saved Hermes profile and
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
| ThinkGraph | Engraphis SQLite/Python | project reasoning and operational memory |
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

Valid activation events include native query results, selections, delivery/consumption, traversal,
writes, and run completion/failure. Answer prose and hidden reasoning are never telemetry.

## Persistence

- PostgreSQL: Projects, saved Cards/revisions, provider/model references, conversations, Runs, and
  artifact metadata.
- AGE on PostgreSQL: saved Card relationships and execution/reference observations.
- Neo4j: KnowGraph.
- Engraphis SQLite: ThinkGraph.
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

- `apps/python-models/requirements.txt` for official MCP, deterministic Card/IDD/AGE rails, AutoGen,
  and the local Engraphis integration;
- `services/knowgraph/requirements.txt` for Graphiti/Neo4j;
- `services/esn_rls/requirements.txt` for the separately retained ESN service boundary.

The canonical `C-Projects-LiquidAIty-main` Codebase Memory project indexes the exact source allowed by the
root `.cbmignore`. It indexes the canonical host checkout `C:/Projects/LiquidAIty/main`; no alias or second root
exists. Runtime homes, credentials, virtual environments, caches, builds, and excluded vendor/imported trees
remain outside the derived projection. Indexing never transfers vendor ownership or relaxes the controlled-
vendor patch law.

## Canonical startup

`npm run dev:fresh` is the only supported full-product start. It installs the LiquidAIty-owned Hermes
entry-point plugin into the preserved Hermes environment, stops the six product ports, creates one
ephemeral internal MCP secret, and supervises frontend `5173`, backend `4000`, AutoGen rails `8003`,
KnowGraph `8001`, official MCP `8765`, ngrok inspector `4040`, and the Hermes gateway. The gateway and
every backend-launched Hermes child receive an environment with the host-only signing secret removed.

Component commands remain private children of that tree. A partial service start is diagnostic only and
is not product readiness proof.

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

A one-call Windows process-lifecycle correction in `Hermes/tools/environments/local.py` routes the
pre-search Git Bash health probe through Hermes' existing bounded process-tree helper. It changes no
tool, shell, workspace, or provider policy; it prevents an MSYS descendant holding a captured pipe
from pinning native file-tool initialization beyond the declared probe timeout. Focused proof lives in
`Hermes/tests/tools/test_find_shell.py` and `Hermes/tests/tools/test_file_tools.py`; rebase and rollback
details live in `Hermes/LIQUIDAITY_VENDOR_PATCHES.md`.

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
short-lived Card bearer, and adds only `LIQUIDAITY_CARD_BEARER`; canonical startup and every
backend-launched Hermes boundary remove the host-only signing secret first. Hermes' normal MCP
`${ENV_VAR}` header interpolation consumes the bearer, while model OAuth and ordinary workers without
the enabled provider remain unchanged. Focused proof and rollback are registered in
`Hermes/LIQUIDAITY_VENDOR_PATCHES.md`.

OpenClaude/LocalCoder is not a vendor boundary, package root, fallback, or supported runtime in Core v0.
WorldSignals, Engraphis, and other imported roots remain isolated owners and are not ordinary cleanup
targets.

## Known limitations

- Complete loaded-runtime and user-visible model proof is a separate approved run.
- Native Hermes child Run/AGE attribution has no-provider contract proof; loaded-runtime execution and
  persistence readback remain for the separately approved live session.
- Reveal pacing, stacked 3D presentation, and transient-call consumption illumination remain incomplete.
- Engraphis semantic embeddings are deferred and must remain lazy/offline when revisited.
- Some stable route and Card IDs retain historical words for persistence/caller compatibility; they are
  classified legacy identifiers, not active architectures.
