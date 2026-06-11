# Working Memory: MCP-First Workflow

> Non-canonical workflow note.
> This file is subordinate to `AGENTS.md` and `.specify/memory/constitution.md`.
> Use it as a convenience memo, not as the governing workflow contract.

## Standing Rule

Refresh/rebuild the repository index, then use `codebase-memory-mcp` for structural localization
before reading code files. If the index was not refreshed, treat its results as advisory only and
let filesystem truth win.

## Per-Task Checklist

- [ ] Identify subsystem involved.
- [ ] Refresh/rebuild the CBM repository index and report whether it was refreshed.
- [ ] Rank top 5 files likely controlling behavior.
- [ ] Map inbound/outbound dependencies around the target symbol/file.
- [ ] Read only minimum files required for exact confirmation.
- [ ] Propose smallest patch.

## Output Contract

Always separate output into:

- **A. graph-derived structural facts**
- **B. file-derived exact code facts**
- **C. patch plan**

## Minimal Structural Commands

- Index check: `list_projects`
- Index (if needed): `index_repository`
- Architecture overview: `get_architecture`
- Candidate search: `search_graph`
- Dependency tracing: `trace_path`
- Focused graph questions: `query_graph`

## Guardrails

- Do not skip structural step unless MCP is unavailable.
- Do not treat `index_status: ready` as freshness proof.
- Do not let stale CBM override direct file, Git, package, or test evidence.
- Do not read broad directories before narrowing candidates.
- Prefer localized edits in highest-confidence controlling files.

## Canvas Control Map

Primary control files
1. client/src/pages/agentbuilder.tsx
2. client/src/components/builder/BuilderCanvas.tsx

Secondary control files
3. client/src/components/builder/useBuilderDeckRuntimeActions.ts
4. client/src/components/graph/graphWorkspaceContract.ts
5. client/src/components/builder/nodes/AgentCardNode.tsx

Triage rules
- whole-canvas bug -> start with agentbuilder.tsx + BuilderCanvas.tsx
- save/run/persist bug -> add useBuilderDeckRuntimeActions.ts
- zoom/snap/focus bug -> add graphWorkspaceContract.ts
- node-card visual/handle/badge bug -> add AgentCardNode.tsx

Usually ignore unless bug is specific
- client/src/components/assist/PlanWikiSurface.tsx
- client/src/components/builder/DeckQuickAddPanel.tsx
- client/src/components/graph/graphVisualTokens.ts
