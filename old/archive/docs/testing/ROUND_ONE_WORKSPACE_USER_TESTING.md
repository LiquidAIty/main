# Round One Workspace User Testing

## Purpose

This package is for the first controlled usability round on the current LIQUIDAIty workspace.

The point of this round is to test whether the product feels like one workspace and whether people can make sense of:

- chat
- plan
- agent graph
- knowledge graph
- right-side panel behavior

This round is not for validating deeper graph taxonomy, advanced orchestration, or model quality.

## Current Product Truth

This package is grounded in the product as it exists now.

Current truths that matter for testing:

- The workspace shell is the thing being tested, not a redesign concept.
- The main usability question is whether the product feels like one workspace rather than stitched-together tools.
- Agent Graph and Knowledge Graph now share the same workspace interaction contract.
- Internal workspace-testing telemetry exists and can be enabled for sessions.
- Builder chat now uses the live assist/runtime path in the current build.

### Important internal note

Do not turn this into a pure model-quality session just because chat is now live.

That means:

- do not frame the session as answer-quality benchmarking
- do ask whether participants understand what the system appears to be doing next
- do use the session to test navigation, graph trust, plan centrality, and workspace coherence

## Session Setup

Before each session:

1. Start the app in the current test build.
2. Open the workspace page you want to test.
3. Enable telemetry in the browser console:

```js
window.__LIQUIDAITY_WORKSPACE_TESTING__.enable();
window.__LIQUIDAITY_WORKSPACE_TESTING__.clearEvents();
```

4. Confirm the event buffer is empty:

```js
window.__LIQUIDAITY_WORKSPACE_TESTING__.readEvents();
```

5. Do not show the participant the telemetry output during the session.

After each session:

```js
window.__LIQUIDAITY_WORKSPACE_TESTING__.readEvents();
```

Use that output in the moderator debrief, not during the task flow.

## Moderator Script

### 1. Intro

Use this script:

> Thanks for joining. I’m going to ask you to use this workspace and think out loud while you do it. I’m not testing you. I’m testing whether the product makes sense on its own.

> Please say what you expect to happen, what you notice, and anything that feels unclear or inconsistent.

> I may stay quiet for stretches so I can see what the product communicates by itself.

### 2. What to tell the participant

Tell them:

- they can click naturally
- they should think out loud
- they should not worry about being right
- they should try to use the interface without asking for help first

### 3. What not to explain up front

Do not explain:

- what each graph means
- what Magentic-One is
- what ThinkGraph vs KnowGraph means
- what the right-side panel is supposed to do
- what the tab/large-area model is supposed to be
- how the system is architected internally

If you explain these first, you destroy the point of the session.

### 4. When to stay silent

Stay silent when:

- the participant is exploring on their own
- they hesitate and may still recover naturally
- they are building their own mental model
- they are comparing Chat, Plan, Canvas, and Knowledge

Let the confusion surface before you rescue it.

### 5. When to ask follow-up questions

Ask only after a meaningful action, hesitation, or failure.

Good follow-up questions:

- What did you expect to happen there?
- What do you think this graph is showing?
- What makes this feel connected or disconnected from the chat?
- Where would you go next?
- Did that feel like the same workspace or a different tool?

Avoid leading questions such as:

- Do you like the panel behavior?
- Does the plan feel central?
- Do you understand the knowledge graph now?

Those prompt the answer.

### 6. When to intervene

Intervene only if:

- the participant is fully blocked for too long
- the build has a known unfinished behavior that makes the task impossible
- a technical issue, not a usability issue, stops the session

If the live assist path fails in a session build, say:

> The chat path is meant to be live in this build. Please continue with the workspace tasks and describe what you expected to happen.

### 7. Session close

Use this script:

> Thanks. Before we finish, in one or two sentences, what do you think this product is doing?

Then ask:

- What felt most clear?
- What felt least trustworthy?
- Did this feel like one workspace or multiple tools?

## Participant Task List

Keep the tasks short and ordered. Do not front-load explanation.

### Task 1: Start in chat

Ask:

> You’ve landed in this workspace. Send a message that would start a project or ask the system to help with something.

Moderator notes:

- Watch where they look after the response.

### Task 2: Inspect the plan

Ask:

> Find the plan and tell me what you think it represents right now.

Success means they can get to Plan and form a plausible interpretation without coaching.

### Task 3: Inspect the agent graph

Ask:

> Open the canvas and tell me what you think the visible graph is doing.

Follow with:

> Click something in the graph and describe what changed.

Success means they recognize it as execution/workflow structure, not decorative diagramming.

### Task 4: Inspect the knowledge graph

Ask:

> Open the knowledge graph and tell me what you think it represents.

Then:

> Select something in the graph and describe what the right-side panel is showing you.

Success means they see knowledge as memory/relationships connected to the workspace, not a disconnected widget.

### Task 5: Return to chat

Ask:

> Go back to chat in whatever way feels natural.

Success means they can recover the conversational workspace without feeling lost.

### Task 6: Explain the loop

Ask:

> Based on what you saw, explain what you think happens in this system after you send a message.

This is the key synthesis task.

### Task 7: Graph trust task

Ask:

> Looking at the two graphs, tell me what the difference is between them.

Then:

> Which one feels like it is doing work, and which one feels like it is storing or showing knowledge?

Success means they can distinguish Agent Graph from Knowledge Graph without needing internal architecture jargon.

## Success Rubric

Use a simple 0-2 score per dimension.

- `0` = failed / clearly confused
- `1` = partial / uncertain / needed prompting
- `2` = clear / successful without meaningful help

Maximum score: `12`

### Rubric dimensions

1. Chat felt live enough to support the workflow
Definition:
- participant understood chat as the front door
- participant knew what to do first

2. Plan felt central
Definition:
- participant could find Plan
- participant believed it mattered to what the system is doing

3. Agent Graph felt truthful
Definition:
- participant believed the canvas represented actual system work
- participant could form a plausible explanation of what the visible chain is doing

4. Knowledge Graph felt connected to the conversation
Definition:
- participant saw Knowledge as related memory/evidence, not random graph clutter

5. Right-side panel behavior felt consistent
Definition:
- participant could click graph items and understand the panel response
- participant did not feel the two graphs had unrelated inspection behavior

6. Whole system felt like one workspace
Definition:
- participant described the product as one connected environment rather than separate apps

### Pass bands

- `10-12`: strong round-one pass
- `7-9`: usable but important clarity problems remain
- `4-6`: weak coherence; major usability issues remain
- `0-3`: not ready for broader user testing

## Observation Checklist

Use this during the session.

### Navigation and click behavior

- Did the participant know where to click first?
- Did they understand how to move between Chat, Plan, Canvas, and Knowledge?
- Did they naturally return to chat?
- Did they struggle with the large-surface versus companion-surface model?

### Plan understanding

- Did they understand what Plan represented?
- Did they treat Plan as central or secondary?
- Did they see Plan as current system state or as decorative text?

### Agent Graph understanding

- Did they understand the graph as execution/workflow?
- Did they believe the graph reflected real system behavior?
- Did they mistrust the graph as decorative or fake?

### Knowledge Graph understanding

- Did they understand the Knowledge Graph as memory/relationships?
- Did they confuse it with the Agent Graph?
- Did they describe it as noisy, arbitrary, or disconnected?

### Right-side panel behavior

- Did graph selection leading to panel content feel natural?
- Did they understand what changed after node or edge selection?
- Did the panel feel consistent between Agent Graph and Knowledge Graph?

### One-workspace coherence

- Did they talk about the product like one workspace?
- Did they say or imply it felt like separate apps or tools?
- Did any transition break their mental model?

## Telemetry Review Checklist

After each session, review the internal event buffer and compare it with notes.

### Core events to review

- `chat_send_started`
- `chat_response_received`
- `surface_opened`
- `return_to_chat`
- `agent_graph_node_selected`
- `knowledge_graph_node_selected`
- `knowledge_graph_edge_selected`
- `workspace_panel_opened_from_graph_selection`
- `workspace_state_refresh_completed`
- `graph_refresh_completed`
- `post_response_refresh_completed`

### What to compare against observation

1. Did the participant actually open Plan, Canvas, and Knowledge in the order they described?
2. Did they return to Chat naturally, or only after wandering?
3. Did they select graph items but fail to mention the panel?
4. Did graph selection happen repeatedly before comprehension?
5. Did the session show long gaps between surface changes that match observed hesitation?
6. Did send/response/refresh timing create visible trust problems?

### How to use telemetry

Use telemetry as support, not as the only truth.

Telemetry helps answer:

- what they actually clicked
- how long transitions took
- whether they inspected graph items
- whether they made it back to chat

Telemetry does not replace:

- spoken confusion
- hesitation
- wrong mental models
- trust/mistrust cues

## Not In Scope Yet

Do not test these yet:

- advanced graph taxonomy
- scope segmentation depth beyond what the current UI already exposes
- deep graph logic correctness
- large-scale graph exploration
- advanced research swarms
- complex orchestration internals
- backend graph storage structure
- fine-grained model quality benchmarking
- long-running autonomous behaviors
- deeper answer-quality benchmarking beyond whether the live chat path feels usable enough for the workspace loop

## Round-One Readout Template

Use this after each session.

### Session summary

- Participant code:
- Date:
- Build used:
- Moderator:

### Rubric score

- Chat felt live enough:
- Plan felt central:
- Agent Graph felt truthful:
- Knowledge Graph felt connected:
- Panel behavior felt consistent:
- Whole system felt like one workspace:
- Total:

### Strongest signals

- What felt clear:
- What felt confusing:
- What felt untrustworthy:

### Telemetry notes

- Key surface sequence:
- Graph selections:
- Return-to-chat path:
- Timing concerns:

### Recommendation

- Ready for next round as-is
- Ready with small usability fixes
- Not ready; major coherence issues remain

## Revision Rule

Keep this package honest.

If the product state changes materially, especially:

- Plan becomes actively runnable
- scope behavior becomes first-class in the interaction layer
- graph trust or panel behavior changes

then revise this document before the next testing round.
