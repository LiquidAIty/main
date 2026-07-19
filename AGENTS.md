# AGENTS.md

## STOP — read [DONT.md](./DONT.md) first

Before anything else, read **[DONT.md](./DONT.md)**. This repo has been cleaned of well over
**200,000 lines** of layered spaghetti — see the DONT.md purge log for the running tally. It keeps
coming back because agents add new approaches without deleting the old ones, and mimic the mess.
DONT.md is the rule set that prevents you from doing that. The one that matters most: **when you
change approach, DELETE the abandoned path in the same change — never layer new over old.**
TS = transport/pixels, Python = rails, models = brain. The UI is a UI, not a calculator; all logic is Python + models.

**Quantified warning (2026-07-05 audit sweep):** in one sweep, **74 files / ~9,248 lines** of dead
non-vendored code were deleted (3 commits, every stack green throughout) — and *every one of those
files "worked" before it was deleted.* They came from exactly **two habits, both of which you must
not repeat**: (1) a big file gets "split up" (the GPT "your 15k-line file is too big, I'll break it
up" move) and the pieces are never deleted or wired back — they end up imported only by their own
spec; (2) a config/service/script/duplicate is scaffolded "for later" and later never comes
(`jest.config.js` shipped as a literal `{{ ... }}` placeholder; `utils/urlGuard.ts` duplicated the
live `security/urlGuard.ts`; `.mjs` scripts nx can't even see). **If you split a file, delete the
original and prove every piece has a live importer. If you scaffold, wire it now or don't write it.
No duplicates, no placeholders, no `.mjs`.**

## Code-Based Memory First

Code-Based Memory / CodeGraph is the first code-discovery system for this repo.

Before planning code work, before editing, and before claiming what a file does, use Code-Based Memory.

Do not start with broad grep.
Do not start with random file opening.

**Skills:** See `skills/codebasedmemoryskill.md` for CBM tool reference. See `skills/ai-native-runtime-awareness.md` for the runtime awareness fabric (event pipeline, Hermes observer, postflight review, evidence tiers).
Do not guess from memory.
Do not claim code behavior without direct reads.
Do not treat stale graph memory as proof.

The normal code-work order is:

```txt
read AGENTS.md
read PLAN.md
read selected wiki/*.md feature manifest(s)
read relevant skills/*.md
refresh or prove Code-Based Memory
record CBM project/root/status/nodes/edges
use CBM graph tools to find files/symbols/routes/relationships
direct-read the resolved files
then plan or edit
```

Direct reads, compile output, focused tests, and live smoke proof beat graph memory if they disagree.

CBM is a structural code-navigation system.

CBM is not a fake proof engine.

## Code-Based Memory MCP Tools

Codebase-Memory exposes 14 MCP tools.

The 14 tools are:

```txt
index_repository
index_status
list_projects
delete_project
search_graph
trace_call_path
query_graph
ingest_traces
detect_changes
get_graph_schema
get_architecture
get_code_snippet
search_code
manage_adr
```

### Indexing tools

```txt
index_repository
index_status
list_projects
delete_project
```

Use `index_repository` to build or update the graph for the repo.

Use `index_status` to verify index state before relying on CBM.

Use `list_projects` to confirm the indexed project/root is the repo actually being edited.

Use `delete_project` only when explicitly requested. Removing an index is destructive to the local graph state.

### Query tools

```txt
search_graph
trace_call_path
query_graph
ingest_traces
```

Use `search_graph` to find symbols, functions, classes, files, routes, and graph entities.

Use `trace_call_path` for inbound/outbound call-chain traversal and impact reasoning.

Use `query_graph` for Cypher-like graph queries when the normal search result is not enough.

Use `ingest_traces` only when runtime trace data is intentionally being imported.

### Analysis tools

```txt
detect_changes
get_graph_schema
get_architecture
```

Use `get_graph_schema` to learn node and edge types before writing graph queries.

Use `get_architecture` to get a structural architecture summary.

Use `detect_changes` only when change-impact analysis is explicitly in scope. Do not use it as permission to rely on git diff by default.

### Code tools

```txt
get_code_snippet
search_code
manage_adr
```

Use `get_code_snippet` for source retrieval after graph discovery.

Use `search_code` for full-text search after CBM has bounded the area.

Use `manage_adr` only for architecture-decision records when the user explicitly wants that kind of durable record. Do not create ADR/documentation sprawl by default.

## How To Use CBM In This Repo

Use CBM to answer:

```txt
what files matter?
what symbols matter?
what routes matter?
what calls what?
what imports what?
what tests what?
what breaks if this changes?
what files are missing from the index?
is the index fresh enough?
what is safe to edit?
what proof should be run?
```

Minimum CBM proof before edits:

```txt
project/root matched
index status ready or explicitly blocked
node count recorded
edge count recorded
relevant files found
relevant symbols/routes found when available
direct reads completed after graph lookup
```

If CBM is stale, unavailable, mismatched to the repo root, or missing required files, block the run and report the exact reason.

Do not silently fall back to grep as if CBM were fresh.

Grep/text search is allowed only after CBM bounds the area or when reporting that CBM is blocked/unavailable.

## CBM Freshness Rules

A CBM result is not fresh merely because a command returned.

A useful CBM freshness report includes:

```txt
project name
project root
index status
nodes
edges
indexed file count if available
missing files if detected
excluded vendored files if detected
fresh/stale/unknown/blocked status
```

If a new file exists on disk but is absent from CBM indexed File nodes, treat freshness as stale or unverified.

If node/edge counts do not change after expected new code, do not assume freshness. Confirm by file/symbol search and direct read.

Never invent an indexed revision, indexed timestamp, chunk count, node count, or edge count.

## Feature Manifest Registry

`wiki/*.md` is the flat Feature Manifest registry. One file equals one real product or
runtime feature. Each feature manifest is a compact semantic pointer card — not a
source-of-truth replacement and not a mini manual.

A feature manifest tells an agent:
- what the feature is and what user/agent outcome it exists for;
- what must not break;
- where to start in CBM (exact file paths + simple symbol names);
- which code landmarks matter;
- what proof is valid;
- what remains risky or unproven.

Source code, tests, persisted data, real runtime evidence, and fresh CBM remain
authoritative over any feature manifest. A manifest is stale when its anchors drift
from the live codebase.

Before a coding task touching a known feature, the explicitly selected feature
manifest(s) are loaded and their anchors are re-resolved through live CBM.

Primary and supporting features are selected by the Planner, Task Ledger, or current
SPEC — never inferred by regex, phrase routing, or automatic classification.

After a coding task completes, the CoderReport identifies affected feature IDs and
whether a manifest refresh is needed. The cheap Wiki Librarian (refresh-only agent)
updates only the affected manifests using evidence from the completed work.

Do not create feature files for random folders, helpers, tests, or every source file.
Do not create generic wiki scaffolding, nested wiki folders, or separate documentation
ledgers.

## Skills System

Skills are reusable work knowledge.

Readable skill files live in:

```txt
skills/*.md
```

SkillsGraph indexes and relates those skills in Neo4j / KnowGraph-style graph memory.

The two layers have different jobs:

```txt
skills/*.md = human-readable procedure, repo law, proof method, known trap
SkillsGraph = machine-readable retrieval graph for matching tasks to skills
```

A skill may contain:

```txt
when to use it
when not to use it
steps
proof commands
known traps
related files/systems
success evidence
failure evidence
query patterns
```

Skills are not PlanFlow nodes.
Skills are not specs.
Skills are not task files.
Skills are not raw task history.
Skills are not one-off CoderReports.

## How Skills Are Used

Before a coder or agent acts, retrieve relevant skills.

Skill lookup should use:

```txt
active user request
selected PlanFlow node
connected PlanFlow nodes
Task Ledger context
CBM / CodeGraph files and symbols
subsystem names
known traps
required proof
```

The result should be a small set of relevant skill pointers.

Do not dump every skill into every prompt.

If no matching skill exists, the CoderReport should say so.

A successful run may propose a new skill candidate only when the learning is reusable.

## Skill Snowball

LiquidAIty should get smarter after real work.

The intended loop is:

```txt
task node
→ CBM / CodeGraph lookup
→ SkillsGraph lookup
→ bounded CoderPacket
→ coder execution
→ CoderReport with proof
→ Progress Ledger result
→ reusable lesson becomes skill candidate
→ user approves or edits skill
→ skill saved to skills/*.md
→ skill indexed into SkillsGraph
→ next run starts smarter
```

A skill is promoted only through proof.

Do not create skill spam.

Do not create a skill just because a task completed.

Do not update skills unless the lesson is reusable.

## Product Law

LiquidAIty is an agentic engineering workbench.

The first launch wedge is the coding loop:

```txt
user chat
→ planner context pull
→ real Magentic-One / AutoGen through Python rails
→ real Task Ledger artifact
→ PlanFlow task nodes
→ Go / Run review
→ one bounded CoderPacket
→ coder
→ structured CoderReport
→ comparison, proof, memory, skills, and next job
```

`PLAN.md` is the durable living product plan and current route.

`AGENTS.md` is execution law.

PlanFlow is the visible task-control surface.

PlanFlow is not:

```txt
doc map
spec library
skill library
markdown graph
road-sign display
fake planner summary
fake execution preview
deterministic sanitizer surface
```

The product object is the task node.

The proof belongs on the task node.

The details belong in the inspector.

The chat steers.

The ledger records.

The graph remembers.

The skills snowball.

## Runtime Naming

The Python runtime is called:

```txt
Python rails
```

Do not call it sidecar in user-facing reports, docs, comments, prompts, or CoderReports.

If Python rails code changes, report once:

```txt
Python rails restart/reload required: yes
```

Do not nag repeatedly.

## Real Task Ledger Law

The Task Ledger is real.

It comes from:

```txt
Python rails
→ AutoGen / Magentic-One
→ taskLedgerArtifact
```

The real Task Ledger may include:

```txt
team composition
agent assignments
which agents are planned to be used
what the agent team plans to do
facts gathered
internal plan
full task ledger
runtime/provenance
model-call proof
```

This is correct and required.

Do not remove team composition.

Do not remove agent assignment planning.

Do not dumb the Task Ledger down.

Do not override AutoGen defaults.

Do not edit vendored AutoGen.

Do not override `_get_task_ledger_plan_prompt`.

Do not replace the real Task Ledger with frontend/backend fake data.

If the real Task Ledger output is ugly, expose the real state. Do not hide it with deterministic cleanup.

## Deterministic Content Logic Ban

Do not add deterministic content interpretation as a substitute for AI planning or task creation.

Forbidden anywhere in the planning/task path:

```txt
sanitizers
regex cleanup
keyword classifiers
deterministic routers
prompt-injection filters
poison filters
content guard filters
string rewrite helpers
agent-name stripping
Source stripping
AutoGen / Magentic-One stripping
PlanAgent / ThinkGraphAgent / KnowGraphAgent stripping
rewriting "Have PlanAgent..." into nicer wording
turning raw plan text into fake user-facing task text
```

Do not keep this logic as:

```txt
temporary
defensive
fallback
guardrail
poison protection
projection sanitizer
display cleanup
```

Delete it.

Normal typed code, schema validation, tests, CSS/layout logic, and structured field rendering are allowed.

Deterministic code that pretends to understand or repair AI work is not allowed.

## Execution Contract

The active CoderPacket prompt is both the complete execution spec and the complete task.

It is also called:

```txt
spec-as-prompt
task-as-prompt
active job contract
```

When coding:

1. Read `AGENTS.md` and `PLAN.md`.
2. Read relevant `skills/*.md`.
3. Read the current CoderPacket when one exists.
4. Refresh or prove fresh CBM and record status, nodes, and edges.
5. Use CBM graph tools before focused text search.
6. Direct-read relevant files before claims or edits.
7. Break the spec-as-prompt into bounded tasks.
8. Execute scoped work only.
9. Prove the work with tests, compile, direct reads, or real smoke evidence.
10. Compare actual work against every CoderPacket requirement.
11. Return a structured CoderReport.
12. Refresh or prove fresh CBM after code changes.
13. Update skills only when the learning is reusable.

Do not broaden scope.

Do not start the next job without instruction.

## CoderPacket

A CoderPacket is one bounded job created from:

```txt
PLAN.md
active Context Packet
selected/connected PlanFlow nodes
relevant ThinkGraph memory
fresh CBM / CodeGraph anchors
relevant SkillsGraph matches
specific skills/*.md files
user constraints
```

A CoderPacket is reviewable and temporary.

It contains:

```txt
requirements
scope
files in scope
files out of scope
proof commands
stop conditions
what not to do
expected report shape
```

Do not create:

```txt
spec files
task files
task ledgers as markdown files
specs/
tasks/
persistent CoderPacket files
persistent task prompt files
```

Durable product direction belongs in `PLAN.md`.

Reusable learning belongs in `skills/*.md` and SkillsGraph.

Current execution requirements belong only in the active CoderPacket.

## CoderReport

Every coding job returns a structured CoderReport containing:

```txt
verdict
comparison against CoderPacket
completed requirements
incomplete requirements
changed requirements
files changed
files read
CBM before/after
proof commands
proof results
blockers
assumptions
chosen approach
rejected alternatives
reusable skill updates
next recommended task
```

Never return vague done.

Never hide incomplete proof.

Never report success without matching proof.

## Context And Memory

Magentic-One / Sol initiates Context Packet assembly before creating the next job.

The Context Packet may combine:

```txt
user input
selected PlanFlow task node
connected PlanFlow task nodes
PLAN.md
ThinkGraph memory
fresh CBM / CodeGraph evidence
relevant SkillsGraph / Neo4j skills
specific skills/*.md files
KnowGraph only when relevant
recent Progress Ledger results
```

Codebase Memory / CodeGraph is the structural map.

Direct reads and proof win when graph memory disagrees.

ThinkGraph stores structured reasoning, events, jobs, reports, proof, blockers, and next steps.

`skills/*.md` store reusable learning and are indexed through SkillsGraph / Neo4j.

Skills are not PlanFlow nodes.

Skills update only for reusable procedures, boundaries, proof rules, failed attempts, adapter lessons, or repo traps.

## PlanFlow Law

PlanFlow is the durable task-object canvas.

PlanFlow must be fed by real artifacts, not chat text.

Allowed source:

```txt
taskLedgerArtifact.planResponse
```

Forbidden sources:

```txt
finalResponseText
autogenMessages
chat text
fallback assistant text
fake task objects
```

PlanFlow may render task nodes from the real Task Ledger artifact.

PlanFlow must not deterministically rewrite task text.

Allowed UI behavior:

```txt
CSS clamp
card sizing
card spacing
selected node styling
inspector details
normal typed fields
choosing not to render optional metadata on a tiny card
```

Forbidden UI behavior:

```txt
content sanitizing
content rewriting
agent-name stripping
source-name stripping
fake user-facing conversion
```

Rendering fewer metadata fields is okay.

Changing task text content is not okay.

## Run Task / Approval Law

Run Task must execute only approved task nodes once execution is actually wired.

Until approved task-node execution is wired, Run Task must fail closed.

Acceptable failure:

```txt
Run Task unavailable: approved task-node execution is not wired yet.
```

Run Task must not use:

```txt
autogenMessages as hidden task source
chat text as task source
finalResponseText as task source
fake task objects
```

Run Task must not:

```txt
call coder before approval
call LocalCoder before approval
call terminal before approval
call tools before approval
call Progress Ledger before execution is wired
mark task complete without proof
fake execution success
```

## Skills

Skills are reusable work knowledge.

Skills live as readable files in:

```txt
skills/*.md
```

SkillsGraph indexes and relates those files.

A skill should contain:

```txt
when to use it
when not to use it
steps
proof commands
known traps
related files/systems
success evidence
failure evidence if relevant
```

A skill should usually come from:

```txt
successful CoderReport
repeated failure pattern
confirmed repo trap
validated proof command
stable workflow rule
candidate skill tested successfully
```

Do not create skill spam.

Do not update skills unless the learning is reusable.

## Documentation Policy

Markdown is an execution layer, but avoid documentation sprawl.

Allowed durable docs:

```txt
PLAN.md
FUTURE.md
AGENTS.md
DONT.md
skills/*.md
repo-intake/*.md only when explicitly needed
```

Forbidden doc sprawl:

```txt
CLAUDE.md
random architecture runbooks from one bad pass
specs/
tasks/
random notes
progress files
evidence files
handoff files
completed-task piles
raw diff dumps
persistent CoderPacket files
persistent task prompt files
```

Do not use docs to hide unfinished product logic.

## Hard Stops

No commit or push unless the user explicitly requests it.

No stubs or placeholder implementations.

No fake fallback.

No silent fallback.

No provider/model fallback unless explicitly requested.

No invented tools.

No hidden success.

No fake final output.

No mocked success.

No vague done claim.

No deterministic fake planning.

No fake Magentic-One / Sol provenance.

No Run Preview pretending to be execution.

No road-sign UI as product law.

No spec sprawl.

No destructive git operations without explicit instruction.

Preserve the real ReactFlow / TypeScript control plane, Node backend, Python rails, and Microsoft AutoGen v0.4+ / Magentic-One runtime unless explicitly changed by the user.

Required runtime primitives must remain available for future wiring:

```txt
MagenticOneGroupChat
AssistantAgent-with-tools
Swarm
SocietyOfMindAgent
UserProxyAgent
```

## Editing And Proof

Use existing repo patterns.

Keep edits scoped.

Use `apply_patch` for manual edits when practical.

Never revert unrelated user changes.

Tests scale with risk.

Report blockers honestly.

Do not fake proof.

For serious runs report:

```txt
verdict
files read
CBM before/after
work done
CoderPacket comparison
proof
actual graph/code delta
reusable skill updates
risks
next state
```

Do not include routine git output or patch dumps unless the user asks.
