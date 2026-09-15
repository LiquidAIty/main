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
| Bot Mode | First-party Hermes source and documentation preserved unchanged | Owner-supplied implementation packet is active; prove the stock Main-to-Builder canonical `Bot Chat` contract before application edits |
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
- The direct Codex CBM tools are registered, but the first `codex_cbm.search_graph` discovery batch
  returned `Transport closed`. No unchanged retry, plugin fallback, daemon launch/restart, cache read, or
  reindex is permitted. This cleanup therefore uses the documented source/Git fallback and reports CBM
  relationship/deletion proof as unavailable.

These are not converted into passing results by removing tests, adding mocks, fabricating data, or
restoring the retired runtime.

## Completion order for this cleanup

1. Finish exact old-identity, route, package, environment, documentation, and vendor-marker scans.
2. Run focused backend, client, Python, and Hermes compilation proof without installing or restarting.
3. Run production typechecks/builds for touched TypeScript boundaries.
4. Inspect the complete diff and every surviving former neighbor; classify every remaining ACP hit as
   either upstream Hermes functionality, historical recovery material, or a defect.
5. Return one implementation report with exact deletions, preserved owners, baseline failures, gaps,
   and Regression Ratio. The subsequent owner-supplied Bot Mode packet is a separate bounded feature.

## Next bounded decision after cleanup

First reload through canonical `npm run dev:fresh` only when Jeremiah explicitly authorizes it. Then
prove one ordinary saved Hermes Card turn and one native Team turn through the new Gateway path. If
those receipts are sound, prepare the Bot Mode Card/profile matrix and design from Hermes' actual
profile, canonical Bot Chat, routines, room, peer, Gateway, and desktop contracts.

The Bot Mode design must answer before code:

- which saved Card fields map exactly to an existing Hermes profile and which Bot metadata is only
  presentation;
- whether LiquidAIty embeds/uses Hermes' native desktop Bot surfaces or renders a compatible Card view;
- how one Card/Run/IDF relates to a Bot's forever chat and background routine without creating a second
  history or scheduler;
- how Main, Builder, Graph Agent, and other saved Cards appear as cards/bots without merging identities;
- which current path is replaced and what observable result decides keep versus remove.

No Bot Mode code, Card mutation, profile mutation, service restart, database operation, dependency
installation, commit, or push is authorized by this plan.
