# Skill: Magentic-One Runtime

@skill id=magentic-one-runtime
@type Skill
@status active
@related_to context-packet
@related_to spec-as-prompt
@related_to coder-report-protocol
@requires fresh_cbm_index

## Vector Summary

Edit the Sol/Magentic-One runtime safely: preserve the real Microsoft AutoGen v0.4+ runtime
(source-editable autogen-agentchat), selected tools only, loud failures, and no fake outputs.
Required primitives must remain available for Fable wiring: MagenticOneGroupChat,
AssistantAgent-with-tools, Swarm, SocietyOfMindAgent, and UserProxyAgent.

## Procedure

1. Read `PLAN.md`, `AGENTS.md`, and the active CoderPacket prompt.
2. Refresh CBM and direct-read relevant runtime files.
3. Preserve the ReactFlow/TypeScript control plane, Node backend, and Python sidecar boundary.
4. Resolve only selected, enabled, schema-complete tools.
5. Run focused runtime tests and real smoke proof when execution behavior changes.
6. Return a structured CoderReport against the active prompt.

## LocalCoder Adapter Procedure

1. Treat `localcoder/` as a vendored runtime and preserve its deep internal names unless a bounded
   adapter change requires otherwise.
2. Use the real LocalCoder machine boundary for coder execution. Prefer its bidirectional gRPC
   service for backend orchestration because it exposes text, tool starts, tool results,
   permission requests, completion, and errors.
3. Keep the backend responsible for LocalCoder lifecycle, repository root, env, explicit model,
   MCP config, permission policy, event translation, and CoderReport assembly.
4. Accept one structured CoderPacket and return one structured CoderReport. Plain task/output is
   insufficient for the product adapter.
5. Stop after one job and return control to the user. Magentic-One/Sol may prepare one next
   CoderPacket but must not execute an uncontrolled recursive chain.
6. Prove that repository tools actually ran before claiming coder execution.

## LocalCoder Runtime Discovery Rule

Discover a runnable LocalCoder/OpenClaude command in this fixed priority order, and never
block a valid higher-priority command because of a lower-priority path's missing build:

1. Explicit env command: `LOCALCODER_COMMAND`, `LOCALCODER_BIN`, `OPENCLAUDE_COMMAND`,
   `OPENCLAUDE_BIN`. `*_COMMAND` is a full command line (tokenized, e.g. `node <bin>`); `*_BIN`
   is a single path. A `node <script>` form runs via `process.execPath`; an extensionless
   launcher on win32 is prefixed with `node`; a `.cmd`/`.bat` shim spawns with `shell: true`.
2. An `openclaude` already resolvable on `PATH`.
3. The built vendored runtime, gated only by `localcoder/{package.json,bin/openclaude,
   dist/cli.mjs,node_modules}`. Bun is build-time only and is NOT a runtime gate.
4. Otherwise return a loud blocked result listing exact missing deps plus a setup command.

Status detection must be token-free: resolve the command, then probe `--version` (fallback
`--help`) only. Never run a coding job during status. If safe detection fails, block with the
exact reason (`localcoder_safe_detection_failed: <command> (--version exit=N --help exit=M)`).
Required env (`OPENAI_API_KEY`, `OPENAI_MODEL`) is checked separately from command discovery.

@proof id=magentic-one-runtime.localcoder-discovery-safe-detection
With `LOCALCODER_COMMAND="node <repo>/localcoder/bin/openclaude"` but no built `dist/cli.mjs`,
`inspectRuntime` discovered the explicit command, ran only `--version`/`--help`, and returned
`ready:false` with `localcoder_safe_detection_failed: ... (--version exit=1 --help exit=1)` —
no coder job, no fabricated success.

@proof id=magentic-one-runtime.localcoder-json-envelope
A live `--print --output-format json --json-schema <CoderReport schema>` run of the built
vendored CLI returns `{"type":"result","subtype":"success",...,"structured_output":{...}}`.
The schema-validated CoderReport sits under the top-level `structured_output` key — the
adapter parser's first candidate — so no parser change was needed; it parsed to status
`succeeded` with the matching `coderPacketId` and `rawOutput` preserved. Use forward slashes in
`LOCALCODER_COMMAND` on Windows (`node C:/.../bin/openclaude`) to avoid backslash mangling.

## No-Edit Smoke Permission Rule

A no-edit/inspection CoderPacket must run read-only. The CLI's `--permission-mode plan`
explores with read tools but cannot invoke `Edit`/`Write`, so it is the correct mode for a
no-edit smoke against a live repo with uncommitted changes. The adapter now derives the
permission mode from the packet via `deriveLocalCoderPermissionMode`: `writeMode:'read-only'`
or any no-edit language in `forbiddenWork`/`stopConditions` -> `plan`; `writeMode:'edit'` ->
`acceptEdits`; ambiguous -> `plan` (conservative — a no-edit job can never silently gain edit
rights). Route tests force a broken `LOCALCODER_COMMAND` so they block during discovery and
never spawn a real coder.

## Chat-To-Active-Job Rule

Normal Agent Builder chat may run the real Magentic-One deck path first, then send real runtime
provenance and selected workspace context to a backend Context Packet/planning service. The backend
planner must be explicitly configured and schema-validated. PlanFlow receives one editable
CoderPacket and waits for user Go; neither chat nor the planner automatically executes LocalCoder.

## Explicit Sol Planner Configuration Rule

The coder planner may use `SOL_CODER_PLANNER_MODEL_KEY`, an explicit
`SOL_CODER_PLANNER_PROVIDER` + `SOL_CODER_PLANNER_MODEL_ID` pair, or an explicitly set
`SOL_PRIMARY=openai|openrouter` with its matching provider key. Do not call a role resolver that
defaults missing `SOL_PRIMARY`; resolve the explicitly selected provider through the real model
registry and persist the non-secret config source/provider/model provenance. Missing, conflicting,
or invalid configuration blocks before packet generation and ThinkGraph success persistence.

## MCP Config Normalization Rule

OpenClaude (`localcoder/src/services/mcp/types.ts`) discriminates MCP servers by a `type`
literal (`stdio`/`sse`/`http`/`ws`/...), NOT by `transport`, and `--strict-mcp-config` rejects
the whole config if any server fails the schema. The backend `apps/backend/mcp.config.json`
uses `transport` and `${ENV}` placeholders, so its sse/http servers were rejected. The adapter
now `prepareMcpConfig()`s before launch: map `transport`->`type`, keep only schema-valid
servers, resolve `${VAR}` from env and drop any with unresolved placeholders, drop stdio
servers whose command is not resolvable, then write a normalized temp `--mcp-config` and pass
`--strict-mcp-config` only when >=1 server survives. If none survive (or the file is
missing/unparseable) the run is MCP-less; either way the kept/dropped reason is recorded in the
CoderReport `assumptions` so it stays visible. Never pass a known-invalid config.

@proof id=magentic-one-runtime.localcoder-mcp-normalized-route-smoke
After normalization, a live read-only `POST /api/coder/localcoder/run` returned HTTP 200
`succeeded`, matching `coderPacketId`, `filesChanged:[]`, `matchesPacket:true`, repo path seen,
`rawOutput` preserved, and `assumptions` =
"localcoder_mcp_config_normalized: kept [filesystem, codebase-memory, tavily]; dropped:
github: unresolved env placeholder; supabase: unresolved env placeholder". No edits (plan
mode). This is the first green no-edit CoderPacket through the real backend route.

## Guardrails

@guardrail id=magentic-one-runtime.locked-v044-line
@guardrail id=magentic-one-runtime.no-banned-frameworks
@guardrail id=magentic-one-runtime.no-fake-runtime-success
@guardrail id=magentic-one-runtime.runtime-is-not-plan-authority
@guardrail id=magentic-one-runtime.selected-tools-only
@guardrail id=magentic-one-runtime.plain-llm-is-not-coder-execution
@guardrail id=magentic-one-runtime.localcoder-no-model-fallback
@guardrail id=magentic-one-runtime.user-gated-bounded-repeat

## Current Runtime Boundary

@proof id=magentic-one-runtime.localcoder-vendored-runtime
`localcoder/` exists without `localcoder/.git`; it includes repository tools, MCP support, and a
gRPC `AgentService.Chat` implementation.

@proof id=magentic-one-runtime.current-main-chat
Main Chat is a persistent Harness session: client session routes call the backend
`grpcChatClient`, which resolves the saved Main card's provider/model/tool grants and streams through
the vendored OpenClaude-derived gRPC server.

@proof id=magentic-one-runtime.current-openclaude-console
The direct OpenClaude Code console is a backend-owned persistent PTY/session with start, stream,
input, resize, interrupt, and stop behavior. It is a separate interactive product path from the
Local Coder card.

@proof id=magentic-one-runtime.current-localcoder
`run_local_coder` calls the backend LocalCoder service/adapter, which discovers the configured
OpenClaude CLI, binds it to the trusted repository/workspace scope, and accepts success only after a
validated CoderReport. It is not replaced by the persistent terminal.

@proof id=magentic-one-runtime.current-runtime-availability
The vendored runtime currently has `node_modules`, `dist/cli.mjs`, `bin/openclaude`, and Bun available.
Re-prove these facts before a live run rather than copying this statement into a CoderReport.

## Query Patterns

@query id=magentic-one-runtime.code-evidence "refresh CBM, search_graph for Magentic-One runtime, worker, and tool-registry symbols, then direct-read resolved files"
@query id=magentic-one-runtime.proof "run focused Python runtime tests, backend runtime tests, compile, and real smoke when execution behavior changes"
@query id=magentic-one-runtime.localcoder-adapter "trace chat to Magentic-One deck execution, OpenClaude routes to runLLM, and LocalCoder gRPC tool/permission events before changing the adapter"

## Clean Native Boundary — Outer Runtime Wrappers Removed (2026-06-28)

@guardrail id=magentic-one-runtime.no-outer-wrappers
A direct Mag One run is `incoming mission text + explicit card/deck config only → native
MagenticOneGroupChat → native Task Ledger → native team → result`. The backend runtime must
NOT layer any of the following onto native reasoning (all removed; do not reintroduce):

* Global backend persona — `MAG_ONE_CODING_RUN_SYSTEM_PROMPT` (and any universal coding/CBM/
  Plan-Agent system prompt prepended to every run). The system prompt is now EXACTLY the card's
  own `prompt`. A card may carry its own explicit prompt; the backend imposes none.
* Deterministic keyword routing — the `isGenericPrompt`/`isContinuation` classifier (`test`,
  `hello`, `hi`, `run`, `go`, `continue`, `approve`, `yes`) and any mutation of
  `priorAssistantText`/mission input. Mission input passes through unchanged.
* Native team mutation — the `resolveMagOneAgentRole(head) !== 'local_coder'` participant filter.
  The team is exactly the bus-connected, Python-callable cards (no role exclusion).
* Hidden graph injection — `buildGroundedTaskLedgerContext`/`renderTaskLedgerGroundingDirective`
  prose spliced into the system prompt and the `taskLedgerGroundingContext` payload field. (The
  future user-authored Plan attaches selected graph context explicitly; runtime never auto-injects.)
* Post-run PlanFlow projection — Python `_planflow_task_objects` and the
  `TaskLedgerArtifact.planFlowTaskObjects` / `PlanFlowTaskObject` contract branch. The native
  `taskLedgerArtifact` (facts/plan/team/taskLedger) is the task breakdown; no extra model call.
* Auto output-contract injection — `withMagenticTaskLedgerContractDefault` in the deck-run path.
  Only a card's own explicitly-set `taskLedgerOutputContract` (edited in the AgentManager "Objects"
  field) is transported; no hidden default is stamped at run time.

Keep intact: `MagenticOneGroupChat`, vendored AutoGen task-ledger prompt / `_get_task_ledger_plan_prompt`,
native `taskLedgerArtifact`, native execution, native team coordination, `buildTaskLedgerArtifactGraph`
(native display — degrades to an honest empty task graph when no artifact).

@proof id=magentic-one-runtime.wrappers-removed-audit `rg -c 'MAG_ONE_CODING_RUN_SYSTEM_PROMPT|withMagenticTaskLedgerContractDefault|_planflow_task_objects|PlanFlowTaskObject|isGenericPrompt|isContinuation' client/src apps/backend/src apps/python-models/app` → zero.
@proof id=magentic-one-runtime.wrappers-removed-compile backend `tsc -p apps/backend/tsconfig.app.json --noEmit`=0; client tsc = 4 pre-existing unrelated; `py_compile` ok.
@proof id=magentic-one-runtime.wrappers-removed-tests cards/runtime.spec.ts payload asserts (systemPrompt == card prompt, priorAssistantText preserved, coder participates, no grounding); deckRuntime.spec.ts 19/19; Python contracts/adapter/orchestrator 18/18.
@limitation id=magentic-one-runtime.full-live-run a full live MagenticOneGroupChat mission needs the Python rails service + a provider key + network (real billed calls); no offline full-run fixture exists. Highest-fidelity offline proof run instead: real adapter `_build_participants` + `taskLedgerArtifact` contract tests with a fake client.

## Backend Workspace Root Guardrail

@proof id=magentic-one-runtime.localcoder-root-resolution
The LocalCoder adapter walks upward from the backend process working directory to the repository
root before resolving `localcoder/`, backend env, and MCP configuration. Blocked reports return an
absolute setup command for the discovered LocalCoder root.

@guardrail id=magentic-one-runtime.localcoder-no-process-cwd-root
Do not assume the backend process working directory is the repository root.
