# LocalCoder Maintainer Notes

## 1. What LocalCoder is
LocalCoder is a vendored runtime adopted from OpenClaude and kept inside this repo as `localcoder/`.

It is being adapted to serve as a host-managed local coder/local scanner agent that can be orchestrated by our backend/app (not treated as a standalone end-user product).

Visible `Claude`/`OpenClaude` branding has been reduced in safe outward-facing surfaces. Deep internals were intentionally not broadly renamed yet to avoid high-risk churn.

## 2. Current adoption status
- Folder/path rename has been applied: vendored runtime path is now `localcoder/`.
- Safe visible de-Clauding pass has been applied on selected terminal/UI/help/onboarding surfaces (labels/messages/descriptions/headings).
- Backend integration scaffolding exists under `apps/backend/src/coder/openclaude/*` and related route wiring (kept as-is internally for now).
- Host-managed provider lock work has been started in vendored runtime (not a full deep refactor).
- Launcher/MCP hookup was patched so backend launcher can pass MCP config:
  - `apps/backend/scripts/openclaude-terminal-launch.ps1` uses `apps/backend/mcp.config.json` via `--mcp-config` when present.
- Working now:
  - Vendored runtime location and launcher pathing to `localcoder` are in place.
  - MCP config handoff from backend launcher is in place.
  - Many outward brand strings are already neutralized to `LocalCoder`.
- Still partial:
  - Deep/internal branding and identity strings remain in many internal files/prompts/tests.
  - Full host-owned terminal behavior is not complete.
  - Full canvas/system-agent integration is not complete.

## 3. What was intentionally NOT changed
- No broad deep symbol rename (functions/classes/variables/modules kept stable).
- No broad package/env/config key rename.
- No protocol identifier rename.
- No full runtime refactor.
- No blanket replacement of all `Claude`/`OpenClaude` strings inside deep internals.
- No claim of full backend ownership of raw terminal behavior yet.
- No claim of full canvas integration yet.

## 4. Known current behavior
- Headless path:
  - Exists through backend runtime scaffolding/services and is better aligned with host control goals.
  - Intended long-term direction: lower-question, worker-like behavior.
- Terminal path:
  - Still interactive and can be question-heavy depending on runtime flow.
  - Launcher is backend-owned in entry path, but runtime UX remains partially native/interactive.
- Provider/model/env expectations:
  - Current direction is host-managed behavior (env-owned provider/auth/model).
  - MCP config is expected from backend config (`apps/backend/mcp.config.json`) when launched via backend script.

## 5. Surface de-branding summary
Applied now (safe layer):
- Vendored folder/path rename to `localcoder`.
- Selected visible labels/help/callouts/descriptions updated to `LocalCoder`.
- Terminal/status UX cleanup work was previously applied in this vendored copy (spinner/tips/clutter reduction path started).

Intentionally left for later:
- Deep prompt identity text.
- Internal comments/tests/implementation strings.
- Internal SDK/protocol/command token semantics.

## 6. MCP / codebase-memory integration
- Expected MCP config location: `apps/backend/mcp.config.json`.
- Patched launcher: `apps/backend/scripts/openclaude-terminal-launch.ps1`.
  - If MCP config exists, launcher passes `--mcp-config <path>`.
- `codebase-memory` server is expected to be configured in that MCP config.
- Operational expectation: repo understanding should trend MCP-first (especially graph/discovery tools) before blind scans.

## 7. Safe next steps (priority order)
1. Verify build/runtime sanity after rename/de-branding changes.
2. Decide terminal strategy:
   - either harden backend ownership of terminal behavior,
   - or explicitly keep terminal as native interactive mode and focus on headless for agent work.
3. Reduce headless “20 questions” behavior to be more worker-like.
4. Strengthen MCP-first repo-understanding behavior (prompt/policy layer, minimal-risk path).
5. Implement real canvas/system-agent integration against backend contracts.
6. Continue visible-only branding cleanup where safe; avoid deep refactor mixing.

## 8. Things to avoid
- Do not do random broad renames.
- Do not casually rename deep internals.
- Do not rely on OpenClaude wizard/profile UX as the product path.
- Do not assume raw CLI behavior equals backend-owned integration.
- Do not mix path-rename work with deep runtime refactors in one pass.

## 9. Smoke test commands
Run from repo root (`C:\Projects\LiquidAIty\main`):

```powershell
# 1) Confirm vendored folder location
Test-Path .\localcoder

# 2) Confirm launcher points to localcoder binary path
Select-String -Path .\apps\backend\scripts\openclaude-terminal-launch.ps1 -Pattern "localcoder\\bin\\openclaude"

# 3) Confirm MCP config exists (and is used by launcher flow)
Test-Path .\apps\backend\mcp.config.json
Select-String -Path .\apps\backend\scripts\openclaude-terminal-launch.ps1 -Pattern "--mcp-config"

# 4) Basic runtime launch sanity (interactive)
powershell -NoProfile -ExecutionPolicy Bypass -File .\apps\backend\scripts\openclaude-terminal-launch.ps1

# 5) Optional vendored CLI version sanity
node .\localcoder\dist\cli.mjs --version
```

