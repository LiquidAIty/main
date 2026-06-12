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
