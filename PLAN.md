# LiquidAIty PLAN.md

## Product Identity

LiquidAIty is an agent workbench for serious projects.

It is not a chat app.
It is not a dashboard generator.
It is not a fake workflow/status-card system.
It is not a pile of markdown specs and task files.

LiquidAIty turns user intent into durable, editable task objects on a canvas, then uses agents, graph memory, skills, tools, reports, and proof to move those tasks forward.

The core loop is:

```txt
user chat
→ Magentic-One / AutoGen
→ Task Ledger
→ persistent editable PlanFlow task nodes
→ Go / Run review
→ execution packet
→ Progress Ledger results
→ SkillsGraph update
→ memory, next tasks, subtasks
```

The product object is the task node.

The proof belongs on the task node.

The details belong in the inspector.

The context is controlled by node connection state.

The chat steers.

The ledger records.

The graph remembers.

The skills snowball.

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

The first product is not “all agents.”

The first product is the control loop that makes agents accurate, continuous, and improvable.

## First Launch Wedge

The first wedge is the agentic engineering / coding workbench.

The first useful loop is:

```txt
user describes work
→ Magentic-One reads active project context
→ SkillsGraph retrieves relevant skills
→ CodeGraph / CBM retrieves relevant files
→ Task Ledger condenses the work into task objects
→ PlanFlow shows editable step/task nodes
→ user reviews/edits/selects/connects/approves
→ Go / Run review builds bounded execution packet
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
```

Allowed:

```txt
real AutoGen / Magentic-One execution
real Task Ledger artifacts
real Progress Ledger artifacts
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

## PlanFlow

PlanFlow is the durable task-object canvas.

PlanFlow is not a Task Ledger metadata display.
PlanFlow is not a document map.
PlanFlow is not a spec library.
PlanFlow is not a skill library.
PlanFlow is not a road-sign/status-card dashboard.

The Task Ledger is the source artifact.

PlanFlow is the editable object surface created from that artifact.

A workbench chat turn should produce at least one durable task/event object.

In planning mode, each meaningful plan step becomes a persistent PlanFlow node.

Example:

```txt
Step 1 — Audit signal sources
Step 2 — Check data path
Step 3 — Review UI wiring
Step 4 — Write repair SPEC
Step 5 — Verify proof
```

A PlanFlow node should be small on the canvas.

Canvas node shows:

```txt
step number
short title
optional one short detail line
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

## Task Ledger

The Task Ledger condenses active user intent and active context into task objects.

The Task Ledger should answer:

```txt
what is the task?
what context matters?
what steps exist?
what depends on what?
what tools are needed?
what skills are relevant?
what should be done next?
what needs approval?
```

The Task Ledger should create or update task objects.

It should not become a giant visible metadata card.

Forbidden PlanFlow display:

```txt
Task Ledger captured
source: magentic_one
facts response: present
plan response: present
full ledger: hidden
model-call proof: missing
raw internal text: hidden
```

That kind of information is not the product UI.

## Task Ledger Includes Tool Planning

There is not a separate Tool Planning Ledger.

Tool planning is part of the Task Ledger.

A Task Ledger may contain:

```txt
task objects
step objects
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
which tools are needed?
why are those tools needed?
what should each tool do?
what context should each tool receive?
what output should each tool return?
what needs user approval before running?
```

Tool planning must not become a fake deterministic router.

It is a planning object inside the Task Ledger, created from active context and model reasoning.

A tool is selected because the task needs it, not because a keyword matched.

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

This is a key part of the MVP code stack.

For now, the first target is this repo and this coding workflow.

Later, the same pattern generalizes to other project types.

## Agents Need Skills

Agents should not work from raw prompts alone.

Every serious agent should have access to relevant skills.

A skill is a reusable working pattern, guardrail, proof method, tool-use method, or known trap that helps an agent perform a task without reinventing the process.

For the MVP, the main target is coding.

Later, the same pattern applies to trading agents, research agents, buyer agents, video agents, and other project agents.

## Skill Lookup Before Work

Before an agent or coder acts, the system should look at the active task context.

Active task context may include:

```txt
connected PlanFlow task nodes
selected task node
Task Ledger steps
planned tools
CodeGraph / CBM file pointers
ThinkGraph memory
KnowGraph context
user constraints
```

Then it should ask SkillsGraph:

```txt
what skills apply to this task?
what skills apply to these files?
what skills apply to this agent role?
what skills apply to these tools?
what known traps should be avoided?
what proof commands should be used?
what failed approaches should not be repeated?
```

The result is a small set of relevant skill pointers, not a dump of the whole skills database.

## Skill Proposal Before Writing

If no strong internal skill exists, the system may propose skills before the coder writes code.

The proposed skills may come from:

```txt
existing SkillsGraph
general skills database
Research Bot / Skill Hunter
public repo patterns
AutoGen / Magentic-One examples
past CoderReports
past failures
known proof patterns
```

A proposed skill is not automatically repo law.

It is a candidate working pattern for the agent or coder to test on the current task.

The CoderPacket or agent execution packet should say:

```txt
matched internal skills
candidate skills to consider
why each skill may apply
which skills are proven
which skills are only inspiration
what proof is required
what traps to avoid
```

## Skill Testing And Promotion

A candidate skill becomes useful only through use and proof.

The loop is:

```txt
task nodes selected
→ SkillsGraph lookup
→ candidate skill proposed if needed
→ coder/agent tests it during bounded work
→ CoderReport or agent report records result
→ Progress Ledger attaches result/proof/blocker
→ successful reusable learning becomes a skill update
→ approved skill is saved to skills/*.md
→ skill is indexed into SkillsGraph
```

If the candidate fails, that failure is useful too.

Failed skills or failed approaches can remain in SkillsGraph as rejection/supersession memory so the system does not repeat them.

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

SkillsGraph edges may include:

```txt
APPLIES_TO_FILE
APPLIES_TO_SYSTEM
AVOIDS_TRAP
REQUIRES_PROOF
SUPERSEDES
RELATED_TO
CREATED_FROM_REPORT
VALIDATED_BY
```

SkillsGraph should help answer:

```txt
have we solved this before?
what skill applies to this file/system/task?
what trap should the coder avoid?
what proof command proved this before?
what old approach was rejected?
what rule keeps getting broken?
what candidate skill should be tested?
what skill should be updated from this report?
```

SkillsGraph is not PlanFlow.

PlanFlow nodes are project task objects.

SkillsGraph nodes are reusable work knowledge.

SkillsGraph can be used to build the active Context Packet, but it should only contribute relevant skills.

It must not dump every skill into every prompt.

## SkillGraph Snowball Rule

Before code writing, the system should query SkillsGraph.

The Go / Run review should retrieve:

```txt
relevant skills/*.md
SkillsGraph matches
known guardrails
known failed attempts
known proof commands
related CodeGraph / CBM file evidence
```

If no matching skill exists, the run should not silently proceed as if nothing was learned.

The current skill handoff logic already encodes the rule:

```txt
No matching skill found; successful completion must create a new skill.
```

Each useful run should either:

```txt
use an existing skill
update an existing skill
create a new skill candidate
record why no reusable skill was produced
```

## Snowball Skills

A major MVP advantage is that every coding run can improve the stack.

The system should not only use existing skills.

It should also discover, create, test, promote, reject, supersede, and index skills.

The code MVP should support this loop:

```txt
new task
→ SkillsGraph lookup
→ if skill exists, attach relevant skill pointer to Context Packet
→ if no skill exists, ask Research Bot / Skill Hunter to find candidate skills
→ candidate skill is summarized and mapped to repo/task area
→ CoderPacket tells coder which skills and candidate skills to read
→ coder uses bounded task + CodeGraph files + SkillsGraph skills
→ CoderReport proves success/failure
→ successful reusable learning becomes skill candidate
→ user approves or edits
→ skill saved to skills/*.md
→ skill indexed into SkillsGraph
→ next run has better skill memory
```

This is the snowball effect.

The goal is not to have a few hand-written skills.

The goal is to grow a working internal skill library that can be searched, related, tested, promoted, rejected, superseded, and reused.

There may eventually be thousands or hundreds of thousands of possible skills.

The system should not stuff them all into context.

SkillsGraph should retrieve only relevant skills for the current task.

## Research Bot / Skill Hunter

LiquidAIty should have a dedicated Research Bot / Skill Hunter agent.

Its job is to look outside the current repo for reusable skill patterns and useful agent-workflow ideas.

It may search for:

```txt
public coding-agent patterns
prompt-chain patterns
AutoGen / Magentic-One examples
repo-analysis workflows
testing/proof patterns
UI/workbench patterns
skills files from other systems
engineering playbooks
trading-agent patterns
research-agent patterns
buyer-agent patterns
video-agent patterns
```

The Research Bot feeds SkillsGraph.

The chat agent can then use SkillsGraph as inspiration and retrieval memory.

The Research Bot does not blindly modify active project behavior.

It proposes skill candidates.

SkillsGraph qualifies them.

The user or proof loop promotes them.

## SkillsGraph Prequalification And Promotion

Research Bot / Skill Hunter is allowed to discover outside skills and patterns.

The solution is graph-mediated qualification.

SkillsGraph tracks where a skill came from, what it applies to, how it was tested, whether it is proven, and whether it has been superseded or rejected.

Candidate skills can come from:

```txt
Research Bot / Skill Hunter
public repos
coding-agent examples
AutoGen / Magentic-One examples
GitHub patterns
repo workflow research
successful internal CoderReports
repeated internal failure patterns
```

SkillsGraph can classify skill state:

```txt
UNTRUSTED_CANDIDATE_SKILL
PREQUALIFIED_CANDIDATE_SKILL
PROVEN_INTERNAL_SKILL
PROMOTED_SKILL
SUPERSEDED_SKILL
REJECTED_SKILL
```

Prequalification can use:

```txt
source quality
GitHub stars/forks/activity if relevant
tests/proof commands
similarity to current repo area
past successful uses
past failure evidence
manual approval
```

A candidate skill should not become active repo law merely because it was scraped.

It becomes active when it is adapted to the repo, tested, and promoted.

## Skills

Skills are durable reusable procedures and guardrails.

Skills live as readable files in:

```txt
skills/*.md
```

The SkillsGraph indexes and relates those files so future agents can retrieve the right skill instead of reinventing the same solution.

A skill should contain:

```txt
name
when to use it
when not to use it
steps
proof commands
known traps
related files/systems
success evidence
failure evidence if relevant
```

Skills are not raw task history.
Skills are not PlanFlow task nodes.
Skills are not spec sprawl.
Skills are not one-off CoderReports.

A new skill should usually come from:

```txt
successful CoderReport
repeated failure pattern
confirmed repo trap
validated proof command
stable workflow rule
candidate skill tested successfully
```

A skill should update only when the learning is reusable.

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

SkillsGraph is different.

SkillsGraph is reusable system memory.

It may retrieve relevant skills by task/file/system match, but it must not blindly stuff unrelated skills into context.

Missing or stale code evidence is a blocker, not permission to guess.

## Go / Run Review

Before Go / Run / Coder execution, chat should review the active task context.

The review should include:

```txt
connected PlanFlow nodes
selected task node
Task Ledger tool-use plan
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

The CoderPacket should explicitly tell the coder:

```txt
which task node is active
which connected nodes matter
which tools were planned
which CodeGraph / CBM files were found
which SkillsGraph skills apply
which skills/*.md files to read
which files are in scope
which files are out of scope
which proof commands are required
what not to do
```

## Magentic-One / AutoGen Runtime

The main AI route is real AutoGen / Magentic-One.

Allowed live route:

```txt
deck_builder/run
→ card_magentic
→ Python AutoGen sidecar
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

Python sidecar responsibility:

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

## Run Task

Run Task must execute approved task nodes.

Run Task should not use:

```txt
autogenMessages as hidden task source
chat text as task source
finalResponseText as task source
fake task objects
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

Later verticals can reuse:

```txt
Task Ledger
PlanFlow task nodes
Progress Ledger
SkillsGraph
ThinkGraph
KnowGraph
CodeGraph / other domain graphs
CoderPacket-like execution packets
report/proof loops
```

This is how LiquidAIty becomes a continuous agent workbench instead of a one-off chat wrapper.

## Documentation Law

Allowed durable docs:

```txt
AGENTS.md
PLAN.md
skills/*.md
repo-intake/*.md when needed
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
specs/
tasks/
random one-off plan files
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
PlanFlow converts Task Ledger plan steps into editable task nodes
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

1. Finish PlanFlow step-node rendering.
2. Remove any remaining Task Ledger metadata-card UI.
3. Remove bottom banner/focus/payload display.
4. Ensure each step node is clickable and editable in the inspector.
5. Stop Run Task from using autogenMessages.
6. Wire Go / Run review over connected task nodes.
7. Wire CoderPacket to include CodeGraph / CBM files and SkillsGraph skills.
8. Wire Run Task to approved connected/selected task nodes.
9. Attach Progress Ledger results to task nodes.
10. Add skill candidate/update flow from CoderReport.
11. Re-ingest approved skills/*.md into SkillsGraph.
12. Add prompt-chain storage/display inside agent cards.
13. Add Research Bot / Skill Hunter for external candidate skills.

## Final Rule

LiquidAIty should show real work objects, not fake status theater.

When a model or coder is tempted to create a dashboard, status card, fallback, mock answer, deterministic plan, or repeated metadata banner, stop.

The product object is the task node.

The proof belongs on the task node.

The details belong in the inspector.

The context is controlled by node connection state.

The chat steers.

The ledger records.

The graph remembers.

The skills snowball.
