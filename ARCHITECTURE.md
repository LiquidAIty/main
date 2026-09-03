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
| Graph Agent | `card_hermes_steward` | Hermes `delegate` | `liquidaity-hermes-steward` |

`card_local_coder` and `template_local_coder` are retained identities and now present the Hermes-backed
Local Coder. They do not imply the removed standalone LocalCoder/OpenClaude runtime.
`031_graph_agent_continuity.sql` gives an existing `card_hermes_steward` one new current revision named
Graph Agent with Hermes `delegate` mode. It copies the prior revision's prompt, profile, provider/model,
grants, runtime extensions, and presentation state, then advances only the current-revision/deck pointers.
Historical revisions, Runs, memory/session homes, and AGE relationships are not rewritten or deleted.

The current default topology preserves:

- Main → Agent Builder: `flow`
- Main → Graph Agent: `flow`
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
Team task-graph root owned by the originating profile/session. Each saved Hermes Card may authorize Team
with an Off/Auto policy plus maximum workers, retry limit, worker provider/model, and one Team-lead
provider/model. Auto means Hermes may call the native model tool; it never starts Team merely because
a Card Run began. The Team-lead model owns native decomposition and the resumed root's final synthesis,
while the worker model owns the bounded decomposed tasks. Team never receives the global Hermes profile
roster: the decomposer sees only the root's already-persisted originating profile, and the atomic native
decomposition boundary pins every child back to that profile even if a malformed response supplies another
assignee. Card-facing Hermes sessions expose Team only when the saved policy permits it and expose `profile`
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
`orchestrator`, `team`, and `profile` on its one `delegate_task` implementation; Leaf/recursive delegation
has no new LiquidAIty UI. A process-only
Team marker blocks every Team worker and synthesis pass from calling any nested delegation role or
creating another native task, so the first-party MVP recipe cannot recurse.

Each saved Hermes Card may additionally own a desired `subagentModel`. At Run start the existing backend
adapter projects that selector into Hermes' native top-level `delegation.provider/model` and
`auxiliary.background_review` fields, then reads the same profile back before inference. The parent Card
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
   chunks under that profile's `HERMES_HOME`; the Card Context tab stores no copy.
5. **ThinkGraph — one Constellation SQLite authority.** Serves project reasoning, hypotheses, relationships,
   operational knowledge, semantic embeddings, identity segments, and its launcher outbox. The pinned engine
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

The initial checked-in fork has no internal AutoGen divergence. Product authority and adaptation stay
in `apps/python-models`; any later fork edit must be registered in
`autogen-main/LIQUIDAITY_FORK.md` with tests and an update/removal strategy.

## MCP and transport

`apps/python-models/app/mcp_host.py` is the one official shared MCP host. Its public catalog is assembled
from current registered owners and is discovered dynamically. A fixed numeric catalog promise is not an
architecture contract.

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

Backend routes containing `/api/coder/mcp-bridge/` are retained transport names used by the official
Python MCP host to reach server-owned Card, conversation, Run, and persistence operations. They are not
a second MCP server and do not represent the removed Coder runtime. Rename only with a versioned caller
migration.

Unknown tools, missing grants, unsupported runtimes, provider failures, and missing relationships fail
honestly. There is no server-side app prefix, prefix-stripping alias, provider substitution, duplicate
registry, or direct-database shortcut.

## Card Inspector projections

The Card editor has exactly six top-level tabs: CLI, Prompt, Context, Tools, Script, and Subagents. CLI replaces the
former Terminal label and remains the one Card Run/session projection; it does not add a second invocation
path. Prompt contains the existing prompt, provider, model, and runtime controls. Context contains the
existing bounded graph selections, saved references, memory, and native Skills/Learning Journey projection.
Tools retains saved grants and modes. Script compiles the saved Python recipe into one typed optimized model
tool that may call only Card-authorized operations; Hermes decides whether to call it. Subagents currently
configures only native Team defaults and limits, then presents the current or last Card Run state and bounded
native Team activity. It does not expose raw internal receipt JSON, copy SQLite rows, or own another timeline.
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
canonical `constellation.context`, `constellation.inspect`, `graphiti.search_nodes`,
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
typed objects. Agent Builder's saved CodeGraph authority uses `selected` catalog policy and only the
structural `cbm.search_graph -> cbm.trace_path -> cbm.get_code_snippet` recipe; coverage and diff
diagnostics remain Local Coder capabilities. Local Coder remains repository-focused and never receives the full IDD. Live proof of
the guided Agent Builder interaction remains outstanding.

Hermes is the runtime platform. LiquidAIty composes and contextualizes its native systems through
saved Card identity, selected capabilities and exact Run input; it does not duplicate native catalogs,
profiles, tool execution or worker scheduling. ACP receives a projection, never the IDD dictionary.
One Hermes Card configures one native agent/profile; native subagents remain children of that agent,
not newly saved Cards. Native prompt/model/tool/profile sections retain their native owners. Further
section consolidation and aliases are deferred; existing non-Hermes saved bindings are preserved.

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
to the target Card's existing Context tab, and records the proven read/handoff on the source Run in
AGE. It never materializes an IDF or starts a Card. The outer Mag One Card is materialized only when an
automatic handoff or reviewed manual submission runs it; each saved worker Card then materializes its own
task through the same receiving-Card path.

Saved Hermes Cards remain four distinct persistent agents: Main, Agent Builder, Local Coder, and Graph Agent.
Each Card maps one-to-one to one native Hermes profile and may privately self-fan out through Team; there is
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
| ThinkGraph | Constellation Engine through the Python/Node adapter | project reasoning and operational memory |
| KnowGraph | Graphiti/Neo4j/Python | sourced knowledge, evidence, and provenance |
| CodeGraph | native codebase-memory-mcp | repository structure and impact |
| AgentGraph | Apache AGE/PostgreSQL | Card relationships, delegation, Runs, tools, references, artifacts |

No owner copies another graph into itself. Context uses native IDs, bounded selections, and provenance.
AgentGraph observes execution; it does not own Card configuration or runtime lifecycle.

Constellation is pinned to npm package `constellation-engine` `1.0.5`, revision
`ac460489f1cd3cd629fa96f2730e5ae9daa4326c`. The existing Constellation child owns the pinned Mímir
semantic child and passes the exact same database path; there is no daemon/database fallback. Python rails
own that child. Both the ThinkGraph projection and the official MCP host call the same Python-rails
operation adapter, so the MCP process never imports the bridge or launches a second child against the
SQLite database. The current bounded operation surface is:

- reads/discovery: `capabilities`, `stats`, `context`, `inspect`, `inspect_edge`, `check_duplicate`,
  `edge_types`, `collide`, `semantic_status`, `semantic_context`, `reembed_status`, `identity_preview`,
  `autonomy_status`, and `notification_status`;
- confirmed effects: `remember`, `remember_semantic`, `update_memory`, `link`, `adjust_edge`,
  `adjust_edge_pair`, `classify_edge`, `classify_edge_pair`, `forget`, `maintain`, `semantic_start`,
  `semantic_stop`, `reembed_start`, `reembed_cancel`, `identity_apply`, `autonomy_start`,
  `autonomy_pause`, `autonomy_resume`, `autonomy_stop`, `notify`, `edge_review`, and `inject_message`.

Semantic mode uses the real local BGE-M3 1024-dimensional embedder. Bulk re-embedding is one bounded,
cancellable process-owned job with progress and exact database receipt. Identity mutation is
preview/digest/confirm/native-write/readback. Bounded autonomy permits one concurrent native `collide` or
confirmed maintenance loop with cycle, duration, interval, traversal-depth, aggregate-context and
per-cycle token budgets; it does not call a model. Launcher notifications use the existing database
outbox. `kickoffSeedExpansion`, `draftSoulCore`, and `rememberRaw` stay catalog-disclosed but unavailable:
the pinned upstream contracts respectively require a configured provider plus launcher worker,
Constellation provider credentials, or a cancellable LLM-fetch timeout that upstream does not expose.

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
- Constellation Engine SQLite: ThinkGraph, semantic embeddings, identity segments and launcher outbox.
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

Hermes is the vendor boundary shared by the internal Hermes Cards. LiquidAIty-owned integration
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
Run closes. Team-specific
task markers carry the exact Card-projected lead/worker models, retry and worker bounds, final-stage
identity and durable internal execution evidence. The Team root and every child retain the root's existing
profile assignee; the Team decomposer never reads the global profile roster, and the SQLite decomposition
transaction independently canonicalizes foreign assignees to the persisted root owner. The
stock dependency/retry/notification lifecycle remains authoritative. Full files, tests, upstream shape,
sync cost and rollback are recorded in `Hermes/LIQUIDAITY_VENDOR_PATCHES.md`.

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
selector. The owning Card's saved `subagentModel` is materialized into both this selector and Hermes'
native delegation selector with a 120,000-token review ceiling; new Hermes Cards default to the
account-backed Luna selection without making it the only valid future value. The child is asynchronous, deduplicated by profile/root Run,
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
