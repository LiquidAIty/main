# LiquidAIty LocalCoder integration changes

This file records deliberate LiquidAIty changes to the vendored OpenClaude runtime. Changes belong here only when they extend an existing native runtime boundary, have a production caller, and have focused proof. Parallel runtimes, compatibility wrappers, speculative abstractions, and test-only production symbols are not acceptable.

## 2026-08-09 — provider-exposed reasoning over the existing gRPC stream

Purpose: allow LiquidAIty Main Chat to receive reasoning text that the configured provider already exposes through the native QueryEngine `thinking_delta` stream. This is the same provider call and the same `AgentService.Chat` stream as the visible answer.

Contract:

- `src/proto/openclaude.proto` adds `ReasoningDelta` to the existing `ServerMessage.event` union.
- `src/grpc/server.ts` validates a native `content_block_delta/thinking_delta` and forwards it as `{ text, source: "provider_exposed" }`.
- Reasoning is not reconstructed from answer text, persisted into the transcript, appended to `FinalResponse.full_text`, or displayed by LocalCoder.
- Providers that emit no native thinking delta emit no reasoning event. No fallback is invented.
- The existing text, progress, tool, completion, error, permission, and cancellation lanes are unchanged.

Production ownership:

```text
provider adapter
→ QueryEngine native thinking_delta
→ serializeProviderReasoningDelta
→ AgentService.Chat ReasoningDelta
→ LiquidAIty backend/browser transport
```

Focused proof:

- `src/grpc/server.test.ts` verifies exact native-delta acceptance, rejection of text/empty deltas, UTF-8 preservation through the real proto serializer, and the `reasoning` oneof identity.
- `bun test src/grpc/server.test.ts`
- `bun run typecheck`

Verification status on 2026-08-09:

- The real protobuf loader parsed `openclaude.proto` successfully (`PROTO_PARSE_OK`).
- LiquidAIty backend/browser focused tests passed: 21/21, including reasoning separation and authority-specific refresh behavior.
- LiquidAIty backend and client production typechecks passed; the client spec typecheck passed.
- The LocalCoder focused test command timed out after 120 seconds without producing output.
- The LocalCoder scripted typecheck timed out after 120 seconds without producing output; invoking its local `tsc.exe` directly also timed out after 180 seconds without a diagnostic.

The timeout is an unresolved package-runner/compiler verification blocker, not a passing result and not a reported assertion or type failure. Do not describe the LocalCoder change as package-green until those commands complete in the normal development runtime.

Removal rule: if QueryEngine stops producing native `thinking_delta` events or the LiquidAIty gRPC consumer is removed, delete the proto member, serializer, tests, and this entry together. Do not retain an unused reasoning compatibility lane.
