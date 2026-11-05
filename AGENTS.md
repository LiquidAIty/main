# AGENTS.md — LiquidAIty execution law

> **Graph + less = more:** less code doing the same work is more useful. Entity names the stable
> Feature; its adjacent Relationship states what that exact file contributes. Use Codebase Memory as a
> directional map, then read current source. Change the smallest existing path, remove what it replaces,
> and keep each file-specific pair truthful.

This file tells every coding agent how to work in `C:\Projects\LiquidAIty\main`. It is repository law, not a
product prompt and not a substitute for current source, tests, or runtime proof.

## Start here

Before doing anything else:

1. When a PromptSpec is active, load the installed `promptspec-receiver` skill first. It owns the
   repository process for that run or stage.
2. Read the current operating rules in [DONT.md](./DONT.md); consult its historical removal record only
   for the affected boundary.
3. Read [PLAN.md](./PLAN.md) completely.
4. For Hermes, Card, Bot, profile, taskgraph, memory, or UI integration work, read the canonical
   [plugin.md](./plugin.md) contract before proposing a change.
5. For CodeGraph, source-pair, module-cohesion, or repository-to-agent-product work, read the canonical
   [CODEGRAPH.md](./CODEGRAPH.md) contract.
6. Read only relevant reusable `skills/*.md` procedures; domain skills defer generic process control to
   `promptspec-receiver`. For product behavior or architecture work, also read the owner-requested
   [understand-project-design](.agents/skills/understand-project-design/SKILL.md) skill before proposing or changing the design.
7. The Primary uses the Codebase Memory CLI for a bounded directional map, then direct-reads current
   source. Support scouts receive exact anchors and use direct source; they do not operate CBM.
8. Establish the permitted working-tree state without violating a current no-Git instruction.
9. Build the task waterfall and exact execution plan before any edit.

The repository has deleted well over 200,000 lines of layered experiments. The most important rule is:

> When an approach changes, delete the abandoned path in the same implementation change. Never
> declare a replacement complete while the replaced path remains live.

### Source graph coding system

> Less code doing the same work is more useful.

Treat source as a graph, not a pile of files. Before editing a first-party source file, read its leading
`Entity:` / `Relationship:` pairs, use the installed Codebase Memory CLI to map the relevant structural
neighbors, then read current source. `Entity` names a stable Feature category. Its immediately adjacent
`Relationship` explains what that exact file contributes to the Feature. CBM independently owns Files,
Symbols, callers, imports, definitions, tests and dependency structure; source comments do not duplicate it.

The pairs have two practical jobs. First, `Entity` is the searchable feature index that lets a reader
find the first-party files participating in one product capability, while `Relationship` makes each
file's place in that feature understandable. Second, they pressure module cohesion: a small file with one
clear responsibility is valid; a file whose actual code spans several unrelated owners is a split candidate.
Do not merge useful small modules merely to reduce file count, and do not split or relabel from tag counts
alone—verify callers, state ownership, and behavior.

This authored format is required on LiquidAIty-owned `.ts`, `.tsx`, and `.py` files, and on a
first-party executable `.js` file when it owns a real integration seam. Do not force it into CSS,
manifests, generated bundles, Markdown, or untouched vendor source. A locally modified controlled vendor file
keeps upstream comment style and is described in the vendored divergence register unless the owner explicitly
requests annotations for that vendor.

### Writing and maintaining source pairs

For a new first-party source file:

1. Put each `Entity:` line before imports/executable code and immediately follow it with its
   `Relationship:` line.
2. Choose the existing stable Feature name that a reader should search to find this file. Create a new
   Entity only for a genuinely new product capability, not a filename, language, layer, or implementation
   detail.
3. Write the Relationship as one concrete present-tense sentence: what this file owns or contributes to
   that Feature. Name the actual boundary; never claim hoped-for, loaded, live, or callerless behavior.
4. Add another adjacent pair only when the file has another real, distinct Feature responsibility.
5. Add no generic Graph-plus-less preamble. This file centralizes that repository guidance.

When editing an existing file:

- read every leading pair before changing code;
- leave a pair byte-unchanged when Feature membership and responsibility remain unchanged;
- update the Relationship in the same patch when the file's actual contribution changes;
- add or remove a complete adjacent pair when a real responsibility is added or removed;
- delete a stale/aspirational pair when no executable owner remains;
- inspect callers and state ownership when several unrelated pairs are required, and split the module when
  the implementation truly contains unrelated owners; and
- keep a small cohesive module when it has one understandable job—small size alone is not a defect.

A useful Relationship lets a future reader answer “why is this file part of this Feature?” without opening
the whole repository. A useful Entity search returns the first-party neighborhood of that Feature. Neither
line substitutes for CBM caller/import/dependency evidence or current source review.

[CODEGRAPH.md](./CODEGRAPH.md) owns the product-level composition of authored meaning, CBM structure,
UI/model navigation, and the later repository-to-agent-product workflow. This file owns mandatory agent
behavior; the CodeGraph document does not authorize ingestion, execution, grants, or vendor changes.

After an edit:

- leave the header unchanged when the file still belongs to the same Feature and contributes the same responsibility;
- update `Entity` when Feature membership genuinely changes;
- update `Relationship` when the file's contribution genuinely changes;
- add or remove an adjacent pair when a real responsibility is added, removed or replaced;
- remove annotations for deleted or superseded code in the same change.

Do not infer semantic categories from filenames, keywords or a deterministic classifier. A validator may
check placement, pairing and nonempty values; semantic accuracy remains part of the agent's source review.
Do not perform a repository-wide header rewrite unless the owner explicitly requests that exact operation.

Law in one line:

```text
TypeScript = transport and pixels
Python rails = runtime and deterministic computation
models = semantic reasoning
saved cards and graph topology = identity and authority
```

Do not imitate nearby spaghetti. Follow this file and the current rules in DONT.md.
Historical recovered documents are evidence of previous decisions and failures, not permission to
restore removed tools, impose retired gates, or override the owner's latest instructions.

---

## Current truth versus approved target

Never collapse CURRENT and TARGET into one claim.

The saved Card/profile `builder` replaces the old Agent Builder. Existing saved Cards, Runs, and shared
state remain preserved; do not add a general history lifecycle. Builder makes prompts, agents, apps, UI
pages and webpages; create/edit are optional tools, not a mandatory semantic router. The lower terminal is
Builder's. Graph-Card consolidation remains an unaccepted option; do not merge ThinkGraph/KnowGraph owners
or silently change their write policy.

### CURRENT

- Main, Builder and the graph helpers are saved Cards on the repo-owned Hermes adapter, with
  separate profiles, sessions, prompts, models, Hermes subagent selections and grants.
- Builder is Card `builder`, display `Builder`, profile `builder`. Main reaches it through a
  direct saved flow; the Agent Builder application's lower terminal presents that same Card.
  It builds prompts, Cards, blue workers, agent apps, UI pages and supporting code using explicit tools.
  Builder never invokes what it builds and cannot edit core system Cards or orange system wiring.
- Do not delete saved Cards, Runs, profiles, or shared state without an explicit owner-authorized exact target.
- Bun is outside the supported graph.
- The existing Mag One Card and blue topology remain LiquidAIty product authority; current source executes
  that bus through the repository-owned Hermes task/dependency runtime with no legacy executor fallback.
- Engraphis owns ThinkGraph, Graphiti owns KnowGraph, CBM owns CodeGraph and AGE owns
  Card topology/Run observations. Preserve the accepted graph surfaces and data.
- Static tests, loaded application execution and external plugin acceptance are separate proofs.
  Current acceptance evidence and remaining work belong in PLAN.md and ARCHITECTURE.md.

### APPROVED TARGET

- Repo-owned Hermes Main, Builder, and graph helpers complete live proof without another runtime or fallback.
- Main submits an exact user-approved Builder PromptSpec to the saved Magnetic Card through
  `message_agent`; the Card's official plugin tool admits one Hermes taskgraph root, and Hermes performs
  task/dependency execution and final synthesis through the exact blue-connected Card roster.
- Real provider graph reads, Context Selections, handoffs, consumption, traversal, and writes drive the
  two visual canvases.
- Hermes child Runs, tools, references, artifacts, failures, and completion become truthful AGE
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
decision. When the owner explicitly retains a feature—such as generic typed SQL/Cypher execution—record
that decision and do not silently narrow it because an earlier implementation was removed.

If a new explicit decision replaces an older approach:

1. identify the exact changed decision;
2. identify the old implementation path it supersedes;
3. preserve unrelated working behavior;
4. delete the superseded path when the replacement is actually implemented and proven;
5. update canonical docs so contradictory plans do not coexist.

### PromptSpec support agents

For an active PromptSpec, the Primary is the only implementation writer. It may use at most three
support agents total, normally:

1. a read-only code/ownership scout;
2. a read-only contract/prompt/documentation/test scout;
3. one fresh independent final reviewer.

Scouts may propose ordered tasks with a Key Objective and Definition of Done, but they never edit.
The final reviewer receives the frozen implementation and returns findings in the conversation with a
minimal PASS/FAIL envelope plus the reviewed-snapshot checksum. The Primary does not patch after final
review begins. A FAIL stops the run for the owner's save, wipe/revert, or clean-retry decision.

Product Cards exercised through the real loaded product are the system under test, not repository
support agents. Stand-ins match the actual saved Card and report unsupported parity; they never substitute
for live agent acceptance.

### Existing branded technical identifiers

Existing `liquidaity-*` identifiers are compatibility contracts, not a naming template. Do not
introduce a new distinct branded profile, package, function, variable, route, tool, schema,
environment key, service, or internal name. Preserve an exact existing identifier when saved data or
a live runtime still depends on it. A separate coordinated refactor recorded in `FUTURE.md` owns their
later removal; do not mix that migration into feature work.

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
architecture work, read [skills/codebasedmemory.md](./skills/codebasedmemory.md) completely. That skill owns
the detailed CLI queries, freshness/coverage interpretation, source fallback, and inverse deletion/rename
audit.

For PromptSpec repository work:

- only the Primary operates Codebase Memory;
- use the installed `codebase-memory-mcp cli` command, not CBM MCP;
- use it before dispatching scouts, only as a bounded directional map;
- pass returned qualified names, paths, relationships, generation/freshness limits, and unresolved questions
  to the direct-source scouts;
- current source wins every disagreement;
- a zero graph result is never sufficient absence/dead-code proof;
- rely on the installed watcher's automatic source refresh as documented in `skills/codebasedmemory.md`;
  do not perform a start-of-run reindex, and require a new explicit owner instruction for any manual
  reindex, restart, trace ingestion, project deletion, or other lifecycle mutation.

Support agents do not operate CBM and do not repair its process or index. They verify supplied anchors through
`rg`, direct source, callers, contracts, and tests. Any deletion or rename must still resolve actual qualified
identities, traverse inverse relationships, repair surviving neighbors, and prove exact residue absence.

Product execution is separate: Hermes Cards and application clients use only their saved granted `cbm.*`
operations through LiquidAIty's application-published provider. Repository CLI policy does not remove or
widen product Card grants.

Never open or manipulate CBM cache/database files, install another indexer, launch a second persistent
frontend, fabricate graph records, or promote a derived graph result into architecture or runtime truth.

---

## Vendored source modification law

Treat `HermesLatest/`, `agent-products/gods-eye-view/`,
`agent-products/shadowbroker/`, `agent-products/kronos/`, and other explicitly
vendored or imported runtimes as controlled upstream forks, not ordinary LiquidAIty cleanup targets.
Before a nontrivial vendor edit, the active PromptSpec task and frozen review evidence must record:

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
changes. Controlled vendor roots are currently excluded by `.cbmignore`; do not claim CBM coverage for
them or change index scope without a separately authorized reindex. Direct-read and test the exact vendor
contract, and use CBM only for the indexed LiquidAIty adapter side. Record every meaningful local divergence in the single vendored divergence register in
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

### Scope and closed features

- The supplied PromptSpec is the implementation scope and Preservation Set. An assistant proposal,
  old plan, TODO, nearby defect or historical approval does not expand it.
- Ask Jeremiah before editing outside `C:\Projects\LiquidAIty\main`, or a production file or feature
  not supported by the current PromptSpec. Discovery grants no implementation authority.
- Report adjacent defects without fixing them. A necessary prerequisite must have evidence of its
  direct coupling to the requested outcome; record that evidence before expanding the work.
- Accepted and closed features stay closed. If the requested change necessarily affects one,
  show the exact coupling and ask first. Better style or possible improvement is not authorization.
- Creativity stays inside the authorized outcome. Ask before adding a new design, authority,
  abstraction, dependency, runtime, storage path or user experience.
- Map every changed file and meaningful hunk to a requirement or proven prerequisite. Keep the
  ledger in the task, not another repository document. Finish and prove one boundary before the next.
- Cleanup covers only residue created inside the authorized boundary. Documentation changes also
  require PromptSpec authorization; do not append an incident diary as a side effect of coding.
- Ask when a consequential ambiguity remains; do not ask again about routine choices already
  authorized. The owner's latest explicit preservation decision wins over a general cleanup rule.
- Tests must preserve the requested behavior. Report source, structural connection, focused tests,
  build, loaded health, real saved product execution and Jeremiah's visual acceptance separately.
  Never use restored, complete, safe or passing to conceal unfinished or unproven work.

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
- unrelated saved Cards are damaged while Builder changes;
- a graph animation claims an operation that did not happen;
- code scope expands opportunistically beyond the active PromptSpec task.

Regression Ratio:

```text
newly broken previously-working invariants
÷ previously-working invariants exercised in the affected blast radius
```

Required value: **0.000**.

---

## Repository runtime boundaries

### User interface

React/TypeScript renders Main Chat, Agent Canvas, knowledge graphs, inspector, saved Card surfaces,
and Builder terminal. It may validate typed transport fields and render activity states. It may not
interpret task meaning, plan, classify intent, rank agents, merge graphs, or infer knowledge access.

### Backend

Node/TypeScript owns LiquidAIty Product HTTP transport, saved deck access, structural identity checks,
application MCP client transport, and domain-event delivery. It does not own Hermes Gateway, sessions,
profiles, provider/model resolution, PTY, agent processes, or chat history. It is not an agent brain.

### Python rails

Python owns LiquidAIty application-tool execution, parameterized SQL/Cypher, exact completed-pair
selection, data processing, graph/data adapters, research ingestion, deterministic validation/computation,
and domain runtimes. Hermes owns configured agent and Team/Magnetic execution.

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

Card preparation preserves the actual task and deliberately selected provider graph references. It does not
run automatic Jev relevance ranking or inject a default Relevant/Recent packet before inference.
The Entity/Relationship map is a separate context contract; ordinary Main chat delivery must be proven independently.
Main is the fast boss: it decides, delegates, reviews and answers. It never creates or edits Cards,
profiles, skills, tools or wires, and it does not retain time-consuming work an appropriate saved Card,
Team or Magnetic can own. A single saved Card is tested by Main through `message_agent` after its profile
and wire read back; Builder never runs that test.
Each current Know is one verified sourced observation with a separate bounded interpretation and optional
direction relative to an explicit proposition. Supporting, challenging and neutral Knows are all valid;
balance belongs across research coverage and synthesis rather than fixed record proportions.
Each non-Magnetic Hermes Card has one explicit saved `Orchestrator` setting. When enabled, its actual enabled
saved Card wires define the exact saved Bot/Card targets it may address through Hermes `message_agent`; Bot
reachability is not restricted to orange wires. Main is the source-default direct orchestrator and may address
every enabled saved Hermes Card present in the Project's enabled wire topology. Another Card may deliberately
enable the same setting and receives only its own connected wired roster. A wire makes the connected Card a Bot
target; it does not make the target an orchestrator or grant it reverse calling authority unless that Card also
has its own saved `Orchestrator` setting. Orange `flow` is the ordinary/default Bot relationship. A blue
`magentic_option` wire provides the same Bot reachability and additionally enrolls that saved identity in the
exact worker roster for LiquidAIty's retained modified Hermes Team execution. Only an enabled orchestrator
renders an orange connection dot. Main remains the default chat front door and uses the same compact rounded
Card geometry wherever a Card preview is rendered; presentation never creates a second Card type or
orchestration authority. Card visibility without a saved wire creates neither Bot authority nor Team
membership. The server's new-Project seed creates Main → Builder plus Team → Magnetic blue membership;
additional saved edges remain Project-owned persisted configuration.
Each Hermes Card owns one saved parent and subagent model selection. Card publication uses Hermes's
public `profiles.create` / `profiles.configure` contract and reads the exact profile back. LiquidAIty
supplies no provider or model fallback and never rewrites another Card or the ThinkGraph extractor.
Every saved profile selects Holographic memory at profile publication; memory is not reconfigured per turn.

### KnowGraph

The saved `card_knowgraph` Card, visible as `KnowGraph` and bound one-to-one to Hermes profile
`knowgraph`, is the persistent sourced-research and KnowGraph helper. It is an ordinary Hermes-backed
Card in `delegate` mode with `subagentType: none`. It may
read deliberately selected ThinkGraph and CodeGraph context, but Neo4j/Graphiti remains its graph authority
and writer. The source-default Card uses Sol for the deeper factual/reality-check role; persisted saved Card
model choice remains authority. KnowGraph uses Hermes Firecrawl search plus its saved Graphiti operations;
it does not create another team or route through the Team Card unless Main deliberately calls Team separately.
One current Know is one first-class `Episodic:Know` object about exactly one Entity, with one source
document, exact evidence passage, self-contained observation, separate bounded interpretation and optional
proposition direction. Its citation fields and exact `entity_uuid` are inspectable properties, its plain-text
episode content remains available to Graphiti hybrid retrieval, and Know records retain no `ABOUT` or
`MENTIONS` attachment edge. The saved KnowGraph root uses Hermes' `grounded-citations` evidence workflow before invoking
Graphiti's queued `add_know`; Python rails preserves the typed citation and Project scope without creating a
second web retriever or citation ledger.
Main PDF attachment ingestion writes through the Graphiti service directly; it is not a KnowGraph Card
turn and must never borrow this Card's model or system prompt. The retired Steward/Stuart identities,
Team delegation residue, and compatibility aliases must not return.

### Hermes Builder

The saved `builder` Card uses Hermes `delegate` mode and profile `builder`. Main and the
Agent Builder lower terminal reach the same saved Card/Run authority. It accepts ordinary
missions and chooses granted tools for files, terminal, research, prompts, Card configuration
and application/UI construction. Card creation and configuration use explicit tool arguments,
exact targets, current revisions and saved grants. No prefilled operation tasks or hidden modes.
Builder may create new ordinary worker candidates, edit only existing non-core blue workers, and add or
remove only their blue Magnetic membership. It cannot edit Main, Builder, ThinkGraph, KnowGraph, Team,
Magnetic, orange system wiring, or another unwired Card. Saving a Card and invoking a Card remain separate
actions: Builder never calls `message_agent` to test or run what it built. Main owns the later single-Card
test and approved Magnetic invocation. Builder has no Mag One execution authority.
Builder retains deliberately selected graph context and its granted provider readers. It does not receive
an automatic Jev-ranked Relevant/Recent packet; inspector/search access does not add a pre-inference filter.

### Team

The saved `card_team` / profile `team` is both a protected core blue worker and Main's direct wildcard.
Main may call Team directly through `message_agent` when a bounded job needs doing but no specialist
matches. The standard Bot turn calls the LiquidAIty plugin's categorized `taskgraph_start` tool once;
Hermes creates one marked root, automatically decomposes it into depth-one same-profile workers, and
resumes that same root for synthesis. Magnetic may also assign one blue child to Team, which enters the
same Team boundary. Team workers cannot delegate or widen their assignment scope.

### Mag One

The existing Mag One Card is the bus orchestrator. Its saved identity, prompt, provider/model, grants,
Canvas placement, and blue `magentic_option` topology remain LiquidAIty authority. Every blue worker is
also an ordinary Bot target; blue additionally supplies the exact Magnetic assignment ceiling. Titles,
prompts, installed profiles and global discovery never add workers.

Main calls Magnetic only with an exact user-approved PromptSpec authored by Builder after Builder reads
relevant ThinkGraph and KnowGraph context and CodeGraph when repository structure matters. The ordinary
Magnetic Bot turn calls the categorized `taskgraph_start` plugin tool exactly once. That tool submits one
bounded root mission to Hermes's existing SQLite task/dependency runtime. The saved Mag One profile
decomposes the mission, assigns work only to the
projected worker identities, links required worker tasks back to the same root, dependency-blocks that
root while needed work is unfinished, and later completes the same root with final synthesis. It never
creates a separate synthesis sink. Hermes' assignment scope
rejects root assignments outside the exact blue roster and keeps manually created worker descendants
self-scoped, without changing unrestricted ordinary tasks.

Hermes owns tasks, dependencies, attempts, dispatch, retries, worker processes, and final synthesis.
LiquidAIty stores no copy of those rows and creates no second scheduler, task store, worker identity,
terminal, transcript, activity feed, or board UI. TypeScript owns typed status presentation,
not decomposition or scheduling. A Magnetic worker may create a sequential descendant only inside its
own narrowed profile scope. Cross-profile nested orchestrator authority is not current MVP behavior.

---

## Graph law

```text
ThinkGraph = Engraphis project reasoning and operational knowledge
KnowGraph  = Neo4j/Graphiti sourced knowledge and provenance
CodeGraph  = CBM repository structure
AgentGraph = LiquidAIty Card relationships, delegation, parent-run lineage, and execution telemetry,
             implemented on Apache AGE/PostgreSQL
```

One authority and one writer per graph.

Main and Bot Mode are not ThinkGraph processing owners. Hermes owns the canonical conversation in
`state.db`; the Hermes plugin host's completed-Main observer reads the latest completed user/assistant pair,
passes it unchanged through Engraphis chunking and the ThinkGraph structured model call, and lets Engraphis
settle every returned Think without a Python semantic filter or minimum Think count. Do not poll history,
copy chat rows into TypeScript, migrate old test conversations, guess pair identity, or fabricate provenance.
LiquidAIty owns no chat prompt queue. No candidate graph, approval state, shadow graph, raw conversation
Memory, regex-first skeleton, broad cleanup path, generic target runner or second graph writer may
substitute for this boundary. KnowGraph retains sourced research through its existing
research agent and queued Graphiti intake. Its dedicated Entity write stores one exact `entity_uuid` property and removes
any Know `ABOUT` or `MENTIONS` attachment edge. Only Entities render as Project graph nodes; Thinks, Knows,
Graphiti episodes, citations, and supporting IDs remain attached properties or provenance. Engraphis
and Graphiti retain their own retrieval tools; automatic Card relevance filtering is removed. The ordinary
Entity inspector shows at most two provider-projected attached records;
it has no current Search/Results or Relevant/Recent control. Operating instructions belong in saved Cards; dynamic input carries
the actual task and selected data. Do not submit system-design guidance as test chatter.

- Pass pointers, provider IDs, bounded Context Selections, and provenance—not copied subgraphs.
- The in-memory JSON Entity/Relationship navigation map contains exactly the enabled visible Think, Know and
  Code projection plus at most one open node. It is orientation context, not another graph, archive, ranking
  layer or retrieval owner. The pre-LLM hook reads only the pre-rendered cached string.
- AgentGraph/AGE owns accepted Card relationship edits and may observe stable run/reference/artifact IDs. It never
  authorizes a runtime, chooses a card, or owns Hermes runtime lifecycle.
- The UI never writes graph meaning directly.
- TypeScript never performs semantic graph merges.
- Files/skills describe how-to; graphs store what-is. Do not copy Hermes profile learning/skill
  nodes into KnowGraph.
- A 2D or 3D visualization is permitted only when wired to real selection, context loading, handoff,
  consumption, traversal, or knowledge creation.

### Honest graph activity

Visual activation may come only from real observable events:

```text
query returned provider IDs
context included provider IDs
selection created
selection sent/delivered/opened
provider node/edge read
provider traversal completed
provider node/edge proposed or written
Hermes run completed or failed
```

Do not visualize hidden chain-of-thought. Do not infer access from answer prose. Do not create fake
success-shaped telemetry. Technical event proof may remain in the inspector; the foreground UX is
knowledge movement.

---

## Card input, IDD, and Script law

There is no LiquidAIty runtime-input file, IDF materializer, Data Anchor envelope, invocation staging
record, or TypeScript prompt assembler. Those abandoned paths are deleted and must not return.

Ordinary Card input is:

```text
literal Hermes Bot/session message
+ Hermes-native images and attachment references
+ the receiving saved profile's SOUL, skill, tools and memory
+ the pre-rendered visible Entity/Relationship navigation map when enabled
```

Hermes owns message admission, persistence, delivery, replay and identity. LiquidAIty may project saved
profile configuration and bounded provider pointers; it does not reconstruct the model request. Team and
Magnetic store one exact mission on the Hermes taskgraph root, then Hermes owns child prompts, dependencies,
attempts and synthesis. No per-worker input file is inferred.

IDD is the Input Data Dictionary: the literal repo-root `LiquidAIty.idd` definition source for Card-editor
fields, typed choices, defaults, templates and validation metadata. It is an authoring dictionary, not a
runtime authority, authenticator, checksum gate, tool catalog, prompt router, or materializer. Creation,
editing, Builder operations, validation and normalization must agree with current executable catalogs.

Every Card retains the Python Script editor below its Tools selection. A valid enabled Script executes only
through the official LiquidAIty plugin's `card_python` tool in a bounded isolated child of the Hermes
plugin host interpreter. Its nested calls remain within that Card's selected tools. Blank, invalid or disabled source is
inert and adds no per-turn execution tax. Script does not replace or re-authorize ordinary profile tools.

Authority is:

```text
provider availability
∩ saved Card/profile selection
∩ saved wire or taskgraph assignment scope
∩ Hermes session/tool authorization
```

Generic typed SQL/Cypher execution remains Python-rails deterministic computation with parameterization,
capability gating, limits and honest results. Do not recreate a registered-query subsystem or one MCP wrapper
per query. Durable operations use repository-root identities, relative paths and content hashes rather than
machine-specific absolute-path identity.

---

## Saved-card authority

A saved card is the sole permanent authority for:

```text
identity
prompt
provider/model/profile
bounded Hermes subagent model
runtime type and binding
enabled state
tool and capability grants
saved topology
```

Callers provide task input and stable references, not alternate card definitions. Missing cards,
models, grants, runtimes, or authorities fail honestly. No model/provider/tool fallback.

The underlying Project graphs remain durable in their provider owners. A caller selects bounded
references/context for one invocation; that selection remains transient and provider-owned.
PostgreSQL persists stable Card state and explicit product observations. AGE owns saved Card
relationships and may observe execution identities. Neither replaces saved-card configuration or
Hermes runtime truth.

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

For substantial repository work, the active PromptSpec plus the installed `promptspec-receiver` skill
form the complete current specification. Do not persist a competing spec, task ledger, or reconstructed
implementation packet.

Required sequence:

```text
SPECIFY
→ Primary initial plan
→ Primary CBM CLI map
→ up to two read-only direct-source scouts
→ Primary reconciliation
→ ordered tasks with Key Objective + Definition of Done
→ exact execution plan
→ implementation by Primary only
→ deterministic proof
→ real loaded-agent proof when behavior depends on a model
→ documentation-coherence review
→ freeze exact implementation bytes
→ independent Agent 3 review
→ Agent 3 returns review findings in the conversation
→ STOP
```

This controlled waterfall exists because prior runs expanded into side quests, mixed rejected designs,
changed broad unrelated file sets, used tests to bless the wrong behavior, and stacked repairs onto an
incorrect structure. Creativity belongs in proposals; the authorized implementation remains literal.

Every PromptSpec task record contains:

```text
Task ID
Key Objective
requirements served
current owner
allowed files
dependencies
implementation moves
authorized proof
Definition of Done
```

A task is complete only when its Definition of Done is satisfied, not when code or prose merely exists.

The final review has no same-run repair loop. Once Agent 3 begins, the Primary does not modify production,
tests, prompts, grants, schemas, configuration, or reviewed documentation. PASS stops for owner review/save.
FAIL also stops; the owner decides whether to inspect, accept, wipe/revert, or retry from a clean checkpoint.

For staged work, apply this sequence to exactly one approved stage and wait for explicit approval before the
next. Product agents executed as acceptance tests do not become repository implementation workers.

---

## PlanFlow and execution approval

PlanFlow is a visible task-object control surface, not a document map, fake planner summary, or
deterministic text-cleanup layer.

Until approved task-node execution is genuinely wired, Run Task fails closed:

```text
Run Task unavailable: approved task-node execution is not wired yet.
```

Do not execute from fallback assistant text, `finalResponseText`, raw chat, fake task objects, or
reconstructed Hermes task-ledger state. Do not mark completion without proof.

---

## Skills

Historical records explain past failures; they do not authorize obsolete tools, graph writes,
generators, or restrictions. No feature-manifest or automatic LLM wiki system is restored.

`skills/*.md` files are reusable proven procedures and known traps. Retrieve a small relevant set. Do
not inject every skill into every prompt. Do not create a skill merely because a task completed.

A skill is promoted only when a lesson is reusable and proven through real work. Skills are not task
nodes, raw history, per-run review reports, or specs.

---

## Documentation law

Canonical durable documents are:

```text
README.md
PLAN.md
AGENTS.md
DONT.md
ARCHITECTURE.md
RUNTIME.md
FUTURE.md
skills/*.md
repo-intake/*.md only when explicitly required
```

Keep turn status, plans, review findings, and remaining work in the conversation. Do not create or
maintain handoff, continuation, review, or progress files unless the owner explicitly requests that
artifact. Notes and unfinished items do not authorize additional work or replace the current request.
Durable implementation contracts belong in `ARCHITECTURE.md`, current status in `PLAN.md`, and product
requirements in `RUNTIME.md`; changing those documents still requires task scope.

Do not create:

```text
CLAUDE.md
specs/
tasks/
progress or checkpoint docs
handoff/evidence files
raw diff dumps
persistent prompt/task packets
unsolicited review reports
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
- No duplicate or application-owned replacement for Hermes task/dependency execution.
- No unrelated cleanup inside a bounded task.
- No deletion outside the owner-authorized exact Card scope.
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
