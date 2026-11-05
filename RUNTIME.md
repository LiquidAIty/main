# Runtime contract — LiquidAIty on Hermes

[Plugin contract](plugin.md) is the canonical implementation boundary. This file states product
behavior and acceptance criteria. It is not proof that current source is loaded, and it must never be
injected into a Card prompt or user turn.

## One UI, one runtime

LiquidAIty is its own React UI inside a Hermes web-dashboard plugin page. Hermes is the only agent
runtime and owns:

- profiles, provider/model resolution, skills, memory providers, and MCP loading;
- Bot Chats, sessions, history, admission, streaming, approvals, clarification, and Stop;
- voice/image attachment delivery;
- `message_agent`, recipient execution, late replies, and sender identity;
- task/dependency rows, attempts, worker processes, retries, and synthesis;
- PTY/TUI and runtime telemetry.

LiquidAIty owns Product pixels, saved Card revisions, Project wire topology, profile projection,
application MCP operations, and graph views. It must not introduce a second session API, Gateway
manager, transcript store, task scheduler, PTY host, or reply waiter.

## Main conversation

Main is the human-facing fast boss. The Main composer sends the user's literal text and selected
images to the canonical Main Hermes Bot Chat through the generated Gateway client.

LiquidAIty does not parse a leading `@Name` into a direct target. Main and Hermes decide whether to
use native `message_agent`. A mounted composer is accepted only when Send reaches Hermes, history
comes from Hermes, Stop interrupts the active Hermes submission, and replies retain Hermes-provided
identity.

Main may finish before a delegated Bot. A later Bot answer appears once when Hermes emits or replays it.
The UI never relabels Main prose as another Card or infers the sender from a wire, title, mention, or text.

Main delegates time-consuming work, reviews results, and answers. Main never creates or edits Cards,
profiles, prompts, skills, tools, or wires.

Hermes currently identifies the canonical Bot Chat by stable profile and exposes no LiquidAIty Project
key in the generated session contract. v0.1 therefore claims the retained Trading Project only, not
concurrent multi-Project history isolation. A cloned profile, local session registry, copied transcript,
or history filter is not an acceptable substitute for a documented Hermes capability.

## Saved Cards and wires

One saved Card maps to one stable Hermes profile. The Card owns its prompt blocks, model/provider,
selected skill, toolsets, MCP includes, optional Python recipe, and Product identity. LiquidAIty
publishes that configuration through public profile calls and verifies readback.

Every valid enabled wire provides native Bot reachability:

- orange `flow` is an ordinary direct relationship;
- blue `magentic_option` is the same relationship plus Magnetic worker membership.

An unwired visible Card is not a target. A wire does not make the target an orchestrator or grant
reverse access. Main is source-default orchestrator. Any other enabled orchestrator receives only its
own exact wired roster.

Each rostered profile description contains a category plus the Card's exact
`[ORCHESTRATOR SKILL]` introduction. Main uses those descriptions to choose intelligently; LiquidAIty
does not implement a deterministic router.

## Builder

Builder builds and never runs. It may author PromptSpecs, prompts, applications, code, and new non-core
blue worker candidates. It may edit only existing non-core blue workers and their blue Magnetic wires.
Core system Cards, orange system topology, and unrelated unwired Cards are protected by the Python
operation owner.

Saving and testing are separate. Main tests a saved Card through native `message_agent`. Builder
does not self-run the Card it created.

Builder's lower terminal uses Hermes dashboard `/api/pty`. Closing/collapsing the panel detaches the
viewer; LiquidAIty does not spawn or stop a TUI process.

## Direct specialist, Team, and Magnetic

Main selects the smallest suitable path:

1. Call one saved specialist directly for bounded matching work.
2. Call protected Team directly when no saved specialist matches.
3. Ask Builder to prepare the exact PromptSpec for deliberate multi-agent work, then send that
   PromptSpec to Magnetic.

Team's Bot turn calls `taskgraph_start` once. Hermes creates one marked root, decomposes it into
same-profile depth-one workers, and returns to the same root for synthesis.

Magnetic's Bot turn calls `taskgraph_start` once. Hermes creates one root restricted to the exact
blue roster, dispatches/dependency-blocks its children, and returns to the same root for synthesis.
Magnetic may assign a child to Team; Team then owns its separate same-profile AutoTeam boundary.

LiquidAIty renders Task status from Hermes's bundled authenticated Kanban board/task reads and keeps only
the exact creator lineage rooted in the selected profile session. It has no Kanban board, task copy,
worker selector, scheduler, or progress simulator.

## Card skills, memory, and Python

Every runnable Card selects exactly one custom or existing Hermes skill. The Card editor may edit its
custom skill. Launch MVP has no second LiquidAIty skill library and no automatic skill-making UI.

Every retained profile selects Holographic. Built-in Markdown memory, user-profile Markdown, background
review, curator behavior, and automatic skill creation are disabled.

The on-Card Python editor is retained. Disabled or blank recipes are inert. Enabled recipes run through
the native LiquidAIty plugin's bounded Python tool with immutable hashes, schemas, timeout, output size,
tool-call count, and exact saved MCP scope. A bad recipe fails without producing a result or widening
the Card's grants.

## Graph context and completed-turn intake

The visible Think/Know/Code canvas publishes one compact in-memory navigation map containing exactly
enabled visible nodes/relationships, provider pointers, and at most one open-node detail record.
Main Send fails closed until the map shown to the user is synchronized with the plugin cache. Main,
Builder, ThinkGraph, and KnowGraph receive the pre-rendered map; provider tools perform deeper reads.

After a successful Main turn, the Hermes plugin host—not Main—owns the background ThinkGraph intake task.
Main cannot start, stop, steer, approve, supervise, or settle it. The hook captures the exact User/Main
`state.db` row IDs at turn completion; Python rails reads only those rows, the registered auxiliary model
extracts structured candidates, and Engraphis records the pair outcome while settling zero or more Thinks.

KnowGraph uses Hermes Web pinned to Firecrawl plus Graphiti search/write. ThinkGraph uses Engraphis
hybrid vector/lexical operations. Main and Builder receive the bounded search grants appropriate to
their roles. No UI code merges graph meaning or writes provider records.

## Voice, images, and telemetry

Voice and image controls remain LiquidAIty pixels over Hermes session/attachment contracts. They do not
open another conversation or provider path.

Card glow, running-model count, tokens, and latency use actual Hermes session/subagent/usage data. Unknown
renders as unavailable. Planned workers, roster size, mentions, and UI intent never count as activity.

## Attribution and persistence

The visible chat contains literal user input and actual Hermes-reported answers. Do not expose internal
delivery envelopes, task JSON, or model scaffolding as conversation messages. Do not manufacture
acknowledgements or hide duplicate execution through prose filtering.

Hermes owns conversation history. LiquidAIty does not copy it into a TypeScript conversation store.
Engraphis raw completed-pair intake is a one-way graph source workflow, not a second chat history or a
history polling mechanism.

Project switching detaches listeners from the old view. It does not delete Hermes sessions, saved Cards,
profiles, graph data, or tasks.

## Acceptance tiers

Report each tier separately:

1. source owners and forbidden-residue absence;
2. focused tests;
3. full relevant tests;
4. typechecks and normal/dashboard builds;
5. loaded plugin discovery and current source identity;
6. real Main send/history/Stop/voice/image behavior;
7. real direct specialist, Team, and Magnetic behavior;
8. Holographic and graph persistence readback;
9. refreshed external connector catalog;
10. Jeremiah's visual acceptance.

A source-defined route or passing fixture is not a loaded turn. A task accepted is not a completed task.
A queued Bot acknowledgement is not a recipient answer. No live success may be claimed without the
corresponding loaded evidence.
