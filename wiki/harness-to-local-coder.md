---
id: feature.main-to-local-coder
title: Main to Local Coder
kind: feature
status: current_source_and_focused_tests

roots:
  files:
    - apps/backend/src/hermes/mainAdapter.ts
    - apps/backend/src/cards/runtime.ts
    - apps/backend/src/coder/localcoder/service.ts
    - apps/backend/src/coder/localcoder/adapter.ts
    - apps/python-models/app/python_models/card_domain.py
    - localcoder/plugins/repository-coder/.claude-plugin/plugin.json
    - localcoder/plugins/repository-coder/hooks/inject-context.ps1
  symbols:
    - materialize_invocation
    - begin_prompt_free_run
    - _coder_transport
    - buildCoderPrompt
  routes:
    - POST /api/coder/mcp-bridge/run_configured_card
    - POST /api/coder/localcoder/run
---

# Main to Local Coder

The saved Coder card remains the persistent under-chat OpenClaude terminal and bounded CoderReport
executor. Main discovers it only through the explicit saved `flow` edge and invokes the existing
configured-card runner exposed in Main's role-filtered Python MCP catalog.

Python materializes and validates the exact Inspector-visible outer IDF, then returns a narrow
`coderTransport`. The backend injects only the trusted run ID and repository root. `buildCoderPrompt`
passes the exact IDF unchanged to LocalCoder; the CoderPacket is process/permission/report metadata,
not a second prompt. The saved Card's explicit `writeMode` is the edit ceiling and defaults to
read-only when absent. No AutoGen AssistantAgent is interposed in this direct configured-Coder path.

The repo-owned Coder plugin injects the bounded coding role, CBM-first discovery order, safe Git policy,
Preservation Set, inverse deletion traversal, focused proof, and CoderReport requirement. Both terminal
and headless launch use a strict MCP config containing only the native repo CBM server. Session and
prompt hooks read the shared repo-owned `.codex/cbm-handoffs/C-Projects-LiquidAIty-main.md` orientation. A guarded
Stop hook asks the same agent to perform one native-MCP completion pass and refresh that handoff after
tracked source changes. Hook processes never launch, wrap, or directly index CBM.

Must remain true:

- the saved card identity, prompt, provider/model, tools, and separate AutoGen facet data remain intact;
- Main reaches Coder only through the explicit connected saved-card doorway;
- the model cannot choose the repository root, run identity, provider, or model;
- future temporary workers created by Coder are a separate nested subagent level;
- no general Python MCP catalog, second CBM owner, or terminal transcript masquerades as CoderReport;
- the interactive terminal and bounded report path remain distinct and working.

Focused proof:

```powershell
python -m pytest apps/python-models/app/python_models/test_card_domain.py apps/python-models/app/python_models/test_run_local_coder.py
npx vitest run apps/backend/src/routes/coder.routes.spec.ts apps/backend/src/coder/localcoder/adapter.spec.ts apps/backend/src/contracts/coderContracts.spec.ts
```

Deferred: visual polish, profile tuning, and live paid-provider comparison beyond the preserved
functional Coder contract.
