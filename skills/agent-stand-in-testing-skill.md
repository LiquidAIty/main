# Agent Stand-In Testing — substitute an external coding agent at any position

## When to use

An agent chain (chat → orchestrator → cards → coder) fails or behaves oddly and reading
code hasn't found it. Agents debug differently than code: substitute a known reasoner
(an external coding agent — Claude Code, Codex, etc.) at ONE position at a time and walk
down the chain until the seam that misbehaves is found. Never blind end-to-end debugging.

Access rule: these doorways are used ONLY from a separate system (a coding agent in its
own session). They are dev-only (routes 403 in production), never called by product code,
and never wired into the app itself.

## The ladder — one doorway per agent position

Walk top-down. At each rung the external agent *is* that position; everything below runs real.

| # | Position stood in for | Doorway (all on :4000 unless noted) |
|---|----------------------|--------------------------------------|
| 1 | **User** | `POST /api/coder/openclaude/session/chat` (+ `answer`, `history`) — a real front-door turn through the gRPC Harness. Say in the message that it is a developer test. |
| 2 | **Main Chat / Harness calling a tool** | `POST /api/coder/mcp-bridge/<tool>` directly — e.g. `run_coder_subagent` (body: parentRunId, projectId, deckId, conversationId, cardId, adapter `claude_code`\|`codex`, approvedPrompt), `run_mag_one`, `hermes_preflight`. This is exactly what the Harness's MCP tool call becomes. |
| 3 | **Orchestrator instructing one card** | `POST /api/dev/agent-harness/probe_card` — live single-card run, double-gated, through the canonical executor. Dry-run first: `probe_frontdoor`. |
| 4 | **Coder** | Claim a job folder (`/api/dev/agent-harness/coder-jobs`, canonical `handoff/<id>/prompt.md` → `returns/<id>/`) and do the work yourself; or run the coder through the runtime-reality layer (below). |

## Runtime-reality layer (PROVEN 2026-07-10, single_coder)

The reusable external stand-in door over the ONE canonical Coder Router — no parallel
controller. HTTP: `GET /api/dev/agent-harness/runtime-tests/capabilities`,
`POST /runtime-tests` (202 + record), `GET /runtime-tests/:id`, `POST /runtime-tests/:id/cancel`.
MCP (dev_agent_harness_mcp.py): `describe_runtime_test_capabilities`,
`start_agent_runtime_test`, `get_agent_runtime_test`, `cancel_agent_runtime_test`.

Start input: mode `single_coder` (mag_one_team is honestly unavailable), real project/deck
ids, parentRunId + correlationId, adapter `claude_code`|`codex` (explicit, no fallback;
claude availability REQUIRES real CLI auth — `claude auth login`, desktop login does not
count), repositoryWorkspaceRef `repo_root`, cardId, objective (the exact coder prompt),
permissionGrant `workspace_write`, expectedOutput {path, marker}, timeoutMs, developerTest true.

What it proves per run: lifecycle events + telemetry (trace SUPPORTED), before/after file
manifest (only expectedOutput.path may be created), marker presence, coder session/thread id,
deterministic verifier verdict, evidence persisted at
`coder-workspace/runtime-tests/<id>/evidence.json` + `coder-workspace/runs/<childRunId>/`.
A failed coder (e.g. rate-limited CLI) yields an honest `failed` stage with CONTRADICTED —
never fake success.

## Proof at every rung

- Telemetry chain: `GET /api/dev/agent-harness/trace/:id` and `events` — stages
  `frontdoor → hermes_preflight → mag_one_dispatch → participant_turn → card_call`.
  A rung passes only when its downstream stages appear with real ids.
- Coder runs: the run snapshot (events, exit code, session/thread id, report) is the
  evidence; `coder-workspace/runs/<runId>/` holds prompt bytes + run.json.
- Diverge point = the first rung where standing in succeeds but the real agent's own
  attempt at the same rung fails. That agent (its prompt/config/model), not the pipe,
  is the suspect — and vice versa.

### Proven live (2026-07-10)

- `codex` → `helloworld.md` (thread 019f4bd7…, exit 0).
- `claude_code` → `hello_from_claude_router_v0.html` via `rtest_cbc95c27…` / child
  `coder_52e11363…` / session `28ec4d04…`, 27 structured events, verifier SUPPORTED (4/1
  MISSING_PROOF: test execution isn't telemetry-measurable), manifest 534→535 created-only.

Adapter argv traps (both cost a live attempt to find):
- Claude CLI: `--print` + `--output-format stream-json` **requires `--verbose`** or the process
  exits 1 in ~2s before any model turn.
- `--permission-mode dontAsk` **auto-denies** anything not pre-approved — pass
  `--allowedTools Bash,PowerShell` or the coder has no hands. It is not "don't prompt, allow".
- Claude CLI auth is its own credential store: `claude auth login` (desktop login does NOT
  count). Adapter availability requires auth, so a logged-out CLI fails closed instead of
  burning the run.

## Known traps

- Stack must be up first: `npm run dev:all` + `docker start sim-pg neo4j` (never start
  services individually).
- `probe_frontdoor` is dry-run only; a live user turn is rung 1, not a probe.
- Rung 2 bypasses the Harness model on purpose — passing rung 2 but failing rung 1
  means the Harness didn't choose/shape the tool call, not that the router is broken.
- The Coder Router never falls back between adapters; an unavailable adapter failing
  loudly is correct behavior, not a pipe bug.
- Python MCP host changes (mcp_host.py) need fresh sessions/restart to be picked up.
