---
id: feature.coder-to-mag-one-handoff
title: Coder to Mag One Handoff
kind: feature
status: partial
proof_level: cbm_anchor_verified_and_source_verified

cbm:
  project_identity: C-Projects-main
  index_root: C:/Projects/main
  full_index_nodes: 5796
  full_index_edges: 11712
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
workers), it writes an exact prompt into `handoff/<run-id>/prompt.md` via its native
Write tool, then calls `run_mag_one` with the shared `jobId`. The Python rails read the
exact bytes from that file as the task — no wrapping, no rewriting. Return artifacts
land in `returns/<run-id>/<card-id>/` for the Coder to inspect.

## What the user/agent experiences

The Coder model writes a task file and calls run_mag_one with jobId. Mag One executes
the team run, workers write return files to `returns/<run-id>/<card-id>/`, and the
Coder reads those results to continue its work. The handoff prompt is the exact contract.

## How it works

```
Coder writes handoff prompt:
  model calls write_return_file(path, content) (or write_mag_one_instructions tool)
    → jf.write_handoff_prompt(folder, instructions)   [job_folder.py:96]
      → writes to: handoff/<run-id>/prompt.md (utf-8, exact bytes)
    → also creates: returns/<run-id>/ directory

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
          → task = those bytes (never chat text/rewrite)
        → arms write_return_file per participant via JOB_RETURN_ROOT ContextVar
        → runs Mag One with the exact prompt

Return artifacts:
  workers call write_return_file(card_id, path, content) [tool_registry.py:378]
    → writes to returns/<run-id>/<card-id>/<path>
    → NOT registered in card tool registry — only available inside handoff run
  RunMagOneResult returns:
    returnsDir: "<root>/returns/<jobId>"
    returnedFiles: ["card-id/path", ...]
    returnStatus: "return_files_created" | "no_return_files_created"
```

## Must not break

1. Handoff prompt is byte-exact — `write_handoff_prompt` writes utf-8 bytes to
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
6. Active coding target: `C:/Projects/main` is the canonical LiquidAIty repo root.
   `coder-workspace/` is the Coder's workspace (not a sandbox).

## Start in CBM

```
search_graph(project="C-Projects-main", query="runMagOne")
search_graph(project="C-Projects-main", query="resolveCoderWorkspaceRoot")
search_graph(project="C-Projects-main", query="write_mag_one_instructions")
search_graph(project="C-Projects-main", query="write_return_file_tool")
search_graph(project="C-Projects-main", query="resolve_job_folder")

trace_path(project="C-Projects-main", function_name="runMagOne",
           mode="calls", direction="inbound", depth=1)

index_status(project="C-Projects-main")
```

## Valid proof

```python
# Proves: handoff folder + prompt.md created with exact bytes
import app.python_models.job_folder as jf

folder = jf.resolve_job_folder("<root>", "test-run-1", create=True)
jf.write_handoff_prompt(folder, "# Task\nbuild X\n")
prompt = jf.read_handoff_prompt(folder)
assert prompt == "# Task\nbuild X\n"
assert folder.handoff_rel == "handoff/test-run-1/prompt.md"
```

Proves: handoff prompt is written and read back with exact bytes, paths are
workspace-contained. Does not prove: Mag One team actually runs with that prompt
(requires real AutoGen sidecar + configured deck with orchestrator card).

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