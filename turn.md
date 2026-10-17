# Next Turn — Frozen Crystallization Boundary

## Review status

**PASS for this PromptSpec stage.** The frozen implementation reaches the requested stopping condition: every remaining eligible file is explicitly decision-bound, live/deferred, or a structural refactor candidate. The repository map is intentionally incomplete rather than decoratively inflated.

- Base branch: `main`
- Base `HEAD`: `395dff3867c001e535264678b1534b3ac92cc51d`
- Frozen implementation paths changed relative to `HEAD`: **36** (`34` modified, `2` deleted), including the pre-existing dirty CBM artifact.
- Frozen implementation diff: **107,364 bytes**
- `FROZEN_IMPLEMENTATION_DIFF_SHA256`: `69a82c2e8b8d973ab88bdccc4f15e732e1341458bc690dad2a2980fee1abec8c`
- Digest definition: SHA-256 of the exact raw output of `git diff --binary HEAD` immediately after the Primary froze implementation and before this reviewer replaced `turn.md`.

## Exact semantic coverage

Inventory authority: current existing Git-tracked first-party `.ts`, `.tsx`, and `.py` files under `apps/`, `client/`, and `services/`, plus root `vite.config.ts`; `__init__.py`, controlled-vendor roots, and currently deleted paths are excluded.

- Eligible current files: **356**
- Classified files: **322 (90.4%)**
- Deliberately unclassified files: **34 (9.6%)**
- Reusable Entity vocabulary: **51**
- Single-Entity files: **296**
- Multi-Entity files: **26**
- Maximum pairs in one file: **3**
- Malformed or unmatched Entity/Relationship pairs: **0**
- Forbidden generic fallback Entities: **0**
- Exact duplicate Relationship prose: **0**
- Relationships outside the 12–40 word guidance: **0**

The prior `turn.md` checkpoint reported `358 / 303 / 84.6%`, but a deterministic read of the committed `HEAD` finds **301 classified files (84.1%)** and 57 unclassified files. The frozen delta is exactly **21 newly classified files plus two deleted unclassified files**, producing the verified current `356 / 322 / 90.4%`. Do not reuse the stale `303` starting count.

No Entity was added. The lone file-specific alias `Trading Project` was reconciled into the established `Trading` Entity, reducing the vocabulary from 52 to 51 without changing behavior.

## Remaining owner decisions and missing product prerequisites — 6 files

### AgentGraph Run chronology — owner decision required

- `apps/python-models/app/python_models/agentgraph_run_observations.py`
- `apps/python-models/app/python_models/test_agentgraph_card_topology.py`
- `apps/python-models/app/python_models/test_agentgraph_inspection.py`

Current-source reason: the observation writer persists `acceptedAt`, `preparationStartedAt`, `preparationEndedAt`, `preparationElapsedMs`, `preparationState`, `preparationError`, and `startedAt`; topology and inspection tests assert the same chronology. Classifying these files would silently approve that complete lifecycle contract. The owner previously rejected accepted/started presentation, while current repository law permits AGE to observe real Run events, so source alone cannot decide whether those fields remain internal observations or are removed entirely.

Smallest next action: decide the exact minimal AGE Run-observation schema. Then change the writer, inspection projection, and both focused test sections as one contract; prove existing Card topology, Run/artifact/tool/failure/completion observations; classify the three files only after that proof.

### ThinkGraph completed-pair intake — approved Hermes caller still missing

- `apps/python-models/app/python_models/thinkgraph_completed_pair_preparation.py`
- `apps/python-models/app/python_models/thinkgraph_completed_pair_extraction.py`
- `apps/python-models/app/python_models/thinkgraph_completed_pair_settlement.py`

Current-source reason: preparation validates one completed User/Main pair and builds Entity grounding plus a structured extraction request; extraction contains the structured output contract and semantic operating prompt; settlement atomically writes the resulting Thinks and Jev-classified relationships to Engraphis. The Python route exists, but no approved saved ThinkGraph Card caller currently connects completed Main pairs through Hermes. Directly calling these rails would restore the rejected bypass.

Smallest next action: approve the saved per-Project `Capture Main turns automatically` control and exact Hermes saved-Card caller. Keep semantic extraction instructions with the saved ThinkGraph Card where appropriate, execute one real completed User/Main pair, read the resulting Think back from Engraphis, and only then classify all three files.

## Deferred WorldView and WorldSignals seam — 25 files

- `apps/backend/src/routes/worldview.routes.spec.ts`
- `apps/backend/src/routes/worldviewRouteHandlers.ts`
- `apps/python-models/app/python_models/project_worldview.py`
- `apps/python-models/app/python_models/signal_contracts.py`
- `apps/python-models/app/python_models/test_project_worldview.py`
- `client/src/components/worldsignal/GodsEyeSurface.spec.tsx`
- `client/src/components/worldsignal/GodsEyeSurface.tsx`
- `client/src/components/worldsignal/loadWorldViewNative.spec.ts`
- `client/src/components/worldsignal/loadWorldViewNative.ts`
- `client/src/components/worldsignal/worldSignalLayerPrefs.spec.ts`
- `client/src/components/worldsignal/worldSignalLayerPrefs.ts`
- `client/src/components/worldsignal/worldViewInspectorMount.spec.ts`
- `client/src/features/agentbuilder/core/AgentBuilderRail.spec.tsx`
- `client/src/features/agentbuilder/core/AgentBuilderRail.tsx`
- `client/src/features/agentbuilder/core/AgentBuilderWorkspace.spec.tsx`
- `client/src/features/agentbuilder/core/useAgentBuilderWorkspaceLayout.spec.tsx`
- `client/src/features/agentbuilder/core/useAgentBuilderWorkspaceLayout.ts`
- `client/src/features/agentbuilder/rail/railVisibility.spec.ts`
- `client/src/features/agentbuilder/rail/railVisibility.ts`
- `client/src/features/worldview/WorldViewSurface.spec.tsx`
- `client/src/features/worldview/WorldViewSurface.tsx`
- `client/src/features/worldview/projectWorldview.spec.ts`
- `client/src/features/worldview/projectWorldview.ts`
- `client/src/worldview-native.d.ts`
- `vite.config.ts`

Current-source reason: these files are one connected first-party seam. Root Vite configuration supplies the controlled test module doorway; the declaration and loader define the mounted God’s Eye contract, frame/fallback readiness, commands, images, and destruction; the surface, rail, layout, and preference files mount it into the application; backend handlers correlate Project-and-Card-scoped actions and capabilities; Python validates Project WorldView state and WorldSignals contracts. Truthful classification depends on the already deferred loaded boundary, not more source-only labels.

Smallest next action after the owner resumes this boundary:

1. Inspect the current WorldSignals command manifest and existing startup credential handoff without creating, printing, rotating, or persisting another credential.
2. Prove one signed mainstream command, one refused specialist command, and one unknown-command refusal.
3. Prove WorldView module load, first rendered frame or honest fallback, destruction, Project remount, command readiness, and image readiness.
4. Re-read and classify these 25 first-party files. If source proves that a controlled God’s Eye or Shadowbroker change is unavoidable, stop for a separate vendored-change authorization and divergence record.

No controlled-vendor file was changed in the frozen implementation.

## Structural refactor candidates — 3 files

### Shared knowledge surface and its specification

- `client/src/components/knowledge/KnowledgeAuthorityGraphSurface.tsx`
- `client/src/components/knowledge/KnowledgeAuthorityGraphSurface.spec.tsx`

Current-source reason: the 2,643-line production file is one real shared inspector surface, but it contains independently testable projection/join composition, Jev Focus preparation and validation, presentation persistence/material settings, citation/evidence presentation, and the stateful renderer/inspector. The 1,600-line specification mirrors those boundaries. Assigning several headers to both files would conceal the current structural problem; splitting by line count or creating multiple product surfaces would also be wrong. The frozen repair only corrected the documented KnowGraph-first default when a joined Entity has both authorities.

Smallest next action: extract only pure contracts that already have independent tests and reasons to change, while preserving one unchanged shared graph/inspector component, its mounts, renderer, storage keys, and visual behavior. Move the corresponding test sections with each extracted contract, rerun the complete client suite, then perform a loaded visual regression before classification.

### Cross-authority Data Anchor specification

- `apps/python-models/app/python_models/test_data_anchor.py`

Current-source reason: this 1,120-line test module covers distinct owners: ThinkGraph exact reads and handoffs, KnowGraph Entity/Know projection and provenance, canonical Entity-directory validation, CodeGraph MCP reads, and IDF Data Anchor materialization. Six Entity labels on one test file would document the mixing rather than resolve it.

Smallest next action: split the tests along the existing production-owner boundaries without changing fixtures or expectations; run every resulting focused module plus the full Python rails suite; classify each new cohesive test file only after it passes.

## Frozen completed boundary

- Removed the uncalled `deckValidation.ts` path after moving its one live edge-identity rule into `BuilderCanvas.tsx`; exact residue search is clean.
- Removed duplicate `test_agentgraph.py`; its unique real libpq URL-parsing proof now lives in `test_postgres.py`.
- Deleted disconnected BuilderCanvas helper/test families while preserving the mounted Canvas contract.
- Removed duplicate Direct ID selector aliases and synthetic unknown defaults while retaining unavailable saved model selections in the Card editor.
- Redacted query strings and fragments from copyable frontend crash locations.
- Replaced KnowGraph failure-body projection with bounded status/code outcomes in the backend and bounded code handling in the uploader.
- Removed MCP prose/JSON error inference; protocol-declared `CallToolResult.isError` and structurally created application errors now own success or failure.
- Isolated Kronos package loading under a private package name without changing `sys.path` or the top-level `model` module.
- Isolated the controlled Hermes holographic-memory proof in a subprocess rather than mutating the parent test interpreter.
- Preserved Graphiti-backed KnowGraph and Engraphis-backed ThinkGraph as LiquidAIty features; no second graph authority, runtime, route, registry, parser, queue, scheduler, or metadata store was added.

## Proof boundary

### Source and structure — PASS

- Complete frozen diff reviewed; every changed executable hunk is bounded to the listed repair classes.
- Two deleted paths have no surviving source references.
- No added files, controlled-vendor edits, generic Entity, malformed pair, legacy fake metadata block, or `Trading Project` Entity residue.
- `git diff --check`: passed.
- `HEAD` remained unchanged; no commit or push occurred in this run.
- `.codebase-memory/artifact.json` was already dirty at run start and remains index-generated metadata. The run record contains one explicit authorized CLI reindex; no second lifecycle command or CBM repair was introduced.

### Deterministic — PASS

Primary freeze evidence:

- `typecheck:all`: passed.
- Vitest: **77 passed / 1 skipped files; 471 passed / 1 skipped tests**.
- Python rails: **507 passed** in 45m16s, with one upstream Graphiti/Pydantic deprecation warning.
- KnowGraph service package: **31 passed** with the same upstream warning. These are tests of LiquidAIty's Graphiti-backed KnowGraph service; they were executed with the Python-rails test interpreter because `services/knowgraph/.venv` lacks pytest. That interpreter choice is test tooling, not another KnowGraph authority or implementation.
- Backend and client production builds: passed; the existing deferred God’s Eye `node:fs` browser-externalization and large-chunk warnings remain with the frozen WorldView boundary.
- Python compileall: passed.
- Focused KnowGraph write route: **7 passed**.
- Focused MCP contracts: **35 passed**.

Independent reviewer replay against the frozen snapshot:

- KnowGraph write route plus shared knowledge-surface specification: **46 passed**.
- MCP provider/catalog/streamable-HTTP contracts: **35 passed**, same upstream deprecation warning.
- Hermes memory isolation, Trading/Kronos isolation, and PostgreSQL boundary: **15 passed**.
- BuilderCanvas, crash diagnostics, model configuration, and Card-options projection: **39 passed**.

### Loaded health — PASS, narrow only

- Frontend HTTP: **200**.
- Backend `/api/health`: **200**.
- This proves process health only; it does not prove a new loaded Card turn, external provider call, graph write, Magnetic mission, persistence mutation, or current visual acceptance.

### Higher proof tiers — NOT RUN / NOT CLAIMED

- Live saved Card or model behavior: not run.
- External-provider acceptance: not run.
- Persistence/readback for changed behavior: not run; the deterministic changes did not authorize a saved-state mutation.
- Visual inspection and owner visual acceptance: not run.

## Next-turn rule

Start with one of the three exact groups above. Do not reopen the 322 classified files for wording cleanup, do not reindex CBM without a new exact owner instruction, and do not add the future CodeGraph UI until the remaining source map is stable.
