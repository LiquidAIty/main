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

1. **User chat**: the user describes the desired outcome normally.
2. **Magentic-One / Sol**: the planner initiates context gathering, reasons over the project, and
   proposes the next bounded job.
3. **Context Packet**: the planner receives current user input, PlanFlow state, this living plan,
   ThinkGraph memory, fresh CodeGraph/CBM evidence, relevant SkillGraph memory, and KnowGraph
   research only when relevant.
4. **CoderPacket**: the planner creates one reviewable active job contract, shaped like a temporary
   execution spec.
5. **User Go**: after review or edits, the user sends the CoderPacket through a coder adapter.
6. **CoderReport**: the coder returns structured results and proof, not a vague done message.
7. **Comparison**: PlanFlow compares CoderReport against CoderPacket and exposes matches, misses,
   changes, blockers, proof, and next step.
8. **Memory**: ThinkGraph records the job and outcome; reusable learning updates skills; the next
   job is prepared.
9. **Bounded repeat**: Magentic-One/Sol may prepare exactly one next CoderPacket, but execution
   stops for user review and Go. The coding loop is iterative, not uncontrolled recursion.

## Product Parts

### User Chat

User chat is the front door. The user describes goals, changes, problems, and constraints in normal
language. Chat starts planning; it is not a prompt-template editor.

### Magentic-One / Sol

Magentic-One/Sol is the planner and thinking agent. It starts from user chat, initiates the Context
Packet pull, and uses current plan state, reasoning memory, relevant skills, fresh code evidence,
and user input to choose the next bounded job. It must not fake repository understanding,
planning, execution, or success.

### PlanFlow

PlanFlow is Magentic-One/Sol's visible thinking and control surface.

PlanFlow shows the living plan, current active job prompt when one exists,
run/report status, blockers, proof summary, and next step. It may expose selected supporting
evidence on demand.

PlanFlow is not a document map, spec library, skill library, markdown graph, set of road signs,
fake planner summary, or fake execution preview. It does not show every spec, skill, or document.

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

Fresh code evidence is core. Magentic-One/Sol uses CBM/CodeGraph to create code anchors and bound
the active job. The coder also uses Codebase Memory directly while working. CBM is a structural map;
direct reads, tests, compile output, and real smoke results win when they disagree.

### SkillGraph / Neo4j / skills/*.md

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

The preferred real adapter foundation is LocalCoder's bidirectional gRPC `AgentService.Chat`
boundary because it streams text, tool starts, tool results, permission requests, completion, and
errors. The backend must own its lifecycle, environment, repository root, permission policy, MCP
configuration, event translation, and structured report assembly. The current gRPC implementation
still needs that host hardening: its start script is not supervised by the backend or passed the
backend MCP config, it may hydrate a saved provider profile, the server currently initializes with
no MCP clients, exposes the runtime's available tools without a CoderPacket access-policy mapping,
and emits a final text response rather than a CoderReport.

## Current Route

1. Make this living plan and `AGENTS.md` the clear product and execution law.
2. Use one active CoderPacket prompt as both the current spec and task; keep no spec or task files.
3. Wire PlanFlow around the living plan, one active CoderPacket, CoderReport comparison, blockers,
   proof, and next step.
4. Have Magentic-One/Sol initiate Context Packet assembly from ThinkGraph, SkillGraph/Neo4j,
   CodeGraph/CBM, and relevant KnowGraph context.
5. Define backend-owned CoderPacket, CoderRunEvent, permission-decision, and CoderReport transport
   contracts.
6. Replace the current plain-LLM OpenClaude run facade with a real LocalCoder gRPC adapter using
   the backend-owned environment, repository root, MCP configuration, explicit model, and explicit
   permission policy.
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
launching, and OpenClaude provider/model resolution no longer silently falls back. In the current
workspace the real LocalCoder route correctly returns blocked because Bun, LocalCoder dependencies,
and built `dist/cli.mjs` are absent.

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

## Code And Context Anchors

* `AGENTS.md`: execution law
* `PLAN.md`: living product route
* `skills/*.md`: reusable learning
* Codebase Memory MCP / CodeGraph: fresh code structure and anchors
* SkillGraph / Neo4j: reusable skill retrieval
* ThinkGraph: structured plan/job/report/proof memory
* PlanFlow: visible active planning and control surface
* `localcoder/src/grpc/server.ts` and `localcoder/src/proto/openclaude.proto`: preferred real
  LocalCoder adapter boundary
* `apps/backend/src/coder/openclaude/*`: current harness scaffolding to replace behind structured
  adapter contracts
* `apps/backend/src/contracts/coderContracts.ts`: validated CoderPacket/CoderReport and comparison
* `apps/backend/src/coder/localcoder/*`: real process-backed LocalCoder adapter and service
* `client/src/pages/agentbuilder.tsx`: current chat path that starts a Magentic-One deck run

## Durable Decisions

* The active CoderPacket prompt is both spec and task; spec and task files do not exist.
* PlanFlow shows active planning state, not document or skill libraries.
* CoderPacket in, CoderReport out is the adapter boundary.
* Chat-to-coder repeats only as bounded user-gated jobs; preparing a next job does not execute it.
* Real coder execution requires LocalCoder tool/runtime events and proof. A plain LLM response is
  not a coder run.
* LocalCoder gRPC is the preferred first machine-facing adapter foundation; terminal remains an
  optional interactive surface.
* Fresh CBM is required before code edits.
* No stubs, fake fallbacks, silent fallbacks, hidden success, fake planning, or fake execution.
* Research is deferred, not deleted.

## Blockers

* Codebase Memory 0.6.1 initially missed an untracked-only planning-service addition during a
  no-op moderate refresh. After tracked graph-context files changed, a real moderate refresh moved
  the graph from 4,640 nodes / 8,596 edges to 4,676 / 8,784 and indexed the previously missing
  planning-service symbols. This indicates an untracked-only/cache invalidation miss, not a
  committed-HEAD-only index. `detect_changes` reports worktree differences from HEAD, while
  `index_status` exposes no indexed revision/time, so freshness remains unverified when changes
  exist.
* The live prepare smoke exposed a non-critical KnowGraph Cypher failure: its DISTINCT/aggregation
  query orders by `n.updated_at` / `n.created_at` after `n` is no longer in scope. The timeout and
  diagnostic boundary kept this visible without blocking the active CoderPacket.
* The Local Coder card currently maps to a generic assistant participant.
* The LocalCoder gRPC launcher is not backend-supervised and is not passed the backend MCP config.
* The LocalCoder gRPC server currently initializes `mcpClients: []`, exposes available runtime
  tools without mapping CoderPacket access policy, and returns final text rather than CoderReport.
* LocalCoder dependencies/build output are absent in this workspace and Bun is not installed, so
  the real LocalCoder process route cannot be live-smoked yet.
* Client TypeScript compile currently has unrelated existing `agentbuilder.tsx` type errors.
* The full AgentBuilder UI test suite is currently blocked before collection by an unresolved `d3`
  import in `client/src/components/worldsignal/crucixNativeRenderer.ts`.

## Next Step

Fix and prove the bounded KnowGraph Context Packet query exposed by the live source diagnostic,
then add a narrow CBM freshness proof that exposes the indexed revision/time or reliably
invalidates untracked-only additions.
