# CodeGraph product and source-design contract

[Product architecture](ARCHITECTURE.md) · [Hermes plugin contract](plugin.md) ·
[Agent execution law](AGENTS.md) · [Current plan](PLAN.md)

CodeGraph is LiquidAIty's repository-intelligence feature. It helps people and agents find the source
that implements a product capability, understand how that source is structurally connected, and keep
newly authored code modular enough to remain understandable.

CodeGraph is not one database and it is not a second coding runtime. It is the deliberate composition
of three different authorities:

1. **Authored meaning:** leading `Entity:` / `Relationship:` pairs state which stable Feature a
   first-party file contributes to and what that exact contribution is.
2. **Derived structure:** Codebase Memory derives Files, Symbols, definitions, callers, calls, imports,
   tests, and dependency relationships from current source.
3. **Product presentation:** LiquidAIty projects bounded provider pointers into the visible CodeGraph and
   the shared in-memory navigation map. Presentation never becomes another index or writer.

The join key is the repository-relative file path. Authored meaning explains *why* a file belongs to a
Feature. CBM independently proves *how* code is connected. Neither source is allowed to fabricate the
other.

## Current v0.1 behavior

The current product boundary is intentionally small:

- first-party TypeScript, TSX, Python, and architecture-owning JavaScript files carry truthful authored
  pairs;
- the installed Codebase Memory owner indexes current repository structure;
- saved Card grants determine which bounded `cbm.*` reads an agent may perform;
- the UI can present selected Code Files and real Calls/Imports without turning them into ThinkGraph or
  KnowGraph records;
- the shared navigation map can carry visible Code File pointers and one open-node context into Main,
  Builder, ThinkGraph, and KnowGraph;
- Builder may use CodeGraph context to author a PromptSpec or a blue worker, but CodeGraph never runs the
  worker and never widens its tools.

CodeGraph does not replace direct source reading. A graph result is a directional map; current source,
callers, tests, and runtime proof remain authoritative.

## Authored Entity and Relationship pairs

### Required scope

Pairs are required for LiquidAIty-owned:

- `.ts` files;
- `.tsx` files;
- `.py` files; and
- executable `.js` files that own a real first-party integration seam.

Do not force pairs into CSS, Markdown, manifests, generated output, data files, or untouched vendor
source. A locally modified controlled vendor file retains upstream comment style; its local behavior is
recorded in the vendored divergence register.

### New files

When an agent creates a first-party source file:

1. Put every pair before imports or executable code.
2. Place each `Relationship:` immediately after its `Entity:`.
3. Reuse the stable Feature name that a reader should search to find the file.
4. Describe the file's present, concrete contribution in one sentence.
5. Add another pair only for another real Feature responsibility.
6. Add the focused test or proof owner appropriate to that contribution.

Good:

```text
// Entity: Card Profiles
// Relationship: Publishes one saved Card's selected model, skill, tools, and Bot roster to its stable Hermes profile and verifies readback.
```

Bad:

```text
// Entity: Utilities
// Relationship: Helps with various Card things and may support profiles later.
```

The bad example names no stable product capability, explains no boundary, and makes an aspirational
claim.

### Existing files

When an agent edits a file:

- read all leading pairs before changing code;
- leave them byte-unchanged when Feature membership and responsibility do not change;
- update the Relationship in the same patch when the real contribution changes;
- add or remove a complete adjacent pair with the corresponding responsibility;
- remove stale or aspirational pairs when their code is removed; and
- check current callers, imports, state ownership, and tests before deciding that a file should split.

A mechanical validator may enforce placement, adjacency, and nonempty values. It must not invent Feature
names or Relationships from filenames, keywords, embeddings, or a deterministic classifier. Semantic
accuracy is a source-review responsibility.

## Module-cohesion pressure

The authored layer is also a design instrument.

A file is probably cohesive when its pairs describe closely related responsibilities, its state has one
owner, and its callers use the module for one understandable reason. A small file is not waste merely
because it is small; useful modules reduce the amount of context an agent must hold.

A file is a split candidate when direct source and structural evidence show that it:

- owns unrelated state lifecycles;
- serves unrelated caller neighborhoods;
- mixes transport, semantic decisions, persistence, and presentation without an owner boundary;
- needs several unrelated Feature pairs to describe what it actually does; or
- changes for independent product reasons that repeatedly collide.

Pair count alone is never a refactoring rule. One complex cohesive owner may need several related pairs,
and one badly named pair can conceal a mixed module. Confirm the boundary through current source and CBM
relationships before splitting or merging.

## Agent authoring workflow

For every first-party file an agent authors or materially changes:

1. Search the existing authored Feature name and use the Codebase Memory CLI for a bounded structural map.
2. Read the exact neighboring source and tests.
3. Choose the smallest existing owner that can implement the change.
4. Add or update truthful pairs as part of the same patch.
5. Delete the superseded path when the replacement is implemented.
6. Let the installed watcher refresh derived structure; do not start another indexer or mutate CBM
   lifecycle without explicit owner authority.
7. Verify the authored neighborhood, structural callers/imports, focused tests, and residue separately.

An agent may use CodeGraph to navigate or propose a change. It may not treat a graph score as permission,
replace source review with a graph summary, or claim that an indexed symbol executed successfully.

## Product presentation and model context

The CodeGraph surface should help a user answer:

- Which files implement this Feature?
- What does each file contribute?
- Which callers, imports, tests, and dependencies connect them?
- Which exact file or symbol is open now?
- Which provider pointer should an agent follow for deeper inspection?

The visible graph may filter or arrange real records, but it must retain exact provider IDs and file paths.
The lightweight shared map carries only the Code layer currently visible to the user plus the one open
node. A model that needs more detail follows saved CBM tools. The map does not copy a repository, infer
hidden attention, or become Project memory.

## Turning an external Git repository into an agent product

Repository ingestion is a later CodeGraph workflow, not a v0.1 launch prerequisite. Its purpose is to
help Builder understand a candidate codebase and propose a safe, coherent agent product—not to install
and execute arbitrary source automatically.

### 1. Admission and provenance

Record before analysis:

- canonical upstream URL;
- exact commit or signed tag;
- license and redistribution constraints;
- dependency manifests and generated lock/SBOM evidence;
- known build/runtime requirements; and
- whether the repository is reference material, a controlled import, or a proposed maintained fork.

Untrusted code remains non-executing during discovery. Do not run install scripts, hooks, builds, tests,
containers, binaries, or model-supplied commands merely because the repository was cloned or indexed.

### 2. Structural digestion

Derive a bounded map of:

- packages and entry points;
- public APIs, protocols, hooks, plugins, MCP surfaces, and configuration seams;
- core domain modules and state owners;
- external I/O and credential boundaries;
- tests and examples that demonstrate intended behavior;
- dependency and license risk; and
- high-coupling or mixed-owner areas that raise integration cost.

Read exact source at the important nodes. A README, filename, generated architecture summary, or graph
centrality score is evidence for orientation, not proof of behavior.

Do not silently add an imported repository to the canonical LiquidAIty CBM project or expand `.cbmignore`.
Index-scope changes require their own explicit authority and refresh proof. A disposable or separately
named analysis project may be proposed, but it must not become a second persistent CodeGraph owner.

### 3. Capability proposal

Builder may turn the evidence into a draft proposal containing:

- the user problem the repository can solve;
- the smallest coherent capability worth retaining;
- the public extension point or adapter that should own integration;
- the exact source subset and upstream behavior to preserve;
- the minimal Hermes tools, skills, files, network, and credential grants required;
- the source and tests that justify the proposal;
- the fork/sync cost and rollback; and
- what existing LiquidAIty path, if any, it replaces.

The proposal is not yet a Card, profile, grant, service, or runtime. A model may rank or compare candidate
modules as advice, but no score may automatically authorize import, execution, or tool access.

### 4. Productization

After explicit owner approval, prefer in order:

1. documented Hermes plugin, hook, skill, MCP, or protocol integration;
2. the upstream project's public API or configuration seam;
3. an existing LiquidAIty adapter owner; and
4. a bounded controlled fork only when the preceding options cannot satisfy the requirement.

Place an approved specialized product under `agent-products/` only when that root genuinely owns its
domain application. Do not create a wrapper directory merely to avoid using an existing owner. Controlled
imports keep exact upstream identity and a divergence record.

A generated agent begins as a reviewable saved-Card proposal: identity, SOUL/PromptBlocks, exactly one
skill, selected tools, model, optional Card Python, and wire placement. Builder may create or edit an
approved non-core blue worker; Builder does not run it. Main performs the saved-Card test through Hermes.

### Independent agent-product packages

A substantial domain agent should normally remain in its own repository and distributable Hermes-facing
package. Kronos, TradingAgents, NRGSIM, WorldView/ShadowBroker, and similar products are candidates for
this boundary when they have independent dependencies, releases, permissions, or runtime behavior.

Each package then receives its own immutable Git provenance, license/SBOM review, CodeGraph project,
Plugin Doctor result, catalog security scan, tool/MCP grant ceiling, tests, version, and rollback. The
LiquidAIty core connects the saved Card through public Hermes Bot Mode, profile, wire, skill, toolset, or
MCP contracts; it does not import the domain runtime into its own plugin process.

Agent capability separation is not automatic UI composition. A domain package may register its own
documented dashboard page or expose typed public operations. LiquidAIty must not import another plugin's
private React modules or invent a cross-plugin component loader. Deeper in-page composition waits for a
documented Hermes web-dashboard seam.

### 5. Acceptance

Report each tier separately:

1. upstream identity, license, and source subset;
2. derived structural map and direct-source confirmation;
3. static adapter/plugin contract;
4. focused source tests;
5. build or package proof;
6. loaded Hermes/plugin/profile proof;
7. one real saved-Card execution through Main;
8. persistence/readback and observable telemetry; and
9. owner product and visual acceptance.

A generated scaffold, passing mock, graph screenshot, or successful build does not prove a useful agent
product.

## General best practices

- Keep one owner and one writer for each store, graph, session, and runtime lifecycle.
- Prefer documented extension points over imitation.
- Pass provider pointers and bounded selections rather than copied subgraphs.
- Keep authored meaning human/model reviewable and derived structure independently reproducible.
- Preserve exact provenance from upstream repository through generated Card proposal and acceptance.
- Grant the least capability needed; absence of a grant is not a reason to create a bypass.
- Treat generated source as first-party only after review; then apply the same pairs, tests, and ownership
  rules as hand-authored code.
- Keep experimental analysis removable. Removing CodeGraph presentation must never damage source,
  profiles, Projects, or provider stores.
- Optimize for the smallest understandable module, not the fewest files or the highest graph score.
- Measure whether CodeGraph reduces discovery time, missed callers, mixed-owner edits, and regressions. If
  a visualization or metric does not change a real coding decision, remove or hide it.

## Explicit non-goals

CodeGraph does not:

- execute repositories;
- grant tools or credentials;
- create profiles or invoke agents automatically;
- replace Git, source, tests, or code review;
- store Project reasoning or sourced facts;
- infer what a model secretly attended to;
- rewrite every source header automatically;
- score code into an authorization decision; or
- make AGE, Engraphis, Graphiti, or CBM own another system's data.

For v0.1, the feature is complete when an agent can find a Feature through authored pairs, verify its
real structural neighborhood through CBM, inspect selected code in LiquidAIty, and use that bounded context
to author better work without a duplicate runtime. External-repository digestion and agent-product generation
remain a deliberate next layer after launch reliability is established.
