# Skill: Magentic-One Runtime

@skill id=magentic-one-runtime
@type Skill
@status active
@related_to context-packet
@related_to spec-as-prompt
@related_to coder-report-protocol
@requires fresh_cbm_index

## Vector Summary

Edit the Sol/Magentic-One runtime safely: preserve the real Microsoft AutoGen v0.4.4 runtime,
selected tools only, loud failures, and no fake outputs.

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

## Verified Adapter Audit

@proof id=magentic-one-runtime.localcoder-vendored-runtime
`localcoder/` exists without `localcoder/.git`; it includes repository tools, MCP support, and a
gRPC `AgentService.Chat` implementation.

@proof id=magentic-one-runtime.current-openclaude-facade
Current backend headless and terminal OpenClaude modes both call `runLLM(request.task)` and return
plain output; neither invokes the vendored LocalCoder coding runtime.

@proof id=magentic-one-runtime.current-chat-gap
Current Agent Builder chat starts a Magentic-One deck run directly, while the dedicated OpenClaude
routes remain isolated and the Local Coder participant is mapped to a generic assistant.

@proof id=magentic-one-runtime.preferred-adapter-boundary
`localcoder/src/proto/openclaude.proto` and `localcoder/src/grpc/server.ts` expose bidirectional
events required for a real backend-owned CoderPacket-to-CoderReport adapter.

@proof id=magentic-one-runtime.grpc-hardening-required
Current LocalCoder gRPC startup is not backend-supervised or passed backend MCP config; its server
uses no MCP clients, exposes available runtime tools without a CoderPacket access-policy mapping,
and emits final text rather than a CoderReport.

@proof id=magentic-one-runtime.audit-smoke-blocked
The workspace has no `localcoder/node_modules`, no `localcoder/dist/cli.mjs`, and no installed Bun
command, so vendored build/typecheck/runtime smoke is blocked until dependencies/runtime are
restored.

## Query Patterns

@query id=magentic-one-runtime.code-evidence "refresh CBM, search_graph for Magentic-One runtime, worker, and tool-registry symbols, then direct-read resolved files"
@query id=magentic-one-runtime.proof "run focused Python runtime tests, backend runtime tests, compile, and real smoke when execution behavior changes"
@query id=magentic-one-runtime.localcoder-adapter "trace chat to Magentic-One deck execution, OpenClaude routes to runLLM, and LocalCoder gRPC tool/permission events before changing the adapter"

## First Real LocalCoder Adapter Attempt

@attempt id=magentic-one-runtime.first-localcoder-process-adapter
@status succeeded
@source_prompt "implement the first real LiquidAIty chat-to-coder loop by wrapping the existing LocalCoder foundation"
@requires_fresh_cbm true

@attempt_result id=magentic-one-runtime.first-localcoder-process-adapter
@status succeeded
@cbm_before nodes=4650 edges=8255
@cbm_after nodes=4620 edges=8499
@proved_by validated CoderPacket and CoderReport contracts with packet/report comparison
@proved_by authenticated POST /api/coder/localcoder/run invokes the real vendored LocalCoder noninteractive entrypoint or returns exact blocked dependencies
@proved_by old plain-task OpenClaude run returns 410 and terminal mode never reports used without launch
@proved_by strict OpenClaude provider/model resolution has no silent fallback
@validated_by 58 focused backend checks and clean backend TypeScript compile
@blocked_by live LocalCoder smoke requires Bun, localcoder/node_modules, and localcoder/dist/cli.mjs
@guardrail localcoder process start and parsed CoderReport are required before success
@guardrail keep CoderPacket as the only active spec/task and stop after one job
@touches_code apps/backend/src/contracts/coderContracts.ts
@touches_code apps/backend/src/coder/localcoder/adapter.ts
@touches_code apps/backend/src/coder/localcoder/service.ts
@touches_code apps/backend/src/routes/coder.routes.ts
@touches_code apps/backend/src/coder/openclaude/provider/openai53.ts
@touches_code apps/backend/src/coder/openclaude/runtime/headless.ts
@touches_code apps/backend/src/coder/openclaude/runtime/terminal.ts
@touches_code apps/backend/scripts/openclaude-terminal-launch.ps1

## Backend Workspace Root Guardrail

@proof id=magentic-one-runtime.localcoder-root-resolution
The LocalCoder adapter walks upward from the backend process working directory to the repository
root before resolving `localcoder/`, backend env, and MCP configuration. Blocked reports return an
absolute setup command for the discovered LocalCoder root.

@guardrail id=magentic-one-runtime.localcoder-no-process-cwd-root
Do not assume the backend process working directory is the repository root.
