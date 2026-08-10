# LocalCoder / OpenClaude Architecture Audit

**Audit date:** 2026-08-10  
**Repository:** `C:\Projects\main\localcoder`  
**Package:** `@gitlawb/openclaude` 0.5.2  
**Purpose in LiquidAIty:** the persistent Main Chat harness, interactive under-chat coder/terminal, and bounded headless coder runtime.

This document is a maintainer map, not a claim that every source feature is active. It deliberately distinguishes:

1. **present in source**;
2. **enabled in the current build**;
3. **wired into LiquidAIty**; and
4. **proved in a live runtime**.

Those are different levels of evidence. Direct source, focused tests, and live smoke results override this document if they disagree.

## 1. Executive verdict

LocalCoder is not merely a terminal skin and it is not merely a coding prompt. Its useful core is a complete agent runtime:

```text
LiquidAIty Main Chat UI
  -> Node backend session and saved-card policy
  -> persistent gRPC OpenClaude harness
  -> prompt/model/tool composition
  -> model loop and native/MCP tools
  -> streamed text, tool events, and session state

LiquidAIty Coder surface
  -> backend-owned launcher or bounded LocalCoder adapter
  -> real terminal/PTY or headless QueryEngine
  -> code edits, commands, tests, and CoderReport
```

The architecture is worth keeping. In particular, the combination of a conversational Main surface with a revealable, real coder/terminal below it is a useful product shape that Hermes does not automatically replace.

The repository around that core is much too large for LiquidAIty's needs. The current source scan found approximately **2,157 TypeScript/TSX/JavaScript/Python source files and 557,745 lines**, excluding vendored dependencies. The current `dist/cli.mjs` is about **20.7 MB**, with a source map of about **41.4 MB**. Large parts are provider breadth, terminal product UI, onboarding, remote/bridge experiments, marketplace/plugin UX, telemetry-era machinery, feature flags, and inherited product features that are not central to our two surfaces.

That does not make the entire codebase "shitcode." It means a capable runtime has accumulated several products' worth of behavior. There are strong seams—gRPC, `QueryEngine`, tool registration, MCP, agents, plugins, and prompt construction—but also warning signs:

- giant high-fan-in files and functions;
- two final system-prompt composition paths instead of one;
- more than eighty feature flags and many disabled feature families;
- source modules that are compiled or mapped even when their runtime branches are disabled;
- a very broad terminal UI and provider-management product around the narrower LiquidAIty use case;
- inherited names and compatibility branches that obscure actual ownership;
- extensive optional agent/team/remote behavior whose value has not been proved in our stack.

It may ultimately be possible to remove half the repository, but **not safely as one blind purge**. The right approach is to define the product slice, prove its entry points and preservation set, remove one independently testable feature family at a time, and delete every abandoned path in the same change. Documentation-first boundary work is appropriate now; a mass refactor is not.

## 2. The product slice we actually want

The smallest useful LiquidAIty slice is:

1. **Main Chat harness** — persistent multi-turn chat over gRPC, controlled by a saved agent card, able to stream text and tool activity.
2. **Coder surface** — a real terminal/PTY and a bounded headless coding path, both able to operate on the selected project.
3. **Host-owned policy** — LiquidAIty selects card, model, provider, working directory, native-tool grants, MCP-tool grants, and inherited context.
4. **External code intelligence** — CBM and, when useful, Serena and Graft remain MCP/external services rather than being reimplemented in this TypeScript repository.
5. **Extensibility seams** — MCP, LSP, skills, hooks, custom agents, and a small subset of subagent patterns.
6. **Proof and reporting** — real command/test results and a structured CoderReport, not terminal-looking prose.

The following are not required to prove that slice:

- a complete standalone onboarding product;
- an agent marketplace;
- vendor analytics or growth experimentation;
- remote-control and bridge products;
- every provider configuration UI;
- a tamagotchi/buddy/persona entertainment layer;
- multiple competing teammate process backends;
- duplicate computer-use implementations when an external MCP service is authoritative;
- a second graph, memory, or task-planning implementation inside LocalCoder.

## 3. Runtime boundaries

### 3.1 Persistent Main Chat over gRPC

The critical path is real and should be treated as core infrastructure.

- `src/grpc/server.ts` owns the OpenClaude-side gRPC server.
- `GrpcServer.connectOfficialPythonMcp` connects to the one official LiquidAIty Python MCP authority and checks required harness tools.
- `GrpcServer.handleChat` receives turns, retains per-session conversation state, resolves the requested agent/tool policy, constructs a `QueryEngine`, streams tool and text events, and returns completion/error events.
- The Node backend owns the external session contract and saved-card resolution under `apps/backend/src/coder/openclaude/session/`.
- The React/TypeScript application remains the control plane and pixels. It should not duplicate model policy or graph logic that belongs in Python rails and external services.

The gRPC connection is therefore not incidental glue. It is what makes the Main Chat surface persistent, streamable, and capable of invoking the actual coding-agent runtime. Replacing it with occasional CLI subprocess calls would lose the defining product behavior.

The current OpenClaude process treats failure to connect to its required official Python MCP as fatal. That is a deliberately strict boundary, but it should eventually be reviewed as a process-lifecycle decision: a required dependency may fail the harness closed without necessarily terminating an unrelated host process.

### 3.2 Interactive coder/terminal

The terminal path is useful for:

- greenfield projects and scratch work;
- direct observation of the coding agent's tool loop;
- long-running commands, dev servers, and interactive software;
- a revealable surface beneath Main Chat rather than a separate disconnected product;
- letting the user intervene when a headless job needs judgment.

It should remain visibly distinct from a Hermes activity panel. Hermes can receive its own terminal/UI when its real adapter is integrated, but it should not consume the dedicated under-chat Coder slot.

### 3.3 Bounded headless coder

`src/QueryEngine.ts` is the reusable non-visual engine. LiquidAIty's backend `LocalCoderAdapter` and `run_local_coder` path are intended to make it a bounded worker that receives an explicit task and produces a validated CoderReport.

This path is a better fit for approved PlanFlow task execution than asking the persistent Main conversation to silently become a background coder. It also gives the host a place to impose timeout, working root, tool grants, report schema, and process ownership.

## 4. System prompts: where they really live

The prompts are numerous, but they are not impossibly scattered. The important distinction is between **prompt producers** and the **final composition seams**.

### 4.1 Default coding prompt

`src/constants/prompts.ts:getSystemPrompt` builds the default OpenClaude coding prompt. Its sections cover the coding-agent identity, task behavior, tool use, tone, output efficiency, session guidance, memory, environment, language, output style, MCP instructions, scratchpad, context-management behavior, result summaries, token budget, and brief mode.

This is the inherited coding operating system. A saved personality should normally augment it, not replace every safety and tool-use instruction.

### 4.2 Interactive composition

`src/utils/queryContext.ts:fetchSystemPromptParts` resolves the default/custom prompt and user/system context.

`src/utils/systemPrompt.ts:buildEffectiveSystemPrompt` is the clearest final composer for the interactive path. Its effective priority is:

```text
explicit override
  -> coordinator prompt
  -> selected main-agent definition
  -> custom prompt
  -> default coding prompt
  + append prompt where allowed
```

The interactive REPL uses this helper.

### 4.3 gRPC/headless composition

`src/QueryEngine.ts:submitMessage` separately assembles the prompt from `fetchSystemPromptParts`, memory mechanics, and the append prompt. The gRPC handler passes the LiquidAIty saved-card prompt as `appendSystemPrompt`.

That means Main Chat's saved card already has a thin personality/role seam: the host can change the card prompt, model, and tool grants without forking hundreds of TypeScript prompt fragments. The inherited coding mechanics remain intact underneath it.

The architectural cleanup opportunity is specific: converge the interactive and headless final composers so there is one tested precedence contract. Do not move every feature-specific prompt into one giant file and do not clone the whole coding prompt into LiquidAIty cards.

### 4.4 Personality switching

A personality switcher can be implemented as saved agent-card selection:

- card system/personality prompt;
- card model/provider selection;
- exact native and MCP tool grants;
- inherited context selection;
- optional output style.

Provider profiles are credentials/endpoints/model defaults, not personalities. Custom agents and output styles can influence behavior, but the saved card is the appropriate LiquidAIty product-level authority.

## 5. Agent patterns in this repository

LocalCoder contains many distinct agent patterns. They should not all be treated as mandatory.

| Pattern | Mechanism | Best use | Current architectural judgment |
|---|---|---|---|
| Main-thread agent | Default/custom prompt plus selected model/tools | Persistent conversation or direct coding | Core |
| Saved-card doorway agent | Backend builds exact agent definition and grants for gRPC request | LiquidAIty Main agents and governed delegation | Core |
| Foreground subagent | `AgentTool` invokes `runAgent` and waits | Bounded research or specialist task | Keep |
| Background subagent | `AgentTool` starts work and returns a task handle | Parallel long-running work | Keep only with observable lifecycle |
| Resume subagent | Resume by prior agent/task identity | Continue an interrupted bounded job | Useful, must preserve context boundaries |
| Forked subagent | Forks rendered parent context/prompt | Closely related investigation | Useful but expensive; opt in |
| Built-in Explore agent | Read/navigation-oriented specialist | Fast repository orientation | Useful, overlaps CBM/Serena |
| Built-in Plan agent | Planning-oriented specialist | Complex bounded plans | Optional; must not become fake PlanFlow authority |
| Verification agent | Independent proof/checking | Regression checks and review | Valuable |
| General-purpose agent | Broad delegated task | Flexible fallback | Useful but easy to overuse |
| Custom agent file | Markdown/frontmatter agent definition | User/project specialists | Strong extension seam |
| Coordinator/worker mode | Coordinator prompt plus worker agents | Larger parallel work | Enabled, but needs LiquidAIty-specific proof before product reliance |
| In-process teammate/swarm | Async-local in-process teammates with mailbox/team state | Lower-overhead collaboration | Interesting; overlaps AGEntgraph and Hermes spawning |
| Pane/tmux/iTerm teammate | External terminal/process backends | Visible independent workers | Platform-heavy; probably not core on Windows |
| Team roster/mailbox/memory | Shared team coordination services | Multi-agent state and messages | Useful concepts, but do not create a second AgentGraph authority |
| Agent SDK query/resume | Programmatic engine API | Embedding in other hosts/tests | Valuable thin seam |
| Remote/bridge/CCR agents | Remote control and transport families | External orchestration | Disabled/unclear; removal candidate unless a concrete owner emerges |

These mechanisms do not by themselves tell an agent what project decision to make. An agent's behavior comes from the task, system prompt, selected agent definition, available tools, inherited context, memory, and runtime feedback. The orchestration pattern determines isolation, concurrency, lifecycle, and context sharing.

## 6. Tools and extension mechanisms

### 6.1 Native tools

`src/tools.ts:getAllBaseTools` is the main native registry. Depending on build flags and environment, the source supports:

- Bash and PowerShell;
- glob/grep and file read/edit/write;
- notebook operations;
- web fetch and web search;
- todos and plan/verification operations;
- foreground/background agents and task output/stop;
- user questions;
- skills;
- terminal and REPL operations;
- LSP operations;
- worktrees;
- teams, peers, and messages;
- workflows, sleep, cron, monitors, remote triggers, and notifications;
- MCP resource access and deferred tool search;
- optional browser tooling.

LiquidAIty's gRPC doorway does not have to expose all of them. It filters native and Python MCP tools through the exact saved-card grants before model-visible schemas are constructed. That is the correct capability boundary.

### 6.2 MCP

MCP is the cleanest shared external-service seam. The backend-owned `apps/backend/mcp.config.json` is passed to the LocalCoder launcher and currently includes Codebase Memory. A healthy design lets Codex, LocalCoder/OpenClaude, and Hermes consume the same authoritative external services, with per-agent grants, rather than embedding three graph implementations.

Recommended code-intelligence roles:

```text
CBM       structural map, architecture, call/import graph, change impact
Graft     compact repository context cards and optional task-start orientation
Serena    exact LSP symbols, references, diagnostics, and semantic edits
grep      literals, errors, config, and fallback after graph tools bound scope
source    final authority before claims or edits
```

This is an adaptive toolbox, not a mandatory five-stage ritual. In this repository the default order is CBM first because that is project law. Graft is optional when a compact context card will pay for its latency. Serena is used when semantic precision matters. Direct source and tests decide correctness.

### 6.3 LSP

The repository has its own LSP tooling, and Serena can also expose LSP-backed MCP operations. Do not automatically give an agent duplicate generic file/search/shell tools. Prefer Serena's semantic operations when needed and retain the native editor/shell path as the execution authority.

### 6.4 Plugins, skills, commands, and hooks

The plugin system can contribute custom agents, commands, hooks, MCP servers, and LSP servers. Skills provide reusable task procedures. Slash commands provide user-invoked workflows. Hook points include pre/post tool use, tool failure, user prompt submission, session start/end, stop/failure, subagent start/stop, notification, and setup.

These are powerful extension seams, but each added extension must have one owner and a live consumer. Do not keep scaffolding merely because a hook exists.

### 6.5 Provider profiles and output styles

The runtime supports multiple model/provider profiles and output styles. LiquidAIty should own which profiles are allowed and should avoid exposing an entire standalone provider-onboarding product unless users need it. Output style can remain a bounded behavioral preference; it should not become a second system-prompt authority.

## 7. Voice, vision, browser, and computer use

Source exists for voice and computer-use/browser-related behavior, but source presence is not runtime proof.

In the current `scripts/build.ts` feature configuration:

- `VOICE_MODE` is disabled;
- `WEB_BROWSER_TOOL` is disabled;
- coordinator mode, built-in Explore/Plan agents, team memory, message actions, monitor tooling, and Buddy are enabled;
- bridge, daemon, proactive/Kairos, background-session, away-summary, and several experimental features are disabled.

Therefore LocalCoder should not currently be described as having a proved voice or browser/computer-use product just because those modules exist. A clean path is to give the saved card an authoritative external vision/computer-use MCP tool, then add native UI capture only where the under-chat coder surface specifically benefits from it.

Agent Zero can remain a future separate card/runtime. Its value proposition—broad machine awareness and computer control—does not require turning LocalCoder into Agent Zero internally.

## 8. What makes LocalCoder a potentially better coder than Hermes

LocalCoder's advantages are structural, not mystical prompt quality:

- a mature edit/command/test loop tightly integrated with terminal UX;
- a persistent Main Chat transport and streaming event protocol;
- precise host filtering of tools and MCP capabilities;
- foreground, background, resume, fork, verification, and custom-agent patterns;
- native file/shell/LSP/worktree operations;
- interactive visibility when software, servers, or terminals need observation;
- a headless `QueryEngine` that can be wrapped in an explicit CoderPacket/CoderReport contract;
- extensive plugin, skill, command, and hook extension points.

Hermes may be the better general research and operations agent, especially where browser/computer use, long-lived memory, knowledge-graph research, and broad task execution dominate. Hermes should not be declared the primary coder merely because it can edit files, nor should LocalCoder be declared the Main brain merely because it contains a chat UI.

A sensible current division is:

```text
Main Chat             OpenClaude gRPC harness behind saved LiquidAIty card
Interactive coding    LocalCoder terminal/PTY beneath chat
Bounded coding jobs   LocalCoderAdapter / run_local_coder
Research and memory   Hermes through one real adapter
Knowledge provenance KnowGraph / Graphiti
Task/result lineage   AGEntgraph / Apache AGE
Broad computer agent Agent Zero later as its own card if still useful
```

This division can change after comparable end-to-end trials. It should not change because one repository advertises more tools.

## 9. Code intelligence evaluation

### 9.1 Codebase Memory

A dedicated full CBM index for `C:\Projects\main\localcoder` produced:

- 25,458 nodes;
- 101,330 edges;
- 2,219 files;
- 12,350 functions;
- 2,569 types;
- 1,101 methods;
- 169 classes;
- 94 interfaces.

It is the fastest useful structural doorway and should remain first for architecture and call/import discovery. The dedicated LocalCoder project avoids flooding the core `C:\Projects\main` project graph with unrelated nested repositories.

### 9.2 Graft

Graft 0.9.0 built a LocalCoder graph successfully:

- 2,197 files;
- 17,708 nodes;
- 59,841 edges;
- 2,197 generated context cards;
- initial build time approximately 227 seconds.

On a real prompt-composition question it refreshed one changed file automatically and returned compact, relevant source anchors in about 14.6 seconds. On a backend call-chain comparison it reduced context substantially but missed a service boundary and trusted-root hop that direct source search found. Graft is useful for orientation, not proof.

The root `C:\Projects\main` build is not acceptable as currently scoped: Graft 0.9.0 follows `git ls-files`, includes tracked nested repositories, and offers no tested directory-exclusion option that solves this. It attempted 3,711 files and was stopped after roughly five minutes. Keep Graft repository-specific and opt in until its scope can be controlled.

### 9.3 Serena

Serena 1.7.0 with the free TypeScript LSP backend successfully performed symbol overview, exact symbol lookup, declaration lookup, implementation lookup, diagnostics, safe symbol-body replacement, and a reference-aware rename on a controlled fixture.

Exact same-file operations were usually sub-second after startup. Cold cross-file reference/implementation requests took roughly 31–34 seconds. On the large real project, one cross-file reference lookup returned no references after the TypeScript index warning even though focused text search found them. Serena is valuable for precise semantic operations, but its current cold large-project indexing can miss references and must not be the sole proof.

The supported Codex MCP configuration exposes only semantic tools and excludes Serena's redundant generic file/search/shell/memory operations. The current Codex task cannot dynamically acquire a newly configured MCP server, so client-side acceptance requires a fresh Codex task/restart even though the server itself was exercised over a real MCP session.

### 9.4 Combined workflow

The observed efficient order for this audit was:

```text
CBM structural doorway
  -> optional Graft context card
  -> Serena exact symbol/diagnostic/refactor
  -> focused grep for literals or missed references
  -> direct source
  -> tests/runtime proof
```

Graft, CBM, and Serena can coexist without project-root confusion when each is explicitly rooted at LocalCoder. The combined path adds noticeable cold latency, so agents should not force every tool on every task.

## 10. Reduction strategy

### 10.1 Preserve before deleting

The preservation set for any reduction is:

- gRPC Main Chat transport and multi-turn session behavior;
- official Python MCP connection and exact saved-card grants;
- interactive terminal/PTY coder;
- bounded headless `QueryEngine` and LocalCoder adapter;
- core file, shell, edit, test, LSP, MCP, and reporting tools;
- selected custom/subagent and verification patterns;
- model/provider path actually used by LiquidAIty;
- privacy/no-phone-home build proof;
- Windows startup and process cleanup;
- existing focused tests for every touched subsystem.

### 10.2 High-confidence investigation candidates

These families deserve reachability and product-ownership audits first:

- disabled bridge, daemon, remote-control, CCR, proactive, and Kairos paths;
- telemetry/analytics/growth-experiment source replaced by the no-telemetry build plugin;
- feedback survey, marketplace, GitHub-app onboarding, and vendor-specific promotional UI;
- Buddy/tamagotchi/companion behavior if it has no LiquidAIty owner;
- unused platform-specific teammate backends such as tmux/iTerm on a Windows-owned product;
- unused editor extension and native installer/updater surfaces;
- unused provider setup screens and compatibility layers;
- disabled voice/browser/computer-use implementations if external MCP services become authoritative.

Names and disabled flags are not enough to delete these. For each family, prove import reachability, build inclusion, runtime registration, tests, and callers. Remove the whole abandoned path—implementation, registration, tests that only self-import it, flags, docs, and dependencies—in the same reviewed change.

### 10.3 Medium-risk consolidation candidates

- converge the two final system-prompt composers;
- reduce giant entrypoint/REPL/AgentTool functions without leaving old and new paths together;
- select one Windows teammate backend before preserving a complete cross-platform matrix;
- make saved-card policy the single host authority for model/tools/personality;
- separate essential runtime protocol from standalone terminal-product onboarding UI;
- remove exact duplicate utilities only after live importer proof.

### 10.4 Why not rip out 50% now

The source map indicates that much of the fork participates in the bundle module graph, even when feature branches are disabled. A large deletion could easily break registration side effects, generated schemas, prompt assumptions, process cleanup, or plugin compatibility. The repository has already demonstrated how "splitting" or layering a second implementation creates more dead code.

The safe objective is not a percentage. It is a smaller, proven product slice with fewer authorities. Fifty percent may be the result after staged deletion; it must not be the acceptance criterion for the first pass.

## 11. Recommended staged work

### Stage 0 — prove the current slice

1. Run typecheck, focused gRPC/prompt/agent tests, privacy verification, and CLI smoke.
2. Run one saved-card Main Chat session with an exact limited tool set.
3. Run one bounded `run_local_coder` job that edits a disposable fixture, tests it, and returns a valid CoderReport.
4. Prove terminal launch and cleanup on Windows.
5. Record which provider/model path was actually used.

### Stage 1 — stabilize boundaries

1. Make the gRPC/headless and interactive prompt precedence share one tested composer.
2. Document and test saved-card personality/model/tool precedence.
3. Keep CBM/Serena/Graft external and selectively granted.
4. Keep Hermes and AgentGraph as external authorities, not internal OpenClaude features.
5. Add no new UI until the two core execution paths are proved.

### Stage 2 — delete obvious product baggage

Audit and remove one high-confidence family at a time. Each change must establish a pre-edit baseline, delete registration and implementation together, rebuild, rerun the preservation set, inspect the bundle/import graph, and maintain a Regression Ratio of 0.000.

### Stage 3 — simplify agent patterns

Retain only the patterns LiquidAIty actually uses. A reasonable initial set is main-thread agent, saved-card doorway, foreground/background bounded subagent, resume, verification, custom agent, and one teammate implementation. Coordinator/swarm behavior should earn its place with an end-to-end task comparison against Hermes/AGEntgraph orchestration.

### Stage 4 — evaluate the primary-agent decision

Compare the same realistic work on:

- Main Chat plus LocalCoder;
- Hermes with its real adapter, memory, and knowledge tools;
- optionally Agent Zero as a separate card.

Measure task correctness, intervention count, tool calls, files/context read, edit precision, runtime latency, recovery from failure, proof quality, and user visibility. Then decide which is Main and which is Coder. Do not decide from repository size or feature lists alone.

## 12. Maintainer rules

- Keep internal `openclaude` protocol/package names until a rename has measurable value; do not mix branding churn with architecture work.
- Do not add a second gRPC harness, MCP owner, coder adapter, prompt authority, graph, memory store, or task ledger.
- Do not treat prompt text as proof that a runtime or subagent executed.
- Do not let a custom card silently erase the coding tool/safety mechanics unless an explicit override contract says so.
- Do not expose every native or MCP tool to every card.
- Do not call source-only voice, vision, browser, or computer-use code a working feature.
- Do not replace the native terminal with a fake activity panel.
- Do not make OpenClaude own KnowGraph, ThinkGraph, CodeGraph, SkillsGraph, or AgentGraph.
- When changing approach, delete the abandoned path in the same change.
- Tests that only import dead code are not evidence that the feature has a product consumer.

## 13. Practical commands

From `C:\Projects\main\localcoder`:

```powershell
# Static and build proof
bun run typecheck
bun run build
bun run verify:privacy

# Test suite or focused tests
bun test
bun test src/grpc

# Built CLI sanity
node .\dist\cli.mjs --version
```

From `C:\Projects\main`:

```powershell
# Confirm the backend-owned terminal launcher and MCP handoff
Select-String -Path .\apps\backend\scripts\openclaude-terminal-launch.ps1 -Pattern 'localcoder|--mcp-config'

# Confirm backend MCP configuration
Get-Content .\apps\backend\mcp.config.json
```

Interactive launch is not a substitute for an end-to-end Main Chat or bounded CoderReport test. A successful build is not proof that a disabled feature works.

## 14. Current decision

Keep and stabilize LocalCoder as the code-execution runtime and OpenClaude-derived gRPC Main Chat harness. Do not make it the owner of research memory, knowledge graphs, or global agent orchestration. Do not perform a mass purge yet. Prove the two product paths, unify the prompt boundary, then remove unowned feature families in measured stages.

The most likely durable architecture is shared external intelligence:

```text
Codex --------------------+
LocalCoder/OpenClaude ----+--> CBM / Serena / optional repo-scoped Graft
Hermes -------------------+--> KnowGraph / Graphiti and other shared MCP services
                           +--> AGEntgraph for approved task/result lineage
```

That is thinner, easier to govern, and more replaceable than embedding large custom graph or semantic-code implementations in this fork.

## 15. What LiquidAIty is actually using, and whether Hermes should replace it

The migration decision should be based on the wired product features below, not on the total size of either repository.

### 15.1 Main Chat mode

LiquidAIty currently uses OpenClaude/LocalCoder for:

- a persistent multi-turn gRPC conversation rather than one CLI process per message;
- saved-card ownership of Main's prompt, provider, model, and exact MCP grants;
- streamed assistant text, provider-exposed reasoning, tool start/result events, progress events, and usage/context estimates;
- mid-turn permission questions, answer handling, cancellation, and durable conversation history;
- explicit `chat` versus `canvas` doorway policy: chat exposes the selected always-on sub-agents, while canvas may expose the larger eligible saved-card topology;
- inherited-context sub-agents whose identity and grants come from saved cards;
- the split workspace in which chat remains visible while canvas, graphs, Kanban, or another work surface is inspected;
- the revealable OpenClaude terminal immediately below chat.

The card currently labelled Hermes in this mode is an OpenClaude/Harness-native inherited-context agent. It uses its saved prompt, model, tools, and parent context, but it does not execute the installed Nous Hermes runtime. That naming distinction must be visible in the product until the real adapter exists.

### 15.2 Coder/code mode

LiquidAIty currently uses two OpenClaude coding modes:

1. **Interactive console:** a backend-owned Windows PTY with xterm rendering, raw input, resize, transcript replay, interrupt, stop, attach-existing behavior, provider/model selection, and an ordinary project shell mode.
2. **Bounded Local Coder job:** `run_local_coder` enters through the saved-card/Python contract, receives a backend-injected trusted root and run identity, executes a bounded objective, and must return a validated CoderReport.

The underlying repository also supplies capabilities that are valuable options even when not all are currently activated: native file/edit/shell/test tools, MCP, LSP, custom agents, foreground/background sub-agents, resume/fork, verification agents, skills, hooks, plugins, provider profiles, structured output, and team/coordinator patterns. This latent feature library is part of the reason to keep the fork. It should be exposed deliberately through build flags and card grants, not deleted merely because it is inactive today.

### 15.3 Feature-by-feature decision

| Capability | OpenClaude/LocalCoder today | Hermes today | Decision and reason |
| --- | --- | --- | --- |
| Main split chat + revealable coder | Already wired into the LiquidAIty React workspace and gRPC session | Could be recreated through gateway/API streaming, but not in this UI | **Keep OpenClaude.** Replacing it would discard working product integration and require rebuilding session/event/permission UI. |
| Interactive coding terminal | Real PTY, xterm, attach, resize, interrupt, stop | Real Hermes CLI can run in its own separate PTY | **Keep both.** OpenClaude is the code terminal; Hermes terminal is the general/research agent console. |
| Bounded coding job + CoderReport | Existing `run_local_coder` saved-card path | Hermes can code and can be given completion contracts, but does not currently emit this host contract | **Keep LocalCoder initially.** Compare later on the same disposable task before moving the contract. |
| Rich coding-agent patterns | Extensive native agent/tool/plugin/LSP/MCP framework | Strong general agent, delegation, skills, profiles, computer use | **Keep OpenClaude as the specialist coder.** Hermes does not need to duplicate every coding pattern. |
| General research and operator agent | Possible, but pulls the huge coding runtime into a broader role | Native strength: web/vision/computer use, memory, skills, profiles, messaging, API/gateway | **Prefer real Hermes.** This is the cleaner home for general/research work. |
| Long-lived personal/session memory | OpenClaude has session/project mechanisms but should not own global product memory | Built-in memory, session search, background review, optional provider | **Prefer Hermes plus shared Engraphis/KnowGraph.** Keep authorities separate. |
| Durable multi-agent work queue | OpenClaude has sub-agents/teams but not the same durable human-visible queue | Native Kanban profiles and OS workers | **Prefer Hermes Kanban.** Do not rebuild it inside OpenClaude. |
| Code intelligence | MCP/LSP consumption seams | MCP/tool consumption seams | **Share CBM and Serena externally; use Graft selectively.** No embedded duplicate. |
| Agent-card/canvas policy | Already native to LiquidAIty's saved deck and UI | Profiles are strong runtime identities but are not the LiquidAIty card graph | **Keep the card canvas as control policy.** Map a card to a Hermes profile/adapter instead of replacing cards with profiles. |

### 15.4 Recommendation

Changing Main and Coder wholesale to Hermes now would look cleaner at the repository level but create a larger product migration: persistent chat/session transport, streaming event translation, permission handling, saved-card policy, terminal embedding, bounded CoderReport behavior, and existing tests would all need to be rebuilt or adapted. The current investment is far enough along that replacement is more trouble than it is worth before a direct comparison.

The lowest-risk path is therefore:

1. keep OpenClaude as the working Main Chat harness and specialist Coder;
2. keep its large optional feature library behind flags/grants and delete only individually proven baggage;
3. wire the installed Hermes runtime once, thinly, for the Hermes card and its separate terminal;
4. use Hermes for research, general operation, memory-assisted work, and durable Kanban fleets;
5. let both runtimes consume the same external CBM, Serena, Engraphis, KnowGraph/Graphiti, and AgentGraph services;
6. compare one real bounded coding task after the adapter exists, then decide whether Hermes should also become an emergency/fallback coder.

This preserves the novel split-chat coding UX you already built while giving Hermes the jobs it can perform more cleanly. It also leaves a credible emergency path: if OpenClaude later proves too expensive to maintain, port the small bounded CoderReport contract and terminal/session adapter to Hermes rather than replacing the entire UI and graph-control plane at once.
