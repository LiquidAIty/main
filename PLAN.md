# LiquidAIty Living Plan

## What LiquidAIty Is

LiquidAIty is an agentic engineering workbench. It automates the manual vibe-coding loop:

user chats with planning AI -> planning AI understands the repo/project -> planning AI creates one
bounded coding job -> user sends the job to a coder -> coder returns a structured report ->
planning AI compares the report against the job -> the system remembers proof, blockers, and
lessons -> the next job is prepared.

The user describes what they want done. The user is not asked to prompt a prompt.

## First Launch Wedge

LiquidAIty first launches as an agentic engineering / vibe-coding workbench.

The first user value is:

plan the job -> gather project context -> create a bounded spec-as-prompt -> send it to a coder ->
read a structured report -> compare report versus job -> remember proof and lessons -> prepare the
next job.

Research remains part of the product, but recursive research, research swarms, broader KnowGraph
ingestion, and the research-to-chat loop are deferred until the coding loop is useful.

## Product Loop

1. **User chat**: user chats with Mag One.
2. **Read PlanFlow**: Mag One reads current PlanFlow state.
3. **Receive Options**: Mag One receives a compact list of available workflow options.
4. **Context Gathering**: Mag One uses CBM and SkillGraph as code-planning tools.
5. **Choose Option**: Mag One chooses one workflow option (e.g., plan_only, draft_spec_for_approval, run_read_only_coder_task).
6. **Update Task Ledger**: Mag One updates the Task Ledger with the plan, selected agents, and context.
7. **Create SPEC**: Mag One creates or updates the current SPEC.
8. **Safe Execution**: Read-only audit/inspect may execute if safe and permitted by the selected option.
9. **Approval Gate**: Edit/refactor/write work requires explicit approval.
10. **Code Console**: Local Coder executes through Code Console visibility.
11. **Update Progress Ledger**: Progress Ledger receives TaskResult, proof, and blockers.
12. **Record Memory**: ThinkGraph records proof/memory.
13. **Next SPEC**: PlanFlow proposes next SPEC candidate.

## Product Parts

### User Chat

User chat is the steering layer and state mirror. The user describes goals, changes, problems, and constraints in normal language. Chat starts planning; it is not a prompt-template editor, and it does not own durable state.


User chat is the steering layer and state mirror. The user describes goals, changes, problems, and constraints in normal language. Chat starts planning; it is not a prompt-template editor, and it does not own durable state.

### Magentic-One / Sol

Magentic-One/Sol is the planner and thinking agent. It starts from user chat, reads current PlanFlow state, uses CBM and SkillGraph as planning tools, and chooses from available workflow options instead of relying on brittle deterministic intent taxonomies. It updates the Task Ledger and creates the current SPEC. It must not fake repository understanding, planning, execution, or success.


Magentic-One/Sol is the planner and thinking agent. It starts from user chat, initiates the Context
Packet pull, and uses current plan state, reasoning memory, relevant skills, fresh code evidence,
and user input to choose the next bounded job. It uses Codebase Memory and SkillGraph as planning tools to form the task. It must not fake repository understanding, planning, execution, or success.

### PlanFlow

PlanFlow is the durable work surface, not decorative ontology chips. It uses a Task Ledger and Progress Ledger to model work.

Task Ledger owns plan, known facts, current SPEC, selected agents, planning context, and approval state.
Progress Ledger owns run status, TaskResult, proof, blocker, next_needed, and next SPEC candidate.

PlanFlow is not a document map, spec library, skill library, markdown graph, set of road signs, fake planner summary, or fake execution preview.


PlanFlow is the durable work surface and Magentic-One/Sol's control plane.

PlanFlow uses a Task Ledger and Progress Ledger to model work, rather than decorative taxonomy chips. It shows the Current Mission, Task Ledger (known facts, durable plan, current SPEC), and Progress Ledger (run status, TaskResult, proof, next step).

PlanFlow is not a document map, spec library, skill library, markdown graph, set of road signs, fake planner summary, or fake execution preview. It does not show every spec, skill, or document.

### PLAN.md

This file is the durable repo-backed living plan. It is always present and can change often through
PlanFlow. It holds product identity, launch wedge, current route, active work, code/context anchors,
blockers, next step, durable decisions, and concise status/proof notes.

`PLAN.md` is not decoration, old prompt storage, a spec library, or a completed-task archive.

### Context Packet

The Context Packet is graph and code context initiated by Magentic-One/Sol before it creates the
next active job. It is assembled from:

* user input
* current PlanFlow state
* `PLAN.md`
* ThinkGraph reasoning, events, proof, and blockers
* fresh Codebase Memory / CodeGraph evidence
* relevant skills indexed through SkillGraph / Neo4j
* KnowGraph research when relevant

Its purpose is to help the planner understand the project before creating a CoderPacket. Missing or
stale code evidence is a blocker, not permission to guess.

### Codebase Memory / CodeGraph

CBM is a planning tool for Mag One to form tasks. It is not the top-level product surface. Magentic-One/Sol uses fresh CBM/CodeGraph to create code anchors and bound the active job. The coder also uses Codebase Memory directly while working. CBM is a structural map; direct reads, tests, compile output, and real smoke results win when they disagree.


Fresh code evidence is core. Magentic-One/Sol uses CBM/CodeGraph to create code anchors and bound
the active job. The coder also uses Codebase Memory directly while working. CBM is a structural map;
direct reads, tests, compile output, and real smoke results win when they disagree.

### SkillGraph / Neo4j / skills/*.md

SkillGraph is a planning tool for Mag One to retrieve relevant skills. It is not the top-level product surface. skills/*.md are durable reusable learning indexed and retrieved through SkillGraph / Neo4j. Skills teach future agents how work is broken down, proof rules, failed attempts, guardrails, no-stub/no-fallback laws, CoderReport expectations, adapter lessons, and reusable procedures.


`skills/*.md` are durable reusable learning indexed and retrieved through SkillGraph / Neo4j.
Skills teach future agents how work is broken down, proof rules, failed attempts, guardrails,
no-stub/no-fallback laws, CoderReport expectations, adapter lessons, and reusable procedures.

Skills are not PlanFlow canvas nodes and are updated only when learning is reusable.

### Active Prompt / CoderPacket

The active CoderPacket prompt is both the spec and the task. There is no separate spec file, task
file, spec folder, or task ledger.

Use the terms **spec-as-prompt**, **task-as-prompt**, **active CoderPacket**, and **active job
contract**.

A CoderPacket:

* is the complete bounded spec and task for one part of `PLAN.md`
* is created from Context Packet, `PLAN.md`, relevant skills, and fresh CBM/code anchors
* is shown in PlanFlow only while active
* can be reviewed and edited by the user
* is sent to a coder when the user clicks Go
* is never converted into a spec file or task file

The repository does not keep a `specs/` folder or task files. Durable product direction belongs in
`PLAN.md`; reusable learning belongs in `skills/*.md`; current execution requirements belong only
in the active CoderPacket prompt.

### CoderReport

CoderReport is the structured response to a CoderPacket. It includes:

* verdict
* comparison against CoderPacket
* completed, incomplete, and changed requirements
* files changed
* proof commands and proof results
* blockers and assumptions
* chosen approach and rejected alternatives
* reusable skill updates
* next recommended task

PlanFlow compares CoderReport against the active CoderPacket. Hidden success and vague done claims
are forbidden.

### ThinkGraph

ThinkGraph stores structured reasoning and event memory: why the plan changed, context used, job
created, coder response, matches and misses, proof, failures, blockers, and recommended next step.
ThinkGraph is not markdown sprawl and does not invent planning or success.

### Coder Adapters

Coder adapters follow one rule: **CoderPacket in, CoderReport out**.

Planned adapters:

* LocalCoder / RepoCoder adapter wrapping the vendored `localcoder/` runtime through its real
  machine-facing execution boundary
* manual adapter for copying CoderPacket out and pasting CoderReport back
* CLI/headless adapter for external coding tools
* MCP adapter for agent tools where available

There is no vendor lock-in. Adapters are product direction only in the current documentation pass.

### Coding-Run Architecture

LiquidAIty currently dogfoods its own coding loop against the explicit target root
`C:\Projects\main`. Approved coder runs may edit LiquidAIty-owned source in this repo. The vendored
`localcoder/` runtime stays excluded from CBM and is not edited unless a future active CoderPacket
explicitly targets vendored runtime work.

The user chats with Magentic-One/Sol first. Sol classifies the workflow and reads the current
AgentBuilder canvas: cards directly connected to the Magentic bus are eligible participants;
disconnected cards are not callable, and bus position does not prescribe execution order. A coding
workflow uses eligible Plan Agent, CodeGraph/CBM, Local Coder, and ThinkGraph roles in that logical
order. Missing required Plan, CodeGraph, or Local Coder connectivity blocks the coding workflow
clearly.

Before code action, Plan Agent creates or validates the plan and the user approves edit work.
CodeGraph/CBM must pass a root-bound scoped gate before coding context or edits. Local Coder receives
one bounded CoderPacket and runs in read-only/plan mode unless the approved packet explicitly sets
`writeMode: edit`. It must return a strict CoderReport. ThinkGraph records decisions, proof,
blockers, and the report; CBM refreshes after successful changes; skills update only for reusable
learning.

The same CoderPacket-in/CoderReport-out lifecycle will later target explicit external repo roots,
user projects, UI apps, dashboards, and client workspaces. Codex, Claude, LocalCoder/OpenClaude, or
other coder workers may execute bounded jobs, but Magentic-One/Sol remains the planner/router and
workers may not invent scope, silently fall back, or bypass the target-root CBM gate.

### LocalCoder / OpenClaude Audit

`localcoder/` is a vendored OpenClaude-derived runtime, not a nested Git subrepository. It contains
real repository tools, permissions, MCP support, and a bidirectional gRPC agent service. The
backend-owned terminal launcher reads `apps/backend/.env` and passes
`apps/backend/mcp.config.json` when present.

The current backend OpenClaude harness is scaffolding, not a real LocalCoder adapter:

* `POST /api/coder/openclaude/run` accepts a plain `task` string and returns plain `output`, not a
  CoderPacket and CoderReport.
* Both current headless and terminal run modes call the host `runLLM` client. They do not invoke
  LocalCoder's coding-agent/tool runtime.
* Terminal mode can report `used: true` from launcher availability without launching or proving a
  terminal run.
* The current provider resolver contains a model fallback, which violates the no-fallback law.
* User chat currently starts a Magentic-One deck run directly. It does not assemble the complete
  Context Packet, create an active CoderPacket, wait for Go, invoke LocalCoder, compare a
  CoderReport, or persist the completed loop.
* A `local_coder` participant in the Magentic-One payload is currently mapped to a generic
  `assistant_agent`; it is not routed to the dedicated LocalCoder harness.

The active machine-facing adapter is the backend-owned CLI/process boundary. It owns the target
root, environment, explicit provider/model, permission mode, normalized MCP configuration, bounded
timeout, and strict CoderReport validation. LocalCoder's gRPC surface remains a possible future
interface but is not part of the current route.

### Code Console (OpenClaude Console Bridge)

Code Console is execution visibility only. OpenClaude/LocalCoder remains a black-box coder engine for now; we are not graphing or editing the full OpenClaude stack now. The Console Bridge shows the live CLI in an in-app terminal panel.


OpenClaude/LocalCoder is a real CLI coder engine, not a log source. LiquidAIty runs it as the actual
coder with its normal tool/runtime abilities; it does not neuter it into a read-only viewer. Mag
One/Sol is the planner/controller on top: it owns the task, checks the canvas bus participants and
the root-bound CBM/CodeGraph scoped gate, and sends the bounded task into the session. The Console
Bridge shows the live OpenClaude CLI in an in-app terminal panel.

* The bridge is the smallest owned backend that spawns the real OpenClaude CLI as a long-lived,
  streamed process (`apps/backend/src/coder/openclaude/console/`). It reuses the LocalCoder adapter's
  runtime discovery, so the terminal and the headless job invoke the exact same vendored CLI.
* Process backend: interactive sessions run on a real PTY via `node-pty` (a true TTY, so the
  OpenClaude REPL behaves like a normal terminal); `print`/`task` one-shots use `child_process`
  stdio pipes. The active backend is reported per session as `transportMode: pty | pipe` and a pipe
  fallback is never silently presented as a PTY.
* Frontend: the terminal panel renders with `@xterm/xterm` (+ fit addon); a plain-text transcript
  mirror is kept for reliability and accessibility.
* Transport: stdout/stderr/PTY output stream to the client over SSE
  (`GET /api/coder/openclaude/console/sessions/:id/stream`) — the existing-equivalent-stream option;
  input is forwarded to stdin/PTY (`POST .../input`), resize via `POST .../resize`; start/stop/status
  are plain JSON routes. No gRPC, and no WebSocket server was added to the boot path.
* Modes are explicit. `interactive` is the default (the CLI itself "starts an interactive session by
  default") and gets the PTY. `print` is one-shot non-interactive. `task` is a Mag One prompt/SPEC/
  CoderPacket delivered into a session. OpenClaude keeps its normal CLI abilities — the bridge adds no
  artificial command/tool restrictions and does not force read-only.
* Mag One has two paths and they do not compete: a quick diagnostics terminal/tool (when one exists)
  for CLI help, bounded checks, and path/runtime inspection; and the OpenClaude Console Bridge for
  real coder work — implementation, debugging, edits, test/fix loops, and active SPEC/CoderPacket
  execution. There is no current Mag One terminal tool in the runtime tool set, so the bridge is the
  active coder path; no second competing coder path is created.
* CBM/CodeGraph informs Mag One planning and gates routing; it does not remove OpenClaude's normal
  capabilities. A disconnected Local Coder or a non-`ok` scoped gate blocks task routing loudly.
* Dogfood target root is `C:\Projects\main`. The same flow will later point at other repos, UI apps,
  dashboards, and client projects via an explicit target root. Vendored `localcoder/` stays excluded
  from CBM unless a SPEC targets vendored runtime work.
* This is not a sandbox: the session runs with the local environment's permissions, and the panel
  says so. Secrets (API keys, bearer tokens) are redacted from streamed output and diagnostics, and
  the full environment is never printed. Success is reported honestly: a started/streaming session is
  real terminal usability, but terminal output is not a CoderReport unless the strict CoderReport
  path validates one.

### Coder Console Naming Firewall

User-facing UI must not expose `Claude`, `OpenClaude`, or `LocalCoder`. The public product names are:

* `Coder` — the user-facing agent role / canvas card.
* `Code Console` — the user-facing terminal feature (left rail item and panel title).
* `Coder Engine` — the user-facing runtime label.
* `Coder Session` — the user-facing task/session label.

Internal implementation names may remain for now: the vendored folder `localcoder/`, the binary path
`localcoder/bin/openclaude`, the backend namespace `apps/backend/src/coder/openclaude/console/*`, and
existing route paths, filenames, imports, and test ids. A broad internal rename is a later SPEC. The
clean display names live in one place: `client/src/features/agentbuilder/console/coderConsoleNames.ts`.

Raw terminal output may still print the underlying CLI banner (Claude/OpenClaude/LocalCoder) in
developer mode, and proof/debug transcripts are never silently mutated. For public terminals an
optional display-only redaction layer (`redactCoderBranding`) maps those terms to clean names and the
UI marks the view as redacted — redaction must never become fake proof.

### Plan Surface Loop & Intent Policy

LiquidAIty is a Plan Surface centered agent workbench, not a generic chat-to-code app. The Plan
Surface is the durable source of truth; chat is a control/mirror layer; Code Console is execution
visibility only.

Core loop:

1. User chats with Mag One.
2. Mag One reads Plan Surface state, CBM, SkillGraph/skills, and connected-canvas capability metadata.
3. Mag One proposes or updates a plan and creates a SPEC packet.
4. Edit/refactor/destructive work requires explicit user approval before dispatch.
5. Explicit read-only audit/inspect tasks may dispatch read-only Local Coder after the Plan Surface
   task/SPEC is created (it cannot edit, commit, or push).
6. Local Coder runs through Code Console; TaskResult updates the Plan Surface; ThinkGraph records the
   outcome; Mag One proposes the next SPEC from incomplete/blocked/subpar TaskResults.

Intent/approval policy (enforced in the `/console/task` route): "Mag One chooses. Code does not interpret the user's wording." Mag One explicitly selects one of the `AvailableWorkflowOptions` (e.g. `draft_spec_for_approval`, `run_read_only_coder_task`, `plan_only`). Read-only tasks auto-dispatch (still gated by Local Coder + CodeGraph connectivity and the scoped CBM gate); edit/refactor/destructive work defaults to `draft_spec_for_approval` and holds for explicit user approval.

Current objective: one reliable self-coding loop, not more scattered experiments. Open work:
PlanFlow must become a live mission/work surface (mission, planning insight, active SPEC, execution,
TaskResult, next SPEC) rather than decorative ontology chips; a compact `MagOnePlanningContext`
packet should feed Mag One before planning. `SkillGraph: unavailable` today — `skills/*.md` exist
(14 files) but there is no SkillGraph query service yet; do not fake skill insight.

OpenClaude/LocalCoder remains a black-box coder engine; we are not graphing the full OpenClaude
stack. CBM and SkillGraph are planner insight sources, not the coder runtime.

## Current Route

1. Make this living plan and `AGENTS.md` the clear product and execution law.
2. Use one active CoderPacket prompt as both the current spec and task; keep no spec or task files.
3. Wire PlanFlow around the living plan, one active CoderPacket, CoderReport comparison, blockers,
   proof, and next step.
4. Have Magentic-One/Sol initiate Context Packet assembly from ThinkGraph, SkillGraph/Neo4j,
   CodeGraph/CBM, and relevant KnowGraph context.
5. Define backend-owned CoderPacket, CoderRunEvent, permission-decision, and CoderReport transport
   contracts.
6. Harden the real LocalCoder CLI/process adapter with stage diagnostics, explicit target root,
   MCP diagnostics, explicit model, bounded timeout, and explicit permission policy.
7. Connect PlanFlow Go to that adapter, stream real run events, compare the returned CoderReport
   against the active CoderPacket, persist the outcome, and prepare exactly one next job.
8. Remove or quarantine misleading harness behavior only after the real route replaces it.
9. After the coding loop is useful, build the deferred research loop.

## Active Work

The spec/task-file model has been removed. The root planning spec/task trees and Spec-Kit scaffold
are gone, SkillGraph handoff treats the active CoderPacket prompt as both spec and task, and
PlanFlow's repository projection now reads only the living `PLAN.md`.

The first real backend CoderPacket-to-LocalCoder boundary is wired. Shared validated CoderPacket and
CoderReport contracts exist, `POST /api/coder/localcoder/run` accepts one packet and returns its
report plus comparison, and the process adapter invokes the vendored LocalCoder noninteractive
entrypoint with backend env, MCP config, explicit model, and structured report schema.

The old plain-task OpenClaude run route is retired, terminal mode cannot claim it was used without
launching, and OpenClaude provider/model resolution no longer silently falls back. The LocalCoder
service now runs a real same-run CBM index and bounded scope gate before invoking the CLI/process
adapter. The gate requires the repo-owned LocalCoder boundary/control-plane files and rejects
vendored or generated runtime files in the index.

The root `localcoder/` runtime remains excluded from CBM while
`apps/backend/src/coder/localcoder/**` and `repo-intake/localcoder-boundary.md` are indexed. Live
read-only adapter diagnostics found the vendored-built CLI ready and reached it without gRPC.
`gpt-5.1-chat-latest` timed out with identical stage evidence with production MCP and explicitly
disabled diagnostic MCP, and still returned no stdout or CoderReport during the one allowed
120-second smoke. LocalCoder-known `gpt-5.3-codex` failed immediately because the configured
account cannot access it; `gpt-5.4` also timed out without returning output. The timeout path killed
the child, left no LocalCoder process, and changed no tracked repo or vendored file.

PlanFlow now accepts one validated active CoderPacket for the selected project, exposes an explicit
Go gate, sends only that accepted packet to the LocalCoder route, and renders the returned
CoderReport comparison, blockers, proof, and next recommended task. A blocked report remains visible
even when the route correctly returns HTTP 424, and no next job starts automatically.

Normal Agent Builder chat now runs the real Magentic-One deck path and then asks the backend
planning service to assemble a Context Packet from user input, PlanFlow state, this living plan,
dedicated ThinkGraph memory, SkillGraph/Neo4j, graph context, selected workspace context, and
KnowGraph only when relevant. The configured planner model must return one schema-validated
CoderPacket; missing planner configuration or invalid output blocks loudly. PlanFlow receives that
packet automatically, keeps it editable, and preserves the existing user-gated Go route.

CoderPacket creation and LocalCoder CoderReport reconciliation are summarized into ThinkGraph,
including completed, incomplete, blocked, changed, and out-of-scope requirements, proof summary,
blockers, and the next narrower focus. Raw large prompts and outputs are not copied into ThinkGraph.

The backend graph-context builder now queries the configured Codebase Memory MCP directly. Context
Packets carry the actual query, matching files and symbols, graph node/edge counts, freshness
status, and a visible blocker when CBM is stale, unavailable, or returns no matching evidence.
CoderPackets trust only CBM-derived anchors or record the exact CBM blocker, and packet-created
ThinkGraph events persist a bounded summary of that evidence.

The Sol coder-planner now resolves only explicit configuration:
`SOL_CODER_PLANNER_MODEL_KEY`, an explicit provider/model pair, or an explicitly set
`SOL_PRIMARY=openai|openrouter` with its matching provider key. Context Packet assembly records
bounded per-source diagnostics for PLAN.md, ThinkGraph, SkillGraph, graph context, CBM/CodeGraph,
KnowGraph, PlanFlow state, and selected context. Critical source timeout/failure blocks; a
non-critical failure continues only with visible Context Packet warnings and CoderPacket
guardrails.

One live no-execution `POST /api/coder/planflow/prepare` created and persisted active CoderPacket
`coderpacket:project_admin:2026-06-13T13:01:58.416Z`. The ThinkGraph event records explicit
`SOL_PRIMARY` / OpenAI / `gpt-5.1-chat-latest` provenance, real CBM anchors, stale-CBM blocker, and
all source diagnostics. No LocalCoder job ran.

The bounded KnowGraph Context Packet node and relationship queries now carry their graph variables
and timestamp `sortKey` through scoped `WITH DISTINCT` clauses before ordering and limiting. A
source-only live diagnostic reached real Neo4j without the former out-of-scope-variable error and
returned an honest `empty` KnowGraph diagnostic in 998 ms. The diagnostic smoke did not call
prepare, write a ThinkGraph event, or run LocalCoder.

CBM freshness now has an additive honest diagnostic at the existing CodeGraph Context Packet
boundary. It ties `list_projects` source root to the requested repo, reads CBM's real indexed
`File` inventory through `query_graph`, and compares it with a bounded direct filesystem source
inventory without using git status/diff. `ok` requires matching complete inventories plus a real
indexed revision or timestamp. CBM 0.6.1 exposes neither revision nor timestamp in this workspace.
A source-only live diagnostic returned `stale`: 408 indexed files, 16,850 bounded on-disk source
files, and bounded examples absent from the CBM inventory. It wrote no ThinkGraph event and ran no
LocalCoder job.

The Python / AutoGen rails now register `coder_console_task` in `DEFAULT_TOOL_REGISTRY`. A
bus-connected Local Coder becomes a real AutoGen participant with that selected tool, using the
smallest safe default for persisted Local Coder cards that predate tool metadata. Ordinary chat
excludes the coder participant; coding runs require current Local Coder and CodeGraph bus
participants, build a compact read-only SPEC-style prompt, and call the existing TypeScript Console
Bridge route without spawning OpenClaude from Python.

A live persisted-canvas smoke reached the full chat/deck -> Magentic-One -> Python rails ->
`coder_console_task` -> TypeScript Console Bridge -> OpenClaude/OpenRouter chain. Magentic-One now
prioritizes the bus-connected Local Coder tool owner for coding dispatch, returns the real started
session/status before waiting for console completion, and stops only its own queued rails work.
Persisted run `deck_run_9u3wi67q` returned in about 26 seconds with Code Console session
`occ_1781418561747_1`, target root, OpenRouter/Kimi provider/model, and watch-surface message. The
Code Console task remained visible and running after chat returned, then exited code 0. Repeated
delivery to a running noninteractive task session still blocks loudly instead of reporting routed
success when `submitLine()` cannot deliver input.

The owned Coder Console route now wraps that existing dispatch path in a small coding-run lifecycle.
Each tool dispatch carries the user goal and compact generated SPEC, records explicit user approval,
returns a retrievable coding-run id with the asynchronous session status, and exposes
`GET /api/coder/openclaude/console/runs/:id` for final collection. The collector polls the existing
session manager after exit, returns a bounded transcript-based result honestly, validates a strict
CoderReport only when one is actually present, extracts bounded proof commands/files, and records
the terminal outcome to ThinkGraph when that existing write path succeeds. Vague coding requests
are blocked before `coder_console_task` dispatch; explicit execute/implement/apply/fix/proceed
language is required for the temporary approval path.

Persisted-canvas coding runs now carry a compact Mag One routing manifest and coding workflow
packet before Python planning. The manifest identifies the bus-connected Local Coder as the primary
`coding.execute` / `coding.inspect` owner, CodeGraph as required `code.context` support, ThinkGraph
as optional result memory, and `coder_console_task` as the single execution tool. Python rails use
the compact workflow packet instead of the large generic canvas prompt for clear coding intent and
return `MAGONE_CODING_DISPATCH_TIMEOUT_BEFORE_TOOL_CALL` after a bounded 45-second pre-tool budget
rather than waiting for the opaque outer backend abort.

Normal persisted canvases now carry an owned workspace root in the deck document so Mag One receives
the target root even when a specialized workbench is not active. Coding-run references and terminal
results update a cached Plan Surface execution state and TaskResult first; chat displays only a
compact mirror derived from that state. The Plan state retains the generated SPEC, coding run,
console session, target root, proof, blocker, ThinkGraph status, next needed action, and next SPEC
candidate.

## Code And Context Anchors

* `AGENTS.md`: execution law
* `PLAN.md`: living product route
* `skills/*.md`: reusable learning
* Codebase Memory MCP / CodeGraph: fresh code structure and anchors
* SkillGraph / Neo4j: reusable skill retrieval
* ThinkGraph: structured plan/job/report/proof memory
* PlanFlow: visible active planning and control surface
* `apps/backend/src/coder/openclaude/*`: current harness scaffolding to replace behind structured
  adapter contracts
* `apps/backend/src/contracts/coderContracts.ts`: validated CoderPacket/CoderReport and comparison
* `apps/backend/src/coder/localcoder/*`: real process-backed LocalCoder adapter and service
* `apps/backend/src/coder/openclaude/console/*`: OpenClaude Console Bridge session manager and Mag
  One task router
* `client/src/features/agentbuilder/console/*`: console panel, API client, and rail visibility rule
* `client/src/pages/agentbuilder.tsx`: current chat path that starts a Magentic-One deck run

## Durable Decisions

* The active CoderPacket prompt is both spec and task; spec and task files do not exist.
* PlanFlow shows active planning state, not document or skill libraries.
* CoderPacket in, CoderReport out is the adapter boundary.
* Chat-to-coder repeats only as bounded user-gated jobs; preparing a next job does not execute it.
* Real coder execution requires LocalCoder tool/runtime events and proof. A plain LLM response is
  not a coder run.
* The backend-owned LocalCoder CLI/process adapter is the active machine-facing boundary; gRPC is
  not wired.
* Fresh CBM is required before code edits.
* No stubs, fake fallbacks, silent fallbacks, hidden success, fake planning, or fake execution.
* Research is deferred, not deleted.

## Blockers

* CBM 0.6.1 exposes source root and indexed File inventory but no indexed revision/time or chunk
  count. The new inventory diagnostic detects missing/new-file risk and blocks freshness claims,
  but it cannot prove an index is current after files change unless CBM exposes a real revision or
  timestamp.
* The current persisted admin canvas connects ThinkGraph, KnowGraph, CodeGraph, Plan Agent, and
  Local Coder to five distinct Magentic bus handles. Research, WorldSignals, and Trading remain
  disconnected. The current canvas therefore satisfies the coding-workflow participant gate.
* The vendored-built LocalCoder CLI is ready and starts through the backend process adapter, but
  current and alternate-model read-only smokes return no valid CoderReport. Production MCP and
  explicitly disabled diagnostic MCP both time out for `gpt-5.1-chat-latest`, so MCP is not the
  differentiating blocker. The repeated missing-context-window warning remains correlated, not
  proven causal.
* Client TypeScript compile currently has unrelated existing `agentbuilder.tsx` type errors.
* The full AgentBuilder UI test suite is currently blocked before collection by an unresolved `d3`
  import in `client/src/components/worldsignal/crucixNativeRenderer.ts`.
* Refreshed CBM still omits `coder_console_task` and several Console Bridge boundary files. The
  lifecycle SPEC used the already-ready owned graph plus direct reads and did not run the older
  moderate-index scope helper because this job explicitly forbade indexing all or broadening CBM.
* Permission brokering for a long-running coder task remains deferred; permission requests stay
  visible in Code Console and are not auto-approved.

## Next Step

Run the complete persisted-canvas Mag One smoke and verify target-root propagation, TaskResult
creation in Plan Surface, and the compact chat mirror.
