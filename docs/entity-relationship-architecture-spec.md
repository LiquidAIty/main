# Entity-Relationship Architecture Spec

## What This System Is Becoming

This system is becoming a graph-native AI operating system where the same semantic language flows through the full stack.

Not just the database.
Not just the UI.
Not just prompts.

The shared glue is an entity-relationship model used across:

- system prompts
- agent prompts
- Plan Wiki
- ThinkGraph
- KnowGraph
- retrieval
- RAG (Retrieval-Augmented Generation)
- skills graph
- documentation graph
- query construction
- tool contracts
- UI labels and cards
- code variable names and types
- future graph explorer chat

The goal is not to make everything look like a database schema.
The goal is to make the system think, store, retrieve, explain, and act using the same conceptual structure.

That allows the graph to become naturally rich instead of manually forced.

---

## Core Product Direction

The product is not a chatbot with some side panels.
It is also not a generic graph viewer.

It is a visible orchestration and reasoning environment where:

- the canvas is the visible execution truth
- Magentic-One is the top-level orchestrator
- agents are callable through visible connections
- Plan Wiki is the readable operational surface
- ThinkGraph holds provisional semantic structure
- KnowGraph holds grounded semantic structure
- retrieval pulls scoped knowledge slices for agents
- future Graph Explore mode becomes the deep navigation surface

The user should be able to read the system, steer the system, and trust the system because the structure is visible and consistent.

---

## Architectural Pillars

### 1. Shared Entity-Relationship Language Everywhere

The most important architectural principle is semantic consistency.

The same conceptual primitives should appear across prompts, graphs, UI, types, and retrieval.

Examples:

- Entity
- Relationship
- Evidence
- Document
- Chunk
- Claim
- Event
- Question
- Gap
- Task
- Constraint
- Summary
- Action

This does not mean every component has to store every primitive explicitly.
It means each layer should be compatible with the same semantic shape.

### 2. Visible Orchestration Truth

The visible React Flow canvas is the real orchestration surface.

If an agent is callable, that should be visible.
If a route exists, that should be visible.
If a task can be delegated, the user should be able to inspect the path.

This means the canvas is not decorative.
It is not a fake diagram.
It is the operational truth for agent routing.

### 3. Plan Wiki Is Operational, Not Decorative

Plan Wiki is not just a notes area.
It is the readable operational surface that sits between semantic structure and agent action.

Plan Wiki has two jobs:

- human-readable explanation and planning
- machine-shaping guidance for Magentic and downstream agents

The plan and the prompt are tied.

### 4. Dual Graph Memory Model

The system intentionally separates provisional thought from grounded knowledge.

- ThinkGraph in AGE (Apache AGE)
- KnowGraph in Neo4j

Both speak the same broad semantic language, but they serve different purposes.

### 5. Scoped Knowledge Delivery for Agents

Agents should not receive random giant context dumps.
They should receive scoped slices of knowledge relevant to the current task.

Those slices may come from:

- skills graph
- documentation RAG graph
- project graph
- evidence graph
- selected entity clusters
- Plan Wiki sections
- current task context

### 6. Future Graph Explore Mode

Graph View should not be treated as just a side panel forever.
It should mature into a deeper Explore Mode.

That future mode may include:

- richer entity and relationship navigation
- evidence inspection
- graph-linked narrative cards
- path exploration
- cluster summaries
- graph AI explorer chat

---

## The Major System Surfaces

### A. React Flow Canvas

The React Flow canvas is the visible orchestration surface.

It should show:

- Magentic-One node
- callable agent nodes
- graph flow nodes where applicable
- visible edges defining legal routes
- future graph and blackboard related nodes where useful

The user should be able to tell:

- what can call what
- what is top-level
- what is nested or graph-scoped
- where the current workflow can legally go

#### Canvas Design Principles

- visible edges define legal action space
- hidden orchestration should be minimized or eliminated
- routes should have explicit meaning
- the graph lives in the connections, not in hidden metadata
- nodes should be inspectable and grounded in runtime behavior

#### Important Edge Semantics

Not all edges should mean the same thing.
Even when the canvas is the visible truth, edge meaning must stay clear.

Likely edge categories:

- callable_route
- required_flow
- optional_flow
- graph_scope
- return_path
- reconcile_input
- compatibility_legacy if needed during migration

The exact naming can change, but the idea matters: visible does not mean ambiguous.

---

### B. Magentic-One

Magentic-One is the top-level orchestrator.

Its role is not to secretly do everything.
Its role is to:

- understand the current task
- read the current operational context
- choose whether to answer directly or call a connected agent
- select the best next move among visible callable options
- keep the task progressing
- revise the next move when progress stalls

#### Magentic Should Be Constrained by Visible Structure

Magentic should not invent routes, agents, or hidden capabilities.

Its callable world should be defined by:

- visible outgoing callable connections
- current task state
- current Plan Wiki guidance
- any completed results already returned in the run

#### Magentic Input Model

Magentic should reason over:

- current user goal
- current Plan Wiki state
- visible callable nodes
- recent results from those nodes
- constraints and active context
- any relevant semantic slices from ThinkGraph or KnowGraph if intentionally provided

#### Magentic Output Model

Magentic should produce either:

- direct response
- or next-agent selection with clear reasoning

It should also be able to update or rely on Plan Wiki structure for continuity.

---

### C. Agent Nodes

Agents are visible callable cards on the canvas.

They are not just named wrappers.
They are execution units with:

- role
- prompt
- runtime type
- tool access
- knowledge slice policy
- optionally memory policy
- visible connectivity

#### Agent Call Model

A useful mental model is:

**Agent call = role + prompt + callable node + knowledge slice + tool access + task contract**

That is much better than treating an agent as only a model name.

#### Agents Should Be Context-Scoped

An agent should receive only the knowledge and tools needed for its current task.
This avoids soup, noise, and poor performance.

Possible context categories:

- task-local context
- graph-derived semantic slice
- evidence bundle
- documentation slice
- skill bundle
- Plan Wiki excerpt
- current entity cluster

#### Agent Output Should Remain Graph-Friendly

Where practical, agent outputs should be compatible with downstream semantic extraction.
They do not always need to emit formal graph JSON.
But they should preserve graph-shaped meaning:

- who or what is involved
- how things relate
- what supports the claim
- what remains uncertain
- what next action is suggested

---

### D. Plan Wiki

Plan Wiki is one of the most important surfaces in the system.

It is not merely a note area and not merely a markdown page.
It is the readable operational interpretation of the system's current semantic state.

#### Plan Wiki Jobs

##### Human Job

It should explain:

- current goal
- what matters now
- what entities and relationships are active
- what the system believes
- what is uncertain
- what evidence exists or is missing
- what should happen next

##### Machine Job

It should help shape:

- Magentic next-agent decisions
- prompt context for downstream agents
- prioritization of gaps
- relevance of entities and relationships
- task progression

#### Plan And Prompt Are Tied

This is a critical design principle.
The Plan Wiki is not dead text.
It is part of the control surface.

The same evolving operational plan that the user reads should also influence the prompt framing for the next agent action.

That does not mean the full wiki must always be copied raw into prompts.
It means the wiki is an authoritative intermediate semantic surface.

#### Good Plan Wiki Section Types

Potential section types:

- Goal
- Active entities
- Key relationships
- Evidence state
- Open questions
- Gaps to research
- Constraints
- Recommended next move
- Recent findings
- Contradictions
- Notes for graph exploration

#### Plan Wiki Writing Style

Because Plan Wiki affects prompting, it should be:

- structured
- readable
- operational
- concise enough to be useful
- not fluffy
- not decorative
- not overly verbose in control-critical sections

It should be readable for humans and stable enough for machine guidance.

---

### E. ThinkGraph In AGE (Apache AGE)

ThinkGraph is the provisional semantic graph.

It captures evolving, possibly incomplete, possibly subjective structure generated during active reasoning and planning.

#### ThinkGraph Responsibilities

- tentative entity extraction
- candidate relationships
- emerging clusters
- working hypotheses
- open gaps and questions
- turn-to-turn working continuity
- planning structure
- semantic shaping before grounding

#### ThinkGraph Is Not The Fact Graph

That distinction matters.
ThinkGraph should be allowed to contain:

- provisional links
- candidate claims
- incomplete structure
- things worth researching
- things worth comparing

This is the graph of thought, shaping, and possibility.

#### Why AGE Fits Here Conceptually

AGE is a suitable home for provisional graph-shaped structure inside a broader Postgres-centered workflow.
The main point is not the brand of graph engine.
The main point is the functional separation:

- provisional graph here
- grounded graph elsewhere

---

### F. KnowGraph In Neo4j

KnowGraph is the grounded semantic graph.

This is where the system stores more durable, evidence-backed structure intended for retrieval, traversal, and support of grounded reasoning.

#### KnowGraph Responsibilities

- grounded entities
- validated or relatively stable relationships
- document and chunk linkage
- evidence-backed claims
- traversal-oriented retrieval
- support for explainable synthesis
- durable semantic memory

#### KnowGraph Is Not The Scratchpad

It should not be polluted by every provisional thought.
It should remain more stable and more evidence-linked.

This is the graph of grounded structure and durable retrieval.

#### Why Neo4j Fits Here Conceptually

Neo4j is a good home for:

- graph traversal
- evidence-linked knowledge
- durable entity networks
- graph-based retrieval and exploration

Again, the more important thing is the role separation, not the logo.

#### The Promotion Boundary Between ThinkGraph And KnowGraph

This is a critical architectural rule.

**Nothing becomes KnowGraph truth just because the model said it.**

The promotion boundary works as follows:

1. **ThinkGraph Extraction (AGE)**
   - Conversation turns are processed into provisional semantic structure
   - Entities, relationships, hypotheses, questions, gaps, and next actions are extracted
   - This structure is marked as provisional and stored in ThinkGraph
   - Uncertainty is preserved
   - No source backing is required at this stage

2. **Research Stage**
   - Gaps and questions from ThinkGraph trigger research
   - Research agent investigates using web search, PDF ingest, or other sources
   - Findings are returned with source references

3. **KnowGraph Normalization (Neo4j)**
   - Research findings are normalized into grounded entities and relationships
   - Only structure backed by sources is promoted to KnowGraph
   - Provenance and evidence links are preserved
   - Speculation is removed or marked as provisional
   - If evidence is weak, the structure stays in ThinkGraph or is excluded

4. **KnowGraph Persistence (Neo4j)**
   - Final grounded structure is written to Neo4j
   - All writes include source references and evidence links
   - This becomes the durable research memory

**Why This Matters**

- ThinkGraph can be messy, incomplete, and speculative. That is its job.
- KnowGraph must remain clean, grounded, and traceable. That is its job.
- The promotion boundary prevents truth leakage from provisional thought into durable knowledge.
- This separation allows the system to reason freely in ThinkGraph while keeping KnowGraph trustworthy.

**Implementation Notes**

- Default builder cards enforce this boundary through prompt semantics
- Backend routes mark ThinkGraph (AGE) vs KnowGraph (Neo4j) ownership clearly
- Tests verify that the default setup reflects the intended split
- The canvas flow shows: ThinkGraph → Research → KnowGraph Normalization → KnowGraph Persist

---

### G. Skills Graph And Documentation RAG Graph

The system should support specialized knowledge sources that can be sliced and delivered to agents.

#### Skills Graph

This is knowledge about how to do things.

Examples:

- playbooks
- procedures
- reusable methods
- coding patterns
- task recipes
- research methods
- operational skills

This is procedural or capability-oriented knowledge.

#### Documentation RAG Graph

This is system or domain reference knowledge.

Examples:

- internal docs
- API docs
- architecture notes
- codebase knowledge
- manuals
- component guidance

This is descriptive or reference-oriented knowledge.

#### Why Graphs Help Here

Graphs let the system deliver relevant slices instead of giant raw dumps.
A good agent call should be able to say:

- give me the skill slice relevant to this task
- give me the docs slice relevant to this subsystem
- give me the evidence slice relevant to this entity cluster

That makes retrieval targeted and auditable.

---

### H. Future Graph Explore Mode

Graph View should grow into a deeper Explore Mode.

It is not just a place to see dots and lines.
It should become a place where the user can:

- inspect entities
- inspect relationships
- inspect evidence
- follow paths
- explore clusters
- compare interpretations
- open linked narrative cards
- use AI explorer chat scoped to graph context

#### Explore Mode Goals

- make graph structure navigable
- make evidence understandable
- let the user drill down into meaning
- allow text and graph to index each other

#### Linked Narrative And Graph Vision

Long term, text and graph should be linked views of the same underlying semantic material.

Examples:

- click a sentence, highlight related nodes and edges
- click a node, jump to the relevant plan or narrative block
- click a relationship, open evidence and summary
- select a cluster, generate a narrative card
- select a path, ask graph explorer chat to explain it

That is the future reading and exploration model.

---

## Pretext In This System

Pretext is not the graph engine and not the reasoning engine.
It is a text layout engine.

### What Pretext Is Good For Here

- measured text blocks
- stable wrapping
- section cards
- linked narrative cards
- graph-adjacent text surfaces
- future graph-linked explorer cards
- smoother text geometry for animated or spatial UIs

### Near-Term Fit

The strongest near-term fit is the Plan Wiki rendering path.
That is the real surface that needs improvement now.

### Later Fit

Later, Pretext may also be useful for:

- graph-linked narrative cards
- graph explorer explanation blocks
- AI explorer chat context cards
- node-adjacent summaries

### Important Limit

Pretext is not a substitute for:

- graph layout
- retrieval
- prompting
- semantic extraction
- evidence grounding

It improves the presentation layer, not the semantic architecture itself.

### Practical Package Note

If we use Pretext in the web client, the relevant npm package is `@chenglou/pretext`.
The unrelated `pretext` package on npm is a much older markup tool and is not the one we want here.

---

## The Shared Semantic Language

The architecture becomes much stronger if prompts, code, retrieval, and UI reuse a small stable semantic vocabulary.

### Recommended Core Objects

- Entity
- Relationship
- Evidence
- Document
- Chunk
- Claim
- Event
- Question
- Gap
- Task
- Constraint
- Summary
- Action
- Cluster
- Path

### Recommended Common Fields

- id
- type
- label
- summary
- source
- confidence
- timestamp
- linkedEntityIds
- linkedRelationshipIds
- evidenceChunkIds
- documentIds
- scope
- status

### Recommended Common Relationship Verbs

These should stay practical, not bloated.

- relates_to
- supports
- contradicts
- depends_on
- influences
- belongs_to
- derived_from
- mentions
- caused_by
- part_of
- targets
- answers
- blocks
- enables
- describes

The exact final vocabulary may differ, but a small stable set is important.

---

## Plan Wiki And Prompt Coupling

Because Plan Wiki helps shape Magentic's next actions, the relationship between plan and prompt should be explicit.

### Good Principle

Plan Wiki is the human-readable operational surface that translates evolving semantic structure into prompt-shaping guidance.

That means:

- the user can read the plan
- the system can act from the plan
- plan updates matter operationally
- graph extraction can feed plan structure
- grounded research can refine plan structure

### Avoid A Bad Pattern

Do not blindly dump the entire Plan Wiki into every prompt.
That becomes noisy and brittle.

Instead, the system should derive relevant prompt context from the current Plan Wiki state.
For example:

- active goal section
- constraints section
- current gap section
- recommended next action
- linked entities or evidence

This keeps the plan operational without making prompting messy.

---

## Knowledge Slices For Agent Calls

This is one of the most important practical mechanisms.

A good agent call should include a scoped knowledge package.

### Possible Package Categories

#### Operational Context

- current task
- current goal
- constraints
- required output

#### Semantic Context

- relevant entities
- relevant relationships
- linked claims
- open gaps

#### Evidence Context

- retrieved chunks
- supporting documents
- citations
- evidence summaries

#### Capability Context

- skill bundle
- documentation slice
- tool guidance
- subsystem notes

#### Plan Context

- relevant Plan Wiki sections
- recommended next step
- relevant summary block

### Important Traceability Rule

Each call should ideally know:

- which slice sources were used
- why they were selected
- which entities were included
- which chunks or docs were included
- what prompt variant was used

That creates auditable execution.

---

## Example End-To-End Execution Loop

This is the high-level cycle the system is moving toward.

### 1. User Turn Arrives

The user asks a question, makes a request, or changes the goal.

### 2. ThinkGraph Shaping

The system extracts provisional structure:

- entities
- candidate relationships
- gaps
- hypotheses
- candidate tasks

### 3. Plan Wiki Synthesis

The system updates readable operational structure:

- goal
- active entities
- key relationships
- current evidence state
- open questions
- next recommended move

### 4. Magentic Reads Current Context

Magentic receives:

- user goal
- current plan state
- visible callable routes
- recent results
- optional semantic context

### 5. Magentic Decides

It either:

- answers directly
- or selects the next connected agent

### 6. Knowledge Slices Are Assembled

The chosen agent receives the right scoped context:

- docs slice
- skill slice
- entity cluster
- evidence bundle
- plan excerpt

### 7. Agent Executes

The agent produces output in a form compatible with downstream semantic interpretation.

### 8. Grounding Pipeline Runs

Validated findings are normalized and stored in KnowGraph.

### 9. Graph Explore And Plan Wiki Benefit

The resulting structure becomes available for:

- improved Plan Wiki explanation
- richer retrieval
- future Graph Explore navigation
- eventual graph-linked AI explorer chat

---

## What "Graph Becomes Naturally Rich" Means

The graph becomes rich not because someone manually draws more lines.

It becomes rich because every layer emits graph-compatible meaning.

### Prompts Emit

- entities
- relationships
- evidence
- gaps

### Retrieval Emits

- linked chunks
- relevant clusters
- supporting documents

### Plan Wiki Emits

- active semantic structure in readable form

### Agent Outputs Preserve

- who or what matters
- how pieces relate
- what next action is needed

### Grounding Stores

- durable semantic structure

That is how richness grows naturally.

---

## Why This Is Better Than A Normal Chatbot Product

A normal chatbot often has these weaknesses:

- opaque orchestration
- vague memory
- random retrieval
- decorative graphs
- prompts detached from UI
- no clear task routing

This system aims to be better by making:

- orchestration visible
- semantic structure consistent
- planning operational
- graphs meaningful
- retrieval scoped
- grounded knowledge separate from provisional thought

That is a much more serious architecture.

---

## What Likely Already Exists Vs What Is Still Emerging

This section is intentionally conceptual and should later be replaced by a direct repo audit.

### Likely Existing Or Partially Existing Now

- React Flow visible canvas
- Magentic-related orchestration direction
- Plan Wiki surface in some form
- card/agent model
- ThinkGraph concept
- KnowGraph concept
- visible routing emphasis
- prompt template machinery
- deck/card runtime concepts

### Likely Partial Or Weak Now

- reliable Knowledge Graph user experience
- robust Plan Wiki rendering quality
- clean plan-to-prompt coupling
- scoped knowledge slice delivery for every agent type
- graph-linked narrative surfaces
- future Graph Explore mode maturity
- graph AI explorer chat
- consistent semantic typing everywhere

### Likely Not Fully Complete Yet

- full semantic unification from prompts to code variable naming to retrieval slices
- fully mature dual-graph operational loop
- complete graph/text mutual indexing
- polished Pretext-backed plan or narrative surfaces

Codex should verify these assumptions against the real codebase rather than trust them blindly.

---

## What Codex Should Evaluate Against This Spec

Codex should use this document as a target-state architecture reference and answer:

### 1. Visible Orchestration Truth

- How close is the current canvas to being the real execution truth?
- Where is routing still hidden or implicit?
- Are callable routes semantically clear?

### 2. Magentic Coupling

- How directly does Magentic use visible connectivity now?
- How much of the next-action logic is actually aligned with canvas routes?

### 3. Plan Wiki Operational Role

- Is Plan Wiki currently only display, or already operational?
- How closely is it tied to prompt shaping?
- What is missing to make that coupling clean and safe?

### 4. ThinkGraph / KnowGraph Split

- Is the provisional vs grounded split implemented cleanly?
- Where do boundaries blur?
- What data is being written too early as fact?

### 5. Knowledge Slice Routing

- Can agents already receive scoped knowledge slices?
- If so, from what sources?
- If not, what minimal architecture supports this next?

### 6. Semantic Consistency

- Do variable names, prompt templates, UI surfaces, and retrieval payloads already reflect entity-relationship concepts?
- Where is semantic drift happening?

### 7. Future Graph Explore Compatibility

- Do current Plan Wiki and graph surfaces leave room for future linked narrative exploration?
- What current choices would make that harder later?

### 8. Pretext Fit

- Is Pretext truly a good fit for Plan Wiki now?
- Is there a simpler first move?
- Could the chosen rendering path later support graph-linked narrative cards and explorer chat surfaces?

---

## Proposed Implementation Priorities

This is the rough recommended order, not a fixed law.

### Priority 1: Stabilize The Real Current Surface

The near-term working surface is Plan Wiki, not a fully mature graph view.
So the first real UI improvement should likely be:

- improve Plan Wiki rendering
- keep it operational
- preserve current app stability
- avoid broad refactors

### Priority 2: Strengthen Plan-To-Prompt Coupling

Make the relation between Plan Wiki and Magentic guidance clearer and more explicit.

### Priority 3: Formalize Scoped Knowledge Slices

Make agent calls context-scoped and traceable.

### Priority 4: Tighten ThinkGraph / KnowGraph Boundaries

Make provisional vs grounded separation cleaner where needed.

### Priority 5: Improve Graph UX Toward Explore Mode

Once the graph is more reliable, evolve it toward deeper exploration and text linkage.

### Priority 6: Add Graph Explorer Chat

Only after graph navigation and evidence linkage are strong enough.

---

## Risks To Avoid

### 1. Ontology Soup

Do not create an overcomplicated abstract schema that nobody can use.
Keep the semantic vocabulary practical.

### 2. Decorative Graph Syndrome

Do not build a graph that looks impressive but has no operational role.

### 3. Dead Plan Wiki Syndrome

Do not let Plan Wiki become pretty text that does not influence execution.

### 4. Context Soup For Agents

Do not dump every graph and every document into every agent call.
Use scoped slices.

### 5. Premature Future Overbuild

Do not block current progress by building the perfect future Graph Explore system too early.

### 6. Hidden Orchestration Drift

Do not allow runtime behavior to drift away from visible canvas truth.

---

## Strong Architecture Summary

This platform is evolving toward a graph-native AI operating system where a shared entity-relationship language is used across prompts, graphs, retrieval, UI, and code.

- React Flow is the visible orchestration truth.
- Magentic-One is the top-level orchestrator constrained by visible callable connections.
- Agents are callable nodes that receive scoped knowledge slices.
- Plan Wiki is the human-readable operational surface and also helps shape prompts for next-agent actions.
- ThinkGraph in AGE stores provisional semantic structure.
- KnowGraph in Neo4j stores grounded semantic structure.
- Future Graph Explore mode becomes the deeper entity/relationship/evidence navigation surface.
- Pretext may improve the readable narrative surfaces now and support richer graph-linked text surfaces later.

The key idea is not just "use graphs."
The key idea is to use entity-relationship semantics as the common language everywhere so the system becomes naturally graph-rich, operationally legible, and easier to evolve.

---

## Short Target-State Statement

Use shared entity-relationship semantics across prompts, Plan Wiki, agent routing, retrieval, and graph storage so that ThinkGraph (AGE) shapes provisional structure, Plan Wiki converts that structure into readable operational guidance, Magentic chooses next callable agents through visible React Flow connections, agents execute with scoped knowledge slices, and KnowGraph (Neo4j) stores grounded durable knowledge for future Graph Explore mode and graph-linked AI exploration.
