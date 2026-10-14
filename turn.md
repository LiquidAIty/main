# Turn report — Card/Hermes recovery source-ready checkpoint

Date: 2026-10-14 (America/New_York)
Primary: Codex `/root`
Repository: `C:/Projects/LiquidAIty/main`
Status: **SOURCE READY FOR THE FIRST COORDINATED LOADED TEST; LOADED PRODUCT BEHAVIOR IS NOT YET PROVEN**

## Requested Delta

Recover one coherent application path from the restored UI through saved Card authority and the
repo-owned Hermes adapter. Remove the abandoned shared-chat/runtime, arbitrary target executor,
application callback-tool protocol, duplicate session/tool owners, fake controls, aliases, and stale
tests. Preserve the UI, saved data, Project topology, graph authorities, Card Python editor/executor,
Hermes profiles, and current provider/model/reasoning controls.

The owner explicitly deferred graph redesign and automatic ThinkGraph completed-pair capture. The
later saved Project control is named **Capture Main turns automatically**; it was not implemented in
this recovery.

## Preservation Set

- The restored Main Chat, Agent Canvas, Card inspector, WorldView/God's Eye, graph inspectors, model
  picker, reasoning picker, Tools selection, and Card Python editor remain.
- Main is a saved Hermes Card/profile and the only headless Card; it is not a separate runtime.
- Every non-Main Card retains its own Hermes profile/session and terminal surface.
- Saved Cards, Card revisions, grants, Runs, Projects, conversations, images, graph data, and profile
  learning state are not reset or reseeded.
- Orange `flow` and blue `magentic_option` remain separate Project-owned authorities.
- ThinkGraph, KnowGraph, CodeGraph, and AgentGraph retain their existing owners and writer boundaries.
- Card Script source remains saved and editable. Disabled, blank, or invalid source is inert; valid
  enabled source is projected through the existing Hermes child-Python runner.
- No provider, model, tool, session, or runtime fallback was added.
- No Git mutation, staging, commit, branch, reset, restore, stash, clean, pull, fetch, or worktree
  operation was performed.

## Current execution design

### Saved Card and Project sessions

- A saved Card revision owns identity, prompt, Hermes mode/profile, provider/model/reasoning, grants,
  Script, and topology membership.
- Each enabled Hermes Card has one exact hidden session per Project. A different Project gets a
  different session; users do not select Hermes sessions independently of Projects.
- Profiles carry no install-wide Project roster. The application supplies the exact current Project
  roster and profile-to-session mapping.
- A Project-scoped target with no exact live session owner fails `runtime_offline`; Hermes does not
  start a CLI fallback.

### Orange Bot delivery

- A non-Magnetic Hermes Card has explicit outbound orange authority. Main is the source-default
  orchestrator; another Card can deliberately enable the same setting.
- Orange `flow` targets are exact saved Cards. Visibility does not create authority, reverse an edge,
  or add a blue worker.
- Direct `@Card` narrows the turn roster to that exact target. The recipient answer is observed and
  persisted under the recipient Card identity; Main finishes internally with `[SILENT]` and does not
  produce a second visible answer.
- A consultation keeps notification delivery and continues the same still-open Main Run after the
  correlated Hermes process completion.
- Orange `flow` may call the saved Magnetic Card. Blue `magentic_option` independently defines only
  Magnetic's worker roster.

### Receiving Card Run and IDF

- Main, a Card terminal, and an orange recipient all enter the same receiving-Card lifecycle.
- The backend transports exact Project/Card/Run identity; Python rails begins the existing outer Run,
  materializes and reloads one canonical `in.idf`, and returns the mechanical Hermes request.
- Hermes starts and finishes that same Run around inference. A new notification turn creates a child
  Run; a correlated consultation continues the already-open parent Run.
- Provider usage remains unknown when Hermes does not report it; missing usage is never converted to
  zero.
- Input retention no longer has a second failure-settlement owner. The accepted-Run lifecycle alone
  settles preparation failure.

### Tools, profiles, and Card Script

- Saved application tools are exact include-filtered tools on the Card profile's `liquidaity` MCP
  connection. OAuth plus Project/profile/Run headers resolves the exact saved grant at request time.
- AutoTools may narrow the loaded saved set for one turn; it cannot grant a tool.
- The deleted Card-runtime MCP principal and per-turn callback URL/token/schema protocol remain absent.
- Internal MCP principals are limited to catalog reading and exact read-only pre-materialization work.
- Codex app-server's own session protocol exposes only the two session-bound Hermes capabilities
  `message_agent` and `card_python`; it is not an application tool-authority path.
- `card_python` dispatches nested calls through tools already registered on that profile. Runtime
  failure removes the compact Script capability and restores only its previously wrapped saved tools
  for the next model iteration.

### Magnetic

- Main can hand an approved mission to the saved Magnetic Card over orange authority.
- Magnetic's exact enabled blue roster is the assignment ceiling. Titles, installed profiles, or
  global discovery cannot add a worker.
- Hermes owns task rows, dependencies, attempts, dispatch, retries, workers, and same-root final
  synthesis. LiquidAIty owns one outer Run and does not copy the task ledger.
- The retired worker configuration fingerprint was removed; immutable Card revision ID/profile
  bindings remain the worker authority.

## Removed or retired paths

- application-owned shared chat/terminal and Card runtime dashboard;
- generic arbitrary Card executor and compatibility aliases;
- application per-turn tool-definition/callback URL/auth protocol;
- Hermes `agent/dynamic_tools.py` and `agent/transports/dynamic_tools_mcp.py` application bridges;
- saved OpenAI runtime selector and provider API mode projection;
- max-turn, max-token, temperature, Last Run, status, accepted-time, and started-time UI controls;
- nested `runtimeOptions.enabled`; Card enablement has one top-level field;
- embedded per-Card Team configuration and obsolete WorldView-as-tool-authorization filtering;
- local conversation/session selector separate from Project identity;
- obsolete source-string/mock tests for deleted components and routes.

Historical database columns and migration literals remain where required to read or clean old rows.
Untouched upstream Hermes provider sampling, token limits, aliases, and platform behavior are not
LiquidAIty Card controls and were not removed.

## Defects found and corrected during the proof pass

1. Orange target projection reused the blue-worker filter and rejected the Magnetic Card. The shared
   topology helper now excludes Magnetic only for blue worker projection.
2. Canonical IDF retention and accepted-Run preparation both tried to settle the same input failure.
   Settlement now has one owner.
3. Migration 058 existed but was absent from the backend migration registry. It is now registered and
   covered by the migration ledger tests.
4. Two restored client modules retained references to deleted JEV/effective-agent state. The dead
   references were removed; no compatibility object was added.
5. The root Vitest harness still named obsolete WorldView virtual modules. It now matches the direct
   WorldView mount used by the production client build.
6. Surviving tests still asserted address aliases, Card status, nested enablement, embedded Team data,
   the deleted Card-runtime MCP principal, and disabled Script execution. Those assertions were removed
   or rewritten against current contracts.

## Deterministic evidence

| Boundary | Result |
| --- | --- |
| Focused Card/Run/topology/IDD/tool Python batch | 157 passed |
| Full application Python suite | 393 passed |
| Full repository TypeScript/Vitest suite | 403 passed, 1 skipped |
| Client source TypeScript check | passed |
| Backend source TypeScript check | passed |
| Client spec TypeScript check | passed |
| Backend spec TypeScript check | passed |
| Backend production build | passed |
| Client production build | passed |
| Affected Hermes files, Windows-filtered | 113 passed, 3 skipped, 3 exact platform assertions deselected |
| Affected Hermes files, unfiltered | 113 passed, 3 skipped, 3 Windows/POSIX-only failures |
| Authored-tree `git diff --check` | passed with the generated overlay excluded; only line-ending conversion warnings were emitted |
| Generated Gateway TypeScript SHA-256 | `A90A760603903A2A6D6F520C19CCB1507B22511BD7302654A735079E5EC71725` |
| Generated Gateway OpenRPC SHA-256 | `88AC88B898748DE8AC111CF755BA3FB0AD4E0642DE4DBBDB8FD9813429AB5478` |
| Hermes overlay SHA-256 | `49F87A94C9106798FCC448EFEDDFA5C8A24CFC3D115DE032DD89857396114785` |
| Hermes overlay reverse-apply check | passed |

The three unfiltered Hermes failures are one slash-spelling assertion for a Windows executable path and
two POSIX `0700` mode-bit assertions on Windows. They are not changed product behavior and were not
patched. The application Python suite emits one upstream Graphiti Pydantic-v2 deprecation warning. The
client build retains existing God's Eye browser-externalization and large-chunk warnings. The TypeScript
suite emits React `act` warnings in the Magnetic task test and intentional stderr from failure/recovery
tests; it has no failed tests. The generated overlay preserves whitespace-only lines present in the exact
Hermes baseline-to-current diff, so checking the patch artifact itself as authored source reports those
literal `+ ` lines; its stronger reverse-apply check passes.

## Source and contract inspection

- The owner-required Codebase Memory CLI reindex/map ran once at the start of the PromptSpec work. No
  CBM MCP call, second reindex, daemon repair, cache/database access, or alternate frontend was used.
- Current source was read directly after the bounded CLI map; source won every disagreement.
- Python syntax, TypeScript/TSX syntax, JSON, IDD/TOML, PostgreSQL placeholder counts, generated Gateway
  contracts, retired-route residue, and changed-file whitespace were checked during the source gate.
- `HermesLatest/LIQUIDAITY_OVERLAY.patch` was regenerated from import commit
  `68b2014e7dbdf502d176e36fc4817a857ae1ce2c`, including the three new Hermes files, excluding itself,
  and reverse-checked against the exact current tree.

## Proof not yet claimed

No application service or browser UI was started after this source freeze. This report does **not**
claim:

- migrations applied successfully to the owner's current database;
- loaded backend/Python rails/Hermes/MCP source identity or health;
- OAuth login or profile-tool readback;
- a provider response from Main or any other Card;
- direct orange delivery, consultation continuation, child Run lineage, or terminal attachment in the
  loaded product;
- Card Script success/failure recovery in a real turn;
- Team or Magnetic execution;
- ThinkGraph/KnowGraph writes, external-client acceptance, or visual acceptance.

## Next ordered acceptance

1. Load the existing stack through its normal launcher and verify exact source identity plus migrations.
2. Verify Project/deck/Card/profile readback without changing saved data.
3. Run one ordinary Main turn.
4. Run one explicit direct `@Card` turn and one Main consultation, checking persisted speaker/target and
   Run identities.
5. Run one non-Main Card terminal turn.
6. Verify one saved profile OAuth tool call and Card Script success/failure recovery.
7. Keep Team, Magnetic, graph writes, external clients, and owner visual acceptance as separately
   authorized proof tiers.

The automatic ThinkGraph caller, its saved Project toggle, quick-Web expansion, graph optimization,
general Card Hooks design, and any UI redesign remain deferred.

## Working-tree snapshot

The repository was already dirty and contains owner work plus earlier recovery changes. The Primary
preserved that tree and does not claim authorship of every listed path. At this checkpoint, the exact
changed/untracked/deleted manifest excluding this report contains 190 entries: 160 existing files and
30 deleted paths. Its manifest algorithm is sorted repository-relative paths, with each existing file
recorded as `F<TAB>path<TAB>SHA256` and each absent path as `D<TAB>path`, UTF-8 joined with LF and a
final LF. Manifest SHA-256:

`9C468A0ED30A65700872A6AF51EDB6C85CDDB9548D7AF17DF97A07B5E8F0986C`

This snapshot is evidence of the preserved dirty tree, not a request to stage or commit it.
