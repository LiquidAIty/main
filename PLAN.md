# LiquidAIty PLAN.md — launch plan and architecture route

LiquidAIty is a **user-owned agentic knowledge workbench**. Its defining experience is not a
chatbot, a task dashboard, or a decorative graph explorer. It is a place where people and agents
can see knowledge being found, selected, passed between agents, consumed, traversed, challenged,
and expanded over time.

This document is the canonical product route. It distinguishes current facts from approved target
architecture so unfinished work cannot masquerade as a working system.

Execution law lives in [AGENTS.md](./AGENTS.md). Deletion and architecture guardrails live in
[DONT.md](./DONT.md). The current system map lives in [ARCHITECTURE.md](./ARCHITECTURE.md).
Deferred ideas live in [FUTURE.md](./FUTURE.md). Do not create another planning document.

## Status vocabulary

Every architectural statement should use one of these meanings:

- **CURRENT** — directly present in current source or saved data.
- **PROVEN** — exercised by a focused test, build, persistence readback, or real runtime proof.
- **TARGET** — approved direction that is not yet complete.
- **BLOCKED** — cannot be completed honestly until a named dependency or authority is available.
- **REJECTED** — explicitly not part of the product route.

Source existence is not runtime proof. A route returning 200 is not agent execution proof. A card
in a source template is not proof that the persisted deck contains it. A graph animation is not
proof that an agent read or wrote knowledge.

---

## The launch decision

The approved launch architecture is:

```text
LiquidAIty UI and saved cards
  = the product, front door, graph experience, policy, identity, and visible control plane

Hermes
  = Main Chat runtime, general agent, research/memory runtime, and Magentic-One steward

OpenClaude / LocalCoder
  = contained specialist Coder, persistent under-chat terminal, and bounded CoderReport executor

Microsoft AutoGen / Magentic-One on Python rails
  = native multi-agent team orchestration behind connected saved cards

Graph authorities
  = ThinkGraph, KnowGraph, CodeGraph, and AgentGraph, each with one owner
```

OpenClaude remains valuable and protected as the Coder. Main now executes through one thin repo-owned
Hermes ACP adapter. The replaced OpenClaude Main gRPC client and product launcher are deleted after
persistence, streaming, session reuse, saved-card resolution, and cancellation proof.

The existing Hermes card is the controlled experiment surface. It may expose both ordinary Hermes
work and Hermes-stewarded Magentic-One/Auto-Kanban work, but it must not become a second front door,
a second card platform, or a fake generic AutoGen agent renamed “Hermes.”

---

## The product experience

The core workspace contains three cooperating surfaces:

```text
┌───────────────────────────────────────────────────────────────────────┐
│ Main Chat — repo-owned Hermes session                                │
│ User speaks, sees streamed answers, grants actions, and steers work. │
├──────────────────────────────────┬────────────────────────────────────┤
│ Knowledge workspace              │ Agent Canvas                       │
│                                  │                                    │
│ 2D force-directed graph          │ ReactFlow agent cards              │
│ optional proven 3D mode later    │ typed edges / bus connections      │
│ progressive context reveal       │ active cards and edges glow        │
│ selection and provenance         │ context visibly travels            │
│                                  │ between agents                     │
├──────────────────────────────────┴────────────────────────────────────┤
│ Coder reveal — persistent OpenClaude terminal / bounded Coder path   │
└───────────────────────────────────────────────────────────────────────┘
```

The Knowledge workspace and Agent Canvas are different projections of one real run:

- The Knowledge workspace shows native graph entities, relationships, selected context, and
  knowledge growth.
- The Agent Canvas shows which saved agents are active, who is passing work or context to whom, and
  which topology grants authority.
- Main Chat is the conversational steering surface.
- The Coder reveal is where OpenClaude edits and tests this repository or another approved target.

Neither visualization is an independent graph authority. Both render current data and real runtime
events received through thin transport.

---

## The central product loop

The primary loop is visible knowledge circulation:

```text
user question or selected data
→ Main/Hermes queries an appropriate native graph authority
→ returned candidate nodes and edges appear progressively
→ the agent explicitly selects a bounded Context Selection
→ selected context visibly moves across an Agent Canvas edge
→ the receiving agent opens the Context Selection
→ the receiving agent traverses related native graph context
→ research or reasoning produces proposed entities and relationships
→ accepted knowledge is written by the native graph owner
→ new nodes and edges settle into the durable graph
→ AgentGraph records assignment/result/provenance lineage
→ future work can retrieve and extend the accumulated knowledge
```

The UI must never claim access to hidden chain-of-thought. “Considering” means observable context
work: a query returned candidates, a bounded subset was included in model context, a subset was
selected for another agent, the recipient opened it, and subsequent native reads or writes occurred.

The visible foreground is context and knowledge. Technical receipts remain compact backstage proof
for debugging, audit, and honest animation; they are not the primary user experience.

---

## Current reality snapshot

This section is intentionally blunt. It prevents the target architecture from being mistaken for
today’s runtime.

### CURRENT — Main Chat

- Main Chat uses a persistent repo-owned Hermes ACP process and stable conversation/card session key.
- The client and backend stream text, reasoning signals exposed by the provider, tool starts, tool
  results, permissions, progress, completion, and errors.
- The saved `main_chat` card supplies prompt, model, and grants.
- The saved Hermes Kanban card uses the same real ACP adapter with its own saved identity, session,
  Graphiti/KnowGraph grants, and existing Kanban workspace.

### CURRENT — Hermes

- Hermes source and its Python environment exist under `C:\Projects\main\Hermes`; the current direct
  filesystem inspection found no nested `.git`. Git mode, outer-repository tracking, and clone/readback
  proof remain unverified in this task because the host blocked Git commands.
- The repo-owned Hermes `0.20.0` executable passed a bounded one-shot prompt and a persistent two-turn
  ACP session using repo-local `HERMES_HOME`; the second turn correctly recalled data from the first.
  AppData Hermes was removed and was not recreated by those repo-owned tests.
- ACP exposes streamed message, reasoning, tool, permission, session, usage, and cancellation events.
  The backend closes the persistent process on shutdown/reload.
- The backend Hermes console and Kanban bridge resolve exact repo-owned executables and `HERMES_HOME`;
  they do not fall back to PATH or AppData installs.

### CURRENT — Coder

- The persistent OpenClaude terminal/PTY is a real interactive Coder surface.
- The bounded Local Coder card and `run_local_coder` path are real and useful.
- Both remain protected. Moving Main to Hermes does not authorize deleting or replacing either.

### CURRENT — knowledge visualization

- `KnowledgeGraphFramework` switches among ThinkGraph, KnowGraph, and CodeGraph surfaces.
- `NativeGraphProjectionSurface` is a real 2D force-directed graph surface with node selection,
  hover focus, topology updates, force controls, search, inspector, provenance display, and
  transient/durable presentation support.
- A 3D graph is a TARGET option only after it consumes the same native projection and activity
  contract. Do not build a separate 3D graph product or duplicate data pipeline.
- The current live ThinkGraph UI derives transient presentation nodes from streamed user,
  assistant, and provider-exposed reasoning text through `/api/thinkgraph/live-projection`.
  This is not the desired final activity model. The transient-prose path must be replaced, in the
  same implementation change, by native graph operation and Context Selection events. Preserve the
  durable ThinkGraph projection and the proven force-directed surface.

### CURRENT — Agent Canvas activity

- `BuilderCanvas` and `AgentCardNode` already accept active card and edge state and have visual glow
  behavior.
- The current Agent Builder composition passes empty `activeCardIds` and `activeEdgeIds` arrays.
- The missing seam is real runtime activity state derived from the existing chat/tool/context event
  stream. Do not add a parallel event bus merely to make cards glow.

### CURRENT — CBM

- Normal work uses only `C-Projects-main`, rooted at `C:/Projects/main`. Its `.cbmignore` excludes
  Hermes, LocalCoder, AutoGen, and the other large imported/runtime roots.
- `C-Projects-Hermes` and `C-Projects-LocalCoder` exist only for explicit work inside those vendors.
  Do not query, refresh, preload, or cross-link them during ordinary core work.
- Normal CBM discovery centers on four tools: `search_graph`, `trace_path`, `get_code_snippet`, and
  `search_code`. Continue useful, result-informed `search_graph` discovery until the actual structural
  owners are found; there is no arbitrary call-count limit. Independent bounded reads may run
  concurrently through the same canonical owner and project. Dependent calls and all mutations remain
  sequential. Direct current source and focused tests remain authoritative.
- The configured native server is the only CodeGraph authority.
- Restricted Codex profiles may expose analysis tools without project/index tools. That restriction
  must be reported; missing tools must never be invented.
- Dedicated full indexes passed at 147,002 nodes / 769,439 edges for Hermes and 25,466 nodes / 101,429
  edges for LocalCoder; those are observation-time measurements, not permanent expected counts.
- `C-Projects-main` is disposable derived state. A clean checkpoint means deleting that exact project,
  fully rebuilding `C:/Projects/main`, and verifying readiness, counts, and exclusions; an in-place
  reindex is not a substitute because deleted or newly excluded SQLite fragments may survive it.
- Each Codex task in `C:/Projects/main` receives a `UserPromptSubmit` SOP requiring the active agent to
  perform that exact delete, full rebuild, and one health/count/exclusion verification through the
  already-connected native MCP owner once at task entry. Follow-ups, interruptions, clarifications,
  compactions, and later messages reuse the task's completed entry state. The hook injects context only;
  it never launches another CBM process or opens CBM storage.
- After that checkpoint, use the four-step daily route: `search_graph` until the structural owners are
  found; `trace_path` when relationships matter; `get_code_snippet` for exact qualified-symbol snapshots;
  `search_code` for bounded concept/literal/residue discovery when useful; then direct-read current source.
- The Git post-commit hook remains Git LFS only. No delayed marker or second CBM mutation frontend exists.

---

## Runtime ownership

### Main — Hermes

CURRENT: the saved `main_chat` card resolves to one real repo-owned Hermes session.

Main must provide:

- stable LiquidAIty conversation identity;
- a one-to-one Hermes session identity for persistent turns;
- saved Main prompt/profile/provider/model/tool grants;
- streaming text and native observable tool/activity events;
- cancellation and honest failure;
- bounded graph context hydration;
- the ability to delegate to saved cards only through saved topology;
- a path to Hermes profiles and Hermes-stewarded Auto-Kanban without making the UI a scheduler.

The adapter uses native ACP stdio for persistent sessions, streaming, permissions, model selection,
and cancellation. It injects saved-card policy through the bounded ACP session configuration and
exposes only saved grants through the role-filtered Python MCP host. Terminal keystroke automation and
one-shot-per-message subprocesses are not product adapters.

### Coder — OpenClaude

OpenClaude remains:

- the persistent under-chat terminal;
- the bounded Local Coder/CoderReport executor;
- the specialist for repository exploration, edits, tests, and interactive software operation;
- CBM-first for this repository;
- separately invocable from Main, Hermes, or Magentic-One through the existing saved-card doorway.

The Main migration must not rename Hermes UI into the Coder terminal, delete the Coder terminal,
replace the CoderReport contract, or create another coding engine.

### Team orchestration — Magentic-One

Microsoft AutoGen/Magentic-One remains on Python rails. Connected `magentic_option` edges determine
eligible workers. The runtime retains its private native Task and Progress Ledgers. LiquidAIty does
not inspect, reconstruct, rewrite, or visualize those private ledgers.

Hermes may steward Magentic-One by authoring a bounded exact IDF/AgentGraph assignment, presenting it
for required user approval, and invoking the one existing `run_mag_one` authority. This is orchestration
through the existing runtime, not a Hermes reimplementation of Magentic-One.

---

## Graph authorities

One writer owns each graph. UI components, telemetry, IDF, and AgentGraph carry pointers and lineage;
they do not merge or copy native authorities.

| Authority | Storage/runtime | Owns | Does not own |
|---|---|---|---|
| ThinkGraph | SQLite / Engraphis through Python rails | project reasoning, conversation-linked operational knowledge, jobs, proof, blockers, next steps | sourced external knowledge, code structure, agent topology |
| KnowGraph | Neo4j / Graphiti and Python research | sourced entities, relationships, episodes, temporal facts, citations, provenance | task orchestration, UI state, code structure |
| CodeGraph | CBM | repository files, symbols, calls, imports, routes, structural relationships, index state | product knowledge, agent assignments, source edits |
| AgentGraph | PostgreSQL AGE plus relational payloads | agents, exact Markdown instructions, assignments, context-reference lineage, results, derivation | copies of native graph records, agent runtime, private Magentic ledgers |
| Telemetry | existing runtime event stream plus bounded append-only activity storage where required | high-volume transient read/select/send/open/traverse/write activity | durable knowledge meaning or another graph authority |

References across authorities are allowed only as provenance and hydration pointers. No graph writes
another graph’s records. AgentGraph may say an assignment referenced native IDs; it must not absorb
the referenced subgraph.

---

## Context Selection — the key visible object

The central transport object is a bounded **Context Selection**. It identifies exactly what graph
context an agent had available and chose to pass.

```text
ContextSelection
  selectionId
  authority
  mode: live | membership | snapshot
  producing query or native tool operation
  typed parameters and limits
  native node IDs
  native edge IDs
  purpose expressed by the agent/user
  sender card ID
  intended recipient card ID
  instruction / assignment ID
  created, delivered, and opened timestamps
  resulting native entity/relationship IDs when work expands knowledge
```

Modes:

- `live` reruns the bounded operation when opened and is suitable for current dashboards.
- `membership` transports exact native node and edge identities and is the default for agent
  handoffs.
- `snapshot` preserves bounded historical evidence when reproducibility or citation requires it.

The sender may include the producing query for provenance, but an exact handoff cannot rely on a
query alone because the graph may change between delivery and consumption.

---

## IDF and IDD — loose executable Markdown

IDF is an agent-readable Markdown document with structured executable islands. It is not a rigid
EnergyPlus-style file and it is not untyped arbitrary command execution.

Normal prose is inert and flexible. Explicit fenced blocks can carry:

```text
idf-imports
idf-mcp
idf-sql
idf-cypher
idf-script
idf-view
idf-result
```

IDD is the assignable vocabulary and capability contract—the rough equivalent of a type system for
agent actions, not agent thoughts. It defines:

- legal authority and connection identity;
- operation language and execution mode;
- required and optional parameters;
- parameter types and limits;
- stored repo-relative operation paths and content hashes;
- output/result shape;
- risk and approval class;
- which saved-card capability grants may invoke the operation.

Execution authority is the intersection of:

```text
saved card capability ceiling
∩ assignment-scoped imports/grants
∩ IDD operation requirements
∩ user approval where required
```

MCP, parameterized SQL, parameterized Cypher, and bounded scripts are all legitimate first-class IDF
operations when granted. Generic typed SQL/Cypher is a retained product requirement. It must use one
Python-owned, capability-gated, parameterized executor; it must not be reduced to a bespoke MCP wrapper
per query or revived as the old overbuilt registered-query subsystem.

Stored operations use portable identities:

```text
rootRef: repository or approved data root identity
relativePath: path beneath that root
contentHash/version: immutable operation identity
```

Do not persist machine-specific absolute paths as portable product identity.

---

## Honest visual activity

The two canvases should react to one real activity vocabulary:

```text
graph.query.started
graph.query.completed
context.candidates.returned
context.selection.created
context.selection.sent
context.selection.delivered
context.selection.opened
graph.node.read
graph.edge.read
graph.traversal.started
graph.traversal.completed
graph.node.proposed
graph.edge.proposed
graph.node.written
graph.edge.written
assignment.started
assignment.completed
assignment.failed
```

Events must come from operations that really occurred. The event payload carries native authority,
native IDs, run/assignment identity, sender/recipient card identity, and status. TypeScript validates
and transports these fields but does not infer semantic meaning from tool names or model text.

### Knowledge graph visual states

| State | Presentation |
|---|---|
| not yet revealed | not rendered |
| returned candidate | dim node/edge |
| included in current model context | soft pulse |
| selected for handoff | bright bounded halo |
| in transit | animated path toward recipient agent |
| delivered but unopened | dim destination badge/cluster |
| opened/consumed | strong destination pulse |
| traversed | progressive neighbor/edge reveal |
| proposed knowledge | dashed/provisional node or edge |
| accepted native write | solid node or edge settling into graph |
| historical inactive knowledge | calm low-intensity durable state |

### Agent Canvas visual states

- The active agent card glows from its real saved card ID.
- The active relationship glows from the persisted edge ID that authorized the action.
- Context handoff animates from sender to recipient.
- Delivered-but-unopened context is visually different from consumed context.
- Worker eligibility remains a topology fact; runtime activity does not mutate saved edges.
- Failed or denied actions appear briefly and settle without fake success.

Telemetry should not make the whole interface flash constantly. Transient activity fades; durable
knowledge remains.

---

## Main-to-Hermes migration plan

This is the launch-critical route. Execute it in order and stop forward expansion on regression.

### Fable 0 — repository and baseline truth

1. Verify Git HEAD, worktree status, outer-repository tracking, and clone/readback of vendored Hermes.
2. Preserve Hermes working files and the controlled upstream-fork boundary during any Git correction.
3. Preserve the proven repo-owned Hermes source entrypoint, environment, and repo-local state root.
4. Preserve focused baselines for current Main chat, Main UI transcript, Coder terminal, Local Coder,
   saved-card resolution, Hermes console, Magentic-One, AgentGraph, and graph projections.
5. Record current persisted deck topology separately from source templates.

Exit: current facts and baseline failures are known; no product behavior changed.

### Fable 1 — repo-owned Hermes health

1. Launch Hermes from `C:\Projects\main\Hermes` using its actual module/source entrypoint.
2. Prove provider/profile/model resolution without copying secrets into card data or telemetry.
3. Prove one bounded one-shot prompt and honest stdout/stderr/exit behavior.
4. Inspect and choose one native persistent/streaming interface for Main.
5. Prove session create, turn, continuation, cancellation, and shutdown outside the UI.

Exit: a real repo-owned Hermes runtime has executed and its protocol is understood.

### Fable 2 — one Hermes Main adapter

1. Add one thin adapter at the existing backend process/session boundary.
2. Resolve the saved `main_chat` card and require a Hermes runtime type/binding explicitly; never
   infer Main from a title.
3. Transport saved prompt/profile/provider/model/tool grants to the chosen Hermes protocol.
4. Map Hermes native events into one runtime-neutral Main event contract.
5. Preserve correlation ID, conversation ID, run ID, saved card ID, cancellation, and errors.
6. Do not add a second MCP host, model client, prompt assembler, session database, or hidden route.

Exit: backend-focused tests prove one persistent Hermes session and no fallback to OpenClaude Main.

### Fable 3 — Main UI talks to Hermes

1. Replace OpenClaude-specific Main client naming with a runtime-neutral Main session client.
2. Keep the existing chat layout, transcript, streaming, busy/error states, and permission UX.
3. Point the real UI chat send path at the Hermes Main adapter.
4. Prove two consecutive turns in one Hermes session through the visible UI.
5. Prove reload/history behavior against the chosen conversation authority.
6. Prove the OpenClaude Coder terminal still starts, streams, accepts input, resizes, and stops.

Exit: the user can chat with real Hermes in the actual front door and independently open Coder.

### Fable 4 — delete the abandoned OpenClaude Main path

After Hermes UI proof passes:

1. Find every caller of the OpenClaude Main-only gRPC client/session path.
2. Separate Coder terminal/Local Coder ownership from Main-only ownership.
3. Delete the replaced Main-only route, client, config assembly, tests, and compatibility code in
   the same change.
4. Preserve the vendored OpenClaude runtime and every Coder path still in use.
5. Search for old Main-only symbols and prove zero live callers.

Exit: one Main runtime, one Coder runtime boundary, no layered fallback.

---

## Hermes card and Auto-Kanban

The existing Hermes card is the first controlled hybrid experiment. Its stable runtime binding remains
`hermes_steward`; its persisted card ID remains whatever the saved deck owns. The user-facing mode may
choose:

```text
Single
  → real repo-owned Hermes bounded task/session

Auto-Kanban
  → Hermes authors exact IDF/AgentGraph assignment
  → user approval when execution requires it
  → one existing run_mag_one authority
  → native Magentic-One selects connected workers
  → result and lineage return through AgentGraph
```

The card must not dynamically pretend to be multiple unrelated runtime types. The mode selects an
existing authority. Magentic-One remains a separate native runtime card underneath the UI.

When Hermes becomes the steward, move the single structural Magentic control authority from Main to
Hermes rather than keeping two competing controllers. Main delegates to Hermes; Hermes invokes the
existing Magentic-One path. Preserve user approval and bus-connected worker eligibility.

Kanban profiles are useful runtime configuration, but the board does not replace Hermes chat and
Hermes chat does not replace the board. Both must use the same real profile/session/runtime identities.

---

## Visual context implementation plan

After the Hermes front door can complete real turns, wire visible knowledge activity through the
existing UI surfaces.

### Replace transient prose projection

The current streamed-prose ThinkGraph projection is not the final product. Replace its transient
source path with real graph activity:

1. Preserve durable `GET /api/thinkgraph/projection` behavior.
2. Preserve `NativeGraphProjectionSurface` topology, selection, inspector, and force controls.
3. Stop treating streamed answer/reasoning text as evidence that a graph entity was read or written.
4. Delete the replaced transient-prose endpoint, hook state, and tests in the same change.
5. Feed transient nodes/edges from native graph operation results and Context Selection lifecycle.

### Activate Agent Canvas glow

1. Derive active card IDs from real saved-card/run event identity.
2. Derive active edge IDs from the exact saved edge authorizing delegation or handoff.
3. Supply those arrays to the existing `BuilderCanvas` rather than building a second canvas.
4. Clear activity deterministically on completion/failure/cancellation.
5. Do not infer card identity from timing, tool name, title, or proximity.

### Add Context Selection UX

1. Let users or agents select bounded native graph nodes and edges.
2. Provide “Copy/Send View to IDF” using native IDs plus query provenance.
3. Show sender, recipient, purpose, delivery state, and consumption state.
4. Animate only proven delivery/open/traversal/write events.
5. Keep technical details in the inspector, not as a receipt wall.

### 3D mode

3D is optional and later. It may be added only as another renderer over the exact same projection,
selection, event, and inspector contracts. It must not own retrieval, normalization, activity logic,
or another API.

---

## Research and knowledge growth

The launch research loop is:

```text
user question + selected visual context
→ Main/Hermes receives exact IDF and Context Selection
→ bounded Engraphis/ThinkGraph recall where relevant
→ Hermes disambiguates the research objective
→ research agents retrieve citeable sources
→ Graphiti writes authoritative episodes/entities/relationships to KnowGraph
→ UI reveals candidate and accepted knowledge progressively
→ AgentGraph links the assignment/result to native provenance references
→ future questions retrieve and extend the accumulated KnowGraph
```

KnowGraph is not copied into AgentGraph. Engraphis does not write KnowGraph. The UI does not write
either graph directly. Research without citations cannot be displayed as accepted sourced knowledge.

---

## Coding loop

The coding loop remains:

```text
Main/Hermes or Magentic-One identifies bounded code work
→ Context Selection contains CBM project/file/symbol/route pointers
→ reviewed CoderPacket is created
→ saved OpenClaude Coder card or interactive terminal executes
→ Coder uses native CBM first, then direct source and focused tests
→ structured CoderReport returns
→ AgentGraph records result lineage
→ reusable proven lesson may become one skill
```

CBM pointers are navigation anchors, not source copies. The Coder must check index state and direct-read
current source before editing. No Graph View or plan may substitute for tests and runtime proof.

---

## Golden launch flows

### Golden Flow A — Hermes front door

1. User opens Main Chat.
2. UI resolves the saved Main card.
3. Backend starts or reuses one repo-owned Hermes session.
4. Two user turns stream through the actual UI.
5. Hermes uses one granted safe tool.
6. Tool activity is visible and correlated.
7. Reload preserves the expected conversation.
8. OpenClaude Coder remains independently usable.

### Golden Flow B — visible context handoff

1. Hermes queries one native graph authority.
2. Candidate nodes/edges appear dimly in the 2D force graph.
3. Hermes or the user selects an exact membership view.
4. Sender card and authorized Agent Canvas edge glow.
5. Context visibly moves to one recipient.
6. Recipient opens the view; consumption becomes visible.
7. Recipient traverses one related branch.
8. One new accepted entity and relationship are written by the native authority.
9. The new graph structure settles visibly with provenance.

### Golden Flow C — Hermes Auto-Kanban

1. User selects Auto-Kanban on the Hermes card.
2. Hermes authors exact loose-Markdown IDF and Context Selection references.
3. Required execution is presented for user approval.
4. Hermes invokes the one Magentic-One runtime.
5. Native Magentic-One selects only bus-connected workers.
6. Worker activity glows on the Agent Canvas.
7. Context consumption and knowledge expansion appear in the Knowledge workspace.
8. Result and provenance return through AgentGraph.

### Golden Flow D — code change

1. Hermes selects CBM anchors and creates a bounded CoderPacket.
2. OpenClaude Coder performs the change using CBM → source → focused tests.
3. CoderReport matches the packet and reports exact proof.
4. No unrelated files or graph authorities change.

---

## Preservation Set for the remodel

Every phase must preserve all previously working behavior in its blast radius unless the phase
explicitly replaces it and proves equivalence before deletion.

- Saved projects, decks, cards, edges, prompts, profiles, model selections, and tool grants remain
  readable.
- The ReactFlow Agent Canvas remains the control plane.
- The 2D native force graph and durable native graph projections remain usable.
- ThinkGraph, KnowGraph, CodeGraph, and AgentGraph retain one writer each.
- The OpenClaude persistent terminal and Local Coder/CoderReport path remain working.
- Microsoft AutoGen/Magentic-One remains native and unmodified at its private ledger boundary.
- The single Python MCP host remains the sole LiquidAIty MCP authority.
- No hidden fallback substitutes OpenClaude for failed Hermes Main execution.
- No fake event makes a card or graph node glow.
- Existing valid stored data is not reset, reseeded, reinterpreted, or deleted without explicit
  approval and readback proof.

Regression Ratio target for every implementation phase: **0.000**.

---

## Rejected approaches

- Keeping OpenClaude as permanent Main merely because the current route exists.
- Deleting OpenClaude or Local Coder while moving Main.
- Renaming a generic Harness child “Hermes” and calling integration complete.
- Driving Hermes by scripted terminal keystrokes.
- Adding a second MCP host, model client, graph database, event bus, planner, or agent framework.
- Visualizing hidden chain-of-thought.
- Creating graph nodes by parsing streamed prose and calling that graph consumption.
- Copying native graph records into AgentGraph or IDF.
- Treating a beautiful 2D/3D graph explorer as product function without selection, context loading,
  handoff, consumption, and knowledge growth.
- Recreating private Magentic-One Task/Progress Ledgers.
- Reducing generic typed SQL/Cypher IDF execution to one handcrafted MCP wrapper per query.
- Restoring the old overbuilt registered-query/runtime-profile subsystem.
- Building Agent Zero into Main or Coder before the core launch. It remains a possible later visual
  computer-use specialist card.
- Creating another plan, task, handoff, evidence, or progress Markdown hierarchy.

---

## Immediate next CoderPacket

Use the functional Hermes front door before polishing it. The next bounded task should verify one
selected persisted project against the intended three-card topology, then exercise one real
Main→Coder or Main→Hermes-Kanban delegation with observable saved-card identity and tool grants.

Defer visual polish, broader profile decisions, Kanban API replacement, and full Mag One/graph-activity
integration until that functional use identifies the highest-value next delta. First layout option to
evaluate: a vertical Kanban progression (top-to-bottom versus bottom-to-top) sized for the inspector.

---

## Durable documentation

```text
PLAN.md          canonical current route and implementation order
AGENTS.md        execution law and how agents work in this repository
DONT.md          deletion law and repeated failure patterns
ARCHITECTURE.md  current system map and verified boundaries
FUTURE.md        explicitly deferred product ideas
wiki/*.md        compact feature pointer manifests
skills/*.md      reusable proven procedures
```

Do not create a second architecture plan. When this plan changes, update this file and remove stale
contradictory direction from the other canonical documents in the same reviewed documentation change.

The launch criterion is simple to state and difficult to fake:

> The user chats with real repo-owned Hermes, sees real graph context move between real saved agents,
> watches accepted knowledge accumulate in its native graph, and can reveal OpenClaude Coder to change
> and prove the software—without duplicate runtimes, fake planning, or hidden authority.
