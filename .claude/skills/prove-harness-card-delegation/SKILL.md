---
name: prove-harness-card-delegation
description: >
  Prove whether the LiquidAIty Harness (main chat) actually delegates to a saved
  agent card (e.g. card_thinkgraph_agent, card_local_coder) and whether the card's
  Python run really persists its work — using real HTTP requests and backend trace
  greps instead of browser automation or trusting the model's own claims. Use this
  whenever a user reports "the chat says it can't do X" / "it gave me a conceptual
  answer instead of doing the real thing" / "no graph/report was written" for any
  Harness → card → Python delegation path. Also use before touching card doorway
  descriptions, runConfiguredCard authority minting, or Harness delegation prompts,
  to establish a before/after baseline.
---

# Proving Harness → card delegation (no browser, no guessing)

This repo's product shape is: **Harness (main chat model) delegates to saved agent
cards through native AgentTool + `card.run_assistant_agent`; the card's own Python run
does the real work (graph write, coder run, etc).** When a user reports the chat
"can't" do something and describes what it would do instead, the failure is almost
always **upstream of the real capability** — the model didn't delegate, or delegated
but authority never armed. Confirmed twice on this exact product (2026-07-06/07):
ThinkGraph write failures were caused by (1) an untruthful doorway description and
(2) a binding-resolution mismatch — never by the graph store or the model's reasoning
ability.

## Why not just use the browser

Driving `claude-in-chrome` for this is slow, flaky, and produces screenshots you have
to eyeball instead of a diffable trace. It took ~20 turns on this exact bug before
switching to direct HTTP + log greps, which nailed both root causes in two requests.
Reserve the browser for the *final* visible-UI confirmation only, after the HTTP-level
proof already passed.

## Step 1 — find the two test surfaces

- **Direct card run (bypasses delegation on purpose)** — isolates "does the card/Python
  path work at all?" from "does the model choose to delegate?":
  ```
  POST /api/coder/mcp-bridge/run_configured_card
  { "projectId": "<real-project-id>", "cardId": "card_thinkgraph_agent",
    "correlationId": "<unique>", "conversationId": "main", "input": "<real task>" }
  ```
- **Full Harness chat (tests real delegation)** — the ONLY valid way to test whether
  the model itself decides to delegate:
  ```
  POST /api/coder/openclaude/session/chat
  { "projectId": "<real-project-id>", "conversationId": "<unique>", "mode": "chat",
    "message": "<real task, explicitly forbidding a conceptual/text-only answer>" }
  ```
  This is SSE (`Content-Type: text/event-stream`). Use `curl -s -N` and inspect
  `event: tool_start` lines — the presence of `"toolName":"Agent"` followed by
  `"toolName":"mcp__liquidaity__card_run_assistant_agent"` IS the proof the model
  delegated. A 200 response and prose text alone prove nothing.

Never use the direct-card endpoint to "test" a delegation SPEC — it structurally
cannot prove the model's decision, since it bypasses it entirely.

## Step 2 — baseline before you touch anything

For any card whose downstream effect is persisted (graph, files, DB), read the
downstream state BEFORE the test so you have a diff, not a vibe:
```
curl -s "http://127.0.0.1:4000/api/thinkgraph/graph-view?projectId=<id>" | wc -c
# or grep node/edge counts, list of ids, etc.
```

## Step 3 — mark the backend log, then fire the request

The backend log is append-only per dev session. Before sending the request, record
its current line count (`wc -l < backend.log`), then after the request only look at
new lines (`tail -n +N+1 backend.log`) — this isolates exactly this request's trace
from everything else running concurrently (Prisma noise, other requests, file-watch
recompiles).

Run long-lived requests (a real model turn can take 10–90s+) via a backgrounded Bash
command, not foreground — foreground blocking wastes the turn waiting synchronously,
and a background command lets you keep working and get notified on completion.

## Step 4 — read the trace chain, not the model's prose

For this product the decisive lines (see `skills/harness-thinkgraph-card-delegation-skill.md`
for the full ThinkGraph chain) are the `[agent]` and `[<CARD>][tool]` lines emitted by
`apps/backend/src/services/harnessTrace.ts` and `runConfiguredCard`. Specifically:
`authority=<kind>` on the `invoking-python` line tells you whether write authority
actually armed — if it's `authority=none` for a card that should get authority, the
binding-resolution path is broken, not the model.

## Step 5 — verify persistence independently

Re-read the same downstream endpoint (graph-view, file listing, etc.) AFTER the
request and diff against the Step 2 baseline. Only a real, external, independent
read counts — never count the model's own "I did it" text, and never count a
`{"status":"completed"}` response alone (that only proves the HTTP round-trip
succeeded, not that anything downstream changed).

## Common false leads to rule out first
- **Backend crash-looping**: if you (or a prior turn) restarted the dev stack, or
  edited backend source causing a hot-reload/rebuild, a request fired during that
  window dies after ~1-2s with only a `session` SSE event and no `tool_start` — this
  is a stack hiccup, NOT a delegation failure. Confirm the backend log shows
  `Found 0 errors. Watching for file changes.` (stable) before treating a fast/empty
  response as a real result. Retry once the stack is stable.
- **Context-window warning spam** (`model "X" not in context window table`) drowning
  the trace — check `localcoder/src/utils/model/openaiContextWindows.ts` has an entry
  for the configured model; this is noise, not a root cause, but it can hide the
  `[agent]`/`[tool]` lines if you're eyeballing raw output instead of grepping.
- **`No module named 'app'`** on any Python MCP tool call — the host is launched as a
  script (`python .../app/mcp_host.py`), so the package root isn't on `sys.path`
  unless `mcp_host.py` bootstraps it once at the top (see the fix already in place).

## Do not
- Do not add mocks, synthetic projects, or fake graph/file records to make a test
  "pass" — the whole point is proving the REAL path.
- Do not restart the dev stack repeatedly to "try again" — one clean restart, then
  test against the stable stack. Repeated restarts is how the crash-loop false lead
  above happens.
- Do not conclude success from a unit test alone when a SPEC asks for live/product
  proof — trace + independent readback is the acceptance bar here, not `pytest`/`vitest`
  green.
