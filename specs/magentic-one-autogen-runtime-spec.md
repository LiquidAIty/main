# Magentic-One / AutoGen Runtime Spec

## Purpose

Define the correct Magentic-One / Sol runtime architecture before future runtime edits, so
bounded coding passes can move fast without smashing the runtime rails.

## Architecture

* Sol / Magentic-One is the front-door orchestration pattern. The UI front door stays the same.
* The model backend routes to cloud/API models normally; local Qwen 7B is the fallback backend
  when no API/internet/billing is available or the user chooses local. Model routing is not
  implemented by this spec.
* TypeScript/ReactFlow UI is the control plane. Node backend owns contracts and persistence.
* The Python sidecar owns real AutoGen runtime execution.
* AutoGen source-run / Magentic-One-style runtime is preferred: the locked line is Microsoft
  AutoGen v0.4.4 (`autogen_core` SingleThreadedAgentRuntime, RoutedAgent, FunctionTool;
  `autogen_magentic_one` LedgerOrchestrator, BaseWorker), adapted in
  `apps/python-models/app/python_models/magentic_runtime.py`.
* AgentChat, AutoGen Studio, Semantic Kernel, LangChain, and Microsoft Agent Framework are not
  part of this runtime unless a future explicit spec changes it.
* The Fable/OpenClaude-style coder is reached through bounded task handoffs, not uncontrolled
  chat.

## Runtime Rules

* Tool execution must use selected ToolSpecs resolved through the ToolRegistry
  (`specs/agent-runtime-primitives.md`); the agent card Tools tab is the only source of tool
  access. Python must not invent or guess tool names.
* Unknown, disabled, unselected, empty, or schema-missing tools fail loudly.
* Runtime failures must fail loudly. No fake `finalOutput`. No mocked sidecar success.
* No provider/model fallback unless explicitly specified.
* `current_datetime` and calculator behavior must remain real AutoGen FunctionTool execution, as
  already guaranteed by `specs/agent-runtime-primitives.md`.

## Current Repo Evidence

Direct-read on 2026-06-12:

* `apps/python-models/app/python_models/magentic_runtime.py` exists and documents the locked
  v0.4.4 primitive map (LedgerOrchestrator bus, CardWorkerAgent, FanOutWorkerAgent,
  SocietyOfMindWorkerAgent, GraphScheduler edge obligations).
* `apps/python-models/app/python_models/orchestration_contracts.py` exists.
* `apps/backend/src/contracts/runtimeContracts.ts` and `apps/backend/src/cards/runtime.ts` exist.
* `apps/python-models/app/python_models/tool_registry.py` does not exist yet: T001
  (ToolSpec/ToolRegistry) in `specs/agent-runtime-primitives.md` is still ready-for-fable.

## Clean Overlap

* This spec does not implement ThinkGraph or SkillGraph.
* Runtime work consumes the Skill Memory Packet
  (`specs/skill-packet-fable-handoff-spec.md`) and the Code Evidence Packet
  (`specs/codegraph-context-reader-spec.md`).
* ThinkGraph context later reaches this runtime only through the prompt writer / context builder
  (`specs/graph-context-prompt-writer-spec.md`), never by direct graph coupling.
* This spec is about correct runtime wiring and future-safe edits, not new features.

## Acceptance

* Future Magentic-One runtime edits must retrieve this spec and
  `skills/magentic-one-runtime-skill.md` before work.
* Future Fable prompts for runtime work must include the Skill Memory Packet and the Code
  Evidence Packet.
* Runtime edits must include proof commands and direct-read evidence; the existing
  `specs/agent-runtime-primitives.md` validation commands apply to ToolSpec/ToolRegistry work.

## Next Task

Plan the first bounded Magentic-One/AutoGen runtime audit or tiny runtime test using the seed
skill; do not start broad runtime edits from this spec alone.
