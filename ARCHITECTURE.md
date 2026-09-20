# LiquidAIty current architecture

This document records the owners and contracts present in the current source tree. It is not a
runtime receipt. `PLAN.md` records the current proof boundary and next ordered work, `FUTURE.md`
contains deferred candidates, `DONT.md` records known failure patterns, and `AGENTS.md` is execution
law.

The September 15 cleanup removed LiquidAIty's abandoned Hermes ACP integration. Hermes' upstream
ACP implementation remains part of the vendored project, but it is not LiquidAIty's Card runtime
boundary. The pushed cleanup source and the smaller current residue deletion still must be rebuilt
and exercised before either can be described as the loaded application.

## One-line law

```text
TypeScript = transport and pixels
Python rails = runtime and deterministic computation
models = semantic reasoning
saved Cards and graph topology = identity and authority
```

## Source-owner map

Use Codebase Memory first for covered structural discovery, then read the complete current source.
When CBM is unavailable or a path is excluded, use the bounded direct-source fallback in
[`skills/codebasedmemory.md`](skills/codebasedmemory.md).

| Concern | Current owner | Contract |
| --- | --- | --- |
| Saved Card and deck state | `apps/python-models/app/python_models/card_domain.py` | Saved identity, revision, runtime binding, profile, provider/model, prompt, grants, topology, and Run state |
| Canonical Run input | `apps/python-models/app/python_models/idf.py::materialize_idf` | One UTF-8 `in.idf`, written and reread before execution |
| Card Python Script | `apps/python-models/app/python_models/card_script.py` plus the existing Card editor transport | Saved Card-owned source, structural compilation, live selected-tool validation, honest native availability, and retained receipt identity; no TypeScript executor |
| Browser transport | `client/src` | Rendering, input controls, SSE/HTTP consumption, and no semantic routing |
| Application HTTP transport | `apps/backend/src/routes` | Authentication, saved-scope checks, process/session lifecycle, native event delivery, and Python-rails calls |
| Hermes Card process/session | `apps/backend/src/hermes/agentTerminal.ts` | One profile-scoped native Gateway, durable native session, and optional native TUI attachment |
| Hermes Run receipt | `apps/backend/src/hermes/agentTerminalExecution.ts` | Bind one already-materialized saved Run to one Gateway turn and persist its native completion |
| Hermes profile application | `apps/backend/src/hermes/profileMaterialization.ts` | Apply the exact saved parent model, selected skills, and desired native subagent model before a turn |
| Hermes runtime | `Hermes/` | Native inference, sessions, tools, memory, delegation, task/dependency dispatch, Gateway, TUI, desktop, and direct-agent messaging |
| Mag One execution | `apps/python-models/app/python_models/magentic_execution.py` | Headless structured submit, status/rejoin, stop, and final-result observation against Hermes' existing SQLite task/dependency runtime |
| Tool contracts and execution | `apps/python-models/app/python_models/tool_registry.py` plus the current Python operation owners | Canonical schemas, native availability, deterministic validation, and execution; transports do not duplicate these owners |
| Official MCP host | `apps/python-models/app/mcp_host.py` | External OAuth publication and native external-tool federation; current internal callers remain until the approved Hermes-plugin boundary replaces that use |
| CodeGraph | Native Codebase Memory through the official MCP host | Repository structure and source relationships; CBM is the sole graph writer |
| ThinkGraph | Engraphis through `engraphis.py` and `thinkgraph.py` | Project reasoning and explicit writes |
| KnowGraph | Graphiti/Neo4j through `services/knowgraph` | Sourced knowledge and provenance |
| AgentGraph | AGE/PostgreSQL through the Card-domain observation path | Saved Card relationships and truthful Run/reference/artifact observations |

## Authority chain

```text
saved Card revision
  + current dynamic mission
  + deliberately selected native references and bounded data
  + effective saved grants
  -> Python materializes and rereads one in.idf
  -> saved runtime binding chooses the exact Hermes mode and profile
  -> native runtime executes
  -> PostgreSQL stores Run state and artifact metadata
  -> AGE may observe stable identities and truthful native events
```

Callers do not supply replacement Card definitions. A model cannot enlarge its grants, change its
saved runtime, invent graph data, or choose a provider fallback. TypeScript does not reconstruct a
second model payload.

## Saved Cards, IDF, and Runs

A saved Card is the permanent authority for:

- stable identity and revision;
- prompt;
- provider, model, native profile, and desired native subagent model;
- runtime kind and mode;
- enabled state;
- selected skills, native tools/toolsets, MCP tools, and other capability grants;
- saved topology and presentation attachments.

The sending user or Card supplies only the current task, images, and selected native references.
`materialize_idf` is the only input materializer. It writes and rereads the exact bounded input before
the runtime sees it. The Run artifact catalog retains the path, byte size, and hash. Receipts,
approval state, provider lineage, AGE observations, and runtime status remain outside `in.idf`.

Each independently invoked saved Card owns its own root Run and IDF. Native temporary children remain
inside their owning Hermes Card. A Hermes Team is one root boundary: Hermes owns decomposition,
worker prompts, retries, synthesis, and child context, so LiquidAIty does not manufacture per-worker
IDFs from native child IDs.

Card Python Scripts remain optional saved Card configuration. Python rails owns parsing, literal tool
handle validation, hashes, and the compact presentation decision. The Agent Builder renders the editor
below the Card's Tools selection; TypeScript only transports the draft and live palette. The removed ACP
plugin/callback was not a valid reason to delete Script authoring, persistence, compilation, or
validation. Until a separately approved Hermes-native owner exists, a valid enabled Script reports
`card_script_native_bridge_unavailable` and the Run retains the Card's existing deliberate MCP
presentation. No alternate executor or synthetic Script result is active.

## Application routes

`apps/backend/src/routes/index.ts` mounts each domain once. Browser-facing routes use normal user
authentication. The official Python MCP host's internal Main endpoints use their process-secret or
signed runtime boundary and are mounted separately from browser authentication.

| Route family | Current responsibility |
| --- | --- |
| `/api/cards` | Card editor choices, saved Card execution, connected relationships, Run inspection, and Stop |
| `/api/main` | Shared-chat address resolution, saved-Card streaming turns, Main context/driver state, participant-aware history, native attention, and exact-Run Stop |
| `/api/agent-terminals` | Authenticated open, SSE events, input, resize/detach, and Stop for the Card's native TUI |
| `/api/hermes-profile` | Saved-Card-scoped native profile projection and explicit native profile operations |
| `/api/idd` | IDD-backed Card editor and tool projections |
| `/api/codegraph` | Authenticated interactive CodeGraph UI reads through Python rails |
| `/api/thinkgraph` and `/api/knowgraph` | Native graph projections/operations without merging authority |
| `/api/projects` | Project and deck transport |

Route names are transport addresses, not agent identities or separate runtimes.

## Hermes Card execution

Main, Builder, and ordinary Hermes-backed Cards use the native Gateway/TUI path:

1. Python rails resolves the exact saved Card, validates grants, creates the Run, and materializes
   its canonical IDF.
2. The backend resolves the authenticated `{userId, projectId, deckId, cardId}` owner tuple.
3. `AgentTerminalManager` starts one isolated, profile-scoped Hermes Gateway with that profile's
   `HERMES_HOME`, connects through its tokenized loopback WebSocket, and refuses competing owners.
4. The backend reads the native profile and applies the saved parent model, selected skills, and
   desired native subagent model. A missing profile fails closed; it is not silently created or
   replaced.
5. The manager resumes the one matching durable native session or creates it, then optionally attaches
   the native TUI through a PTY.
6. `AgentTerminalExecution` validates the prepared Run identity and saved provider, stages one active
   turn, and the manager submits the exact materialized message to the native session.
7. Gateway events drive streaming output. The completed native text, session references, provider
   identity, available usage, cost, duration, and failure/cancellation state finish the same saved Run.

Each saved Card's native session remains the authority for its runtime history. The browser shared-chat
history route additionally reads an exact completed-turn presentation projection from the existing
normalized conversation tables so user, target, and replying Card identities survive reload across
multiple native Card sessions. That projection is not another runtime, delivery queue, or agent registry;
it is written only after the real target turn completes. History deletion remains deliberately
unavailable. The terminal surface streams real PTY bytes; a mounted component, queued UI item, or running
process is not proof that a turn executed.

### Removed LiquidAIty ACP path

The following are not current architecture and have no retained fallback:

- the backend `mainAdapter` ACP process/session owner;
- LiquidAIty ACP callback and internal Kanban callback routes;
- the host execution-context registry and worker bearer bridge;
- the external editable `liquidaity-hermes-plugin` package;
- the Python `hermes_acp_bridge`;
- ACP transcript, snapshot, synthetic native-event, and Team-receipt projections;
- LiquidAIty-specific private ACP host-profile/Script-execution/tool-refresh hooks;
- the orphan ACP MCP-connection projection left after `mainAdapter` was removed;
- an abandoned frontend deck-workspace helper left by the removed Agent Builder operation surface;
- an uncalled ThinkGraph NetworkX community/gap projection and its application-only dependency pin.

Hermes' own `acp_adapter/` source and upstream ACP tests remain vendor functionality. Their presence
does not authorize LiquidAIty to use ACP as a Card runtime or restore the removed integration.

## Hermes modes and delegation

`main` and `delegate` are the supported saved Hermes Card execution modes. Direct creation of a new
saved Card Run in the old `kanban` runtime mode fails closed. Read compatibility and recovery remain
only where existing active Kanban rows require them.

Native Hermes delegation remains model-selected within the Card's native capability ceiling:

- upstream `leaf` and `orchestrator` use Hermes' temporary child execution;
- retained `team` creates one durable native Auto-Kanban root and lets Hermes own decomposition,
  dispatch, workers, retry, review, synthesis, notification, and rejoin.

Saved-Card conversation is not delegation. One enabled orange `flow` connection between two enabled
Hermes agent Cards authorizes either endpoint to contact the other saved profile through native
`message_agent`; Hermes owns the receiving profile's canonical `Bot Chat` and the conversation.

Direct user addressing in shared chat is a separate entrance. A leading saved-roster address such as
`@builder` resolves before inference, prepares the addressed saved Card's ordinary canonical Run/IDF,
and submits the exact user text to that Card's own profile-scoped Gateway session. Main is not invoked,
does not acknowledge the turn, and does not inspect the result. Only the actual addressed Card response
is rendered and persisted with that Card's identity. An unaddressed turn invokes Main; only then may its
IDF include the bounded preceding shared conversation. Main's independent native `message_agent` route
remains unchanged for model-chosen Card-to-Card communication.

LiquidAIty has no TypeScript participant classifier, task-count router, callback scheduler, copied
Kanban database, or Team receipt product. `apps/backend/src/hermes/kanbanRunRecovery.ts` monitors only
eligible existing active `runtimeMode === "kanban"` rows and does not create new Team work.

The complete Hermes fork scope and rollback contract is
[`Hermes/LIQUIDAITY_VENDOR_PATCHES.md`](Hermes/LIQUIDAITY_VENDOR_PATCHES.md). It records the
previously retained Hermes extensions, the profile-scoped direct-agent roster, and the nullable root-scoped
assignee ceiling used only when Mag One submits a bounded native execution.

## Native Hermes Bot Mode

Bot Mode is substantial first-party Hermes functionality under `Hermes/apps/desktop`,
`Hermes/tools/bot_mode_*`, the Gateway, profile/session stores, cron delivery, peer relay, and the
checked-in Hermes documentation. It is not ACP residue and must not be deleted or rewritten during
LiquidAIty cleanup.

The current working tree projects saved Bot authority through one native chain:

```text
saved enabled Hermes Cards + enabled orange flow edges
  -> Python Card-domain ordered symmetric profile projection
  -> existing Hermes profile materialization owner
  -> profile-scoped bot_mode.roster write and exact readback
  -> native resolve_bot_roster
  -> canonical Bot Chat prompt and stock message_agent target validation
  -> unchanged stock live-owner or quiet-CLI delivery
```

Missing or empty roster configuration grants no local target. The resolver preserves configured order,
deduplicates without sorting, excludes self, and filters malformed, unknown, deleted, or tombstoned
profiles. The default profile is available only when explicitly listed. Blue Mag One topology does
not enter this projection.

The former Card Bot-DM plugin, backend host/authentication route, and Python per-message target resolver
are removed. No application component intercepts Card-to-Card `message_agent`, forwards a Gateway
credential, chooses live versus offline delivery, waits for its reply, reconstructs its transcript, or
creates a Card Run for that native Card-to-Card conversation. Hermes owns the canonical Bot Chat,
acknowledgement, delivery choice, queueing, ordering, completion, receipts, attributed replies, silence,
retries, and background notification. The direct user-addressed shared-chat entrance above uses the
existing ordinary saved-Card Run/Gateway path; it does not replace or proxy `message_agent`.

`delegate_task` remains native in-Card subagent/Team work; it is not a profile-to-profile Card
conversation entrance. Loaded ordinary-Main and real Card-to-Card attributed-reply acceptance remain a
separate proof tier until the canonical stack is started from this source.

## Profile materialization and memory

Saved Card configuration remains the authority. The native Hermes profile is an execution projection,
not another Card database. Before a Gateway turn, the backend:

- resolves the exact saved provider/model without environment or availability fallback;
- applies and rereads a mismatched parent model;
- verifies selected skills exist and enables only those plus Hermes' required operating skill;
- applies the desired bounded native subagent provider/model without changing background review;
- fails before inference when the profile, selected skill, or required application is unavailable.

Hermes owns profile-local credentials, sessions, native memory, skills, and background review.
LiquidAIty exposes Honcho setup/status only for Main; it does not project a general Card memory-provider
field or copy memory between profiles.

## Python rails and Mag One

Python rails owns deterministic runtime preparation, saved Card/Run persistence, IDF
materialization, native graph hydration, tool execution, parameterized SQL/Cypher, research/data
processing, and the structured Mag One boundary into Hermes' existing execution machinery.

## Internal Card tools and external MCP

The current working tree separates publication from execution without duplicating tool ownership:

```text
saved Card and current execution authority
  -> protocol-neutral Python operation owner
     -> native Hermes plugin registration for internal Card use
     -> official MCP publication for external clients
```

`OperationDefinition` in Python is the canonical owner of LiquidAIty operation IDs, descriptions,
parameter schemas, handlers, availability, and permitted publishers. Existing Python modules continue to
contribute their own definitions. Saved Cards grant canonical IDs; the profile-scoped native Hermes plugin
receives only selected `internal-plugin` definitions directly from that registry, the MCP host publishes
only `external-mcp` definitions, and IDD receives derived Builder-facing metadata. No publisher discovery
is fed back into the canonical registry, and `tool_manifest()` is a derived view rather than another owner.

For Hermes-backed Cards, the profile-scoped plugin registers model-facing LiquidAIty tools through the
public plugin registry using Hermes' exact `{name, description, parameters}` schema. Hermes continues to
own tool presentation, selection, validation, guardrails, approvals, hooks, dispatch, and result delivery.
Each invocation crosses one authenticated LiquidAIty host boundary; the host derives the source Card/runtime
from process and native session identity, and Python rails enforces the saved grant and current revision.
The plugin does not own grants, load IDD, cache a second catalog, copy implementations, launch a helper
service, or route internal operations through MCP.

MCP remains correct for external GPT clients and deliberately configured third-party/external servers.
It is not the internal execution bus for LiquidAIty tools inside Hermes. Both publishers reuse the same
Python definitions and implementations. A saved individual external-tool grant derives only its required
backing MCP connection; a separate connection checkbox is not required and sibling tools on that server
do not become granted. Stock `tools.configure` is durable profile projection and session rebuilding only;
it is never invocation-time authorization. Loaded proof shows Main using its selected internal
`engraphis_recall_context` operation through the native plugin and Python handler. External CBM/Graphiti
invocation and the incomplete Bot reply retain their separate proof boundaries in `PLAN.md`.

The native TUI and Bot Chat are proof surfaces for the same plugin-backed Card runtime, not reasons to
create separate tool paths. A public-contract failure stops the implementation; it does not authorize an
ACP-like host execution layer, callback protocol, session mirror, transcript owner, or worker runtime.

The existing Mag One Card remains the LiquidAIty bus authority. Saved `magentic_option` topology is
projected into one exact roster of enabled current Card revisions and Hermes profile bindings. The
headless adapter submits the reloaded canonical mission to Hermes' existing SQLite task/dependency
runtime with a root-scoped blue assignee ceiling. Root-created assignments are checked against that
scope; manually created worker descendants are self-scoped rather than inheriting the complete roster.
The adapter observes only outer execution state and returns the one verified native final-synthesis
summary. LiquidAIty does not copy native task, dependency,
attempt, or event rows into PostgreSQL/AGE; TypeScript does not schedule workers or fabricate a transcript.

## MCP and Codebase Memory

`apps/python-models/app/mcp_host.py` is the one official MCP host. It freezes one canonical external
publication view, preserves native tool schemas, and dispatches to the existing Python owners. External
account access uses the configured OAuth resource boundary. Internal Hermes Card tools use the same
protocol-neutral Python operation definitions through the native plugin and do not depend on MCP discovery.
Catalog/readback tests and loaded internal-tool execution are proven separately from external-client live
acceptance.

Codebase Memory is a native MCP dependency of that host. Canonical startup resolves the current official
`codebase-memory-mcp` command from the machine's normal installed PATH; the repository does not retain a
versioned copy or checksum pin. LiquidAIty owns one long-lived application stdio frontend. Codex Desktop may own one separate
frontend through its official direct registration, independent of LiquidAIty and GPT/plugin availability. Both
join the same upstream per-account daemon/cache/runtime identity outside the repository. Docker, Hermes, Cards,
plugins, and connectors do not launch another frontend. The upstream watcher owns ordinary freshness;
indexing/deletion are explicit application-MCP administrative operations.

`POST /api/codegraph/read` is not an additional CBM tool and not a second catalog. It is an
authenticated browser transport that checks the saved Card scope, permits only `list_projects`,
`index_status`, bounded `trace_path`, and the fixed graph projection, then asks Python rails to call
the actual `cbm.*` reads through the official host. The client uses it to hydrate CodeGraph UI state.

The canonical project is `C-Projects-LiquidAIty-main` at `C:/Projects/LiquidAIty/main`.

## Graph authorities and native observations

```text
ThinkGraph = Engraphis project reasoning and operational knowledge
KnowGraph  = Graphiti/Neo4j sourced knowledge and provenance
CodeGraph  = native CBM repository structure
AgentGraph = AGE Card topology and truthful execution observations
```

Each graph has one authority and one writer. Run-scoped Context Selections may carry bounded native
IDs, data, and provenance together in `in.idf`; that transport is not another graph and does not copy
ownership. Main chooses explicit ThinkGraph writes or deliberate delegation. Automatic completed-pair
extraction remains removed.

Visual activity may be driven only by real reads, selections, deliveries, traversals, writes, Run
completion, or failure. `native_attention.py` normalizes observable tool events. AGE may store stable
Run/reference/artifact identities, but it does not authorize a runtime, hold raw IDFs, choose a Card,
or control native lifecycle.

## UI and Builder

React/TypeScript renders Main Chat, Agent Canvas, graph views, Card/Run inspection, and Builder's lower
terminal. It may validate structured transport and render status. It may not interpret task meaning,
rank or route agents, merge graph semantics, infer knowledge access from prose, or fabricate native
activity.

Builder is the saved Card with stable ID/profile `builder`; Agent Builder is the workspace that edits
Cards and shows Builder's terminal. Creation, configuration, and invocation remain separate explicit
operations. Builder receives an ordinary mission and uses only its saved grants. There is no hidden
create/edit mode, PLAN loader, semantic TypeScript router, or alternate prompt envelope.

## Persistence and identity

- PostgreSQL stores saved Cards, decks, revisions, Runs, conversations, and artifact metadata.
- AGE/PostgreSQL stores accepted Card relationships and execution observations.
- Hermes profile homes store native configuration, sessions, memory, skills, and Kanban state.
- Engraphis, Graphiti/Neo4j, and CBM retain their own graph data.
- Durable source-operation identities use repository root plus relative path and content hash, never
  a machine-specific absolute path as the permanent identity.

Cleanup must not delete saved Cards, Runs, profiles, graph data, credentials, or shared state without
an exact owner-authorized target. Historical IDs may remain load-bearing compatibility contracts even
when their wording is old.

## Startup and loaded proof

Canonical development startup is `npm run dev:fresh`. It resolves the current official CBM command from PATH,
validates its native MCP server identity, and starts the supported local service graph. No cleanup task
may launch an extra CBM frontend, restart the daemon, or partially replace the supervisor.

Evidence tiers remain separate:

1. source and inverse-residue inspection;
2. focused contract tests;
3. production typecheck/build;
4. loaded service health and source hashes;
5. a real saved Card input and native output through Gateway/TUI;
6. external connector acceptance;
7. Jeremiah's visual acceptance.

A lower tier never proves a higher one.

## Controlled imported and vendored roots

`Hermes/`, `worldsignal/`, `Kronos-main/`, and other imported systems are controlled
upstream forks or first-party runtime source, not general cleanup targets. Prefer a public API,
protocol, configuration, hook, or existing adapter boundary. A justified vendor edit must record its
exact files/symbols, preserved upstream behavior, tests, fork cost, and rollback.

For Hermes, the retained local fork patches are the previously recorded extension, the bounded
direct-agent roster entry, and the root-scoped Mag One assignee ceiling in
`Hermes/LIQUIDAITY_VENDOR_PATCHES.md`. Direct-agent delivery remains upstream-owned; its roster entry
changes only profile-scoped local target authority. The Mag One entry changes only assignment authority
inside one explicitly bounded creator tree and leaves ordinary tasks unrestricted. Upstream ACP is not a
LiquidAIty runtime boundary. No other Hermes customization is silently accepted by this document.

## Current proof limits

- The ACP removal and Gateway consolidation are pushed source; the smaller residue deletions remain
  current working-tree source. Neither is loaded-process proof.
- The retained Team path still needs real Gateway input, native worker activity, synthesis, and returned
  output through the same saved Run.
- Native profile-scoped Bot roster source, focused tests, typechecks, and backend build are complete in the
  current working tree. The canonical stack loaded the saved roster endpoint successfully, then the existing
  Gateway client boundary failed before any Card session because
  `Hermes/apps/shared/src/json-rpc-gateway.ts` imports a non-existent sibling
  `json-rpc-channel.js` while only `json-rpc-channel.ts` is present. MCP readiness independently remained
  `503` because its one native CBM frontend could not attach to the already-active daemon within 30 seconds.
  Neither unrelated boundary was changed in this Bot pass. Ordinary Main, one real orange-connected Card Bot
  message/reply, unwired-profile live refusal, and no-alternate-machinery runtime inspection therefore remain
  unproven.
- Stable saved Card tool grants are enforced as the live Hermes registry surface through the native plugin.
  Main's selected `engraphis_recall_context` completed through Python rails in the canonical stack. Focused
  catalog tests prove publisher separation; external CBM/Graphiti live invocation remains outstanding.
- Native subagent configuration and actual child provider/model require a real child receipt; saved or
  projected selections alone are not execution proof.
- Mag One, graph attention, external MCP selection, and visual behavior retain their own acceptance
  boundaries.
