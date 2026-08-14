# LiquidAIty Architecture

## Product

LiquidAIty is a user-owned agentic engineering and research workbench. Main Chat steers work; saved
cards define agents and tools; the canvas shows card topology; Python rails run model/team logic; and
three graph authorities retain reasoning, sourced knowledge, and code structure.

The repository rule is:

```txt
TypeScript = transport and pixels
Python rails = execution and data rails
models = reasoning
```

There is no Runtime Observatory or RunManifest subsystem. Development proof comes from focused tests,
runtime responses, durable job artifacts, and direct inspection of the real authorities.

## Runtime topology

`npm run dev`, `npm run dev:fresh`, and `npm run dev:all` converge on one visible foreground
launcher. It stops only the prior verified application stack, preserves and verifies the existing
databases, starts every application process, and shuts the stack down together:

| Process | Port | Owner | Start command |
| --- | ---: | --- | --- |
| Vite frontend | 5173 | `client/` | `npm run dev:fresh` |
| Express backend | 4000 | `apps/backend/` | `npm run dev:fresh` |
| Graphiti ingestion API | 8001 | `services/knowgraph/` | `npm run dev:fresh` |
| Python rails | 8003 | `apps/python-models/` | `npm run dev:fresh` |
| Authenticated GPT plugin MCP | 8765 | `apps/python-models/` | `npm run dev:fresh` |
| Public MCP tunnel | public URL | local ngrok | `npm run dev:fresh` |

PostgreSQL normally listens on 5433 and owns projects, saved decks, and conversations.
Neo4j normally listens on 7474/7687 and owns KnowGraph. ThinkGraph is SQLite/Engraphis. CodeGraph is
the CBM index. Startup guards reuse only verified healthy LiquidAIty processes and refuse unknown port
owners. Isolated service startup is not a supported application proof path.

## Current working workflow

```txt
Main Chat
→ backend Main session route
→ persistent repo-owned Hermes ACP session
→ saved Main card provider/model/tools
→ saved flow children: Coder and Hermes Kanban
→ streamed answer and durable conversation

Approved team work
→ saved Magentic-One card plus magentic_option-connected worker cards
→ backend transport
→ Python AutoGen/MagenticOneGroupChat
→ native team execution
→ result and job-folder artifacts
```

Provider/model authority is per saved card. The source deck is used once when a project is explicitly
created; it is never a runtime fallback and is not proof of current persisted state.

## The two coding paths

### Direct OpenClaude Code console

The Code Console is an interactive persistent local process. The backend owns its `node-pty` session,
transcript stream, input, resize, interrupt, and stop lifecycle. The client renders the session with
xterm. It is bound to `C:/Projects/main` and runs with the machine's permissions; it is not a sandbox.

The console is now mounted directly below Main Chat by `HarnessChatPanel`. A draggable reveal handle
expands and collapses the real OpenClaude Code terminal without replacing the chat session. The same
panel also has an explicit GPT-as-Main display state, but display state does not change runtime
authority. The backend remains the sole owner of the console process and the terminal remains distinct
from Hermes.

Primary landmarks:

- `client/src/features/agentbuilder/console/OpenClaudeConsolePanel.tsx`
- `client/src/features/agentbuilder/console/XtermView.tsx`
- `apps/backend/src/coder/openclaude/console/consoleSession.ts`
- `apps/backend/src/routes/coder.routes.ts`

### Local Coder card

Local Coder is a separate bounded coding path. The `card_local_coder` saved card selects its
provider/model/tool configuration. Python `run_local_coder` calls
`/api/coder/localcoder/run`; the backend injects the trusted filesystem root and run identity; the
LocalCoder service invokes the configured OpenClaude CLI; and success requires a validated
CoderReport.

The two current callers converge before execution; the preserved Mag One participant contract joins
the same path when that later test is intentionally run:

```txt
Coder card Run ─┐
Main → generic connected-card subagent doorway ─┼→ runConfiguredCard / runCardWithContract
Mag One (later compatibility test) ─────────────┘  → Python typed runtime participant
                                                     → model-bound run_local_coder
                                                     → /api/coder/localcoder/run
                                                     → LocalCoderService → LocalCoderAdapter
```

Main's Hermes adapter resolves the saved Main→Coder flow and exposes the existing configured-card
runner only for that direct saved child. There is no separate Coder-specific execution engine.

OpenRouter cards use OpenClaude's OpenAI-compatible dialect with the saved provider model (for
example DeepSeek) and the OpenRouter endpoint/key. OpenAI Account cards use the same supported
`openai` CLI dialect with the Codex backend URL and OpenClaude's existing Codex OAuth/auth-file
authority; the current saved-card default is GPT-5.6 Luna. They are configurations of this one path,
not separate app servers.

Primary landmarks:

- `apps/backend/src/coder/localcoder/adapter.ts`
- `apps/backend/src/coder/localcoder/service.ts`
- `apps/backend/src/cards/localCoderController.ts`
- `apps/python-models/app/python_models/tool_registry.py`
- `client/src/features/agentbuilder/deck/newProjectDeck.ts`
- `repo-intake/localcoder-boundary.md`

The console is interactive and session-oriented. Local Coder is bounded and report-oriented. Neither
is a fallback for the other, and neither should be replaced with another generic adapter layer.

## Cards, prompts, bindings, edges, and decks

The saved deck document is runtime authority. A card carries its stable ID, template, prompt,
`runtimeType`, optional `runtimeBinding`, provider/model options, tool grants, and other typed runtime
options. Edges carry source/target IDs, handles, and an edge type.

Important edge meanings:

- `magentic_control`: Main controls the Mag One entry point.
- `magentic_option`: a saved worker card is eligible for Mag One participation.
- `flow`: a directed native sub-agent invocation relationship; it does not silently activate a
  Mag One worker. Main-to-Hermes uses this same contract.

The new-project template and initial topology live in
`client/src/features/agentbuilder/deck/newProjectDeck.ts`. Client saved-document parsing lives in
`deckDocument.ts`; backend persistence and normalization live in `apps/backend/src/decks/store.ts`;
shared runtime resolution lives in `apps/backend/src/cards/runtime.ts`; and Python validates the
received card graph before creating AutoGen participants.

## Mag One

Mag One is real Microsoft AutoGen/Magentic-One on Python rails. The backend transports saved cards,
edges, and mission input; Python builds the native participant set; bus connectivity decides
eligibility; and the native orchestrator owns its private Task and Progress Ledgers.

Keep:

- `MagenticOneGroupChat` and the vendored AutoGen line;
- saved worker-card selection;
- parent/child execution and job-folder returns;
- native private Task and Progress Ledgers, with no app-authored copy or projection;
- loud failures when a selected model, tool, card, or service is unavailable.

Do not add TypeScript planning logic or a fake Mag One fallback.

## Hermes boundary

There are three real Hermes-facing surfaces, and they must not be conflated:

```txt
Main Chat
→ saved `main_chat` card
→ persistent repo-owned `Hermes\\venv\\Scripts\\hermes-acp.exe`
→ saved prompt, profile, model, grants, and direct saved children

Hermes Kanban card
→ saved `card_hermes_steward` identity and familiar canvas position
→ a second persistent Hermes ACP session
→ KnowGraph/Graphiti grants and the existing native Kanban workspace

Hermes Terminal
→ separate `/api/coder/hermes/console` route family
→ separate `hms_` PTY/session namespace
→ installed `hermes chat --cli`

Hermes Kanban
→ LiquidAIty Kanban workspace
→ CLI bridge to the installed Hermes board/profile commands
→ durable worker processes and board state
```

Main, the separate Hermes Kanban helper, the Hermes terminal, and the Kanban workspace now use the
repo-owned installation. Main and the helper preserve distinct saved-card identities and session keys;
neither is a generic AutoGen call renamed Hermes. OpenClaude remains the Coder runtime.

The product must preserve both real Hermes modes:

- **single interactive agent:** ordinary Hermes chat with its own tools, memory, vision, session, and
  terminal lifecycle;
- **durable Kanban fleet:** profile-routed OS workers, dependencies, restart survival, human blocking,
  and structured handoffs.

They share the installed Hermes runtime but not UI state. The terminal must remain usable when Kanban
is absent or stopped; Kanban may display a compact status/control strip and open the terminal, but it
must not consume or replace the under-chat OpenClaude Coder slot. Short `delegate_task` calls remain an
in-turn Hermes mechanism; the Kanban board is the durable cross-agent queue.

The current LiquidAIty Kanban backend shells out to the Hermes CLI for each operation. That contract is
tested, but current Hermes also exposes a richer authenticated `/api/plugins/kanban/` surface. The
eventual integration should evaluate replacing the large CLI-shaped bridge with one thin native API
adapter. Do not run both adapters permanently and do not expose the local dashboard API without its
session-token boundary.

### Installed Hermes audit (2026-08-10)

The audit began with an editable checkout at
`C:\Users\jerem\AppData\Local\hermes\hermes-agent`. A supported `hermes update --check` reported that
checkout 863 commits behind `origin/main`. The updater created a 144.6 MB full pre-update backup and
advanced the source to `56dc01d904d5826957208450e62a1634b5dc76a3` before the outside-repo update was
stopped.

The canonical readable source is now cloned at `C:\Projects\main\Hermes`, on the same current-main
commit with the official NousResearch origin. Its repo-local data home is
`C:\Projects\main\Hermes\.hermes`; current memory files, config, Kanban/project databases, and the
94.8 MB session database were migrated and hash-checked. The old AppData install remains only as a
fallback snapshot. `pyproject.toml` reports version `0.20.0` while the latest public tagged release
observed during this audit was `v0.18.2`, so this is an ahead-of-tag main checkout, not a confirmed
newer stable release.

The repo-owned `Hermes\venv` now supplies both the CLI and ACP executable. Persistent two-turn ACP,
saved external system-prompt injection, clean shutdown, and cancellation are proven. The adapter pins
`HERMES_HOME` to `Hermes\.hermes`; console and Kanban routes resolve the same repo-owned installation
without PATH or AppData fallbacks.

The current install has the useful core enabled:

- the `hermes-cli` toolset, which supplies file, terminal, web/browser, memory, skills, vision/image,
  todo, delegation, code execution, cron, session search, and clarification capabilities;
- OpenRouter model configuration;
- compressor context engine;
- built-in memory and user profile;
- session search backed by `state.db`;
- delegation with inherited MCP configuration;
- curator/background self-improvement;
- Kanban dispatcher and automatic decomposition settings.

The install is not missing a single magic “four-part memory add-on.” Its memory should be understood as
four cooperating layers:

1. `MEMORY.md` — bounded agent-maintained facts, injected as a frozen session-start snapshot;
2. `USER.md` — bounded user preferences/profile, injected the same way;
3. `state.db` + `session_search` — on-demand FTS5 retrieval over complete past sessions;
4. background review/curator, plus an optional external memory-provider plugin when deliberately
   selected.

The first three layers and background review are present. `MEMORY.md` was 2,222 bytes, `USER.md` was
1,374 bytes, and `state.db` was about 94.8 MB during this audit. `session_search` passed a direct
requirements check and returned real historical results. No external provider is selected
(`memory.provider` is blank), which is not a broken install: external providers are additive and only
one can be active. Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, and
Supermemory are optional choices, not required pieces of built-in Hermes memory.

Do not enable one merely to complete a checklist. For LiquidAIty, built-in Hermes personal/session
memory plus shared Engraphis reasoning and Graphiti/KnowGraph provenance is the least-duplicative first
architecture. Evaluate an external provider only if a measured recall/user-modeling gap remains. Honcho
is strongest when cross-agent user representation and alignment are the missing capability, but it
would not replace Graphiti/KnowGraph's sourced domain graph.

Two operational warnings were observed:

- Hermes reported that the Python runtime's linked SQLite version is in a WAL-reset-corruption advisory
  range and recommends a fixed SQLite build. Because `state.db` is large and already uses WAL, back up
  Hermes data and repair the embedded runtime before relying on it as a critical memory service.
- background-review logs show successful review activity but also attempts to use tools that the
  background-review guard then refused. The guard is protecting user-owned state, yet the loop should
  be re-tested on the current model/toolset so it is not repeatedly spending work on forbidden actions.

### What the Kanban change broke, and what has been restored

The relevant Main-repository history is:

| Date/time (America/New_York) | Commit | Change |
| --- | --- | --- |
| 2026-08-05 12:30 | `c8b185f2b7e0` | Last identified pre-Kanban parent; Hermes console files existed in this tree. |
| 2026-08-05 17:22 | `1b23479a96f` | Restored agent workflows and prepared the Hermes Kanban workspace. |
| 2026-08-06 01:01 | `9849939b3afc` | Added the large Hermes Kanban backend CLI bridge and tests. |
| 2026-08-06 02:54 | `142926a4ff14` | Replaced the Hermes terminal with the native Kanban workspace and deleted the console component/spec. |
| 2026-08-06 05:18 | `70b94cbb1a9d` | Refined the Kanban workspace visuals. |

The destructive architectural step was specifically `142926a4ff14`: Kanban was treated as a
replacement for the console even though it is a different interaction mode. Current source has since
restored the separate Hermes console and keeps Kanban-first navigation with an explicit “open terminal”
action. Focused tests prove separate route, session-manager, client, and UI identities. Therefore the
correct repair is not a rollback to the pre-Kanban tree: preserve the restored console and the useful
Kanban work, then simplify the adapter boundary surgically.

Current Kanban configuration has `dispatch_in_gateway: true`, `auto_decompose: true`, and concurrency
allowances for several children. Those settings are useful after profile roles and board ownership are
reviewed, but unsafe for exploratory gateway starts because starting the gateway can make queued work
eligible for automatic decomposition/dispatch. This audit also observed stale gateway PID/state files
and one status-probe lifecycle anomaly. No gateway should be enabled as a persistent LiquidAIty service
until stale state is repaired, automatic dispatch is intentionally selected, and the exact profile
roster/tool grants are reviewed.

### Hermes integration path

Hermes offers three realistic external seams:

- **PTY CLI** — already suitable for the visible single-agent terminal;
- **TUI gateway JSON-RPC** — best fit for a custom host that needs persistent sessions, streaming,
  slash commands, and approval events;
- **OpenAI-compatible HTTP/SSE API** — simplest language-neutral prompt/run adapter;
- **ACP stdio** — strongest editor/coder integration, but broader than the first Main-to-Hermes need.

The implemented path uses ACP stdio because it supplies persistent sessions, native streamed events,
permission requests, cancellation, session load/new, and model selection without terminal keystroke
automation. The backend owns one calm ACP process per saved Hermes profile. A role-filtered Python MCP
child exposes only the saved tool grants, and direct card delegation is limited to explicit saved
`flow` children. The existing CLI Kanban bridge remains the board adapter; replacing it with Hermes'
authenticated Kanban API is a separate measured migration, never a second permanent writer.

Hermes can be the cleaner general/research agent without becoming LiquidAIty's only runtime. OpenClaude
remains the contained specialist Coder UX; Hermes becomes the Main/general operator and durable fleet. If
OpenClaude later fails the measured maintenance test, the emergency path is to port the bounded
CoderReport and terminal/session contract to Hermes ACP or gateway—not to rewrite the whole workbench.

## OpenClaude and Hermes synthesis

This section combines direct inspection of the LiquidAIty fork with upstream primary-source research.
Upstream claims describe capability and intent; they do not prove that a feature is enabled or working
in this repository.

### Provenance and maintenance risk

“Clean room” is not an accurate description of the Gitlawb OpenClaude repository. Its own README says
it originated from the Claude Code codebase, and its LICENSE says the repository contains code derived
from Anthropic's proprietary CLI, that only contributor modifications are offered under MIT where
legally permissible, and that the project does not have Anthropic's authorization to distribute the
underlying source. This is an engineering and distribution risk distinct from code quality. It is not
legal advice; obtain legal review before distributing a product that contains this code.

Primary sources:

- [OpenClaude README](https://github.com/Gitlawb/openclaude/blob/main/README.md)
- [OpenClaude LICENSE](https://github.com/Gitlawb/openclaude/blob/main/LICENSE)
- [OpenClaude current package metadata](https://github.com/Gitlawb/openclaude/blob/main/package.json)

The LiquidAIty checkout identifies itself as `@gitlawb/openclaude` `0.5.2`. During this audit,
upstream `main` identified itself as `0.27.0`, while the npm index snapshot reported a recently
published `0.25.0`. The local fork also extends the upstream gRPC protocol with saved-card agent
definitions, separate native/MCP grants, parent identity, AgentGraph run identity, progress/reasoning
events, and context/usage accounting. Therefore a normal dependency upgrade or wholesale upstream
merge is not safe. Any update must be treated as a port across a custom runtime protocol, with the
current LiquidAIty behavior contract as the preservation set.

### Fundamental architecture difference

OpenClaude is fundamentally a coding-agent CLI product:

```txt
Bun/TypeScript + Ink terminal UI
→ QueryEngine/provider adapters
→ coding tools, permissions, agents, tasks, LSP/MCP, commands, plugins
→ foreground, background, interactive, print, SDK, and gRPC entry points
```

Its upstream README explicitly centers bash/file/edit/grep/glob, agents/tasks, provider profiles,
streaming tool loops, image input, repo maps, and a bidirectional gRPC server. That shape explains both
its value and its size: it inherited an entire terminal coding product, then accumulated providers,
extension surfaces, compatibility code, and product UI. Its system prompt is assembled by code, but
LiquidAIty already has thin seams for saved-card prompt/model/tool policy. The prompt is not inherently
impossible to govern; the danger is adding a second composition path or editing many internal prompt
fragments instead of controlling the documented append/grant boundary.

Hermes is fundamentally a general personal-agent core with multiple transports:

```txt
Python AIAgent narrow waist
→ stable cached prompt + provider resolution + selected toolsets
→ CLI / TUI / messaging gateway / desktop / API / ACP
→ persistent sessions, memory, skills, delegation, profiles, schedules, Kanban
```

The Hermes maintainers explicitly describe prompt-cache stability as sacred and capability-at-the-edges
as the design rule. The same `AIAgent` core is exposed through ACP, TUI-gateway JSON-RPC, and HTTP/SSE.
Memory, skills, profiles, plugins, web/browser/vision, and durable Kanban are first-class general-agent
concerns rather than additions to a coding terminal.

Primary sources:

- [Hermes architecture](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/architecture.md)
- [Hermes development and extension rules](https://github.com/NousResearch/hermes-agent/blob/main/AGENTS.md)
- [Hermes prompt assembly](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/prompt-assembly.md)
- [Hermes programmatic integration](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md)
- [Hermes persistent memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)
- [Hermes profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles/)
- [Hermes Kanban](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban/)

### Relative to LiquidAIty's actual objectives

| Objective | OpenClaude fit | Hermes fit | Synthesis |
| --- | --- | --- | --- |
| User chats while revealing a live coder below | Excellent in the current custom UI/gRPC integration | Requires one real persistent Hermes adapter while retaining the host-owned event and permission bridge | Preserve the LiquidAIty chat UI and OpenClaude Coder reveal; migrate Main execution to Hermes. |
| Focused repository coding | Excellent: coding-native tools, LSP/MCP, agent patterns, PTY, headless reports | Good general coder with ACP/terminal/tools, but no current LiquidAIty CoderReport adapter | OpenClaude is primary Coder; Hermes is the measured emergency/secondary path. |
| General personal assistant and research operator | Technically possible but drags in coding-product complexity | Core product purpose, including memory, skills, web, vision, computer use, profiles, scheduling | Use real Hermes. |
| Durable multi-agent fleet | Many subagent/team patterns, but not the same durable human-visible work queue | Native profile-routed Kanban workers and handoffs | Use Hermes Kanban, preserve single-agent Hermes alongside it. |
| Saved visual agent/card policy | Already integrated through LiquidAIty's deck and canvas | Profiles provide runtime identities but not the LiquidAIty graph/control plane | Cards remain host policy; one card may bind to one Hermes profile. |
| Engraphis recall → research → Graphiti knowledge | Can consume MCP context but should not own the pipeline | Strong research runtime and memory-aware operator | Deliver a typed IDF/context manifest to real Hermes; write sourced results through Graphiti. |
| Code context | Native repo-map exists upstream, but it overlaps the canonical external code authority | Can consume external tools | CBM remains the sole CodeGraph authority; use direct source and tests after CBM discovery. |
| Long-term distributable foundation | Proven local value, but derived-code licensing and custom-fork drift are material risks | MIT project with deliberate external protocol/plugin boundaries | Contain OpenClaude; avoid making new domain logic depend on its internals. |

### Final architectural decision

“Main” is a LiquidAIty product role and saved card, not the permanent name of one third-party runtime.
**Current fact:** the repo-owned Hermes ACP adapter executes Main and the saved Hermes Kanban helper.
The retired OpenClaude Main gRPC client and product startup path are deleted; there is no A/B Main or
hidden fallback. OpenClaude remains the contained Coder.

The recommended stable split is:

```txt
LiquidAIty UI and saved cards = user experience, policy, grants, visualization

OpenClaude = contained specialist coding runtime
  - under-chat interactive Coder
  - bounded Local Coder / CoderReport

Hermes = general/research runtime
  - real single-agent terminal and saved-card adapter
  - memory, skills, web, vision, computer use
  - profile-routed durable Kanban fleet

Shared external authorities
  - PostgreSQL: typed IDF and relational records
  - AGE AgentGraph: assignments, dependencies, derivation/result lineage
  - Engraphis/ThinkGraph: project reasoning and recall
  - Graphiti/KnowGraph: sourced domain knowledge and provenance
  - CBM/CodeGraph: repository structure, symbols, relationships, and bounded source discovery
```

This preserves the proven host-owned UI behavior while moving the general-agent role to the runtime
designed for it. Keep the host-owned session/card/CoderReport behavior tests as the preservation
contract. OpenClaude's contained Coder adapter can later be replaced independently if its maintenance
or licensing risk becomes unacceptable, while the LiquidAIty UI, IDF, graphs, cards, and proof contracts
remain stable.

### How the three agent loops actually work

The model loop is conceptually similar in all three systems. The differences are where policy lives,
how much platform surrounds the loop, and what persists between turns.

**OpenClaude / LocalCoder Coder:**

```txt
saved Coder assignment or persistent terminal input
→ OpenClaude composes its coding prompt + native tools + native CBM
→ provider streams reasoning/text/tool-use events
→ permission check when required
→ native file/shell/test or CBM tool executes
→ tool result is appended to the conversation
→ model is called again
→ repeat until final response, cancellation, or error
→ bounded CoderReport or persistent terminal transcript
```

The Coder plugin injects its bounded role and CBM-first procedure. Its strict MCP configuration exposes
only the native repo Codebase Memory server; it does not attach the general Python MCP catalog.

**Hermes:**

```txt
CLI/gateway/API/ACP prompt
→ AIAgent builds one cache-stable system prompt + selected toolsets + frozen memory/profile
→ provider streams model output/tool calls
→ registry dispatches the tool and appends its result
→ repeat until completion, cancellation, or iteration limit
→ store session; run memory-provider sync/background review as separate lifecycle work
```

Short subagents are child AIAgent runs that report back into the parent turn. Profiles are isolated
agent homes. Kanban does not replace the loop: its dispatcher starts a profile as an OS worker, injects
task guidance, and the worker uses the ordinary AIAgent loop plus `kanban_*` lifecycle tools.

**Agent Zero:**

The supplied archive contains a Python core (`agent.py`, about 60 KB) surrounded by a large Python/API
and JavaScript/HTML Web UI platform. Its `Agent.monologue()` is an explicit outer run loop with an inner
message loop: build `LoopData`, call extension hooks, prepare the prompt, stream an LLM response, parse
built-in or text-encoded tool requests, execute a tool, append history, and continue until the response
tool breaks the loop. Subordinate agents receive focused contexts and report upward. Prompts are
separate Markdown files and tools/extensions are Python, which is easier to inspect than OpenClaude's
distributed TypeScript prompt/product tree; however, the central agent loop is monolithic and the
Docker/Web UI/browser/desktop/plugin platform is another large product, not a small replacement.

Agent Zero's distinctive value is its visual computer environment: browser annotations, screenshot
history, a live Linux desktop canvas, LibreOffice cowork, and optionally host browser/desktop control
through its connector. That could become a valuable future Agent Builder card for CAD, GUI inspection,
and visual verification. It should not become Main or Coder before the core launch, and its 3,481-entry
archive has not been extracted or runtime-tested in this audit.

Primary sources:

- [Agent Zero repository](https://github.com/agent0ai/agent-zero)
- [Agent Zero Browser/Desktop documentation](https://www.agent-zero.ai/p/docs/desktop/)
- [Agent Zero host connector and computer use](https://www.agent-zero.ai/p/docs/a0-cli-connector/)
- [Agent Zero subagents](https://www.agent-zero.ai/p/docs/subagents/)

### Two launch scenarios

#### Scenario A — rejected launch alternative: OpenClaude remains Main and Coder

This preserves the most code already written. Main continues through the custom gRPC Harness, saved
doorway agents stay native to OpenClaude, and the revealable OpenClaude terminal plus Local Coder remain
the coding surfaces. Hermes remains a separate terminal/Kanban/research sub-agent after its real adapter
is completed.

Benefits: least immediate UI/transport migration; working split-chat UX; mature coding tools and agent
patterns; existing tests and CoderReport path remain authoritative.

Costs: the front door remains coupled to a very large derived-code fork; ordinary graph/semantic tools
require separate indexing and careful scoping; upstream has moved far beyond the local fork; custom
gRPC changes make merges expensive; and the repository's own license creates a serious distribution
risk. This is viable for a private MVP but is not the best long-term Oracle-hosted product foundation.

#### Scenario B — recommended launch: LiquidAIty Main UI + Hermes general runtime + OpenClaude coder card

```txt
LiquidAIty chat and graph UI (the actual front door)
→ saved Main policy and typed IDF/context manifest
→ real Hermes adapter for general chat, research, memory, web/vision, and graph processing
→ Engraphis recall + Graphiti/KnowGraph writes + AgentGraph lineage

When code work is selected:
→ OpenClaude Code saved card
→ optional Plan/Explore pass
→ interactive PTY or bounded Local Coder implementation
→ CBM/source/tests
→ CoderReport and AgentGraph result reference
```

Benefits: the product UI and graph context are runtime-independent; Hermes owns the work it is designed
for; OpenClaude's strongest coding behavior is retained without making its entire repository the front
door; the eventual Oracle deployment has one clear service boundary; and OpenClaude can be retired later
without replacing the UI, graphs, cards, or IDF.

Costs: one real Hermes protocol adapter and one context-manifest assembler still have to be finished;
the repo-local Hermes install must pass health tests; and the current Harness-native card called Hermes
must be renamed or replaced so it cannot masquerade as the external runtime.

**Recommendation:** launch Scenario B. Do not downsize OpenClaude now and do not replace it with Agent
Zero. Contain it as a specialist card, finish one healthy repo-local Hermes runtime, make the IDF the
typed context handoff, and prove one user flow end to end: chat → visualize/select data → Engraphis
recall → real Hermes research → Graphiti/KnowGraph result → optional OpenClaude code change on the same
visible task.

## Graph authorities

### ThinkGraph

ThinkGraph is project reasoning and operational state in SQLite/Engraphis. Python rails own its
bounded reads and writes. It is not Neo4j and not AGE.

### KnowGraph

KnowGraph is sourced knowledge and provenance in Neo4j. Graphiti is its canonical Python ingestion
and retrieval engine; its native entity, episode, relation, temporal, and provenance schema owns the
database. The backend exposes that graph without merging Apache AGE results.

### CodeGraph

CodeGraph is repository structure from Code-Based Memory. The CBM indexer is the only writer. Product
code uses thin MCP calls for status/search; developers use the canonical
`skills/codebasedmemory.md` workflow. Direct source and tests win when graph memory disagrees.

The root Compose stack owns one `codegraph` execution service built as
`liquidaity-codegraph:0.10.2`. Its image contains the pinned Linux portable CBM binary at
`/opt/cbm/codebase-memory-mcp`, mounts the repository read-only at `/workspace/main`, and keeps graph
state in the named `codegraph_data` volume. CLI calls use `docker compose exec -T codegraph`, while
stdio MCP clients use `docker exec -i liquidaity-codegraph /opt/cbm/codebase-memory-mcp` because
Compose CLI startup output is not a clean MCP stdio transport. Runtime download, Windows AppData,
PATH discovery, and developer-machine executable paths are prohibited. Oracle builds must obtain the
pinned official v0.10.2 Linux portable release inside the builder stage, verify archive SHA-256
`4EAD161715FE959EF8A0E38946D63B1728D31E5FB1762A85DBB4B8C4ABFBE481` and executable SHA-256
`F3557B891EFCA36D8DB6508BB93C9688ADEB7C0F89236C6788DE1594C097D9FE`, and copy only the executable
and license notices into the final image. The final image contains no build toolchain or upstream source,
and the deployed service never downloads CBM at runtime.

### KnowledgeGraphFramework

`client/src/components/knowledge/KnowledgeGraphFramework.tsx` is the unified graph workspace shell.
It selects and renders the current ThinkGraph, KnowGraph, and CodeGraph surfaces without becoming a
fourth data authority.

### AgentGraph

PostgreSQL AGE is the sole AgentGraph authority. It stores exact Markdown agent handoffs, sender and
receiver identity, and minimal result/derivation lineage. It does not copy, proxy, expand, or merge
the native graph authorities, tools, models, or Card Canvas configuration.

## Typed Input Data File and delivered context

The proposed **Input Data File (IDF)** is viable as a typed, persisted input object. It should not be a
literal loose file passed between agents and it should not become a fifth graph authority. The clean
contract is a versioned PostgreSQL record whose payload is schema-validated and whose relationships and
execution lineage are projected into AGE.

An IDF may contain references to, rather than copies of, heterogeneous input:

```txt
IDF / DeliveredContextManifest
  identity: project, request, version, author, timestamps
  instruction: exact user/card prompt and acceptance state
  loose text: bounded authored context
  relational references: conversation/message/card/deck IDs
  typed operations: exact native-tool calls plus first-class parameterized SQL/Cypher query definitions
    with authority, language, mode, limits, typed parameters, and required card capability
  Engraphis references: recalled memory IDs and support/provenance metadata
  KnowGraph references: Graphiti episode/entity/fact IDs and temporal provenance
  CodeGraph references: CBM project + file/symbol/route pointers + indexed revision state
  attachments: content-addressed artifact references and media metadata
  output contract: expected schema, proof requirements, and destination
```

PostgreSQL owns the typed manifest, query versions, parameters, and durable payload. AGE owns only the
assignment, sender/receiver, dependency, derivation, and result-lineage edges. Engraphis owns project
reasoning and recall. Graphiti/KnowGraph owns sourced knowledge and provenance. CBM owns code structure.
An IDF records references and the evidence used for one request; it must not duplicate entire native
graphs into PostgreSQL or AGE.

The intended research flow is:

```txt
user chat + uploaded/selected data
→ visualize and inspect the data
→ persist a typed IDF plus immutable native-tool and SQL/Cypher operation references in PostgreSQL
→ connect request/card/data/result lineage in AgentGraph (AGE)
→ retrieve bounded Engraphis context
→ Main or the real Hermes adapter receives one validated DeliveredContextManifest
→ Hermes uses the exact prompt + recalled context to disambiguate research
→ source retrieval and processing
→ Graphiti ingests authoritative episodes into KnowGraph with provenance
→ result references and proof return to the IDF/assignment, without copying KnowGraph into AGE
```

For coding work the same envelope carries CBM pointers instead of dumping source. The receiving coder
must still check CBM freshness and direct-read the resolved source before editing. Existing exact
instructions and AgentGraph assignment-context functions are useful foundations, but the complete IDF
schema, assembler, validation, generic typed SQL/Cypher execution boundary, and end-to-end consumer
proof are not yet implemented. Migration 016 removed an earlier overbuilt registered-query subsystem;
that deletion does not remove the product requirement for one Python-owned, capability-gated,
parameterized query executor shared by IDF consumers.

## Trading and retained specialists

The trading surface and specialist systems are retained boundaries, not cleanup residue:

- `client/src/pages/tradingui.tsx` and Python Alpaca read-only market tools;
- `worldsignal/` plus its backend/client bridge;
- the protected `Kronos-main` submodule and model-adapter boundary;
- `services/esn_rls/`;
- `services/energyplus-runner/`;
- EDGAR/SEC ingestion, evidence, and cached source data.

Mock balances, fake signals, synthetic proof, and duplicate panels are deletable when individually
proven dead. The actual source, data, tests, and adapter boundaries are protected.

## Ownership by language

- React/TypeScript client: canvas, chat, console rendering, graph/trading surfaces, editors, and
  typed transport.
- Node/TypeScript backend: HTTP/SSE transport, saved-deck/conversation access, model/tool resolution,
  process/session ownership, security boundaries, and Python/gRPC bridges.
- Python rails: AutoGen/Mag One, single-card agents, tool execution, graph/data rails, and specialist
  computation.
- Vendored runtimes: `Hermes/`, `localcoder/`, `autogen-main/`, `worldsignal/`, and `Kronos-main`
  retain their upstream boundaries and are not ordinary cleanup targets.

## Repository ownership and CBM project boundaries

One repository ownership boundary equals one CBM project. Ordinary LiquidAIty work uses only the
core project; vendor projects are dormant, on-demand navigation aids and are never preloaded merely
because they exist.

| Ownership boundary | Root | CBM project | Use and current state |
| --- | --- | --- | --- |
| LiquidAIty core | `C:\Projects\main` | `C-Projects-main` | Default. Vendors are excluded. Current graph is blocked/unhealthy until a delete/rebuild removes 7,986 observed stale Hermes files and proves zero Hermes/LocalCoder files. |
| Hermes | `C:\Projects\main\Hermes` | `C-Projects-Hermes` | On demand only for explicit Hermes work. Full index passed at 147,002 nodes / 769,439 edges during the boundary test. |
| OpenClaude/LocalCoder | `C:\Projects\main\localcoder` | `C-Projects-LocalCoder` | On demand only for explicit LocalCoder work. Full index passed at 25,466 nodes / 101,429 edges during the boundary test. |

Other significant imported roots—`autogen-main/`, `worldsignal/`, `engraphis-main/`, `Kronos-main/`,
`defog-sqlcoder/`, `neo4j-text2cypher/`, and `client/src/vendor/codebase-memory-ui/`—remain excluded
from the core graph. Give one of them a dedicated CBM project only when an active task enters that
ownership boundary. Do not create a standing index swarm or combine vendor and core graphs.

### Vendored divergence register

This is the single durable record for intentional local departures from upstream. Add or update one
row whenever a nontrivial vendor change is approved; do not create parallel divergence ledgers.

| Vendor | Upstream and baseline | Known local divergence | Proof and synchronization note |
| --- | --- | --- | --- |
| Hermes | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent), source version `0.20.0`; exact upstream commit unverified | `acp_adapter/session.py` carries ephemeral host-supplied saved-card prompt/capability state. `acp_adapter/server.py` applies the exact saved native-tool/toolset ceiling, preloads saved skills, preserves that state across native model recreation, and still normalizes an interrupted `None` response so cancellation returns the ACP `cancelled` stop reason. Callers that omit this ACP extension metadata retain upstream defaults. | 51 focused ACP session/server tests pass, including exact grants, skill failure, and model-switch preservation; prior live two-turn ACP reused one PID/session and live cancellation returned `hermes_turn_cancelled`. Keep the divergence until upstream exposes equivalent external profile/capability configuration. |
| OpenClaude/LocalCoder | [Gitlawb/openclaude](https://github.com/Gitlawb/openclaude), local package `0.5.2`; exact upstream commit unverified | Repo-owned `plugins/repository-coder` injects the bounded Coder/CBM policy and shares the repository CodeGraph handoff with Codex through native prompt and guarded Stop hooks. LiquidAIty launches the terminal and headless Coder with that plugin and a strict native-CBM-only MCP configuration. The hooks never launch another CBM owner. The historical vendor gRPC implementation remains dormant vendor capability, not a product Main path. | Plugin/schema and direct hook-output proof plus focused adapter and terminal tests preserve the Coder contract. Preserve terminal, card, permission, CBM, graph-handoff, and CoderReport proofs on updates. |

Exact upstream commits and outer-repository Git state could not be verified during this policy task
because the host blocked read-only Git commands. Version and URL are therefore recorded without an
invented commit identity.

## Agent Builder file ownership

- Page composition: `client/src/pages/agentbuilder.tsx` selects the active project/workspace and
  composes the rail, Main Chat, canvas, inspector, console, graph, trading, and WorldSignals surfaces.
- Project and deck state: `client/src/features/agentbuilder/state/useAgentBuilderProject.ts`,
  `useAgentBuilderDeck.ts`, `useAgentBuilderDeckLoad.ts`, `useAgentBuilderAutosave.ts`, and
  `useAgentBuilderProjectReset.ts` own selection, loading, revisions, persistence, and reset effects.
  `client/src/features/agentbuilder/project/AgentBuilderProjectDrawer.tsx` owns project
  create/select/delete presentation and requests.
- Canvas: `client/src/features/agentbuilder/canvas/AgentCanvasPane.tsx` is the Agent Builder canvas
  surface; `client/src/components/builder/BuilderCanvas.tsx` owns ReactFlow node, edge, selection,
  connection, and viewport behavior.
- Card editing: `client/src/features/agentbuilder/state/useAgentBuilderCardEditor.ts` owns selected-card
  derivation and configuration/name/subtext mutations. `client/src/components/AgentManager.tsx`
  renders the card editor.
- Main Chat: `client/src/features/agentbuilder/console/useAgentBuilderMainChat.ts` owns transcript
  loading, streamed Hermes turns, and busy/error state.
  `client/src/components/builder/BuilderChat.tsx` renders the conversation.
- OpenClaude console: `client/src/features/agentbuilder/console/OpenClaudeConsolePanel.tsx`,
  `openClaudeConsoleClient.ts`, and `XtermView.tsx` own the persistent terminal UI and client
  lifecycle. Backend PTY ownership remains in
  `apps/backend/src/coder/openclaude/console/consoleSession.ts`.
- Graph workspace: `client/src/components/knowledge/KnowledgeGraphFramework.tsx` selects the
  ThinkGraph, KnowGraph, and CodeGraph surfaces. The graph authorities remain separate.
- UI shell and polish: `client/src/features/agentbuilder/core/AgentBuilderWorkspace.tsx` owns the
  rail/chat/splitter/canvas/companion/overlay layout;
  `useAgentBuilderWorkspaceLayout.ts` owns resize behavior; `AgentBuilderRail.tsx` and
  `CompanionSurfaceHost.tsx` own their actual visual regions.
- Backend routes: `apps/backend/src/routes/index.ts` mounts the supported route families.
  `projects.routes.ts` and `decks.routes.ts` own project/deck transport; `coder.routes.ts` owns
  Main Hermes, Coder, console, card-control, and MCP-bridge transport; `knowgraph.routes.ts` exposes
  the KnowGraph service; `worldsignal.routes.ts` owns the retained specialist bridge;
  `auth.routes.ts` and `health.routes.ts` own access and liveness. Engraphis, Graphiti, and CBM
  tools are federated by the official Python MCP rather than mirrored as backend route families.

## Adding a card

1. Decide whether it is a real runnable agent, a controller, or a UI/data card. Do not create a card
   for a speculative service.
2. Add/update the typed template and default instance in `newProjectDeck.ts` only when new projects need it.
3. Keep stable IDs and update matching client/backend runtime types and normalizers.
4. Add an explicit saved prompt, provider/model, binding, and only the tools it may call.
5. Add the intended edge with real source/target handles. Use `magentic_option` only when the card
   should participate in Mag One.
6. Prove explicit new-project creation, save/readback, canvas rendering, and the focused runtime path.
   Editing the source template never rewrites an existing saved deck.

## Adding a runtime

1. Prove the real executable/service and its invocation, session, cwd, input/output, cancellation,
   tool, and failure behavior first.
2. Put reasoning/execution on Python rails unless it is specifically a backend-owned local process
   boundary such as the existing PTY.
3. Extend the existing synchronized runtime type/binding fields; do not create a parallel card or job
   schema.
4. Resolve provider/model/tool grants from the saved card and fail closed when any are missing.
5. Wire one route and one owner. Do not add a silent fallback or generic substitute.
6. Add focused source tests, transport tests, persistence readback, and a real runtime smoke before
   calling it working.

## Validation

Run checks separately so failures retain their owner:

```powershell
npm --workspace apps/backend run typecheck
npm --workspace apps/backend run typecheck:spec
npm --workspace client run typecheck
npm --workspace client run typecheck:spec
npm --workspace apps/backend run build
npm --workspace client run build
npx vitest run
apps/python-models/.venv/Scripts/python.exe -m pytest apps/python-models/app/python_models
services/knowgraph/.venv/Scripts/python.exe -m pytest services/knowgraph
npm run mcp:check
```

Use narrower focused suites first when changing one boundary. A live full-stack probe additionally
requires PostgreSQL, Neo4j, all five processes, provider credentials, and acceptance of real model
cost.

## Intentionally unavailable or incomplete

- Persisted ADMIN Hermes/graph cards and edges; source template presence is not database recovery.
- Full Main → actual Hermes → approved Mag One end-to-end proof.
- Full Main → AgentGraph → Hermes/Coder product activation; the AGE store and Coder consumer exist,
  but the current saved-card grants and native Hermes doorway do not yet expose the complete flow.
- A complete typed IDF/DeliveredContextManifest schema and proven assembler/consumer flow.
- Runtime Observatory and RunManifest; both are intentionally absent.

These states must remain explicit. Do not hide them with placeholders, fake success, generic model
substitution, or deterministic prose repair.
