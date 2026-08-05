# CLASSIFICATION REPORT — Coder as one real card, one runtime

> Source: Hermes session `@session:default/20260805_094942_d88993`, message 5097 (2026-08-05)
> Repo: `C:\Projects\main` · Toolchain verified read-only this session — nothing touched/removed, all reads.
> Status: **DECISIONS PENDING (1–5 below)** — no edits fired yet.

## Summary

The SPEC's destructive scope inverts the repo's own current governance:
- `AGENTS.md:43` + `PLAN.md:90-92` + `DONT.md` explicitly bless `run_local_coder` → `/api/coder/localcoder/run` → `LocalCoderAdapter` as **the working Coder path** ("not cleanup residue").
- The SPEC touches the reserved vendored `localcoder/` tree's OAuth surface.
- The SPEC asks for net-new schema (a connection-mode field that doesn't exist anywhere).

Per DONT.md's stop-rule ("stop & propose before plan-changing findings, broad deletion") and the SPEC's "classify every surface" requirement, here is the classification and decision points before anything is removed.

## What was traced (all verified this session)

**The ONE canonical Coder runtime already exists and is healthy:**

- `OpenClaudeConsoleSessionManager` (consoleSession.ts:540), singleton `ownerCardId: 'card_local_coder'` (:812) — the one session manager, fail-closed (`console_controller_model_required`, `console_coder_model_unresolved`), builds `--model <saved> --provider openai` + `OPENAI_BASE_URL` for OpenRouter.
- `run_coder_subagent` (coder.routes.ts:318) — canonical doorway: saved card → `resolveCardModelStrict` → `runOpenClaudeCodeTask` → one session → CoderReport → AgentGraph assignment/result lineage.
- `OpenClaudeConsolePanel` (client) + `resolveLocalCoderControllerConsoleConfig` — reads **saved card runtimeOptions only**.
- Vendored `localcoder/src/cli/handlers/auth.ts` + `services/oauth/*` — **real account-login/OAuth surface exists**.

**Confirmations from the live deck:** `card_local_coder` = provider **openrouter**, modelKey **deepseek/deepseek-v4-flash-0731**, overrides synced (no contradiction). Main→Coder `flow` edge present. This supports account-login (openai) and OpenRouter as *two configs of the same runtime* — the SPEC's model A/B maps directly onto the existing provider field.

## Classification of every surface

| Surface | Class | Evidence |
|---|---|---|
| `OpenClaudeConsoleSessionManager` | ✅ **canonical one-runtime** | sole visible PTY manager, owner card_local_coder |
| `run_coder_subagent` | ✅ **canonical Coder doorway** | resolves saved card, assignment chain |
| `runOpenClaudeCodeTask` | ✅ **canonical execution** | uses that manager, parses CoderReport |
| `openai53.ts` | ✅ **validator (false suspect)** | strict provider/model registry check, no runtime |
| `AgentManager` Runtime tab | ✅ **canonical shared selector** | consumes `/api/config/models` (MODEL_REGISTRY); **no Coder-only array exists** |
| `runConfiguredCard` local_coder branch | 🔴 **translates local_coder→assistant_agent** | runtime.ts:560,580 hardcode `assistant_agent` — **the Coder Run button posts here** |
| `LocalCoderService` + `LocalCoderAdapter.run()` | 🟠 **headless engine (working, documented)** | AGENTS.md:42-43/PLAN.md:90-92 bless it; DONT.md calls Mag One→Coder canonical via `run_local_coder` |
| `POST /api/coder/localcoder/run` | 🟠 **headless invisible path** | route :892, used by Python `run_local_coder` |
| `build_local_coder_tool` / `run_local_coder` (Python) | 🟠 **Mag One→Coder headless doorway** | tool_registry.py:327-430, POSTs to /localcoder/run |
| `gpt-5.6-sol` (Codex app-server) | 🔴 **fake registry entry** | no app-server runtime exists in vendored tree; `openai53.ts` is not one |
| `gpt-5.3-codex`, `gpt-5.1-chat-latest` | ✅ **keep (valid OpenAI account models)** | spec: don't remove account-backed models |
| connection-mode UI field | ❌ **does not exist** (net-new) | no `connectionMode` in runtimeOptions schema |

## Git regression points (pinned)

- `gpt-5.6-sol` fake entry added by commits `024ddaa3` ("Prepare both coder lanes for testing") + `d97582da` ("Separate the system coder from the baseline").
- `gpt-5.3-codex` / `gpt-5.1-chat-latest` arrive from `9668e3ba`, `050fc106`, `e574c983`, `47c569e6`.
- `runConfiguredCard` → `assistant_agent` hardcode (runtimeType) originates at `18dcd8a9` ("feat: wire ThinkGraph MCP front door and single-card runtime").

## Adapter internals (why it's headless, not duplicate)

- `LocalCoderAdapter` (adapter.ts): `discoverRuntime()` → explicit env → PATH openclaude → built vendored runtime. Same discovery order in `resolveConsoleRuntime()` for the Console Bridge — **live terminal and headless job invoke the exact same CLI**.
- `run()` builds `buildOpenClaudeSubagentArgs({ model: providerModelId, ... env: { ...CLAUDE_CODE_USE_OPENAI: '1' } })` then `runProcess`.
- `envMissing()` fail-closes: provider `openrouter` → requires `OPENROUTER_API_KEY`, else `OPENAI_API_KEY`; + `providerModelId` required.

## Why Coder showed a reduced model list (E)

The screenshot list (GPT-5 Nano/Mini/Full/5.3/5.3 Codex/5.6 Sol/5.1 Chat Latest) is **exactly the `openai` provider's 7 entries**. Coder showed it because the card's saved provider was `openai` (the impostor state fixed the prior turn → now openrouter). It is NOT a Coder-only registry. The only genuinely fake catalog item is `gpt-5.6-sol (Codex app-server)` which appears in both provider lists.

---

## DECISIONS NEEDED before removing working code (per DONT.md stop-rule)

**1. Conflict with your own law:** AGENTS.md:43 + PLAN.md:90-92 + DONT.md document `run_local_coder`→`LocalCoderAdapter` as THE working Coder path ("not cleanup residue"), and DONT.md's 2026-07-05 lesson concludes "coder is a normal bus card Mag One instructs." This SPEC declares that same path a duplicate to remove. Which wins for this pass —
- (a) remove/disable the headless LocalCoderService+Adapter+`/localcoder/run`+Python `run_local_coder` and re-point the Coder Run + Mag One→Coder to the console manager (full spec compliance, larger diff, touches group-mode flow), or
- (b) only fix the `run_configured_card`→assistant_agent translation + fake registry entry now, and treat the headless-removal as a follow-up?

**2. Mag One→Coder:** if `run_local_coder`/`build_local_coder_tool` is removed, group mode loses its Coder tool unless Mag One is rewired to `run_coder_subagent`. Do you want group-mode rewired to the canonical doorway in this same pass, or is that out of scope (leaves `run_local_coder` as the Mag One doorway for now)?

**3. Fake entry removal scope:** remove only the `gpt-5.6-sol (Codex app-server)` **openai** registry entry (proven fake), keeping `openai/gpt-5.6-sol` (a real OpenRouter model id)? Or strip the word "app-server" and keep both?

**4. Reserved vendored tree:** account-login mode reads/writes the vendored `localcoder/` OAuth state (auth.ts, oauth cache). Authorize **read** of that surface for wiring (not modify), or should the account-login UI read status via a status endpoint only?

**5. Connection-mode UI is net-new** (no field exists). OK to add `connectionMode` to `normalizeRuntimeOptions` + AgentManager Runtime tab (Account Login / OpenRouter API radio + conditional controls), with `provider:openai` mapped to Account Login and `provider:openrouter` mapped to OpenRouter API?

Answer 1–5 (short codes fine, e.g. "1a 2yes 3openai-only 4read-status 5yes") and the full repair + tests + UI proof executes. No paid run, no commit, nothing touched yet — all reads.
