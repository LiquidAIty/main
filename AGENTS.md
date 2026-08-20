# AGENTS.md — LiquidAIty execution law

This file tells every coding agent how to work in `C:\Projects\LiquidAIty\main`. It is repository law, not a
product prompt and not a substitute for current source, tests, or runtime proof.

## Start here

Before doing anything else:

1. Read [DONT.md](./DONT.md) completely.
2. Read [PLAN.md](./PLAN.md) completely.
3. Read the explicitly relevant `wiki/*.md` feature manifests.
4. Read the relevant `skills/*.md` procedures.
5. Establish Git and native Codebase Memory state.
6. Use CBM to resolve the structural slice.
7. Direct-read the current source CBM identified.
8. Only then plan or edit.

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

Do not imitate nearby spaghetti. Follow this file and DONT.md.

---

## Current truth versus approved target

Never collapse CURRENT and TARGET into one claim.

### CURRENT

- Main Chat, Coder, and Kanban are saved Cards source-wired through one persistent repo-owned Hermes
  ACP adapter with separate profiles, sessions, memory, prompts, models, and grants.
- Coder is a Hermes delegate Card with a backend-owned terminal under Chat. The historical
  `card_local_coder` identifier is persistence compatibility, not runtime ownership.
- OpenClaude, LocalCoder, and Bun are absent from the supported product and dependency graph.
- Microsoft AutoGen 0.7.5 is checked in at `autogen-main` as first-party execution infrastructure;
  Python rails install its three packages only from that tree. The 0.7.5 upstream base is frozen;
  do not upgrade or rebase it onto later Microsoft AutoGen versions.
- The complete loaded six-service runtime and user-visible Main/Coder/Kanban model execution remain
  unproven until an explicitly approved live test.
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
decision. When the owner explicitly retains a feature—such as generic typed SQL/Cypher in IDF—record
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

## Codebase Memory is mandatory first navigation

Codebase Memory / CodeGraph is the repository structure authority. The canonical project is:

```text
project: C-Projects-LiquidAIty-main
root:    C:/Projects/LiquidAIty/main
```

Use the native `codebase-memory-mcp` server. Do not launch CBM through PowerShell, CLI wrappers, Python,
Node, or another MCP host. Do not open its SQLite files. Do not write a replacement search façade.

The full native catalog may expose:

```text
index_repository
index_status
list_projects
delete_project
search_graph
trace_path
query_graph
ingest_traces
detect_changes
get_graph_schema
get_architecture
get_code_snippet
search_code
manage_adr
```

The live profile is authoritative. Restricted profiles may intentionally expose fewer tools. Report
the missing project/status capability; do not invent results or start another CBM process.

### Keep discovery inside the active repository ownership boundary

The canonical project is the unified tracked-source graph:

| Active ownership boundary | CBM project | Root | Normal use |
| --- | --- | --- | --- |
| LiquidAIty product | `C-Projects-LiquidAIty-main` | `C:\Projects\LiquidAIty\main` | LiquidAIty and checked-in AutoGen source |

The normal core graph includes the checked-in first-party `autogen-main` fork. Hermes is too large for
routine core rebuilds and remains excluded by `.cbmignore`; a controlling task may explicitly authorize
one temporary unified projection for bounded cross-runtime design work. Runtime homes, credentials,
virtual environments, caches, builds, downloaded models, and independently versioned applications
such as WorldSignals remain excluded.

Temporary unified indexing does not transfer ownership. Hermes remains an upstream-managed controlled vendor;
AutoGen is a first-party maintained fork; LiquidAIty adapters remain product code. Use path-scoped
queries to control noise and direct-read the owning current source after discovery. Do not create an
index swarm or a second Hermes graph for ordinary work. Direct source and focused tests remain
authoritative after graph discovery.

### The correct discovery order

For code and architecture work:

```text
search_graph for exact symbols, routes, types, files, or concepts until the structural owners are found
→ trace_path for callers, callees, data flow, and impact
→ get_code_snippet for the exact qualified symbols
→ direct-read complete relevant current source bodies
→ focused rg for literals, configs, comments, non-code, missing coverage, and exhaustive residue
→ edit
→ focused tests and compile/build
→ direct reread and diff
→ post-edit CBM impact/coverage when available
```

Do not begin with broad `rg`, random file opening, or recursive directory tours when the task concerns
code structure. Do not use CBM ranking as semantic truth.

### Tool selection

- `search_graph` — default first call; find functions, methods, classes, routes, fields, modules, and
  structural concepts.
- `trace_path` — call next only when caller/callee or impact relationships matter. Use simple symbol
  names unless the live schema says otherwise.
- `get_code_snippet` — call only after `search_graph` gives an exact qualified name and only when its
  bounded source is useful before the complete direct read.
- `search_code` — graph-augmented text search after CBM has bounded the subsystem.
- `query_graph` — use read-only Cypher for a specific bounded multi-hop question not answered by the
  four normal tools.
- `get_architecture` — obtain selected broad structure, dependencies, routes, boundaries, layers, or
  clusters only when broad orientation is actually needed.
- `detect_changes` — map tracked changes to symbols; it is not a replacement for Git status.
- `index_repository` — run one full rebuild after the fixed Main entry deletion, or once for another
  explicitly authorized maintenance reason. Never reindex before individual queries or run it concurrently.
- `delete_project`, `ingest_traces`, and `manage_adr` are state-changing. The owner has granted the
  scoped standing maintenance authorization below for `delete_project`; trace ingestion and ADR
  mutation still require an explicit task.

Do not treat this catalog as a checklist. There is no arbitrary CBM call-count limit: continue making
useful, result-informed structural searches until the source boundary is actually resolved. Prefer:

```text
search_graph
→ trace_path only if relationships matter
→ get_code_snippet only if the bounded snippet adds value
→ direct source
```

Use `query_graph`, `get_architecture`, and indexing/status operations only when the task actually
requires them. Stop when CBM has bounded the files and symbols. Several useful searches are not a
swarm; speculative or redundant searches disconnected from prior results are.

### Keep one calm lifecycle

- Choose one native CBM doorway for the run.
- Independent bounded read operations may run concurrently through the same already-connected native
  MCP owner and the same canonical project/database. Do not impose an arbitrary concurrency count.
  Dependent calls still wait for their prerequisites; all state changes, initialization, indexing,
  deletion, and lifecycle recovery remain sequential.
- Check project/readiness once, not in a polling loop.
- On timeout or closed transport, stop equivalent retries, report the doorway/error once, and retry at
  most once after a specific lifecycle repair.
- Never start several CLI/indexer processes to make CBM “faster.”
- Never delete/rebuild an index as generic process recovery.

### Standing CBM maintenance authorization

Codex has unrestricted technical access to the native CBM catalog. Do not "ground" Git or CBM by
disabling tools, adding an `enabled_tools` allowlist, switching the project to untrusted, or changing
the global approval policy merely because one run behaved badly. Fix the bounded misuse instead.

`C-Projects-LiquidAIty-main` is disposable derived projection state. Repository source and tests are authoritative.
The owner authorizes exact-project deletion and immediate canonical rebuilding without another
permission round-trip once at the start of each Codex task whose active repository is
`C:/Projects/LiquidAIty/main`. This fixed task-entry checkpoint replaces freshness deliberation, delayed markers,
and the proposed post-commit checkpoint. Immediately before deletion:

1. use the native doorway only;
2. verify the exact project name and root are `C-Projects-LiquidAIty-main` and `C:/Projects/LiquidAIty/main`;
3. record the current index status/counts or the checkpoint reason;
4. verify `.cbmignore` contains the intended current exclusions;
5. ensure no index/delete/recovery operation is already running.

Then perform exactly one delete, exactly one full `index_repository` rebuild of `C:/Projects/LiquidAIty/main`, and
one readiness/count/exclusion verification phase. Reindexing alone does not replace deletion because
SQLite-backed incremental refresh can retain deleted or newly excluded fragments. Never delete
another project, repository source, or CBM storage files
under this authorization. Never use delete/rebuild for an ordinary timeout or connector failure.

`UserPromptSubmit` injects this maintenance and discovery SOP, but the active agent executes maintenance
only if the current Main task has not already completed its clean entry. Use the one already-connected
native MCP owner; the hook itself must not launch a CLI, server, indexer, or direct database process.
Record completion in task context and never repeat delete/rebuild for an interruption, follow-up,
clarification, compaction, or another message in the same task. An explicit controlling task may move
this single delete/rebuild checkpoint to the final stable-source stage; it still occurs only once.
After the clean rebuild, verify the exact project/root, ready status, live node/edge/file counts,
`.cbmignore` exclusions, presence of intended tracked AutoGen source, and absence of excluded
runtime/vendor-application paths once. If the active task explicitly authorized a temporary Hermes
projection, report that it becomes structurally divergent once the normal `/Hermes/` exclusion is restored.
Then begin discovery with the four normal tools: `search_graph`, `trace_path` when relationships matter,
`get_code_snippet` for exact qualified-symbol snapshots, and `search_code` for bounded concept/literal/
residue discovery when useful. Outside `C:/Projects/LiquidAIty/main`, do not perform this Main maintenance.

The Git post-commit hook remains Git LFS only. Do not install a second CBM mutation frontend, kill the
normal Codex owner, or reintroduce a delayed marker system.

### Freshness proof

A useful CBM report contains:

```text
project name
canonical root
index status or exact reason unavailable
node count
edge count
indexed file count when exposed
index head/base revision when exposed
current Git HEAD when available
dirty/untracked state from Git
known exclusions or missing files
fresh | stale | divergent | unknown | blocked
```

Never copy old counts from this document, a wiki manifest, memory, or another run. Obtain live values.

The committed graph can remain useful when the working tree is dirty. Use it for structural anchors,
then inspect the active diff and direct source. Do not call ordinary dirty-worktree divergence a CBM
defect. Refresh after commit, or when the owner explicitly requires a working-tree refresh.

If `head_sha` and `base_sha` differ, or if CBM cannot be tied to current Git HEAD, call the index
structural-only/divergent. Do not block all work automatically; use bounded direct-source verification
and report the limitation.

### Evidence tiers

**Scout** — a few narrow searches for provisional positive discovery. Never make exhaustive absence,
dead-code, or deletion claims from Scout evidence.

**Verify** — project/status, exact search, relevant traces, qualified snippets, complete direct source,
focused residue search, focused tests. Required for normal implementation.

**Auditor** — paginate every relevant result set, inspect inbound/outbound impact, verify skipped or
missing paths directly, and state coverage limits. Required for safe deletion, duplicate-authority,
dead-code, and exhaustive claims.

### Direct-source fallback

If CBM omits a known current file or symbol:

1. verify the exact path exists and is in the requested scope;
2. verify project/root identity and record why index coverage is insufficient;
3. read the exact current file directly;
4. use focused `rg` for imports, callers, contracts, and tests;
5. continue the task without pretending CBM supplied the missing evidence;
6. do not repair/rebuild CBM unless that is the requested task.

CBM is structural navigation, not a fake proof engine. Direct source, compile output, focused tests,
persistence readback, and real runtime evidence win when they disagree with graph memory.

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

Models interpret user intent, select among granted capabilities, plan semantically, author IDF prose and
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

### Hermes planning/memory/KnowGraph helper

The stable card currently identified as `card_hermes_steward` is a persistent planning, memory,
research, and KnowGraph helper. Preserve its saved identity and data, but do not define it as "the
Kanban card." It is an ordinary Hermes-backed card and may run either `single` or `auto-kanban` without
changing its identity, profile home, memory, or capability ceiling. Temporary Hermes swarm workers are
not saved LiquidAIty cards.

### Hermes Coder

The saved Coder Card uses the repo-owned Hermes adapter in `delegate` mode with profile `coder` and a
backend-owned terminal under Chat. Its stable `card_local_coder` ID must not be interpreted as a
runtime selector. Coder uses CBM first for this repository. Do not restore OpenClaude/LocalCoder, add a
hidden coding runtime, or make Coder a Mag One worker without an explicit later product decision.

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
ThinkGraph = SQLite/Engraphis project reasoning and operational knowledge
KnowGraph  = Neo4j/Graphiti sourced knowledge and provenance
CodeGraph  = native CBM repository structure
AgentGraph = LiquidAIty Card relationships, delegation, parent-run lineage, and execution telemetry,
             implemented on Apache AGE/PostgreSQL
```

One authority and one writer per graph.

- Pass pointers, native IDs, bounded Context Selections, and provenance—not copied subgraphs.
- Transient context selection may reference native authorities for IDF hydration; it is not another graph
  and does not absorb or archive their data.
- AgentGraph/AGE owns accepted Card relationship edits and may observe stable run/reference/artifact IDs. It never
  stores raw IDFs, authorizes a runtime, chooses a card, or owns native runtime lifecycle.
- The UI never writes graph meaning directly.
- TypeScript never performs semantic graph merges.
- Files/skills describe how-to; graphs store what-is. Do not smear SkillsGraph into KnowGraph.
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

There is exactly one IDF meaning and implementation:

```text
saved Card stable fields
+ current transient dynamic input
+ deliberately selected rich data, native references, and images
+ effective granted tools
= exact transient model/framework request
```

A saved Card becomes the IDF only when its dynamic input is filled and the Card is run.
`apps/python-models/app/python_models/idf.py::materialize_idf` is the only materializer. It produces the
exact Inspector-visible fields consumed once by Hermes or AutoGen/Mag One: system instructions,
dynamic message, runtime/provider/model/options, effective MCP/native tools, skills/toolsets,
connections, selected context/references/images, and requested output requirements. The object exists
in memory for one call and is discarded.

Card identity, revision identity, sender/target routing, Project/conversation/Run/correlation identity,
AGE data, telemetry, receipts, hashes, approval state, and runtime lineage stay outside the IDF. No
adapter may rebuild, wrap, serialize, validate, hash, save, rematerialize, or reinterpret it. Adapters
may only project its existing fields mechanically into the native Hermes or AutoGen API shape. There is
no saved-IDF library, revision, approval copy, envelope, manifest, or alternate TypeScript assembler.

Cards remain one product concept. Their explicit Hermes or AutoGen runtime binding is saved Card
configuration, not a separate Card type or a second runtime payload. A sending user or agent supplies
only dynamic input and selected references; the receiving Card owns materialization. Mag One workers
receive their dynamic task through the saved-worker Card doorway, so each worker Card materializes its
own one-call IDF.

IDD is the Input Data Dictionary: the one literal repo-root `LiquidAIty.idd` declaration language for
constructing and editing structured input where structure is useful. It may declare named variables,
types/defaults/constraints, tools, native operations, and output forms. Python rails interprets that
file mechanically; TypeScript and Python must not contain a copied competing dictionary. Only the
declarations selected for the current communication enter its IDF; the whole IDD never enters a model
request. Ordinary prompt prose stays Markdown, while explicitly cataloged native-language islands may
be typed.

Authority is:

```text
saved card capability ceiling
∩ current input and deliberately selected values/references
∩ IDD operation requirements
∩ user approval where applicable
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
runtime type and binding
enabled state
tool and capability grants
saved topology
```

Callers provide task input and stable references, not alternate card definitions. Missing cards,
models, grants, runtimes, or authorities fail honestly. No model/provider/tool fallback.

The underlying Project graphs remain durable in their native owners. A caller selects bounded
references/context for one invocation; that selection and the materialized IDF remain transient.
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
relevant selected feature manifests and skills
Preservation Set
proof commands
stop conditions
forbidden work
expected CoderReport shape
```

Execution order:

1. Read repository law and selected manifests/skills.
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

## Skills and feature manifests

`wiki/*.md` files are compact feature pointer manifests. They identify the outcome, exact CBM anchors,
must-not-break behavior, valid proof, and limitations. They are not source-of-truth replacements.

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
DONT.md
ARCHITECTURE.md
FUTURE.md
wiki/*.md
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
