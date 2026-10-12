---
name: codebasedmemory
description: Primary-only Codebase Memory CLI procedure for bounded LiquidAIty repository mapping, coverage qualification, source fallback, and inverse deletion or rename audits.
version: 6.0.0
project: C-Projects-LiquidAIty-main
---

# Codebase Memory — Primary CLI Map

@skill id=codebasedmemory
@type Skill
@status active
@requires current_source_authority

When a PromptSpec is active, load `promptspec-receiver` first and defer repository process control to
it. This skill contributes only CBM CLI discovery, coverage, and inverse-impact mechanics.

## Boundary

For Codex repository work:

- only the Primary uses Codebase Memory;
- use the installed `codebase-memory-mcp cli` command;
- do not use CBM MCP;
- use CBM before dispatching scouts;
- pass exact returned anchors to the scouts;
- scouts and reviewers verify through direct source and `rg`;
- current source and tests outrank the derived graph.

CBM is a directional map. It does not decide architecture, intent, scope, runtime truth, correctness,
completion, or whether a model used context.

LiquidAIty product execution is separate. Saved Cards may use their saved granted application-published
`cbm.*` operations. This repository-development rule neither removes nor widens those product grants.

Canonical project:

```text
project: C-Projects-LiquidAIty-main
root:    C:/Projects/LiquidAIty/main
```

## Standing start-of-run refresh

The owner has explicitly authorized and required one official CLI reindex at the start of every
PromptSpec run before the Primary maps ownership:

```powershell
codebase-memory-mcp cli --progress index_repository `
  --repo-path C:/Projects/LiquidAIty/main
```

Run it once, then read `index_status`. This standing instruction authorizes that one refresh; it does
not authorize process restarts, cache access, project deletion, registration changes, or retry loops.
A successful reindex is not proof that every file is current: qualify coverage and direct-read each
material source path.

## Primary workflow

Use only the smallest useful sequence:

```text
index_status when freshness is material
→ search_graph for each independent ownership question
→ trace_path when callers/callees or impact matter
→ get_code_snippet only for a qualified name returned by search_graph
→ check_index_coverage for every material evidence path
→ complete direct-source read
→ focused rg for literals, Markdown, config, dynamic dispatch, and residue
```

Do not turn this into broad archaeology. Stop when current owners, material callers, tests, coverage
limits, and collisions are known.

## CLI examples

Project state:

```powershell
codebase-memory-mcp cli index_status --project C-Projects-LiquidAIty-main
```

Find an exact symbol:

```powershell
codebase-memory-mcp cli search_graph `
  --project C-Projects-LiquidAIty-main `
  --name-pattern materialize_invocation `
  --include-connected true `
  --limit 30
```

Trace one returned qualified function:

```powershell
codebase-memory-mcp cli trace_path `
  --project C-Projects-LiquidAIty-main `
  --function-name "<returned-qualified-name>" `
  --direction both `
  --depth 2 `
  --include-tests true
```

Coverage:

```powershell
codebase-memory-mcp cli check_index_coverage `
  --project C-Projects-LiquidAIty-main `
  --paths apps/example.py `
  --diagnostics full
```

Use the live CLI `--help` for current flags. Do not copy a stale schema from this document into an
application contract.

## Search rules

### Use CBM first for

- symbol and structural-owner discovery;
- inbound/outbound call relationships;
- route, handler, runtime, and test adjacency;
- duplicate-owner candidates;
- deletion/rename impact;
- cross-file feature slices.

### Use direct source or `rg` for

- Markdown and repository instructions;
- exact strings, prompts, grants, routes, IDs, comments, and configuration;
- dynamic registration or dispatch missed by static edges;
- excluded/parse-partial paths;
- exhaustive residue checks;
- every final current-behavior claim.

A `search_graph` query is ranked. A zero result is not an exhaustive absence proof.

## Freshness and coverage

Record:

- project and root;
- status and generation timestamp;
- node/edge counts when useful;
- result totals, pagination, and truncation;
- every `metadata_changed`, parse-partial, skipped, excluded, or unavailable path;
- direct-source fallback used.

`no_recorded_issue` is not completeness proof. If coverage says `metadata_changed`, read the file
directly and report freshness as unproven even when a search result looks correct.

Normal ongoing freshness belongs to the upstream watcher. Apart from the one owner-required start-of-run
reindex above, restart, additional reindexing, trace ingestion, project deletion, or other lifecycle
mutation requires an explicit current owner instruction for that exact operation. Do not reflexively
refresh again because a query returns nothing.

Never:

- open or edit CBM cache/database files;
- create a second CBM frontend or daemon;
- modify global registration;
- substitute another graph and call it CBM;
- repeatedly retry a closed transport;
- present index creation as application or runtime proof.

## Dynamic-dispatch blind spot

Static graph edges may miss:

- string/registry operation dispatch;
- HTTP callers across services;
- event emitters;
- dependency injection;
- dynamic imports;
- saved runtime/profile selection.

For a zero-caller result:

```text
CBM inbound trace
+ exact rg
+ registration/route read
+ complete containing source
+ coverage qualification
= candidate conclusion
```

Without all of those, classify the identity as UNKNOWN rather than dead.

## Scout handoff

Before dispatching support scouts, the Primary passes:

```text
project/root
index generation and freshness limits
exact qualified symbols
file paths and line ranges
material inbound/outbound relationships
relevant test paths
coverage gaps
direct-source fallback already performed
questions still unresolved
```

Scouts do not rerun CBM. They independently check current source and may reject the Primary's graph
interpretation.

## Inverse deletion and rename audit

A rename is deletion of the old identity plus introduction of the new one.

Before a deletion or rename:

1. Resolve the exact path and qualified identity.
2. Trace inbound callers/importers and outbound dependencies.
3. Read exports, routes, schemas, registries, config, prompts, grants, tests, and docs.
4. Search exact simple/qualified names, paths, route strings, and IDs.
5. Record real surviving neighbors.

During the change:

- update or remove every surviving caller, import, registration, test, config, and documentation contract;
- preserve compatibility only when current product authority proves it remains required;
- remove the superseded path in the same completed approved change after replacement proof exists.

Before completion:

1. Reread each surviving former neighbor from its side of the relationship.
2. Prove old identities and paths are absent except labeled history/compatibility.
3. Prove the replacement identity exists when applicable.
4. Run focused proof for the surviving boundary.
5. Report coverage and dynamic-dispatch limitations honestly.

## Evidence labels

Use exact labels:

- **CBM-mapped:** graph returned the symbol/path.
- **CBM-path-proven:** `trace_path` returned the claimed edge.
- **Source-verified:** current source confirmed the relationship.
- **Contract-test-proven:** a focused deterministic test exercised the contract.
- **Runtime-proven:** the loaded product executed the real path.

Never promote one tier into another.

## Stop conditions

Stop CBM exploration when:

- the current owner and material relationships are mapped;
- direct source confirms or rejects the map;
- focused tests are identified;
- coverage gaps are explicit;
- the Primary can write collision-free tasks and Definitions of Done.

If the CLI is unavailable, report the exact failure and use bounded direct-source fallback only when the
active PromptSpec permits proceeding without the structural map. Do not let a support agent repair CBM or
invent a replacement.
