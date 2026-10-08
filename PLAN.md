# LiquidAIty current plan

[Execution law](AGENTS.md) · [Known failures](DONT.md) · [Current architecture](ARCHITECTURE.md) · [Deferred work](FUTURE.md)

This file records only the current route and the next proof boundary. It is not a runtime input,
incident diary, or historical implementation record. Git preserves superseded implementations.

## Product outcome

A user talks to Main or directly addresses an authorized saved Card. The exact saved Card revision,
current input, selected references, and effective grants produce one canonical `in.idf`; HermesLatest
performs the real turn; and LiquidAIty shows the actual response, references, Run state, usage,
failures, and lineage without inventing another execution owner.

Builder remains saved Card `builder` and owns the lower terminal. ThinkGraph is Engraphis,
KnowGraph is Graphiti, CodeGraph is Codebase Memory, and AgentGraph is AGE/PostgreSQL. Team and
Magnetic use the retained HermesLatest task/dependency extensions beneath their existing saved Cards
and topology.

## Current source

The saved restoration baseline is commit `3cc61563cc81e1e4ae12867cf8b916bf867e77a3`. The current
working tree contains the bounded inverse-residue cleanup that must pass static proof before one
coordinated reload.

- Saved Cards and orange/blue topology own durable identity, configuration, grants, and authority.
- Python rails owns Card/Run preparation, the canonical operation registry, deterministic validation,
  the single IDF materializer, tool dispatch, graph adapters, and durable Run settlement.
- The backend owns authenticated HTTP/SSE transport, exact Card/Project/conversation mapping, one
  shared Hermes Gateway client connection, submission correlation, and truthful result projection.
- Saved Card execution is split across `sharedChat.routes.ts`, `savedSpecialist.routes.ts`, and
  `thinkGraphRevision.routes.ts`, using the shared `savedCardAuthority`, `hermesCardSession`, and
  `savedCardRun` services; the former generic Main-session router is deleted.
- Builder's Project-owned `projectCodeFolder` is source-wired to managed Project storage and a
  Hermes Docker mount for Builder only. Loaded Builder product proof is not established.
- HermesLatest owns profiles, sessions, inference, its built-in tools, Bot delivery, queue behavior,
  retries, terminal/PTY, Team task execution, Magnetic task/dependency execution, and synthesis.
- Dynamic Tools present only the current Run's authorized Card capabilities and call the existing
  authenticated Python dispatcher. Bot Mode is not a product tool.
- The flat live catalog is the selectable product projection. IDD consumes that projection for
  Builder/editor choices and never authorizes, validates, or dispatches an ordinary Run.
- One durable Card maps to one reusable Hermes profile. Projects and conversations create distinct
  sessions; Project topology and private/session state are not written into the shared profile.
- After an ordinary Main response is persisted and returned, the restored saved ThinkGraph Card
  lifecycle may process the exact completed User/Main pair into one Engraphis episodic Think. Jev
  alone admits and classifies durable semantic edges.
- KnowGraph remains Graphiti-backed sourced research. Its automatic research follow-up remains off
  until the manual `knowgraph.research` path succeeds in real product acceptance.
- The Card inspector's compact **Last run** metrics show only the latest/current Run's model, elapsed
  time, token count, estimated cost, and tool-call count. They are a projection of durable Run data,
  not another runtime dashboard or event store.

## Static proof already established

- The application-owned AgentTerminal/CardRuntime process, registry, reconciler, per-Card Gateway,
  loopback Card-tools plugin, and startup ownership generations are deleted.
- Main, direct Card delivery, profile materialization, terminal attachment, Run history, Dynamic
  Tools, Team/Magnetic preparation, graph projection, and catalog boundaries have focused source
  tests from the restored baseline.
- The catalog reduction and saved-grant reconciliation use the one canonical operation-definition
  set; Engraphis exposes the Smart surface selected for the product.
- Production backend/client builds and typechecks passed at the saved restoration baseline.
- A later `npm run dev:fresh` invocation compiled the backend and launched the local services, but MCP
  readiness remained `503` because the application CBM dependency was unavailable; the public tunnel
  therefore remained unpublished. That is a real remaining failure, not plugin acceptance.

Static tests, a successful process start, loaded runtime behavior, external MCP/plugin behavior, and
visual acceptance remain separate proof tiers.

## Current cleanup gate

Before another reload:

1. finish the inverse audit of the deleted runtime, catalog, graph-reference, and old-Hermes symbols;
2. remove only proven dead callers, fields, tests, configuration, and stale current-state documents;
3. keep checksum-bound recovery exports and append-only migrations unchanged;
4. make `HermesLatest/LIQUIDAITY_PATCHES.md` and its generated overlay use Git history—not a deleted
   comparison directory—as the update authority, then clean-apply-check the overlay;
5. run focused control-plane, backend, client, and Hermes overlay proof;
6. reindex the current first-party CBM scope once and repeat the inverse searches.

## One coordinated reload and real acceptance

After the static gate is green, run `npm run dev:fresh` once and verify in dependency order:

1. HermesLatest, backend, Python rails, KnowGraph, MCP, frontend, and WorldView become healthy, with
   executable/source identities from the current checkout only;
2. the application CBM catalog dependency becomes ready, MCP `/health/ready` succeeds, and the
   existing ngrok publication comes online without creating a second tunnel;
3. the live flat catalog and every saved Card grant reconcile with zero unknown, duplicate,
   orphaned, or undispatchable entries; IDD failure cannot block an ordinary turn;
4. Main completes one natural ordinary turn without invoking Magnetic and keeps the submitted user
   message continuously visible;
5. an addressed Builder turn completes a real read-only CBM call and its Hermes PTY attaches;
6. an addressed KnowGraph turn completes a real granted Graphiti read;
7. Team and Magnetic prepare through HermesLatest; do not execute a Mag One mission without a new
   explicitly approved mission;
8. Run history identifies the exact Card, conversation, and submission, and Stop interrupts only the
   correlated submission;
9. the refreshed external GPT plugin sees the same ordinary authenticated MCP projection and completes
   representative read-only Main, Canvas, CBM, Engraphis, and Graphiti calls;
10. Jeremiah performs the final visual acceptance in Preview.

If a live gate fails, repair that exact seam. Do not reopen the runtime architecture, restore a deleted
manager, add a fallback engine, replay a user request, or broaden into voice, trading, God's Eye,
repository-to-agent automation, or graph redesign.

## Explicitly outside this acceptance pass

- voice/HUD work beyond standard Hermes behavior;
- a new learning graph or memory subsystem;
- automatic KnowGraph research before the manual path succeeds;
- a Mag One mission or state-changing research/trading/graph-write proof;
- new tool-request automation or Card-face metrics beyond the existing compact inspector block;
- dependency upgrades unrelated to a demonstrated acceptance failure.
