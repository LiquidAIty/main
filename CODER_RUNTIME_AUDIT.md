# CODER_RUNTIME_AUDIT

Grounded findings from reading only `apps/backend/src/cards/runtime.ts`.

## Overview
The file implements the backend control-plane logic for running deck canvas cards as Python AutoGen/Magentic-One participants. It contains strictly typed, no-fallback resolvers for:
- Model configuration
- Tools selection
- Runtime graph construction
- Single-card execution
- Mag One orchestrator execution

All logic is grounded in the file and reflects explicit no-inference, no-classifier, no-fallback rules.

## Key Findings (Grounded)

### 1. Strict Model/Provider Resolution
- `resolveOrchestratorCardModel` and `resolveCardModelStrict` both enforce:
  - Required `modelKey`.
  - UI provider must match registry provider.
  - Throws errors directly (e.g., `card_model_config_missing`, `card_model_config_mismatch`).

### 2. Tools Resolution Is Hard-Fail Strict
- `resolveCardTools` only allows tools declared in `RUNTIME_TOOL_SPECS`.
- Empty tool names or unknown names fail immediately.
- No auto-injected tools.

### 3. Runtime Types Are Minimal and Controlled
- Only three recognized runtime types in this file: `assistant_agent`, `local_coder`, `magentic_one`.
- `isAssistLikeRuntimeType` gates which cards are callable by Python rails.

### 4. Magentic Option Bus Connectivity Is the Only Worker Activation Signal
- `resolvedMagenticOptions` selects nodes connected via edges whose `edgeType` normalizes to `magentic_option`.
- Filtering ensures: agent kind, no parentGraphId, allowed runtime types.
- No role inference, no worker ranking.

### 5. Runtime Graph Construction
`buildRuntimeGraph` builds a graph containing:
- Nodes for orchestrator, callable heads, and child subgraph nodes.
- Each node is annotated with:
  - `provider`, `providerModelId`, `runtimeType`, `tools`, `fanOut`, `isSocietyOfMind`, `prompt`, `role`.
- Edges include normalized `edgeType` and extracted loop configs (multiple fallbacks: `edge.loop`, `edge.data.loop`, `metadata.loop`, or loopMaxIterations → structured loop object).

### 6. Participant Serialization
- Two parallel shapes: `serializeCardParticipant` (public manifest) and `serializeCardPrivateParticipant` (private Python-only fields including the system prompt).
- Explicitly strips internal prompt text from the public participant.

### 7. PythonAutoGen Payload Construction
`buildPythonAutoGenCardRuntimePayload`:
- Generates session metadata.
- System prompt = **exact** card prompt (no injection or deterministic persona).
- Attaches supported heads (Python-callable only).
- Transmits `runtimeGraph`, participants, privateParticipants.
- Includes workspace context, prior assistant text, job handoff (if present).

### 8. Single Card Runtime Path (`runConfiguredCard`)
- Enforces strict argument key whitelist.
- Resolves model/tools exactly once and reuses the same resolvers as Mag One.
- Creates a dedicated returns folder under coder workspace.
- Logs decisive trace lines for binding, authority, and tools.
- Handles ThinkGraph authority by resolving runtime binding, with precedence for explicit `runAuthority`.

### 9. Python Invocation Behavior
- Uses `runSingleCardWithAutoGen` or `orchestrateWithAutoGen`.
- No retries, no fallbacks.
- Honest failure returned when Python rails return non-ok or errors.

### 10. Result Normalization
- Single-card → `ConfiguredCardRunResult` → `toAgentRunResult` → DeckRun output.
- Includes tool call counts parsed from transcript.
- Summaries built via `summarizeText`.

### 11. Discovery Mode / Locked Mode Behavior
- `runCardWithContract` checks for `discovery_proposal` mode.
- Enforces that Mag One requires at least one bus-connected worker unless in discovery mode.

### 12. Failure Conditions Exposed
The file explicitly throws or reports failures for:
- Missing modelKey
- Provider mismatch
- Empty or unknown tool names
- Disabled tools
- Missing bus participants
- Missing final text AND missing artifact
- Transport exceptions
- Disabled or non-runnable cards
- Override attempts (structural key mismatch)

## Security/Correctness Observations (Grounded)
- No dynamic code execution appears.
- No unsafe serialization: all values are primitive-validated or JSON-compatible objects.
- All fallbacks are intentionally removed.
- Strict access control for ThinkGraph authority via `resolveRuntimeBinding` and conversationId.
- Dedicated coder job-folder handoff paths are correctly isolated under the workspace root.

## Concluding Notes
All findings strictly come from the content of `runtime.ts` with no extrapolation. The file is a deterministic bridge between deck card definitions and the Python AutoGen/Magentic-One runtime.
