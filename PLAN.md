# LiquidAIty Core v0 Plan

This is the current product plan. It describes what the repository owns now, what must remain
separate, and the smallest proof required before live model testing. Historical migrations belong in
Git history and clearly labelled purge notes, not in the active plan.

## Core v0

```text
Chat / GPT plugin
  → Main Chat Card (Hermes, profile liquidaity-main)
     ├─ flow → Coder Card (Hermes delegate, profile coder, terminal under Chat)
     ├─ flow → Kanban Card (Hermes, profile liquidaity-hermes-steward)
     └─ magentic_control → automatic or optionally reviewed Card handoff → native AutoGen Magentic-One

Direct Assistant Card
  → native AutoGen AssistantAgent

Every shared tool
  → one official Python HTTP MCP host
```

OpenClaude, LocalCoder, and Bun are absent from the product and dependency graph. Stable persisted
identifiers such as `card_local_coder` and `template_local_coder` remain migration-compatible IDs for
the Hermes-backed Coder; they do not identify a runtime.

## Current versus unproven

### Current source contracts

- Saved Cards own identity, prompt, provider/model/profile, runtime binding, enabled state, and grants.
- `runtime.kind` plus `runtime.mode` selects Hermes Main/delegate/Kanban, AutoGen Assistant, or native
  Magentic-One. Card names and template text do not select runtimes.
- Main, Coder, and Kanban are separate saved Hermes Cards with separate profiles and runtime homes.
- Main delegates only across saved AGE/ReactFlow relationships.
- The official Python MCP host is the shared tool doorway. Its catalog is discovered dynamically;
  documentation and tests must not promise a permanent numeric tool count.
- IDD declares legal inputs and operations. A saved Card grants a ceiling. One transient Card call
  carries bounded values, tools, and native references for one communication.
- Python rails own deterministic runtime work, AutoGen, Magentic-One, native tools, and graph adapters.
- ThinkGraph, KnowGraph, CodeGraph, and AgentGraph have separate owners and never become one copied
  graph.
- Reveal renders compact native attention events. It never infers hidden reasoning or writes graph
  meaning.
- The Agent Builder Graphs workspace uses the embedded CodeGraph renderer with bounded native CBM
  projections. The removed standalone CBM demo/package shell is not part of the product.

### Still requiring live proof

- A completed Main response through the saved Hermes profile and saved account/model.
- Native Main-to-Coder delegation with truthful child Run, tool, native-reference, and AGE lineage.
- Main-to-Kanban execution and separate-session memory behavior.
- Automatic and optionally reviewed one-IDF handoff to one native Magentic-One run.
- End-to-end Reveal pacing for graph consumption, traversal, handoff, and writes.
- Engraphis semantic recall. Nonsemantic ThinkGraph operations remain the near-term boundary.

Structural tests are not substitutes for these live proofs.

## Authority model

```text
effective capability
  = saved Card capability ceiling
  ∩ IDD operation requirements
  ∩ current input selections and native references
  ∩ saved AGE/ReactFlow relationship
  ∩ explicit user approval where required
```

Routing metadata, sender/target Card IDs, Run IDs, conversation IDs, and correlation IDs stay outside
the transient Card call. The call carries task meaning and selected context, not runtime control.

## Runtime roles

### Main Chat

- Card: `card_main_chat`
- Hermes mode/profile: `main` / `liquidaity-main`
- Owns the persistent conversation front door and approval of downstream work.
- May use only its saved tools and its saved outgoing relationships.

### Coder

- Card: `card_local_coder` (stable historical database ID; user-facing name is Coder)
- Hermes mode/profile: `delegate` / `coder`
- Owns bounded repository work and the under-chat terminal.
- Uses CodeGraph/CBM first, then direct source and focused proof.
- Is not automatically a Magentic-One worker.

### Kanban helper

- Card: `card_hermes_steward`
- Hermes mode/profile: `kanban` / `liquidaity-hermes-steward`
- Owns planning, native Kanban, research, memory, and KnowGraph work within its grants.
- Has separate saved-Card identity, prompt, model, grants, and stable native session. Main, Coder, and
  Kanban intentionally share the one native Hermes home, root OAuth/provider configuration,
  `state.db`, and Holographic memory database.

### AutoGen

- The checked-in first-party `autogen-main` fork is pinned to official Python AutoGen 0.7.5 and is
  the sole installed source for `autogen-core`, `autogen-agentchat`, and `autogen-ext`. Its upstream
  base is frozen; LiquidAIty maintains it instead of adopting later Microsoft versions.
- `AssistantAgent` is the direct single-Card rail.
- `MagenticOneGroupChat` is the native team rail.
- Task and Progress Ledgers remain private AutoGen state.
- Saved `magentic_control` and `magentic_option` edges define control and worker eligibility.

## Graph and attention plan

```text
ThinkGraph  = Engraphis SQLite project reasoning and memory
KnowGraph   = Graphiti/Neo4j sourced knowledge and provenance
CodeGraph   = native CBM repository structure
AgentGraph  = Cards, relationships, Runs, delegation, references, tools, and artifacts in AGE
```

The foreground graph starts empty and reveals only native objects actually returned, selected,
consumed, traversed, handed off, or written. Inspector detail may show technical receipts. Card faces
may show correlated tool activity, but Card animation is not a substitute for graph attention.

## Supported repository commands

Node is pinned by `.nvmrc`, `engines`, and `packageManager`. Dependency lifecycle scripts are disabled
by `.npmrc` and must also be disabled explicitly during install.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run prisma:generate
npm run typecheck:all
npm --workspace apps/backend run build
npm --workspace client run build
npm test -- --run <focused-specs>
npm run dev:fresh
```

Python services keep separate existing virtual environments and requirement owners:

```powershell
apps\python-models\.venv\Scripts\python.exe -m pip install --no-cache-dir -r apps\python-models\requirements.txt
services\knowgraph\.venv\Scripts\python.exe -m pip install --no-cache-dir -r services\knowgraph\requirements.txt
apps\python-models\.venv\Scripts\python.exe -m pip check
services\knowgraph\.venv\Scripts\python.exe -m pip check
```

Ordinary startup is exactly `npm run dev:fresh`. It owns frontend, backend, Python AutoGen rails,
KnowGraph, official MCP, and readiness-gated ngrok. Component scripts are implementation details, not
alternate startup instructions.

## Ordered delivery

1. Keep cold install, typecheck, build, focused tests, and static startup proof green.
2. Prove Main alone with one bounded, explicitly approved model call.
3. Prove Main → Coder and truthful child lineage.
4. Prove Main → Kanban with separate session/memory.
5. Prove transient Mag One Card input → native Magentic-One.
6. Prove native graph attention and Reveal from real read/write events.
7. Only then reduce remaining legacy names, tune the UI, or expand memory behavior.

## Core v0 acceptance

- One Card authority, one IDD, one transient Python call materializer, one official Python MCP host.
- One canonical `dev:fresh` tree and one root npm workspace lock.
- Hermes Main/Coder/Kanban, AutoGen Assistant/Mag One, and four graph authorities remain distinct.
- No OpenClaude/LocalCoder/Bun implementation, package root, lock, fallback, or downloader.
- No fake graph activity, provider substitution, automatic embeddings, or product-data reset.
- Regression Ratio for every accepted change is `0.000`.
