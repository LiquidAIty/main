# LiquidAIty current plan

[Execution law](AGENTS.md) · [Known failures](DONT.md) · [Current architecture](ARCHITECTURE.md) · [Deferred work](FUTURE.md)

PLAN records the current route and proof gaps. It is not a model prompt, task ledger, runtime input,
or historical execution diary.

## Product outcome

A user talks to Main or deliberately invokes a saved Card, the exact saved Card authority and current
input produce one canonical IDF, the selected native runtime performs real work, and the application
shows truthful output, references, artifacts, usage, failure, and lineage without losing saved state.

Main remains the conversation front door. Builder remains the saved `builder` Card and the lower
terminal in Agent Builder. Hermes owns native Card execution and delegation; AutoGen owns Magentic-One;
the four graph authorities remain separate.

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

Remove the abandoned LiquidAIty ACP architecture and all of its live source, tests, packaging, and
canonical-documentation residue. Consolidate saved Hermes Card execution on the existing native
Gateway/TUI path. Preserve only the two explicitly intended Hermes changes: native
`delegate_task(role="team")` and `delegate_task(role="profile")`.

### Preservation Set

- saved Cards, Card revisions, Runs, conversations, profiles, native sessions, credentials, and graph data;
- one canonical Python-owned IDF and saved-Card grant authority;
- Main, Builder, ordinary Hermes Cards, native Gateway/TUI, and honest Run completion;
- upstream Hermes ACP as dormant vendor functionality, not a LiquidAIty execution route;
- native Hermes Bot Mode source, desktop UI, Gateway methods, profile/session state, routines, and peer relay;
- upstream `leaf`/`orchestrator`, retained native Team, and the retained fail-closed profile branch;
- Card-owned Python Script source, compiler, validation, editor, saved configuration, IDF presentation,
  and historical Run receipt data;
- Magentic-One and accepted AutoGen primitives;
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
| Named-profile delegation | Contained fail-closed vendor branch, exact-profile authority, internal-handle filtering, and unit contract | Supported Gateway-native host request and real result return; no ACP restoration |
| CodeGraph UI read | Direct route-to-Python-to-`cbm.*` source trace and existing tests | Loaded browser hydration when UI acceptance is authorized |
| Card Python Script | Python compiler/header/validation, restored Card editor, IDF projection, saved-data normalization, route tests, and honest `card_script_native_bridge_unavailable` fallback | A separate approved Hermes-native/plugin execution design; no ACP bridge restoration |
| Bot Mode | First-party Hermes source plus the thin working-tree managed interception/profile-resolution boundary | Prove stock Main-to-Builder delivery and native reply through the canonical `Bot Chat`; source/tests are not loaded-runtime acceptance |
| Hermes Card tools | Python saved-grant/IDF materialization and stock Hermes plugin/registry contracts | Implement the approved native-plugin projection and prove exact Main/Builder visibility plus invocation-time Python authorization |
| Production boundaries | Backend and client production typechecks | Loaded build/source hashes and full product acceptance |

## Known baseline failures and environment limits

- The deleted Script route/rail/editor boundary was a cleanup regression, not removable ACP residue.
  `/idd/script-tools` and `/cards/script/validate` are restored, the Python compiler and Card editor are
  present again, saved Script data remains readable, and ordinary Runs retain their exact model-visible
  tool presentation while native execution reports `card_script_native_bridge_unavailable`.
- The focused Python Card-domain suite now passes, including the Hermes model-facing removal of the
  internal `card.run_assistant_agent` handle while native profile delegation remains the named doorway.
- Client production typecheck passes. Client spec typecheck has unrelated existing errors in Agent
  Manager mocks, Testing Library role options, graph/team specs, and imported Hermes desktop aliases/types;
  none references a file removed by this cleanup.
- Hermes' repository virtual environment does not contain `pytest`; this cleanup does not install a
  dependency into the vendored runtime. Python compilation and available application tests are separate proof.
- Hermes declares package version `0.21.0`, but the imported tree does not retain its original upstream
  commit SHA. The explicit vendor markers/register now contain only Team and profile, but an exhaustive
  unmarked-divergence audit requires first identifying the exact upstream base.
- Direct Codex CBM produced useful structural evidence, but repeated frontend calls accumulated duplicate
  client processes. Twenty-seven exact duplicate frontends were stopped while the one frontend owning the
  upstream daemon was preserved. No reindex, cache mutation, alternate host, or daemon replacement was
  performed; further discovery used bounded current-source reads.

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

## Next bounded implementation decision

The native Hermes-plugin route above is the preferred architecture. Before implementation, compare the
bounded variants in the active task's options matrix and select only the smallest variant that proves:

- one profile-scoped plugin registration enters Hermes' real registry;
- Main sees exactly its saved internal tools plus deliberately selected native/external tools;
- Builder sees its own exact, independent selection;
- one tool call crosses one authenticated internal invocation boundary and executes through the existing
  Python operation owner;
- caller-supplied Card, Run, project, deck, or grant data cannot widen authority;
- an unavailable plugin, schema, grant, or execution identity fails closed; and
- external GPT/MCP behavior remains unchanged.

Do not edit `Hermes/`, restore ACP, route internal Hermes tools through MCP, create a second catalog or
dispatcher, or use profile configuration as invocation-time authorization. Live model sends and browser
acceptance follow source, focused-test, typecheck, and canonical-stack readiness proof.

This implementation has an explicit anti-ACP stop condition: if stock plugin handlers plus existing
native session/task identity cannot support one authenticated call into the Python operation owner, stop
and document that precise public-contract gap. Do not add a host execution lifecycle, callback registry,
worker protocol, session mirror, transcript projection, capability daemon, or replacement runtime.
