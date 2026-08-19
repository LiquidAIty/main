# LiquidAIty Core v0 Architecture

This document describes current source ownership. `PLAN.md` orders future proof; `FUTURE.md` contains
deferred work; `AGENTS.md` and `DONT.md` are execution law.

## One-line law

```text
TypeScript = transport and pixels
Python rails = runtime and deterministic computation
models = semantic reasoning
saved Cards and graph topology = identity and authority
```

## System map

```text
React/Vite Agent Builder and Chat
  → Node/TypeScript HTTP, SSE, saved-state, and session transport
     → persistent repo-owned Hermes ACP adapter
        ├─ Main: profile liquidaity-main
        ├─ Coder: profile coder
        └─ Kanban: profile liquidaity-hermes-steward
     → official Python MCP client boundary
        → one official Python HTTP MCP host on :8765/mcp
           ├─ Card/IDF/AGE deterministic rails
           ├─ AutoGen AssistantAgent
           ├─ AutoGen MagenticOneGroupChat
           ├─ ThinkGraph/Engraphis
           ├─ KnowGraph/Graphiti
           └─ CodeGraph/native CBM
```

ngrok is a readiness-gated child of the canonical service tree and forwards only to the official MCP
host. OAuth remains enforced at the MCP resource boundary.

## Saved Cards and runtime binding

A saved Card is the permanent authority for identity, prompt, provider/model/profile, runtime binding,
enabled state, and tool/capability grants. Callers supply input and references, never replacement Card
definitions.

Current internal Cards:

| User-facing role | Stable Card ID | Runtime | Profile |
| --- | --- | --- | --- |
| Main Chat | `card_main_chat` | Hermes `main` | `liquidaity-main` |
| Coder | `card_local_coder` | Hermes `delegate` | `coder` |
| Kanban | `card_hermes_steward` | Hermes `kanban` | `liquidaity-hermes-steward` |

`card_local_coder` and `template_local_coder` are retained database identities from an earlier runtime.
They no longer imply LocalCoder or OpenClaude behavior. Renaming them requires a deliberate stored-data
migration; source must not infer runtime ownership from those strings.

The current default topology preserves:

- Main → Coder: `flow`
- Main → Kanban: `flow`
- Main → Magentic-One: `magentic_control`
- explicit production-agent → Magentic-One edges: `magentic_option`

AGE/ReactFlow relationships authorize who may call whom. They do not select providers, rewrite IDF, or
start runtimes.

## Hermes ownership

`apps/backend/src/hermes/mainAdapter.ts` owns persistent Hermes ACP construction and sessions.
`apps/backend/src/hermes/coderTerminal.ts` owns the Coder terminal lifecycle. Main, Coder, and Kanban
share the genuine repo-owned Hermes codebase. Every persistent top-level Hermes Card process receives
its own `HERMES_HOME`, working directory, session, and memory boundary. A native `delegate_task` child
is ephemeral inside its owning parent's Hermes process: it receives the selected saved prompt/model/
tool profile and a separate child session database, but currently inherits the parent's profile home.
Do not describe that child as having independent persistent memory until Hermes exposes a safe
per-agent home boundary or LiquidAIty runs it as another top-level Card process.

The backend injects server-owned Card, conversation, Run, and correlation identity. Hermes receives the
exact materialized IDF plus saved-card context. No generic model call or another agent runtime hides
behind Hermes.

## AutoGen ownership

Python rails own both AutoGen modes:

- direct Assistant Cards use native `AssistantAgent`;
- team Cards use native `MagenticOneGroupChat`.

Saved Card configuration and graph edges define participants. LiquidAIty does not reconstruct private
Task/Progress Ledgers or add a TypeScript participant classifier. Mag One receives an approved exact
IDF through the official MCP/Card boundary; it does not consume Main's internal subagents.

## MCP and transport

`apps/python-models/app/mcp_host.py` is the one official shared MCP host. Its public catalog is assembled
from current registered owners and is discovered dynamically. A fixed numeric catalog promise is not an
architecture contract.

Backend routes containing `/api/coder/mcp-bridge/` are retained transport names used by the official
Python MCP host to reach server-owned Card, conversation, Run, and persistence operations. They are not
a second MCP server and do not represent the removed Coder runtime. Rename only with a versioned caller
migration.

Unknown tools, missing grants, unsupported runtimes, provider failures, and missing relationships fail
honestly. There is no alias, provider substitution, duplicate registry, or direct-database shortcut.

## IDD and exact IDF

`LiquidAIty.idd` is the one native input declaration language. It defines legal variables, types,
constraints, tools, native operations, and output forms.

For one call, Python rails materialize an exact transient Markdown IDF from saved Card context and the
bounded values/native references selected for that communication. The Inspector-visible bytes are the
bytes delivered to the runtime, subject only to mechanical protocol formatting. The IDF is not a
manifest, task database, runtime router, or graph.

```text
capability = Card grants ∩ IDD requirements ∩ IDF claims ∩ AGE relationship ∩ approval
```

Routing IDs and telemetry remain outside IDF. PostgreSQL may save an IDF revision only through the
explicit canonical save path.

## Graph owners

| Graph | Native owner | Meaning |
| --- | --- | --- |
| ThinkGraph | Engraphis SQLite/Python | project reasoning and operational memory |
| KnowGraph | Graphiti/Neo4j/Python | sourced knowledge, evidence, and provenance |
| CodeGraph | native codebase-memory-mcp | repository structure and impact |
| AgentGraph | Apache AGE/PostgreSQL | Card relationships, delegation, Runs, tools, references, artifacts |

No owner copies another graph into itself. Context uses native IDs, bounded selections, and provenance.
AgentGraph observes execution; it does not own Card configuration or runtime lifecycle.

## Native attention and Reveal

`useAgentBuilderGraphAttention` consumes compact attention events from real graph/tool activity.
`KnowledgeGraphFramework` selects ThinkGraph, KnowGraph, and CodeGraph. CodeGraph renders through:

```text
/agentbuilder
→ AgentBuilderRail Graphs control
→ CompanionSurfaceHost
→ KnowledgeGraphFramework
→ NativeCodeGraphSurface
→ embedded GraphTab
→ GraphScene
```

`NativeAuthorityGraphSurface.tsx` converts bounded native projections without changing native IDs.
The embedded CodeGraph view starts from returned objects and expands explicitly; it does not auto-load
the entire repository graph. The former standalone CBM UI app/package/demo shell and duplicated UI
primitives are intentionally absent.

Valid activation events include native query results, selections, delivery/consumption, traversal,
writes, and run completion/failure. Answer prose and hidden reasoning are never telemetry.

## Persistence

- PostgreSQL: Projects, saved Cards/revisions, provider/model references, conversations, prompt-free
  Runs, explicit IDF revisions, and artifact metadata.
- AGE on PostgreSQL: saved Card relationships and prompt-free execution/reference observations.
- Neo4j: KnowGraph.
- Engraphis SQLite: ThinkGraph.
- Native CBM owner: CodeGraph.

No cleanup task may reset or reseed these stores.

## Repository and dependency ownership

The root npm workspace owns root, `client`, and `apps/backend` through one `package-lock.json`. Separate
locks under excluded vendor/imported roots remain owned by those independent projects and are not part
of ordinary Core v0 install.

`.npmrc` disables dependency lifecycle scripts, saves exact direct versions, and requires npm locks.
`.nvmrc`, `engines`, and `packageManager` carry one Node/npm pin. Prisma generation is an explicit
first-party command after install; it is never enabled as an install hook.

Python dependency owners remain:

- `apps/python-models/requirements.txt` for official MCP, deterministic Card/IDF/AGE rails, AutoGen,
  and the local Engraphis integration;
- `services/knowgraph/requirements.txt` for Graphiti/Neo4j;
- `services/esn_rls/requirements.txt` for the separately retained ESN service boundary.

## Canonical startup

`npm run dev:fresh` is the only supported full-product start. It stops the six product ports, creates
one ephemeral internal MCP secret, and supervises frontend `5173`, backend `4000`, AutoGen rails `8003`,
KnowGraph `8001`, official MCP `8765`, and ngrok inspector `4040`.

Component commands remain private children of that tree. A partial service start is diagnostic only and
is not product readiness proof.

## Controlled vendor divergence

Hermes is the only vendor boundary required by the three internal Cards. LiquidAIty-owned integration
stays in the backend adapter whenever possible. Any Hermes edit must remain narrowly recorded, tested,
and justified against an unavailable upstream adapter/configuration hook.

The current contained divergence tracks
[`NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent) at upstream commit
`210cdb0ed35d4f7ef0957182312baaaa9e19bfbc`. ACP has no native host contract for publishing a bounded
set of named child profiles, so `Hermes/acp_adapter/host_profiles.py` plus marked hooks in
`acp_adapter/session.py`, `acp_adapter/server.py`, and `tools/delegate_tool.py` accept only trusted
`_meta.hermes.sessionConfig`. The extension contains no LiquidAIty Card types or credentials: the
backend maps saved Cards into ordinary Hermes prompt/model/toolset/tool/skill fields, gives each Card a
separately scoped authenticated connection to the same official MCP host, and lets the model select
only an opaque profile ID. Sessions without that metadata retain upstream Hermes behavior. Focused
no-provider tests live in `Hermes/tests/acp_adapter/test_host_profiles.py` and
`Hermes/tests/tools/test_delegate.py`; the complete rebase, rollback, and upstream-contribution plan is
owned by `Hermes/LIQUIDAITY_VENDOR_PATCHES.md`. On each Hermes refresh, remove this divergence if
upstream supplies the equivalent public hook; otherwise reapply only these marked symbols and rerun
the registered tests.

OpenClaude/LocalCoder is not a vendor boundary, package root, fallback, or supported runtime in Core v0.
WorldSignals, Engraphis, and other imported roots remain isolated owners and are not ordinary cleanup
targets.

## Known limitations

- Complete loaded-runtime and user-visible model proof is a separate approved run.
- Native Hermes child Run/AGE attribution still requires end-to-end proof.
- Reveal pacing, stacked 3D presentation, and IDF-consumption illumination remain incomplete.
- Engraphis semantic embeddings are deferred and must remain lazy/offline when revisited.
- Some stable route and Card IDs retain historical words for persistence/caller compatibility; they are
  classified legacy identifiers, not active architectures.
