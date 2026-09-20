# LiquidAIty current plan

[Execution law](AGENTS.md) · [Known failures](DONT.md) · [Current architecture](ARCHITECTURE.md) · [Deferred work](FUTURE.md)

PLAN records the current route and proof gaps. It is not a model prompt, task ledger, runtime input,
or historical execution diary.

## Product outcome

A user talks to Main or deliberately invokes a saved Card, the exact saved Card authority and current
input produce one canonical IDF, the selected native runtime performs real work, and the application
shows truthful output, references, artifacts, usage, failure, and lineage without losing saved state.

Shared chat sends an unaddressed user turn to Main and an explicitly addressed turn directly to the
authorized saved Card. Builder remains the saved `builder` Card and the lower terminal in Agent Builder.
Hermes owns native Card execution, delegation, and the task/dependency execution beneath Mag One; the
four graph authorities remain separate.

## Current Mag One execution-engine cutover — September 19, 2026

### Requested Delta

Keep the existing `card_magentic` product identity, Canvas node, blue `magentic_control` and
`magentic_option` connections, canonical `in.idf`, saved Card authorities, and ordinary outer Run.
Replace only the live Microsoft executor beneath that bus with headless Hermes orchestration and its
existing SQLite task/dependency machinery. No legacy executor fallback or historical-Run compatibility
path remains live.

### Current working-tree source

- Python projects the exact enabled blue-connected Card identities, current revisions, and saved Hermes
  bindings through the same saved-topology projection pattern already used by direct Card relationships.
- Before submit, the backend materializes and rereads the exact saved prompt, provider/model, tools,
  skills, plugins/MCP, and profile for the Mag One Card and every worker without opening a visible TUI.
- Python reloads the retained canonical `in.idf`, requires exact mission equality, and creates one
  idempotent native root assigned to the saved Mag One profile.
- The native root carries an assignee scope containing only that profile and the projected workers.
  Root-created assignments are checked against that blue scope; manually created worker descendants
  are self-scoped instead of inheriting the whole roster. Ordinary Hermes tasks remain unrestricted
  when the field is absent.
- The root model performs decomposition and must create one final dependency sink assigned back to the
  Mag One profile. Structured status returns only the verified native final summary.
- PostgreSQL retains one product-level invocation/lineage Run. Hermes SQLite exclusively owns native
  tasks, dependencies, attempts, assignment, retries, and task state; none is copied into PostgreSQL/AGE.
- The bus remains headless. The existing Results area shows ordinary outer Run state and the real final
  answer only—no CLI, task feed, transcript, active-worker display, board, or fabricated artifacts.
- The checked-in AutoGen fork, adapter package, Python executor, routes, package dependencies, and live
  runtime contracts are removed. Applied migrations and checksum-bound recovery evidence may still name
  the removed runtime, but no production caller can select it.

Static source/tests/build proof and one restarted real saved-product execution remain separate tiers.
Do not describe this working tree as loaded runtime proof until both are completed.

## Current shared-chat direct addressing — September 18, 2026

The shared composer obtains callable addresses from the existing Python-owned saved Hermes Bot-roster
projection. It performs case-insensitive prefix autocomplete and Tab completion without another registry.
A leading address is resolved before inference. The addressed saved Card receives the exact user text
through its ordinary canonical Run/IDF and profile-scoped Gateway session; Main has no Run, inference,
acknowledgement, or `message_agent` role in that turn. Only a completed native target response is stored
and rendered with target identity. An unavailable address fails before either target or Main execution.

The existing normalized conversation tables retain the exact completed shared-chat projection so speaker
and target identity survive reload. On a later unaddressed turn, Main alone receives a bounded mechanical
projection of the shared exchange plus the current user message. Main's independent model-chosen native
`message_agent` capability remains the only Card-to-Card conversational doorway and is not used to fake
direct user addressing.

## Current Hermes tool boundary — September 16, 2026

### Confirmed current state

- Python rails derives the saved Card's `enabledTools`, `unavailableTools`, `presentedTools`, schemas,
  skills, native toolsets, and MCP connection IDs before Hermes inference.
- The current Hermes profile materializer applies and reads back only the parent model, selected skills,
  and native subagent model. It does not make the Card's selected LiquidAIty tools callable in Hermes.
- IDF tool text is context, not registration. Stock Hermes presents and dispatches only tools in its
  native registry snapshot, populated by built-ins, enabled native plugins, and deliberately configured
  external MCP servers.
- Stock `tools.configure` edits durable profile toolsets and may rebuild a session agent. It is not
  Run-scoped authorization and cannot replace the saved Card/Run grant check.

The current mismatch is therefore explicit:

```text
saved Card and Python rails know the intended grant
Hermes independently owns the actual model-facing registry
```

### Approved direction

Internal LiquidAIty capabilities for Hermes-backed Cards will be joined to Hermes through a native,
profile-scoped Hermes plugin using the public `PluginContext.register_tool` contract. MCP remains the
publication boundary for external clients and deliberately external MCP servers; it is not the internal
Hermes-to-LiquidAIty execution bus.

The plugin is a runtime projection, not another authority. It must not copy tool implementations, own a
catalog, launch a service, infer grants, or accept caller-supplied Card/Run scope. Hermes owns tool schema
presentation, model selection, dispatch, guardrails, approvals, hooks, and result delivery. The
authenticated LiquidAIty host derives the calling Card/runtime from process and native session identity;
Python rails reuses the saved Card and current execution authority and invokes the one existing operation
owner. External MCP publication and the Hermes plugin must share that protocol-neutral Python operation
core rather than call one another.

The bounded implementation must still settle and prove two contracts before it can be called complete:

1. exact per-Card visibility without treating durable `tools.configure` state as Run authorization; and
2. the authority for a native Bot turn that intentionally has no fabricated application Run. A missing
   Run-dependent grant must fail closed; it must not be replaced by a synthetic Run, broad profile token,
   MCP credential, or plugin-owned policy.

## Current cleanup — September 15, 2026

Baseline: branch `main`, pushed cleanup HEAD `0ed7fb63314ec00e0762ddeccd86417a5dce883b`
(`LIQUIDAITY CLEANUP WORK IN PROGRESS`). The smaller residue cleanup after that commit remains an
uncommitted working tree and has not been loaded into the running application.

### Requested Delta

Keep saved Hermes Card execution on the existing native Gateway/TUI path. Native `message_agent`,
authorized between both endpoints of an enabled orange `flow` connection, is the only Card-to-Card
conversational path. Preserve the one intended Hermes extension: native `delegate_task(role="team")`.

### Preservation Set

- saved Cards, Card revisions, Runs, conversations, profiles, native sessions, credentials, and graph data;
- one canonical Python-owned IDF and saved-Card grant authority;
- Main, Builder, ordinary Hermes Cards, native Gateway/TUI, and honest Run completion;
- upstream Hermes ACP as dormant vendor functionality, not a LiquidAIty execution route;
- native Hermes Bot Mode source, desktop UI, Gateway methods, profile/session state, routines, and peer relay;
- upstream `leaf`/`orchestrator`, retained native Team, and native Bot Mode;
- Card-owned Python Script source, compiler, validation, editor, saved configuration, IDF presentation,
  and historical Run receipt data;
- the existing Mag One Card, Canvas topology, blue worker connections, and outer Run/IDF boundary;
- ThinkGraph, KnowGraph, CodeGraph, and AgentGraph owners and data;
- the authenticated `/api/codegraph/read` UI transport to actual application-published `cbm.*` reads;
- unrelated imported roots and application features.

### Removed path

- backend ACP `mainAdapter`, host execution lifecycle, child execution-context, worker bearer,
  profile-delegation adapter, internal callback routes, and callback startup;
- editable `apps/hermes-liquidaity-plugin` package and its installed editable distribution in the
  repository Hermes virtual environment;
- Python `hermes_acp_bridge` and its HTTP/MCP execution-context routes;
- LiquidAIty-specific Hermes plugin/callback/private-host execution hooks and synthetic Team result injection;
- browser transcript/snapshot/native-event/Team-receipt projections owned by the abandoned path;
- automatic ThinkGraph completed-pair proxy/extraction that had been coupled to that route;
- the orphan ACP MCP-connection materializer and its self-contained spec after `mainAdapter` lost its
  last production caller;
- the abandoned deck-workspace resolver and its self-contained spec after the old Agent Builder
  operation surface stopped using it;
- the disconnected NetworkX ThinkGraph community/gap projection, its ceremonial test block, and the
  Python-rails-only direct `networkx` pin;
- the unused direct backend `zod` dependency edge; the MCP SDK retains its own required transitive copy;
- noncanonical build journals and stale architecture claims that described removed code as current;
- accidentally tracked Windows cache database files under `Hermes/%SystemDrive%`.

Hermes' upstream `acp_adapter/` implementation and tests remain. Native Bot Mode remains. CodeGraph read
remains because inspection proved it is an authenticated UI transport to the real canonical CBM tools,
not the fabricated standalone tool initially suspected.

## Current evidence matrix

| Boundary | Current source evidence | Still required |
| --- | --- | --- |
| Deleted ACP identities | Exact source/test/route/package searches and inverse-neighbor inspection | CBM after-watcher deletion/edge proof when the application doorway is available |
| Gateway consolidation | Backend source and focused terminal/Run contracts | Canonical reload; real input, stream, persisted completion, reconnect, and Stop |
| Profile materialization | Extracted current owner plus focused tests/typecheck | Real saved parent/skills/child selections and actual child receipt |
| Native Team | Contained vendor source, retained tests, and compilation | Real Gateway Team creation, workers, synthesis, rejoin, and same saved Run |
| Native Card Bot Mode | Python projects ordered symmetric orange peers into each managed profile's explicit `bot_mode.roster`; explicit `[]` denies all while a truly absent key preserves stock standalone discovery; prompt and stock `message_agent` share one resolver; duplicate host/plugin authorization is removed | Canonical reload, ordinary Main, real attributed orange-peer reply, unwired-profile refusal, and no-alternate-machinery inspection |
| Shared-chat direct Card addressing | Canonical saved-roster resolution, target saved-Card Run/Gateway route, exact-message preservation, participant persistence, autocomplete, failure attribution, and focused backend/client/Python tests | Canonical reload; real Builder exact reply, identity persistence, later Main context, and preserved independent Main-to-Builder native delegation |
| CodeGraph UI read | Direct route-to-Python-to-`cbm.*` source trace and existing tests | Loaded browser hydration when UI acceptance is authorized |
| Card Python Script | Python compiler/header/validation, restored Card editor, IDF projection, saved-data normalization, route tests, and honest `card_script_native_bridge_unavailable` fallback | A separate approved Hermes-native/plugin execution design; no ACP bridge restoration |
| Hermes Card tools | Canonical Python `OperationDefinition` registry, publisher-separated views, stable per-Card plugin materialization/readback, focused tests, and loaded Main `engraphis_recall_context` execution | Prove selected external CBM/Graphiti execution and unavailable reasons through their actual configured servers; Bot reply proof remains separate |
| Production boundaries | Backend and client production typechecks | Loaded build/source hashes and full product acceptance |

## Known baseline failures and environment limits

- The deleted Script route/rail/editor boundary was a cleanup regression, not removable ACP residue.
  `/idd/script-tools` and `/cards/script/validate` are restored, the Python compiler and Card editor are
  present again, saved Script data remains readable, and ordinary Runs retain their exact model-visible
  tool presentation while native execution reports `card_script_native_bridge_unavailable`.
- The focused Python Card-domain suite covers reciprocal ordered orange projection, blue-edge isolation,
  disabled/unwired exclusion, two-sided revocation, and profile-ambiguity failure. Native `message_agent`
  remains the conversational doorway; no application Bot host/authentication route survives.
- Client production typecheck passes. Client spec typecheck has unrelated existing errors in Agent
  Manager mocks, Testing Library role options, graph/team specs, and imported Hermes desktop aliases/types;
  none references a file removed by this cleanup.
- Hermes' repository virtual environment does not contain `pytest`; this cleanup does not install a
  dependency into the vendored runtime. Python compilation and available application tests are separate proof.
- The Hermes vendor register pins upstream 0.21.3 at
  `73521a8e375a867fae14ec0579f2dfb47aa0017e`; its intentional divergence manifest contains Team and the
  bounded profile-scoped native Bot-roster contract. Bot delivery remains stock Hermes.
- Direct Codex CBM produced useful structural evidence, but repeated frontend calls accumulated duplicate
  client processes. Twenty-seven exact duplicate frontends were stopped while the one frontend owning the
  upstream daemon was preserved. No reindex, cache mutation, alternate host, or daemon replacement was
  performed; further discovery used bounded current-source reads.
- The canonical roster endpoint loaded the real saved `deck_builder` after removing an invalid dependency on
  absent legacy `deckRevision` metadata. Startup then stopped at the unchanged Gateway-client module boundary:
  `json-rpc-gateway.ts` imports missing `json-rpc-channel.js` although the source tree contains
  `json-rpc-channel.ts`. MCP publication separately stayed at `503` after its native CBM frontend timed out
  attaching to the already-active daemon. This Bot pass did not change either unrelated owner.

These are not converted into passing results by removing tests, adding mocks, fabricating data, or
restoring the retired runtime.

## Completion order for this cleanup

1. Finish exact old-identity, route, package, environment, documentation, and vendor-marker scans.
2. Run focused backend, client, Python, and Hermes compilation proof without installing or restarting.
3. Run production typechecks/builds for touched TypeScript boundaries.
4. Inspect the complete diff and every surviving former neighbor; classify every remaining ACP hit as
   either upstream Hermes functionality, historical recovery material, or a defect.
5. Return one implementation report with exact deletions, preserved owners, baseline failures, gaps,
   and Regression Ratio. Bot Mode and the Hermes tool boundary remain separately proven working-tree
   changes, not permission to restore any removed ACP path.

## Next bounded proof boundary

The native profile-scoped Bot roster and application projection are implemented in the working tree. The
canonical load reached saved-state projection but failed before a Hermes Card session at the existing shared
TypeScript Gateway module-resolution boundary. Repair and independently prove that exact canonical Gateway
client import in a separately authorized pass; do not fold it into Bot delivery or roster logic. Once that
boundary and the independently owned MCP/CBM readiness failure are healthy, continue with existing-state
acceptance:

- prove ordinary Main returns a real Hermes response;
- inspect existing saved topology without creating Cards or edges;
- send one harmless message between two existing enabled orange-connected Hermes Cards;
- prove the source roster excludes an existing unwired live profile and stock `message_agent` rejects it;
- prove the receiving canonical `Bot Chat`, sender attribution, native acknowledgement/completion, and
  attributed reply notification; and
- prove Hermes chose delivery without a Card Run, application queue, callback, waiter, correlator,
  alternate executor, or duplicate Bot session.

Do not force live/offline branches by changing state, restore the deleted Bot host/plugin, expose a Gateway
credential, add a delivery adapter, or begin Builder/AutoBot work. If existing saved state lacks two valid
orange-connected Cards, stop at that exact product-proof blocker.
