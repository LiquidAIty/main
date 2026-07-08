---
id: feature.coder-to-mag-one-handoff
title: Coder to Mag One Handoff
kind: feature
status: partial
proof_level: cbm_anchor_verified_and_source_verified

cbm:
  project_identity: C-Projects-main
  index_root: C:/Projects/main
  full_index_nodes: 5849
  full_index_edges: 11002
  freshness: ready

roots:
  files:
    - apps/backend/src/coder/openclaude/mcp/liquidAItyAgentFlow.ts
    - apps/backend/src/cards/runtime.ts
    - apps/backend/src/coder/workspaceRoot.ts
    - apps/python-models/app/python_models/job_folder.py
    - apps/python-models/app/python_models/coder_job_tools.py
    - apps/python-models/app/python_models/magentic_agentchat.py
    - apps/python-models/app/python_models/tool_registry.py
  symbols:
    - runMagOne
    - runCardWithContract
    - resolveCoderWorkspaceRoot
    - write_mag_one_instructions
    - write_return_file_tool
    - write_handoff_prompt
    - read_handoff_prompt
    - resolve_job_folder
  tests:
    - test_coder_job_tools.py
---

# Coder to Mag One Handoff

## What this is

When the Coder needs work done that requires the Mag One team (orchestrator + connected
workers), Harness / the packet-builder writes a Magnetic One variable context packet
into `C:/Projects/main/coder-workspace/handoff/<jobId>/prompt.md`, then calls
`run_mag_one` with the shared `jobId`. The Python rails read the exact bytes from
that file as the run task — no wrapping, no rewriting. Return artifacts land in
`C:/Projects/main/coder-workspace/returns/<jobId>/<card-id>/...` for inspection.
Repo-root `handoff/` was useful for earlier proof artifacts, but it is not the
backend `run_mag_one` jobId consumption path.

`prompt.md` is a run-specific packet, not a durable configuration store. Agent cards
own durable constants: system prompt/role definition, model/provider, selected tools,
durable role/purpose, standing constraints, output expectations, graph write
permissions, tool permissions, runtime binding, and card-specific behavior rules.
Runtime hooks enforce invariants such as packet existence/readback, card-owned tool
access, explicit commit/push permission, graph write ownership, CodeGraph as
measurement-only, and no hidden model/tool fallback. `prompt.md` owns only variables
selected for this run: job/project ids, current ask, current task focus, selected
summaries, scoped graph context pointers, CBM/CodeGraph anchors, dirty overlay,
runtime facts, and relevant wiki/skill/file anchors.

## How it works

```
Harness / packet-builder writes handoff packet:
  model uses the native file writer or write_mag_one_instructions tool
    → jf.write_handoff_prompt(folder, instructions)   [job_folder.py:96]
      → writes to: coder-workspace/handoff/<jobId>/prompt.md (utf-8, exact bytes)
    → also creates: coder-workspace/returns/<jobId>/ directory

Coder triggers Mag One:
  run_mag_one({ jobId, projectId, deckId })            [liquidAItyAgentFlow.ts:142]
    → jobId wins over promptMarkdown (line 159-163)
    → resolveCoderWorkspaceRoot()                       [workspaceRoot.ts:22]
      → <repo-root>/coder-workspace (C:/Projects/main/coder-workspace)
    → runCardWithContract(orchestrator, {}, '', {       [runtime.ts:737]
        jobHandoff: { workspaceRoot, jobId }
      })
      → Python run_native_magentic_mission              [magentic_agentchat.py:447]
        → jf.read_handoff_prompt(folder)                [job_folder.py:108]
          → reads handoff/<jobId>/prompt.md EXACT bytes
          → task = those packet bytes (never chat text/rewrite)
        → arms write_return_file per participant via JOB_RETURN_ROOT ContextVar
        → runs Mag One with the exact prompt

Return artifacts:
  workers call write_return_file(card_id, path, content) [tool_registry.py:378]
    → writes to coder-workspace/returns/<jobId>/<card-id>/<path>
    → NOT registered in card tool registry — only available inside handoff run
  RunMagOneResult returns:
    returnsDir: "returns/<jobId>/"
    returnedFiles: ["returns/<jobId>/<card-id>/<path>", ...]
    returnStatus: "return_files_created" | "no_return_files_created"
    status: "completed" | "partial" | "failed"
```

## Must not break

1. Handoff packet is byte-exact — `write_handoff_prompt` writes utf-8 bytes to
   `handoff/<job-id>/prompt.md`; `read_handoff_prompt` reads them back as exact bytes.
   No wrapping, no LLM-authored rewriting.
2. jobId wins over promptMarkdown — if both are supplied, `runMagOne` picks jobId
   (line 159-163). The on-disk file is always the contract.
3. Coder workspace is server-owned — `resolveCoderWorkspaceRoot` returns
   `<repo-root>/coder-workspace`, never a client path. All handoff/ and returns/ are
   contained inside it.
4. write_return_file is scoped to one agent's card — the `card_id` is injected from
   the trusted run context, never from the model argument. No agent can write into
   another agent's folder.
5. `JOB_RETURN_ROOT` ContextVar — if not set (call outside a handoff run), the tool
   returns `job_return_authority_missing` error. Honest degrade.
6. Route completion must surface handoff metadata. After artifact creation, `runMagOne`
   returns `completed` or structured `partial`/`failed` metadata instead of hiding useful
   return files behind a generic 502.
7. Active coding target: `C:/Projects/main` is the canonical LiquidAIty repo root.
   `coder-workspace/` is the Coder's workspace (not a sandbox).
8. `prompt.md` context pointers are scoped read handles, not graph authority. Mag One
   does not gain raw graph DB access, graph write permission, arbitrary query access,
   or generic graph-delta behavior from the packet.
9. CodeGraph/CBM anchors are measurement-only pointers. CodeGraph is written only by
   indexing/measuring source code, never manually by Mag One or planning agents.
10. Tools are bound to saved cards and runtime validation, never granted by
    `prompt.md` or inferred from user wording. Hooks may deny invalid calls, but must
    not become phrase-based routers or deterministic intent classifiers.

## Start in CBM

```
index_status(project="C-Projects-main")
search_graph(project="C-Projects-main", name_pattern="^runMagOne$")
search_graph(project="C-Projects-main", name_pattern="^runCardWithContract$")
search_graph(project="C-Projects-main", name_pattern="^run_native_magentic_mission$")
search_graph(project="C-Projects-main", name_pattern="^write_return_file_tool$")
```

## Valid proof

```python
import app.python_models.job_folder as jf

folder = jf.resolve_job_folder("<root>", "test-run-1", create=True)
jf.write_handoff_prompt(folder, "# Task\nbuild X\n")
assert jf.read_handoff_prompt(folder) == "# Task\nbuild X\n"
assert folder.handoff_rel == "handoff/test-run-1/prompt.md"
```

Proves: handoff prompt is written and read back with exact bytes, paths are
workspace-contained.

Minimal packet shape:

```markdown
---
jobId: test-run-1
projectId: project-id
createdBy: harness_packet_builder
packetKind: magnetic_one_context
cbm:
  project: C-Projects-main
  status: ready
  changedCount: 0
contextPointers:
  - id: tg-focus
    graph: thinkgraph
    mode: read
    purpose: selected planning context
    scope:
      projectId: project-id
      featureIds: [feature.coder-to-mag-one-handoff]
      files: [apps/python-models/app/python_models/job_folder.py]
      symbols: [read_handoff_prompt]
      maxDepth: 1
      maxNodes: 12
      maxTokens: 1200
anchors:
  wiki: [wiki/coder-to-mag-one-handoff.md]
  skills: [skills/cbm-graph-reader-skill.md]
  files: [apps/python-models/app/python_models/job_folder.py]
  symbols: [read_handoff_prompt]
---

# Current ask

Run-specific goal.
```

Do not put durable constants in this packet: system prompts, output contracts,
allowed/denied tools, standing constraints, model/provider choices, agent role
definitions, fallback behavior, or permanent graph write policy.

One-line law: cards define capability; hooks enforce invariants; `prompt.md` supplies
selected run context.

Runtime proof, 2026-07-07:

- `run_mag_one` consumed jobId `magone_trading_research_completion_20260707_2352`
  from `coder-workspace/handoff/<jobId>/prompt.md`.
- Route returned `ok:true`, `result.status:completed`, `returnStatus:return_files_created`.
- `returnedFiles` included
  `returns/magone_trading_research_completion_20260707_2352/card_plan_agent/trading_intelligence_research_plan.md`.
- `read_model_results` returned `artifact_read` for that artifact (`10895` bytes).
- Late abort after artifact creation is covered as structured `partial` success.
- Process proof detected no Local Coder and no native `openclaude --print`.

## Limitations

- **Handoff flow is persistence/proven, not CBM-path-proven.** The Python functions
  (`write_handoff_prompt`, `read_handoff_prompt`, `resolve_job_folder`) are not
  resolved by CBM trace_path — they are source-verified via file reads.
- **TypeScript↔Python boundary** at `runCardWithContract` → `runSingleCardWithAutoGen`
  → Python `run_native_magentic_mission` is source-verified, not CBM-path-proven.
- **No cleanup guarantee.** `handoff/` and `returns/` directories accumulate on disk.
  No evidence of automatic cleanup after a handoff run completes.
- **workspaceRoot is best-effort.** `mkdirSync` in `resolveCoderWorkspaceRoot` uses
  try/catch — a disk-write failure degrades silently to a missing directory, and the
  Python job-folder resolver re-validates independently (catching `FileNotFoundError`).
- **Graph/research tools inside Mag One are still unproven.** The route and artifact
  handoff are proven. The packet may point to selected graph context, but it does not
  grant raw ThinkGraph, KnowGraph, web, SEC/EDGAR, or CodeGraph authority.

## Future agent load set

| File | Why |
|------|-----|
| `apps/backend/src/coder/openclaude/mcp/liquidAItyAgentFlow.ts` (lines 127-208) | runMagOne with jobId |
| `apps/backend/src/coder/workspaceRoot.ts` | resolveCoderWorkspaceRoot |
| `apps/python-models/app/python_models/job_folder.py` | Handoff folder resolver + read/write |
| `apps/python-models/app/python_models/coder_job_tools.py` | write_mag_one_instructions |
| `apps/python-models/app/python_models/tool_registry.py` (lines 378-426) | write_return_file_tool, build_return_writer_tool |
| `apps/python-models/app/python_models/magentic_agentchat.py` (lines 447-532) | run_native_magentic_mission handoff path |
| `apps/python-models/app/python_models/test_coder_job_tools.py` | Handoff tests |
