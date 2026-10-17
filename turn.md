# Next Turn — Remaining Refactor and Classification Queue

This is a forward scratchpad, not a history report or architecture authority.

## Current boundary

- Eligible first-party TypeScript/TSX/Python files: **358**.
- Truthfully classified with inline `Entity` / `Relationship` comments: **303 (84.6%)**.
- Still deliberately unclassified: **55**.
- Do not batch-generate, reclassify, or add companion metadata. Read and decide one source file at a time.
- A classification remains a passing grade: repair, split, or delete questionable code before tagging it.
- The owner confirmed the loaded application currently runs. Preserve that working boundary.
- One owner-requested Codebase Memory CLI reindex was already completed for this run. Do not reindex again without a new exact request.

## Explicitly deferred — do not open this boundary until the owner resumes it

WorldSignals, WorldView, and Shadowbroker work is deferred. When resumed, prove the existing first-party adapter before touching either controlled product.

- `client/src/components/worldsignal/worldSignalLayerPrefs.ts`
- `client/src/components/worldsignal/worldSignalLayerPrefs.spec.ts`
- `client/src/features/agentbuilder/rail/railVisibility.ts`
- `client/src/features/agentbuilder/rail/railVisibility.spec.ts`
- `client/src/features/worldview/projectWorldview.ts`
- `client/src/features/worldview/projectWorldview.spec.ts`
- `client/src/components/worldsignal/worldViewInspectorMount.spec.ts`
- `apps/python-models/app/python_models/project_worldview.py`
- `apps/python-models/app/python_models/test_project_worldview.py`
- `client/src/components/worldsignal/GodsEyeSurface.tsx`
- `client/src/components/worldsignal/GodsEyeSurface.spec.tsx`
- `client/src/features/agentbuilder/core/AgentBuilderWorkspace.spec.tsx`
- `client/src/features/agentbuilder/core/AgentBuilderRail.tsx`
- `client/src/features/agentbuilder/core/AgentBuilderRail.spec.tsx`
- `client/src/features/agentbuilder/core/useAgentBuilderWorkspaceLayout.ts`
- `client/src/features/agentbuilder/core/useAgentBuilderWorkspaceLayout.spec.tsx`
- `apps/python-models/app/python_models/signal_contracts.py`
- `apps/backend/src/routes/worldview.routes.spec.ts`
- `apps/backend/src/routes/worldviewRouteHandlers.ts`
- `client/src/components/worldsignal/loadWorldViewNative.ts`
- `client/src/components/worldsignal/loadWorldViewNative.spec.ts`
- `client/src/features/worldview/WorldViewSurface.tsx`
- `client/src/features/worldview/WorldViewSurface.spec.tsx`

Required later proof:

- WorldSignals: inspect the current command manifest, then prove one signed mainstream command, one refused specialist command, and one unknown-command refusal. Review the current startup HMAC handoff without creating, printing, rotating, or persisting another credential.
- WorldView: prove real module load, first frame or honest fallback, destruction, Project remount, command readiness, and image readiness before considering any controlled God’s Eye change.

## Confirmed cleanup or decision work before classification

1. Remove or merge duplicate and orphaned code:

   - `apps/python-models/app/python_models/test_agentgraph.py` duplicates the durable PostgreSQL/AgentGraph coverage; retain its unique URL-parsing assertion only if it is not covered elsewhere.
   - `client/src/components/builder/deckValidation.ts` has no production caller; determine whether its tested helpers belong in the real canvas owner or delete the file and test-only residue.
   - `client/src/components/diagnostics/FrontendCrashBoundary.tsx` has no production caller; either mount the one intended boundary or delete the orphan and its self-supporting test.

2. Split or simplify mixed authority:

   - `client/src/features/agentbuilder/deck/deckPrimitives.ts` mixes text helpers, model/tool defaults, runtime authority, edge normalization, cloning, and IDs. Separate only proven concepts and delete residue.
   - `apps/python-models/app/python_models/trading_forecast.py` mutates process-global import state for Kronos. Replace that with the supported package/process boundary or remove the unused path.
   - `apps/python-models/app/python_models/test_hermes_holographic_memory_contract.py` reaches into controlled Hermes through `sys.path` and module replacement. Prefer the existing Hermes-owned tests or an actual public adapter contract.

3. Remove false aliases and error-shaped layers:

   - `apps/backend/src/llm/models.config.ts` creates duplicate `Direct ID` aliases. Prove saved-data compatibility, then remove aliases rather than retaining two names for one model.
   - `apps/python-models/app/mcp_observability.py`
   - `apps/python-models/app/mcp_request_dispatch.py`
   - `apps/python-models/app/python_models/test_mcp_provider_dispatch_contract.py`
   - `apps/python-models/app/mcp_catalog_runtime.py`
   - `apps/python-models/app/python_models/test_mcp_catalog_runtime_contract.py`

   Audit these together for string/JSON-shaped failure inference, duplicate readiness state, or success-shaped projection. Keep real transport, auth, catalog, and provider behavior; delete the parallel interpretation layer and tests that only prove it.

4. Repair exact unsafe boundaries:

   - `apps/backend/src/routes/knowGraphWrite.routes.ts` string-classifies ingest failures and can project internal upstream details. Keep transport only and return bounded public errors from typed provider outcomes.
   - `services/knowgraph/jev_fact_settlement.py` needs deterministic duplicate/resume proof around Graphiti episode creation, authority metadata, and Jev settlement before it passes classification.

5. Resolve Run observation residue as one explicit contract:

   - `apps/python-models/app/python_models/agentgraph_run_observations.py`
   - `apps/python-models/app/python_models/test_agentgraph_inspection.py`
   - `apps/python-models/app/python_models/saved_card_contract.py`
   - `apps/python-models/app/python_models/test_agentgraph_card_topology.py`

   Reconcile the remaining accepted/started/preparation timestamp fields with the intended minimal Card-face and Run contract. AGE may observe real Runs, artifacts, tools, failures, and completion; it must not recreate a fake lifecycle surface.

6. Resolve saved-Card persistence policy before tagging:

   - `apps/python-models/app/python_models/saved_cards.py`
   - `apps/python-models/app/python_models/test_saved_cards.py`

   Preserve Project-scoped saved Card revisions and data. Resolve the current global logical-profile binding and fresh-Project seed ownership without adding aliases, a second library, or destructive migration.

## ThinkGraph completed-pair rail — retained but not yet a complete feature

The preparation and settlement rails remain source-owned, but automatic Main-pair capture has no approved Hermes caller. Do not claim the feature is current and do not reconnect the deleted TypeScript executor.

- `apps/python-models/app/python_models/thinkgraph_completed_pair_preparation.py`
- `apps/python-models/app/python_models/thinkgraph_completed_pair_extraction.py`
- `apps/python-models/app/python_models/thinkgraph_completed_pair_settlement.py`

Before classification, remove operating-policy prose from the extraction module if that policy belongs in the saved ThinkGraph Card, then prove the eventual caller through the approved saved per-Project control.

## Remaining large one-concept candidates

These were not failed. They simply need a complete one-file review before receiving a passing header. Start with the smallest and classify only if the file remains one coherent feature.

- `client/src/features/agentbuilder/tasks/MagneticTasksTab.tsx`
- `client/src/components/graph/RightGlassDrawer.tsx`
- `apps/python-models/app/python_models/engraphis.py`
- `apps/python-models/app/python_models/test_thinkgraph_hybrid.py`
- `apps/python-models/app/python_models/test_data_anchor.py`
- `apps/python-models/app/python_models/test_card_runs.py`
- `client/src/components/builder/BuilderCanvas.tsx`
- `client/src/components/knowledge/KnowledgeAuthorityGraphSurface.spec.tsx`
- `client/src/components/knowledge/KnowledgeAuthorityGraphSurface.tsx`

## Proof already clean at this checkpoint

- TypeScript source and spec checks: passed.
- TypeScript tests: **470 passed, 1 intentionally skipped**.
- Python rails tests: **508 passed**.
- KnowGraph tests: **31 passed** with one upstream Graphiti Pydantic deprecation warning.
- Backend and client production builds: passed; the existing God’s Eye browser-externalization and large-bundle warnings remain deferred with WorldView.
- Production dependency audit: **0 vulnerabilities**.
- `git diff --check`: passed; the existing PowerShell line-ending warning remains.

Do not infer external-provider, Magnetic mission, graph-write, or owner visual acceptance from these deterministic proofs.
