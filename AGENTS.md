# AGENTS.md — LiquidAIty execution law

This file tells every coding agent how to work in `C:\Projects\LiquidAIty\main`. It is repository law, not a
product prompt and not a substitute for current source, tests, or runtime proof.

## Start here

Before doing anything else:

1. Read [PLAN.md](./PLAN.md) completely.
2. Read the relevant `skills/*.md` procedures.
3. Establish Git and native Codebase Memory state.
4. Use CBM to resolve the structural slice.
5. Direct-read the current source CBM identified.
6. Only then plan or edit.

The repository has deleted well over 200,000 lines of layered experiments. The most important rule is:

> When an approach changes, delete the abandoned path in the same implementation change. Never
> declare a replacement complete while the replaced path remains live.

Law in one line:

```text
TypeScript = transport and pixels
Python rails = runtime and deterministic computation
models = semantic reasoning
saved cards and graph topology = identity and authority
```

Do not imitate nearby spaghetti. Follow this file.

---

## Current truth versus approved target

Never collapse CURRENT and TARGET into one claim.

### CURRENT

- Main Chat, Agent Builder, Local Coder, and Kanban are saved Cards served through one persistent
  repo-owned Hermes ACP adapter with separate profiles, sessions, memory, prompts, parent models,
  bounded-subagent model selections, and grants.
- Local Coder is the Hermes delegate Card `card_local_coder` / profile `coder`, owns work against an
  explicitly selected local repository, remains a Magentic-One option, and is not Agent Builder.
- Agent Builder is Main's directly connected Hermes implementation/coding Card. Main Chat remains the
  upper conversation and the lower split is another presentation of this same saved Agent Builder
  Card/Run authority. Agent Builder also owns approved Card construction/configuration, canvas wiring,
  agent UI, IDD, Agent Maker, and CBM work; it is not connected to Magentic-One and receives no Local
  Coder state.
- OpenClaude, the removed standalone LocalCoder runtime, and Bun are absent from the supported
  dependency graph. The user-facing Local Coder is Hermes-backed.
- Microsoft AutoGen 0.7.5 is checked in at `autogen-main` as first-party execution infrastructure;
  Python rails install its three packages only from that tree. The 0.7.5 upstream base is frozen;
  do not upgrade or rebase it onto later Microsoft AutoGen versions.
- The canonical stack, direct saved Main response, and saved Local Coder account-backed Run are live-proven.
  Main-to-Agent-Builder, Main-to-Kanban, Magentic-One team execution, and external GPT-plugin acceptance
  remain separate proofs.
- The Knowledge workspace has a real 2D native force-directed graph surface.
- The Agent Builder Graphs workspace renders bounded native ThinkGraph, KnowGraph, and CodeGraph
  attention projections; the redundant standalone CodeGraph app/package shell is deleted.
- AGE/Card activity and native graph attention are structurally wired, but complete end-to-end
  attribution and Reveal pacing remain incomplete.

### APPROVED TARGET

- Repo-owned Hermes Main, Coder, and Kanban complete live proof without another runtime or fallback.
- Main approves exact IDF handoff to the one native AutoGen Magentic-One runtime.
- Real native graph reads, Context Selections, handoffs, consumption, traversal, and writes drive the
  two visual canvases.
- Native child Runs, tools, references, artifacts, failures, and completion become truthful AGE
  observations without making AGE a runtime controller.

Do not document TARGET behavior as CURRENT. Do not preserve an abandoned runtime as a hidden fallback.

---

## Working with the owner

The owner frequently supplies long, exploratory, rapidly typed messages while reasoning about the
system. Treat them as high-bandwidth design input, not as permission to guess or as evidence that the
idea is unserious.

### Recover intent without patronizing

- Normalize spelling and phrasing mentally; respond to the underlying architecture or product need.
- Consolidate a long message into one Requested Delta, one Preservation Set, and an ordered route.
- State the consolidation plainly so the owner can correct it.
- Do not make the owner repeatedly restate decisions already made in the same task.
- Do not call an idea dumb, delusional, confused, or impossible. Identify the concrete cost,
  contradiction, missing authority, or proof gap instead.
- Do not flatter. Give a direct evidence-calibrated assessment.

### Most recent explicit decision wins

Exploration is not approval to delete a capability. A historical migration is not a current product
decision. When the owner explicitly retains a feature—such as generic typed SQL/Cypher selected into IDF—record
that decision and do not silently narrow it because an earlier implementation was removed.

If a new explicit decision replaces an older approach:

1. identify the exact changed decision;
2. identify the old implementation path it supersedes;
3. preserve unrelated working behavior;
4. delete the superseded path when the replacement is actually implemented and proven;
5. update canonical docs so contradictory plans do not coexist.

### Ask only when the choice is materially irreversible

Proceed with reasonable bounded assumptions for ordinary read-only discovery and normal implementation
steps. Stop and ask when a missing decision would change storage authority, delete data, change a public
contract, spend significant money, message external people, or create an irreversible migration.

### Idea Reality Check

Before adding a framework, runtime, graph, schema, service, scheduler, event bus, or major UI surface,
the agent must answer:

```text
What user problem is unsolved?
Which existing owner should solve it?
Why can the existing owner not solve it?
What is the smallest reversible experiment?
What existing path will this replace?
What observable result means keep it?
What observable result means remove it?
```

This is an agent reasoning discipline. Never implement it as a deterministic keyword classifier,
content filter, prompt rewriter, approval gate, or TS router. An explicit owner decision overrides the
experiment recommendation; the agent should record the tradeoff rather than covertly veto it.

---

## Codebase Memory binding

The canonical project is `C-Projects-LiquidAIty-main` at `C:/Projects/LiquidAIty/main`. Before code or
architecture work, read [skills/codebasedmemory.md](./skills/codebasedmemory.md) completely and follow its
ordered discovery recipe. That skill is the sole detailed authority for CBM discovery, coverage fallback, and
the mandatory inverse deletion/rename audit.

CBM is installed only as the checksum-pinned official binary under the user's LiquidAIty AppData directory.
It indexes the canonical host checkout `C:/Projects/LiquidAIty/main`, which derives the one canonical project
name `C-Projects-LiquidAIty-main`. The official Python MCP host owns exactly one long-lived stdio frontend; the
unmodified upstream coordination daemon, watcher, embedded UI, and disposable native cache remain outside the
repository and are reached only through that frontend. Docker does not own or launch CBM.

Codex, Hermes, Cards, plugins, and connectors use only LiquidAIty's application-published `cbm.*` tools. No
tracked Codex prompt/Stop hook, direct client registration, connector refresh,
or model turn may launch CBM, attach another frontend, index, retry, repair, or own lifecycle. Normal freshness
belongs to the upstream watcher. Initial or destructive projection maintenance is an explicit application-MCP
administrative operation, never an automatic coding-agent hook.

Begin with `search_graph`; retain real native IDs/provenance supplied by Main or the IDF actual-graph-data section; never fabricate
symbols or graph seeds; and read complete current source before changing behavior. Any production deletion or
rename must resolve actual qualified identities, traverse inverse relationships, repair surviving neighbors,
and prove residue absence according to the skill.

The current derived projection intentionally excludes `autogen-main` through `.cbmignore`; AutoGen remains
first-party runtime source. Never open or manipulate CBM SQLite/cache files, create backups, launch another
daemon/frontend, change global Codex configuration, or bypass LiquidAIty's application MCP boundary.

---

## Vendored source modification law

Treat `Hermes/`, `worldsignal/`, `Kronos-main/`, and other explicitly
vendored or imported runtimes as controlled upstream forks, not ordinary LiquidAIty cleanup targets.
Before a nontrivial vendor edit, the active CoderPacket must record:

```text
VENDORED PROJECT
PURPOSE
EXTERNAL ALTERNATIVE CHECK
FILES AND SYMBOLS
UPSTREAM BEHAVIOR PRESERVED
CONTRACTS
TESTS
FORK COST
ROLLBACK
```

Prefer an existing public adapter, configuration, plugin, hook, MCP, protocol, or documented extension
point. Put LiquidAIty-owned integration logic on an existing LiquidAIty adapter boundary whenever that
can satisfy the requirement; do not invent a new wrapper directory merely to avoid a justified vendor
edit.

Inside a vendor, prohibit broad cleanup, mass rename/format/type/dependency changes, speculative dead-
code deletion, prompt rewrites, unrelated test rewrites, and upstream documentation or terminology
changes. Use path-scoped searches in the unified core CBM project first, then direct-read and test the
exact upstream contract. Record every meaningful local divergence in the single vendored divergence register in
`ARCHITECTURE.md`, including upstream URL, version or commit when known, local files/symbols, reason,
proof, sync cost, and whether the change can later be removed.

---

## Git and working-tree law

Read-only Git operations are normal discovery:

```text
git status
git diff
git log
git show
git blame
git rev-parse
git ls-files
git submodule status
```

If the host blocks a read-only Git command, report it as a host-policy limitation. Do not say the
owner denied permission, do not bypass it through another shell, and do not invent a clean tree.

Git mutations require explicit owner request:

- restore, checkout, reset, revert, stash, clean, or deletion;
- add/stage, commit, amend, tag, push, or force-push;
- branch creation/switching, merge, rebase, cherry-pick, pull, fetch;
- worktree creation/removal;
- submodule or embedded-repository conversion.

An instruction to edit code is not automatic permission to discard unrelated changes or commit them.
Never use `git reset --hard` or `git checkout --` as cleanup. Preserve unrelated owner work.

Before edits, inspect the complete working-tree status and relevant diff. If host policy makes that
impossible, either stop before risky code mutation or constrain work to an explicitly requested,
directly inspected documentation edit and report the missing Git proof.

---

## Requested Delta and Preservation Set

Every implementation begins with:

### Requested Delta

The smallest observable behavior that must change.

### Preservation Set

Previously working behavior that must remain working, including interfaces, routes, schemas, saved
data, card topology, UI controls, tool grants, authentication, session behavior, and runtime boundaries.

### Forbidden Regressions

- an existing command, tool, route, control, or field silently disappears;
- saved data becomes unreadable or is reset/reseeded;
- a real runtime is replaced by a mock, generic model call, or fallback;
- card prompts/models/tools are overridden outside saved-card authority;
- another writer appears for an existing graph;
- a test is deleted, weakened, skipped, or redefined to match a bug;
- Coder is damaged while Main moves to Hermes;
- a graph animation claims an operation that did not happen;
- code scope expands opportunistically beyond the active CoderPacket.

Regression Ratio:

```text
newly broken previously-working invariants
÷ previously-working invariants exercised in the affected blast radius
```

Required value: **0.000**.

---

## Repository runtime boundaries

### User interface

React/TypeScript renders Main Chat, Agent Canvas, knowledge graphs, inspector, Kanban/profile surfaces,
and Coder terminal. It may validate typed transport fields and render activity states. It may not
interpret task meaning, plan, classify intent, rank agents, merge graphs, or infer knowledge access.

### Backend

Node/TypeScript owns HTTP/SSE transport, saved deck/conversation access, structural identity checks,
process/session lifecycle, provider/model lookup from saved config, MCP client transport, gRPC/ACP or
other proven protocol bridges, and event delivery. It is not an agent brain.

### Python rails

Python owns AutoGen/Magentic-One, configured agent execution, tool execution, parameterized SQL/Cypher,
data processing, graph/data adapters, research ingestion, deterministic validation/computation, and
specialist runtimes.

Use the user-facing name **Python rails**, not “sidecar.” If Python rails changes, report once:

```text
Python rails restart/reload required: yes
```

### Models

Models interpret user intent, select among granted capabilities, plan semantically, author task prose and
operations, choose useful graph context, and decide what to delegate. Do not replace model reasoning with
regex, substring, keyword, or lookup-table logic.

---

## Runtime roles

### Main

The saved Main card executes through the repo-owned Hermes persistent chat adapter. Main is the fast
LiquidAIty front door, not the name of a third-party UI. Its default execution mode is `single`, but
Main is not a distinct card type and must not be structurally forbidden from using the same card-owned
Hermes Kanban/swarm capability when explicitly selected. The adapter preserves saved prompt/profile/
model/tool authority and real streaming/session/failure behavior.
Each Hermes Card also owns one saved desired native subagent model. Run start materializes that
selection into the bound native profile and reads it back before inference; actual child provider/model
and any fallback belong in the Run receipt. The selector never rewrites the parent model, another Card,
Kanban worker selection, Magentic-One, or Constellation. External-memory selection remains native
profile configuration. LiquidAIty exposes Honcho setup/status only for Main and never projects a
general Card memory-provider field or reconfigures memory at Run start.

### Hermes planning/memory/KnowGraph helper

The stable card currently identified as `card_hermes_steward` is a persistent planning, memory,
research, and KnowGraph helper. Preserve its saved identity and data, but do not define it as "the
Kanban card." It is an ordinary Hermes-backed card and may run either `single` or `auto-kanban` without
changing its identity, profile home, memory, or capability ceiling. Temporary Hermes swarm workers are
not saved LiquidAIty cards.

### Hermes Local Coder

The saved Local Coder Card uses the repo-owned Hermes adapter in `delegate` mode with profile `coder`
and a backend-owned terminal. Its stable `card_local_coder` ID must not be interpreted as a runtime
selector. Local Coder uses CBM first for an explicitly selected local repository and remains connected
to Magentic-One through `edge_coder_magentic_option`. Do not restore OpenClaude, add a hidden coding
runtime, or give Local Coder Agent Builder/IDD authority.

### Hermes Agent Builder

The saved Agent Builder Card uses the repo-owned Hermes adapter in `delegate` mode with profile
`agent-builder`. Main reaches it through a direct `flow`; the user reaches the same Card Run
authority through the lower Agent Builder coding surface beneath Main Chat. It executes bounded coding
missions by inspecting current source, editing, running commands/tests, and returning evidence. Its
Card/profile memory, skills, tools, sessions, Runs, and history are independent of Local Coder, and it
has no Magentic-One edge.

### Magentic-One

Use the real Microsoft AutoGen v0.4+ `MagenticOneGroupChat` on Python rails. Preserve these available
runtime primitives:

```text
MagenticOneGroupChat
AssistantAgent with tools
Swarm
SocietyOfMindAgent
UserProxyAgent
```

Bus connectivity through saved `magentic_option` edges is worker eligibility. Do not create a TS
participant classifier or another scheduler.

Task and Progress Ledgers are private native Magentic-One state. Never override AutoGen defaults or
`_get_task_ledger_plan_prompt`; never subclass to capture the orchestrator; never read `_facts`,
`_plan`, `_team_description`, or other private ledger state; and never reconstruct, transport,
project, trace, or render ledger artifacts in LiquidAIty.

---

## Graph law

```text
ThinkGraph = Constellation Engine project reasoning and operational knowledge
KnowGraph  = Neo4j/Graphiti sourced knowledge and provenance
CodeGraph  = native CBM repository structure
AgentGraph = LiquidAIty Card relationships, delegation, parent-run lineage, and execution telemetry,
             implemented on Apache AGE/PostgreSQL
```

One authority and one writer per graph.

- Pass pointers, native IDs, bounded Context Selections, and provenance—not copied subgraphs.
- Transient context selection may reference native authorities for bounded IDF hydration; it is not another graph
  and does not absorb or archive their data.
- AgentGraph/AGE owns accepted Card relationship edits and may observe stable run/reference/artifact IDs. It never
  stores raw IDFs, authorizes a runtime, chooses a card, or owns native runtime lifecycle.
- The UI never writes graph meaning directly.
- TypeScript never performs semantic graph merges.
- Files/skills describe how-to; graphs store what-is. Do not copy Hermes profile learning/skill
  nodes into KnowGraph.
- A 2D or 3D visualization is permitted only when wired to real selection, context loading, handoff,
  consumption, traversal, or knowledge creation.

### Honest graph activity

Visual activation may come only from real observable events:

```text
query returned native IDs
context included native IDs
selection created
selection sent/delivered/opened
native node/edge read
native traversal completed
native node/edge proposed or written
native run completed or failed
```

Do not visualize hidden chain-of-thought. Do not infer access from answer prose. Do not create fake
success-shaped telemetry. Technical event proof may remain in the inspector; the foreground UX is
knowledge movement.

---

## IDF and IDD law

There is exactly one runtime-input meaning and implementation:

```text
saved Card stable fields
+ current transient dynamic input
+ deliberately selected rich data, native references, and images
+ effective granted tools
= one exact Input Data File
```

A saved Card becomes runnable only when its dynamic input is filled and the Card is run.
`apps/python-models/app/python_models/idf.py::materialize_idf` is the only materializer. Before inference
it writes and reloads exactly one canonical UTF-8 file for the Card/root Run:

```text
in.idf = actual bounded native graph data, references, and provenance
       + stable receiving-Card context read from PostgreSQL
       + selected tools, schemas, and effective saved grants
       + current dynamic mission, context, and images
```

The existing Run artifact catalog retains its path, byte size, and hash. Hermes and AutoGen receive only a
mechanical native request projected from those exact reloaded bytes; no adapter may reconstruct, wrap,
validate, hash, or reinterpret a competing payload. TypeScript transports the file reference and renders
selected-Run inspection; it is never a materializer. AGE data, receipts, approval state, and runtime lineage
remain outside the file. There is no saved-input library, revision copy, envelope, manifest, receipt, or
alternate TypeScript assembler.

There is no second runtime-input format or file. Optional graph or handoff artifacts remain ordinary Run
artifacts and never become a prerequisite, retained input authority, or competing model payload.

Cards remain one product concept. Their explicit Hermes or AutoGen runtime binding is saved Card
configuration, not a separate Card type or a second runtime payload. A sending user or agent supplies
only dynamic input and selected references; Python validates or rereads that exact bounded selection, and
the receiving Card owns materialization. A normal `card.run_assistant_agent` handoff executes immediately
through the receiving Card's canonical Run path. Optional review uses the existing Card Invocation and
Knowledge editors, then submits that same path once; staged review state is not a retained input or Run.
Mag One workers
receive their dynamic task through the saved-worker Card doorway, so each independently invoked saved worker
Card gets its own root IDF. A Hermes Kanban Card is one root boundary: Hermes owns native task decomposition,
worker prompts, handoffs, and child context. Never infer per-worker IDFs from native child IDs.

IDD is the Input Data Dictionary: the one literal repo-root `LiquidAIty.idd` Agent Builder palette
for composable objects, typed fields, templates, relationships and effect metadata. Native Hermes,
MCP and model discovery own their current catalogs. IDD is not runtime authority, an authenticator,
a checksum gate or an IDF validator, and no copied dictionary belongs in TypeScript or Python.
Full builder context belongs only to the Agent Builder Card in explicit Agent Builder work directed by
Main after user approval. Ordinary Runs and Local Coder receive selected values/references, never the
whole palette. Ordinary prompt prose stays Markdown. Every Card has the same visible Python Script tab
only in the Agent Builder workspace. IDD supplies current tool contracts, while the Card's effective
Tools-tab grants limit autocomplete and execution. The user or the authenticated Agent Builder profile
may validate, save and activate the next Script version; a running Card receives one immutable saved
version/hash and cannot rewrite it. Valid Hermes Scripts execute through Hermes' existing child-process
Python runner and native tool dispatcher. Literal `tools.call()` handles are replaced by one compact
Script tool while selected tools not wrapped by the Script remain ordinary MCP tools. Blank/invalid
Scripts keep the exact selected MCP presentation; runtime failure removes the compact tool and restores
only its pre-registered wrapped handles for the next model iteration. Never widen to IDD or the complete
catalog, never add another executor, and never activate Script execution for a non-Hermes Card.

Authority is:

```text
native availability
∩ saved Card/Hermes selection
∩ current Run authorization (including user approval where applicable)
```

Generic typed SQL/Cypher execution is retained. Implement it once on Python rails with parameterization,
capability gating, limits, and honest results. Do not delete it because migration 016 removed an older
overbuilt registered-query subsystem, and do not create one MCP wrapper per query.

Use repo-root identities plus relative paths and content hashes for portable stored operations. Do not
make machine-specific absolute paths the durable identity.

---

## Saved-card authority

A saved card is the sole permanent authority for:

```text
identity
prompt
provider/model/profile
bounded native subagent model
runtime type and binding
enabled state
tool and capability grants
saved topology
```

Callers provide task input and stable references, not alternate card definitions. Missing cards,
models, grants, runtimes, or authorities fail honestly. No model/provider/tool fallback.

The underlying Project graphs remain durable in their native owners. A caller selects bounded
references/context for one invocation; that selection and the materialized IDF remain Run-scoped.
PostgreSQL persists stable Card state, Run status, and explicit artifact metadata. AGE owns saved Card
relationships and may observe execution identities. Neither replaces saved-card configuration or
native runtime truth.

---

## Deterministic semantic logic ban

Do not add deterministic content interpretation to the planning, routing, graph, or task path:

```text
regex cleanup or prose sanitizers
keyword intent classifiers
title/template substring role inference
deterministic agent routers or cascades
prompt-injection/poison/content filters used to rewrite model work
agent/source name stripping
fake user-facing rewrites of raw plan/task text
hardcoded ontologies deciding semantic meaning
TS scoring, ranking, planning, or priority tables
```

Normal schema validation, exact enum checking, parameter typing, path containment, size limits,
authentication, CSS/layout logic, and structured field rendering are allowed. Deterministic code may
validate structure and safety; it may not pretend to understand meaning.

---

## Active execution contract

The active CoderPacket prompt is the complete current task and spec. Do not persist it as another task
file.

A CoderPacket contains:

```text
requested outcome
requirements
scope and files in/out
CBM anchors and freshness
relevant selected skills
Preservation Set
proof commands
stop conditions
forbidden work
expected CoderReport shape
```

Execution order:

1. Read repository law and selected skills.
2. Establish Git and CBM state.
3. Resolve symbols, relationships, contracts, and tests through CBM.
4. Direct-read current source.
5. Run the smallest meaningful pre-edit baseline.
6. Make the smallest complete change.
7. Delete the replaced path when replacement proof exists.
8. Run requested-delta and Preservation Set proof.
9. Typecheck/build the touched production boundary.
10. Inspect current source and diff for unrelated change.
11. Report exact completion, gaps, and Regression Ratio.
12. Stop; do not start the next job without instruction.

### CoderReport

Every meaningful implementation returns:

```text
verdict
Requested Delta comparison
completed/incomplete/changed requirements
Preservation Set proof
files read
files changed
CBM before/after and coverage limits
proof commands and results
known baseline failures
new regressions
Regression Ratio
blockers and assumptions
chosen and rejected approaches
reusable skill candidate, if genuinely proven
next recommended bounded task
```

Never return vague “done.”

---

## PlanFlow and execution approval

PlanFlow is a visible task-object control surface, not a document map, fake planner summary, or
deterministic text-cleanup layer.

Until approved task-node execution is genuinely wired, Run Task fails closed:

```text
Run Task unavailable: approved task-node execution is not wired yet.
```

Do not execute from fallback assistant text, `finalResponseText`, `autogenMessages`, raw chat, fake
task objects, or reconstructed Magentic-One ledgers. Do not mark completion without proof.

---

## Skills

`skills/*.md` files are reusable proven procedures and known traps. Retrieve a small relevant set. Do
not inject every skill into every prompt. Do not create a skill merely because a task completed.

A skill is promoted only when a lesson is reusable and proven through real work. Skills are not task
nodes, raw history, CoderReports, or specs.

---

## Documentation law

Canonical durable documents are:

```text
PLAN.md
AGENTS.md
ARCHITECTURE.md
FUTURE.md
skills/*.md
repo-intake/*.md only when explicitly required
```

Do not create:

```text
CLAUDE.md
specs/
tasks/
progress or checkpoint docs
handoff/evidence files
raw diff dumps
persistent prompt/task packets
parallel skill directories
random architecture runbooks
```

When the architecture changes, update the existing canonical owner and remove stale contradictory
direction. Do not solve uncertainty by writing another document.

---

## Hard stops

- No commit or push unless explicitly requested.
- No destructive Git, source, unknown-project, vendor-project, or direct database operation without
  explicit authorization and exact target verification. Exact `C-Projects-LiquidAIty-main` projection maintenance
  follows the standing authorization above.
- No stubs, placeholders, mocked success, fake fallback, or silent degradation.
- No hidden second route, MCP host, runtime, graph, renderer, event bus, or prompt system.
- No provider/model fallback.
- No invented tools or schemas.
- No direct CBM database access.
- No UI-as-brain or TypeScript semantic logic.
- No edits to vendored AutoGen private ledger behavior.
- No unrelated cleanup inside a bounded task.
- No deletion of Coder while moving Main to Hermes.
- No calling TARGET behavior CURRENT.
- No success claim without matching proof.

---

## Completion standard

Success requires:

```text
requested behavior directly proven
previously working affected behavior preserved
old replaced path removed when replacement is complete
no hidden fallback or duplicate authority
tests were not weakened
saved data and contracts remain valid
current source and diff inspected
CBM limits reported honestly
new regressions = NONE
Regression Ratio = 0.000
```

If proof is incomplete, report **PARTIAL / UNPROVEN**. If a new change breaks an old invariant, stop
forward expansion, restore the invariant, prove restoration, and only then continue.
