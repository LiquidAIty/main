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
| 4 | **Coder** | Claim a job folder (`/api/dev/agent-harness/coder-jobs`, canonical `handoff/<id>/prompt.md` → `returns/<id>/`) and do the work yourself; or drive one adapter run via `/api/dev/agent-harness/coder-runs/prepare` → `/:runId/start` → `/:runId` (claude_code dev controller). |

## Proof at every rung

- Telemetry chain: `GET /api/dev/agent-harness/trace/:id` and `events` — stages
  `frontdoor → hermes_preflight → mag_one_dispatch → participant_turn → card_call`.
  A rung passes only when its downstream stages appear with real ids.
- Coder runs: the run snapshot (events, exit code, session/thread id, report) is the
  evidence; `coder-workspace/runs/<runId>/` holds prompt bytes + run.json.
- Diverge point = the first rung where standing in succeeds but the real agent's own
  attempt at the same rung fails. That agent (its prompt/config/model), not the pipe,
  is the suspect — and vice versa.

## Known traps

- Stack must be up first: `npm run dev:all` + `docker start sim-pg neo4j` (never start
  services individually).
- `probe_frontdoor` is dry-run only; a live user turn is rung 1, not a probe.
- Rung 2 bypasses the Harness model on purpose — passing rung 2 but failing rung 1
  means the Harness didn't choose/shape the tool call, not that the router is broken.
- The Coder Router never falls back between adapters; an unavailable adapter failing
  loudly is correct behavior, not a pipe bug.
- Python MCP host changes (mcp_host.py) need fresh sessions/restart to be picked up.
