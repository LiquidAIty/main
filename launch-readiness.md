LiquidAIty MVP Readiness
Generated: April 11, 2026
Updated: April 13, 2026
Status: Internal dogfooding / operator-first phase
Target: Jeremiah as first real user, then cleanup, then external launch

> Historical planning note.
> This file is not the current Stage 0 contract and does not override `specs/003-trading-intelligence-stack/*` or `docs/README.md`.

Executive Summary
What phase are we actually in?
We are not in true public launch readiness yet.
We are in operator-first readiness.
The immediate goal is not “ship to many users.”
The immediate goal is to make LiquidAIty genuinely usable by you inside your real workflow:


building and evolving the project itself


loading and exploring the current code graph


building project-scoped knowledge around the code, dependencies, docs, and research used to create it


using MainChat / Magentic-One as the central orchestrator


using the UI to generate and route coding tasks/prompts to a User Proxy Agent through MCP (Model Context Protocol) to Goose or a similar coding agent


validating the 4-surface workspace in real use before cleanup and external launch


Actual product truth
LiquidAIty MVP has 4 distinct but connected surfaces:


Chat


Canvas


Plan


Knowledge


MainChat = Magentic-One.
MainChat / Magentic-One is the central orchestrator.
User input, plan, and graph context belong on the MainChat side.
Agents on the canvas are the agents available to that orchestrator. This aligns with the repo’s unified workspace model and visible orchestration/canvas runtime.
What this phase must prove
Before worrying about broad launch, the system must prove these things in visible UI:


Current project code graph visibly loads


Project-scoped knowledge graph visibly builds around that code and its sources


MainChat can use that context to reason and plan


Canvas agents are visibly available to MainChat


UI can prepare prompts/tasks for a User Proxy coding agent via MCP


Plan visibly populates after real runs


Knowledge is human-explorable and agent-readable


All of this works for the active project / ADMIN scope in real use


No success should be claimed unless the UI visibly proves it.

Current State Assessment
What is already true


Backend Neo4j code graph import works


Overlay import works


Project-scoped Knowledge had a real bug: knowledgeProjectId must use active project id


messages.routes.ts is dormant/unmounted and should not be used


agentbuilder.tsx is the giant coordinator


BuilderCanvas.tsx is the real canvas surface


These match the repo structure and mounted/unmounted route inventory. 
What is already working


Visible Magentic-One orchestration


Deck runtime execution


Plan Wiki operational surface


Canvas interaction improved/fixed


Legacy cleanup progress


These are real strengths, but they do not yet prove the operator-first workflow is complete.
What is still missing for real operator use


mini chat-side canvas behavior is not yet correctly constrained


full canvas responsibilities are still too easy to leak into mini/chat


knowledge is not yet clearly acting as a living research substrate in visible UI


plan population after real runs is not yet the trusted visible behavior


active project / ADMIN graph visibility is still an acceptance-critical test


UI-to-MCP coding-agent handoff is not yet the clearly proven workflow



Primary Goal of This Phase
Build LiquidAIty by using LiquidAIty on itself
The immediate objective is to make the system useful for its own development.
That means:


the project’s code graph is loaded and visible


the project’s knowledge graph grows around the codebase, dependencies, external references, implementation notes, research, and prior decisions


MainChat / Magentic-One can read that project context and produce plans


the Canvas exposes the available agents that MainChat can use


the UI can prepare a good task/prompt for a User Proxy Agent


that User Proxy Agent can be routed through MCP to Goose or a similar coding agent


outputs from those agents can feed back into Plan and Knowledge


the system becomes a real internal build environment before it becomes a public product



Phase Structure
Phase 1 — Internal Operator Readiness
Goal
Make the product truly usable by you as the first real user.
Must be visibly true
1. Chat / MainChat


MainChat is the central orchestrator


user input is handled here


plan context is visible here


graph context is available here


MainChat can decide when to use available agents


2. Mini chat-side canvas


still uses the same canvas language


shows MainChat / Magentic-One and relevant nearby agents


shows nearby available agents, not only currently connected ones


allows only quick connect/disconnect to MainChat


does not become a list manager


does not become a form surface


does not leak full canvas editing behavior


3. Full agents canvas


remains the only true editing surface


add-agent works here


full edge editing works here


prompt/tool/runtime editing works here


this is where full graph authoring lives


4. Knowledge


summary first


evidence reveal second


source links visible


full source open available


graph context visible


Plan ↔ Knowledge linking visible


readable by humans


usable by agents


5. Plan


may be blank before first real run


must visibly populate after a real run


must not be treated as logs


must reflect reasoning and execution intent


6. Project-scoped graph


imported code graph visibly loads for active project / ADMIN


knowledge graph is clearly scoped to that project


code graph + knowledge graph can be used together during work


7. MCP coding-agent bridge


UI can create a task/prompt for a User Proxy Agent


that task can be sent through MCP to Goose or a similar coding agent


the coding-agent result can come back into the project workflow


the result can update plan and/or knowledge surfaces



Phase 2 — System Cleanup After Real Use
Goal
Clean up only after the operator workflow is real.
This means:


remove UI drift


tighten surface responsibilities


reduce accidental control leakage


improve clarity in agentbuilder.tsx without unsafe big-bang refactors


harden project scoping


make the MCP handoff cleaner and more repeatable


improve Knowledge browse/explore quality


improve Plan ↔ Knowledge ↔ Canvas coherence


This phase exists to stabilize what worked in real use, not to theorize.

Phase 3 — External Launch Readiness
Goal
Prepare for users beyond yourself only after operator-first proof exists.
This is where the previous launch-hardening items become primary:


project ownership isolation


route protection


rate limiting


HTTPS-safe deploy path


observability


smoke coverage


production docs


onboarding polish


Those remain valid launch requirements, but they are not the product-defining work of the current phase. The previous launch-readiness document is still useful here, just in the wrong order.

What Now Counts as “Blocking”
A. Blocking internal operator use
These are the top blockers now:


Current project graph not visibly loading for active project / ADMIN


Mini chat-side canvas not behaving as MainChat neighborhood view


Knowledge not yet behaving as a living research substrate


Plan not clearly populating after real runs


UI-to-MCP User Proxy Agent handoff not proven


Code graph and knowledge graph not yet clearly working together in the same project flow


B. Blocking external launch later
These remain real, but come after internal operator proof:


project ownership / isolation


rate limiting


sensitive route protection


HTTPS-safe deployment


structured observability


smoke tests for critical flows



Acceptance Criteria for This Phase
The phase is successful only when screenshots or visible UI prove all of the following:
Workspace / surfaces


Chat, Canvas, Plan, and Knowledge all exist as distinct but connected surfaces


MainChat is visibly the orchestrator


user input, plan, and graph context sit on the MainChat side


Mini canvas


mini canvas shows MainChat plus nearby available agents


mini canvas allows only quick connect/disconnect to MainChat


mini canvas does not expose full editor behavior


Full canvas


full canvas is the only place with add-agent and full graph editing


prompt/tool/runtime editing is only in full canvas mode


Knowledge


knowledge shows summary first


evidence is expandable


source links are visible


full sources can be opened


graph context is visible


Plan ↔ Knowledge linking is visible


Plan


blank before first run is acceptable


after a real run, plan visibly populates


Graphs


imported code graph visibly loads for active project / ADMIN


knowledge graph visibly reflects project-scoped research and context


code graph and knowledge graph can both inform the workflow


MCP coding-agent workflow


user can trigger a UI action that prepares a coding task/prompt


that task is routed to a User Proxy Agent through MCP


Goose or similar coding agent can receive it


returned result can feed back into the workspace


No claim of completion should be made until screenshots match.

Exact Priority Order Now
Priority 1
Visible active-project code graph and project-scoped knowledge graph in the UI
Priority 2
Mini canvas corrected into MainChat-neighborhood behavior
Priority 3
Knowledge surface upgraded into summary → evidence → source → graph-context workflow
Priority 4
Plan visibly populates from real runs
Priority 5
UI task/prompt handoff to MCP User Proxy Agent → Goose-like coding agent
Priority 6
Cleanup and hardening for repeated internal use
Priority 7
External launch hardening

Files Most Relevant to This Phase
Frontend


client/src/pages/agentbuilder.tsx


client/src/components/builder/BuilderCanvas.tsx


client/src/components/builder/BuilderChat.tsx


client/src/components/PlanWikiSurface.tsx


client/src/components/PlanWikiLexicalView.tsx


client/src/components/assistPlanSurface.ts


client/src/components/builder/DeckEdgeInspector.tsx


client/src/components/builder/DeckQuickAddPanel.tsx


client/src/hooks/useBuilderDeckRuntimeActions.ts


Backend


apps/backend/src/routes/v2/projects.routes.ts


apps/backend/src/routes/v2/kg.routes.ts


apps/backend/src/routes/knowgraph.routes.ts


apps/backend/src/routes/v2/agentBuilder.routes.ts


apps/backend/src/services/agentBuilderStore.ts


apps/backend/src/services/research/researchService.ts


apps/backend/src/services/graphService.ts


Explicitly do not use


apps/backend/src/v3/routes/messages.routes.ts
Because it is dormant/unmounted. 



Revised Launch Sequence
Stage 1 — Use it on itself


load project code graph


build project knowledge around it


use MainChat with plan + graph context


use canvas agents from MainChat


send coding work to User Proxy Agent through MCP


bring outputs back into plan/knowledge


Stage 2 — Tighten the product


remove surface drift


clean up mini/full canvas boundaries


improve knowledge exploration


improve MCP task handoff


make internal workflow repeatable


Stage 3 — Harden for outside users


ownership isolation


auth hardening


rate limiting


HTTPS deploy path


observability


smoke tests


onboarding polish



One-line product definition for this phase
LiquidAIty is a 4-surface workspace where MainChat / Magentic-One uses project-scoped plan, code-graph, and knowledge-graph context to orchestrate canvas agents and route coding work through MCP to external coding agents, first for internal self-use, then for cleanup, then for launch.
