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

Baseline: branch `main`, HEAD `7974e62bbdb2a81413a814735c9a8ce337675b3c`
(`WORKING HERMES RUNTIME BEFORE CBM AND BOT MODE`). The cleanup is an uncommitted working tree and has
not been loaded into the running application.

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
- LiquidAIty-specific Hermes plugin/callback/private-host hooks and synthetic Team result injection;
- browser transcript/snapshot/native-event/Team-receipt projections owned by the abandoned path;
- automatic ThinkGraph completed-pair proxy/extraction that had been coupled to that route;
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
| Named-profile delegation | Contained fail-closed vendor branch and unit contract | Choose a supported Gateway extension or remove the branch; no ACP restoration |
| CodeGraph UI read | Direct route-to-Python-to-`cbm.*` source trace and existing tests | Loaded browser hydration when UI acceptance is authorized |
| Bot Mode | First-party Hermes source and documentation preserved unchanged | Separate Card/profile/presentation design and explicit implementation approval |
| Production boundaries | Backend and client production typechecks | Loaded build/source hashes and full product acceptance |

## Known baseline failures and environment limits

- The monolithic backend `savedCard.routes.spec.ts` contains two pre-existing Script-route expectations
  for `/idd/script-tools` and `/cards/script/validate` that have no production handlers at baseline.
  Their queued mocks cascade into five later failures when the entire file runs; the five pass when
  isolated. Script is an unrelated approved feature, so this cleanup does not delete or redefine those tests.
- The focused Python Card/MCP suite retains six pre-existing failures in unchanged earlier
  `card_domain.py` behavior: one presented-tools expectation and five delegation-grant expectations.
- Hermes' repository virtual environment does not contain `pytest`; this cleanup does not install a
  dependency into the vendored runtime. Python compilation and available application tests are separate proof.
- Hermes declares package version `0.21.0`, but the imported tree does not retain its original upstream
  commit SHA. The explicit vendor markers/register now contain only Team and profile, but an exhaustive
  unmarked-divergence audit requires first identifying the exact upstream base.
- The direct application-published CBM tools are unavailable to this Codex runtime. No alternate client,
  plugin, daemon launch, restart, direct cache read, or reindex is permitted. This cleanup therefore uses
  the documented source/Git fallback and reports CBM deletion proof as unavailable.

These are not converted into passing results by removing tests, adding mocks, fabricating data, or
restoring the retired runtime.

## Completion order for this cleanup

1. Finish exact old-identity, route, package, environment, documentation, and vendor-marker scans.
2. Run focused backend, client, Python, and Hermes compilation proof without installing or restarting.
3. Run production typechecks/builds for touched TypeScript boundaries.
4. Inspect the complete diff and every surviving former neighbor; classify every remaining ACP hit as
   either upstream Hermes functionality, historical recovery material, or a defect.
5. Return one implementation report with exact deletions, preserved owners, baseline failures, gaps,
   and Regression Ratio. Do not start Bot Mode implementation in the same change.

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
