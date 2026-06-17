# LiquidAIty PLAN.md

## Product Identity

LiquidAIty is an agent workbench for serious projects.

It is not a chat app.
It is not a dashboard generator.
It is not a fake workflow/status-card system.
It is not a pile of markdown specs and task files.
It is not a deterministic sanitizer/router/filter system.

LiquidAIty turns user intent into durable, editable task objects on a canvas, then uses agents, graph memory, skills, tools, reports, and proof to move those tasks forward.

The product object is the task node.

The proof belongs on the task node.

The details belong in the inspector.

The context is controlled by node connection state.

The chat steers.

The ledger records.

The graph remembers.

The skills snowball.

## Core Loop

The target loop is:

```txt
user chat
→ Magentic-One / AutoGen through Python rails
→ real Task Ledger artifact
→ persistent editable PlanFlow task nodes
→ Go / Run review
→ bounded execution packet
→ agent / coder execution
→ Progress Ledger results
→ skill candidate or skill update
→ graph memory update
→ next tasks, subtasks, or blockers
```

The current repo should not fake later stages before the real planning loop is honest.

## First Launch Wedge

The first launch wedge is the agentic engineering / coding workbench.

The first useful loop is:

```txt
user describes work
→ Magentic-One reads active project context
→ Task Ledger captures the real team plan and work plan
→ PlanFlow shows editable task nodes
→ user reviews / edits / selects / connects / approves
→ Go / Run review builds a bounded execution packet
→ coder receives one bounded CoderPacket
→ coder returns CoderReport
→ Progress Ledger attaches proof/results/blockers to task nodes
→ skill candidate/update is proposed
→ approved skill updates skills/*.md and SkillsGraph
→ ThinkGraph records what happened
→ next task/subtask is proposed
```

Research, trading, video, buyer agents, and other verticals come later.

The coding loop comes first because it has the clearest proof loop:

```txt
task
→ code/file scope
→ skill lookup
→ coder execution
→ tests/proof
→ CoderReport
→ Progress Ledger
→ skill update
→ next task
```

Once this works, the same control architecture can support agents that require accuracy, continuity, approval, and repeatable improvement.

## Current Immediate State

The current repo is mid-repair.

Useful corrections to preserve:

```txt
bad AutoGen prompt override removed
vendored AutoGen untouched
Python rails capture-only Task Ledger extraction preserved
factsResponse / planResponse / taskLedgerResponse / teamDescription / modelCallProof preserved
Run Task should fail closed instead of executing from autogenMessages
fake hand-built TaskLedger tests/nodes should be deleted if they do not connect to the real taskLedgerArtifact path
```

Current cleanup priority:

```txt
delete deterministic PlanFlow sanitizer/rewrite code
delete tests that require sanitizer behavior
delete one-off doc sprawl
keep real Task Ledger capture
keep PlanFlow rendering from real artifacts
keep approval gate fail-closed
```

The repo should expose the real current state before trying to make it pretty.

## Hard Product Law

Do not fake AI work.

Forbidden:

```txt
fake planner output
fake Task Ledger cards
fake Progress Ledger results
fake completed statuses
fake fallback answers
deterministic road-sign UI
bottom metadata banners
chat replies converted into plans
autogenMessages converted into plans
finalResponseText converted into plans
backend-authored AI answers
frontend-authored AI answers
mocked success on live routes
hidden prompt spaghetti buried in runtime files
deterministic sanitizer code pretending to be AI planning
deterministic regex cleanup pretending to be product logic
deterministic guardrail/filter/poison logic in the planning path
```

Allowed:

```txt
real AutoGen / Magentic-One execution
real Task Ledger artifacts
real Progress Ledger artifacts when execution is wired
real task objects
real user-editable canvas nodes
real proof/results attached to tasks
real missing-state reporting
real skill lookup
real skill creation/update after proof
```

When uncertain, do not fake it.

If an artifact is missing, report missing.

If proof is missing, report missing.

If a route is not wired, fail closed.

If a task is disconnected, it is inactive metadata.

If a task is deleted, it is gone unless it is explicitly a reusable template/preset.

## Deterministic Content Logic Ban

At this stage, deterministic content manipulation is not wanted in the planning/task path.

Forbidden:

```txt
sanitizers
regex cleanup
keyword classifiers
deterministic routing
prompt-injection filters
poison filters
guardrail filters
string rewrite helpers
agent-name stripping
Source stripping
AutoGen / Magentic-One stripping
PlanAgent / ThinkGraphAgent / KnowGraphAgent stripping
rewriting "Have PlanAgent..." into nicer wording
turning raw plan text into fake user-facing task text
```

These must not be kept as:

```txt
temporary
defensive
fallback
guardrail
poison protection
projection sanitizer
display cleanup
```

If the real Task Ledger output is noisy, show the noisy real state for now.

The fix is proper Mag One agent-card / prompt-chain design, not deterministic code.

## Python Rails

The Python runtime is called Python rails.

Do not call it sidecar in user-facing reports, docs, prompts, comments, or CoderReports.

If Python rails code changes, report once:

```txt
Python rails restart/reload required: yes
```

Do not repeat restart instructions.

## Magentic-One / AutoGen Runtime

The main AI route is real AutoGen / Magentic-One.

Allowed live route:

```txt
deck_builder/run
→ card_magentic
→ Python rails
→ MagenticOneGroupChat.run_stream
→ real Task Ledger artifact
→ PlanFlow task nodes
```

The frontend and backend do not create AI answers.

Backend responsibility:

```txt
transport
route orchestration
state persistence
safe API contracts
```

Python rails responsibility:

```txt
AutoGen / Magentic-One runtime
real team execution
real Task Ledger artifact extraction
real Progress Ledger execution when wired
```

Do not replace this with a basic chat call.

Do not add a deterministic planner.

Do not add fallback success answers.

Do not mock success on the live route.

## Task Ledger

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

This is correct.

Do not remove team composition.

Do not remove agent assignment planning.

Do not dumb the Task Ledger down.

Do not override AutoGen defaults.

Do not edit vendored AutoGen.

Do not override `_get_task_ledger_plan_prompt`.

Do not hide the team plan.

Do not replace the real Task Ledger with frontend/backend fake data.

The Task Ledger should eventually produce or carry both:

```txt
real team plan
PlanFlow-ready task objects
```

But that should come from Mag One agent-card / prompt-chain design, not deterministic string cleanup.

## Task Ledger Includes Tool Planning

There is not a separate Tool Planning Ledger.

Tool planning is part of the Task Ledger.

A Task Ledger may contain:

```txt
task objects
step objects
team plan
agent-use plan
tool-use plan
context requirements
approval requirements
SkillsGraph pointers
CodeGraph / CBM file pointers
expected outputs
```

If a request needs tools, Magentic-One should plan tool use inside the Task Ledger.

The Task Ledger should answer:

```txt
which agents are needed?
why are those agents needed?
which tools are needed?
why are those tools needed?
what should each agent/tool do?
what context should each agent/tool receive?
what output should each agent/tool return?
what needs user approval before running?
```

Tool planning must not become a fake deterministic router.

A tool is selected because the task needs it, not because a keyword matched.

## PlanFlow

PlanFlow is the durable task-object canvas.

PlanFlow is not a Task Ledger metadata display.

PlanFlow is not a document map.

PlanFlow is not a spec library.

PlanFlow is not a skill library.

PlanFlow is not a road-sign/status-card dashboard.

The Task Ledger is the source artifact.

PlanFlow is the editable object surface created from that artifact.

PlanFlow should be fed by real artifacts, not chat text.

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
CSS text clamp
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

Changing the content of plan/task text is not okay.

## PlanFlow Node Shape

A PlanFlow node should be small on the canvas.

Canvas node shows:

```txt
step number
short title or real step line
optional one short detail line
status
```

The right inspector owns details.

Inspector may show:

```txt
editable title
editable body/detail
step number
source artifact reference
status
result
proof
blocker
next_needed
subtasks
prompt-chain reference
skills used
team plan
tool plan
compact debug/provenance if needed
```

Bottom banners are forbidden.

There should be no bottom focus strip, no bottom source strip, no bottom raw payload strip, and no repeated Task Ledger metadata banner.

## PlanFlow Context Control

PlanFlow is also context control.

Node states:

```txt
connected = active context
selected = active inspection/edit target
disconnected = inactive metadata
deleted = removed
template/preset deleted = may remain as reusable library metadata
```

Connected nodes are active project context.

Selected nodes are active inspection/edit targets.

Disconnected nodes are inactive metadata. They may remain visible or recoverable, but they must not silently enter the next prompt.

Deleted nodes are removed unless explicitly stored as reusable templates/presets.

The user controls context by connecting, disconnecting, selecting, editing, deleting, or reviving task nodes.

## Approval / SWAT Gate

The selected-node approval gate may remain.

It must be fail-closed.

It may do:

```txt
select a Step node
show a small attached approval tray
stage/approve the selected node
report execution is not wired
stop
```

It must not:

```txt
call coder
call LocalCoder
call terminal
call tools
call Progress Ledger
call backend execution endpoint
use autogenMessages as task source
use chat text as task source
use finalResponseText as task source
mark task complete
fake execution success
```

Until approved task-node execution is wired, Run Task should fail closed.

Acceptable failure:

```txt
Run Task unavailable: approved task-node execution is not wired yet.
```

Not acceptable:

```txt
silently run from autogenMessages
silently run from chat answer
pretend a task was approved
```

## Progress Ledger

The Progress Ledger comes after task execution.

It attaches execution results to task nodes.

Progress Ledger fields may include:

```txt
task result
proof
files changed
tests run
blocker
next_needed
CoderReport
agent report
new subtasks
skill candidate
skill update
```

Progress Ledger results should update existing task nodes or create child task nodes.

Progress Ledger must not create fake success.

If a task has no proof, show proof missing.

If a task is blocked, show the blocker.

If more work is needed, show next_needed.

## Coder In The Progress Ledger Loop

The coder belongs inside the Progress Ledger part of the loop.

The intended coding loop is:

```txt
PlanFlow task node
→ Go / Run review
→ connected-node context packet
→ CodeGraph / CBM file pointers
→ SkillsGraph skill pointers
→ CoderPacket
→ coder execution
→ CoderReport
→ Progress Ledger update
→ task node result/proof/blocker/next_needed
→ skill candidate or skill update
```

The coder should not receive a vague chat message.

The coder should receive a bounded CoderPacket that tells it:

```txt
active task node
connected task context
selected files from CodeGraph / CBM
relevant skills from SkillsGraph
skills/*.md files to read
files in scope
files out of scope
proof commands
stop conditions
what not to do
```

The CoderReport is not just a chat reply. It is evidence.

Progress Ledger attaches that evidence to the task node.

## Chat

Chat is the command and reasoning surface.

Chat is not durable project memory by itself.

Chat can request plans, audits, edits, runs, explanations, decisions, research, skill search, and skill creation.

For plan-producing work, chat should not dump the full plan if the plan exists on PlanFlow.

Acceptable chat response after plan creation:

```txt
Plan created on canvas.
```

The durable state belongs in task objects, graph memory, ledgers, reports, and skills, not in chat transcript text.

## Chat As Task Maker And Skill Maker

Chat has two MVP jobs in the code workbench.

First, chat is the task maker.

A chat turn can produce task objects through Magentic-One / AutoGen and the Task Ledger.

Those task objects become PlanFlow nodes.

Second, chat is the skill maker or skill pointer.

When a chat turn, CoderPacket, CoderReport, failure, fix, or repeated repo trap reveals reusable knowledge, the system should either:

```txt
point to an existing skill
propose a new skill
propose an update to an existing skill
ask Research Bot / Skill Hunter for candidate skills
```

The goal is to stop the stack from rethinking the same problem every time.

## Launch Magic: Skill Snowball

The small smart thing to launch with is the Skill Snowball.

LiquidAIty does not need every future agent on day one.

It needs one loop that makes each agent run smarter than the last.

The launch loop is:

```txt
task nodes
→ SkillsGraph lookup
→ missing-skill search or skill proposal
→ agent/coder tests skill in real work
→ CoderReport / agent report records proof
→ Progress Ledger attaches result to task
→ working skill is saved to skills/*.md
→ skill is indexed into SkillsGraph
→ next run starts smarter
```

This is the magic.

The system does not just chat.

The system does not just remember.

The system learns usable procedures.

For the code MVP:

```txt
before coding:
  find relevant skills and code files

during coding:
  use matched skills, task context, and proof rules

after coding:
  report proof, blockers, and reusable lessons

after report:
  create or update skills
```

The repo learns how to work on itself.

That same loop later supports trading agents, research agents, buyer agents, video agents, and other serious agents.

## Existing SkillsGraph System

LiquidAIty already has an internal SkillsGraph system.

It is not just an idea and not just markdown.

The current repo contains:

```txt
skills/*.md
services/knowgraph/skill_ingest.py
services/knowgraph/test_skill_ingest.py
services/knowgraph/test_skill_retrieve.py
skills/skillgraph-neo4j-indexing-skill.md
skills/knowgraph-skill-ingestion-skill.md
skills/knowgraph-skill-retrieval-skill.md
```

The current design is:

```txt
skills/*.md
→ deterministic skill importer
→ Neo4j / SkillsGraph
→ skill retrieval packet
→ CoderPacket / handoff prompt
→ CoderReport
→ reusable skill update
→ re-ingest into SkillsGraph
```

`skills/*.md` are the human-readable durable skill files.

SkillsGraph / Neo4j is the machine-readable retrieval layer.

The graph exists so the stack stops rethinking the same repo traps, proof commands, failed attempts, and guardrails every time.

## SkillsGraph

SkillsGraph is LiquidAIty’s internal reusable-skill memory.

It exists to stop the system from rethinking the same repo traps, workflow rules, proof patterns, failed attempts, and implementation boundaries every time.

The two forms have different jobs:

```txt
skills/*.md = human-readable reusable procedure / guardrail
SkillsGraph = machine-readable retrieval graph for matching tasks to skills
```

A skill file is the durable readable source.

A SkillsGraph node stores and relates:

```txt
skill name
skill file path
when to use it
when not to use it
related files
related systems
known traps
proof commands
past successful uses
past failures
required gates
```

SkillsGraph should retrieve only relevant skills for the current task.

It must not dump every skill into every prompt.

## Active Context Packet

Before creating a CoderPacket or task plan, Magentic-One should work from an active Context Packet.

The Context Packet may include:

```txt
user input
connected PlanFlow task nodes
selected task node details
PLAN.md
relevant ThinkGraph memory
fresh Codebase Memory / CodeGraph evidence
relevant SkillsGraph matches
specific skills/*.md files selected by SkillsGraph
KnowGraph research when relevant
recent Progress Ledger results
```

Disconnected PlanFlow nodes are inactive metadata and should not enter the active Context Packet unless the user reconnects/selects/revives them.

SkillsGraph is reusable system memory.

It may retrieve relevant skills by task/file/system match, but it must not blindly stuff unrelated skills into context.

Missing or stale code evidence is a blocker, not permission to guess.

## Go / Run Review

Before Go / Run / Coder execution, chat should review the active task context.

The review should include:

```txt
connected PlanFlow nodes
selected task node
Task Ledger team/tool-use plan
recent relevant Progress Ledger results
CodeGraph / CBM found files
SkillsGraph found skills
relevant skills/*.md
ThinkGraph task memory
KnowGraph context if relevant
user approval state
```

Disconnected PlanFlow nodes are inactive metadata and should not enter the active run context unless the user reconnects/selects/revives them.

The Go / Run review produces a bounded execution packet.

For coding, that packet is the CoderPacket.

## Agent Cards And Prompt Chains

Prompts should not be buried randomly in runtime files.

If an agent/card uses a multi-step prompt, that prompt belongs on the agent/card as an inspectable prompt chain.

Prompt chain shape:

```txt
Agent Card
  Prompt Chain
    1. role / identity
    2. context policy
    3. Task Ledger extraction rule
    4. output contract
    5. tool-use conditions
    6. approval / stop conditions
```

Prompt chains should later be visible and editable in the card inspector.

Runtime code should execute configured prompt-chain steps.

Runtime code should not smuggle hidden prompt strings into adapters.

## Next Real Step After Cleanup

After deterministic code is removed and the repo is honest again, the next single step is:

```txt
put the Task Ledger output-shape instruction into the Mag One agent card / prompt chain
```

That later step should let Mag One produce both:

```txt
real team plan
real PlanFlow-ready task objects
```

without deterministic sanitizer code.

The prompt-chain work must live on or through the Mag One agent card / prompt-chain path, not hidden randomly in runtime code.

## Codebase Memory / CodeGraph

Codebase Memory / CodeGraph is a planning and code-discovery tool.

It is not the top-level product surface.

CBM helps bound code work, find anchors, and avoid blind edits.

Direct reads, compile output, tests, and real smoke proof win if they disagree with graph memory.

Before code edits, CBM must be fresh enough for the target scope or the work is blocked.

## ThinkGraph

ThinkGraph stores structured reasoning and project memory.

ThinkGraph may store:

```txt
why the plan changed
what context was used
what task was created
what report came back
what proof passed
what failed
what blocker exists
what next step was recommended
```

ThinkGraph is not markdown sprawl.

ThinkGraph must not invent planning or success.

## KnowGraph

KnowGraph stores external/project knowledge when relevant.

KnowGraph is separate from PlanFlow.

KnowGraph can support task planning, research, market data, documents, and domain knowledge, but it should not pollute active context unless selected/relevant.

## CoderPacket

The active CoderPacket prompt is both the spec and the task for one bounded job.

It is also called:

```txt
spec-as-prompt
task-as-prompt
active job contract
```

A CoderPacket:

```txt
is temporary
is reviewable by the user
is created from active context
contains all requirements, scope, proof, and stop conditions
is sent to a coder only after approval
is not saved as a spec file unless explicitly exported
```

The repo should not accumulate spec files or task files.

Durable direction belongs in PLAN.md.

Reusable learning belongs in skills/*.md and SkillsGraph.

Current execution requirements belong in the active CoderPacket prompt.

## CoderReport

Every coding job returns a structured CoderReport.

A CoderReport should include:

```txt
verdict
task-by-task result
completed requirements
incomplete requirements
changed requirements
files changed
proof commands
proof results
blockers
assumptions
chosen approach
rejected alternatives
next_needed
skill candidates
skill updates
```

PlanFlow and Progress Ledger compare the CoderReport against the CoderPacket.

Hidden success and vague done claims are forbidden.

## General Agent Skill Loop

The code MVP proves the loop first.

The general agent loop is:

```txt
agent receives task
→ active task/context is assembled
→ SkillsGraph retrieves relevant skills
→ missing skill candidates are proposed if needed
→ agent acts with skills and tools
→ report/proof/result is produced
→ Progress Ledger records outcome
→ useful learning becomes skill update
→ SkillsGraph improves
```

This is how LiquidAIty gets control over agents.

Agents become more accurate and continuous because they stop relying only on raw model behavior.

They work through task objects, graph context, tools, ledgers, reports, and skills.

## Trading And Other Agents Later

After the code MVP works, the same control architecture can support useful trade agents and other serious agents.

A trading agent needs the same control loop:

```txt
task/context object
→ connected active context
→ relevant skills
→ relevant data/tools
→ plan
→ proof/checks
→ execution approval
→ result ledger
→ memory update
```

The code MVP proves the agent-control pattern first.

## Documentation Law

Allowed durable docs:

```txt
AGENTS.md
PLAN.md
skills/*.md
repo-intake/*.md when explicitly needed
```

Allowed durable graph memory:

```txt
ThinkGraph = project reasoning/task memory
KnowGraph = external/project knowledge
SkillsGraph = reusable skill/procedure memory backed by Neo4j + skills/*.md
CodeGraph / CBM = codebase structure and edit-boundary memory
```

Forbidden doc sprawl:

```txt
CLAUDE.md
random architecture runbooks from one bad pass
specs/
tasks/
persistent CoderPacket files
persistent task prompt files
raw diff dump files
completed-task archive piles
```

PLAN.md is product law and current route.

AGENTS.md is execution law.

skills/*.md are reusable procedures and guardrails.

SkillsGraph is the retrieval and relationship layer for those skills.

## Current Implementation Target

Near-term target:

```txt
real Magentic-One route remains working
real Task Ledger artifact is captured
deterministic text sanitizers/rewrite logic are removed
PlanFlow renders from the real Task Ledger artifact
bottom banner is removed
right inspector owns details
disconnected nodes become inactive metadata
deleted nodes are removed unless reusable templates/presets
Run Task fails closed until approved task-node execution is wired
Go / Run review includes CodeGraph files and SkillsGraph skills
CoderPacket points coder to matched skills/*.md and code files
Progress Ledger attaches results/proof/blockers to task nodes
CoderReport can produce skill candidates/updates
approved skills update skills/*.md and SkillsGraph
prompt chains later live on agent cards
Research Bot / Skill Hunter later feeds candidate skills into SkillsGraph
```

## Next Narrow Work

1. Delete deterministic PlanFlow sanitizer/rewrite logic.
2. Delete tests that require sanitizer/agent-name stripping behavior.
3. Delete one-off doc sprawl.
4. Keep real Python rails + AutoGen Task Ledger capture intact.
5. Keep PlanFlow rendering from real taskLedgerArtifact.
6. Keep Run Task / approval gate fail-closed.
7. Confirm PlanFlow does not use finalResponseText.
8. Confirm PlanFlow does not use autogenMessages.
9. Confirm PlanFlow does not use chat text.
10. After cleanup, add Task Ledger output-shape instruction to the Mag One agent card / prompt-chain path.
11. Finish PlanFlow step-node rendering.
12. Ensure each step node is clickable and editable in the inspector.
13. Wire Go / Run review over connected task nodes.
14. Wire CoderPacket to include CodeGraph / CBM files and SkillsGraph skills.
15. Attach Progress Ledger results to task nodes.
16. Add skill candidate/update flow from CoderReport.
17. Re-ingest approved skills/*.md into SkillsGraph.

## Final Rule

LiquidAIty should show real work objects, not fake status theater.

When a model or coder is tempted to create a dashboard, status card, fallback, mock answer, deterministic plan, sanitizer, regex cleanup layer, or repeated metadata banner, stop.

The product object is the task node.

The proof belongs on the task node.

The details belong in the inspector.

The context is controlled by node connection state.

The chat steers.

The ledger records.

The graph remembers.

The skills snowball.
