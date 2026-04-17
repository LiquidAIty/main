# LiquidAIty Agent Operating Guide

## Default Investigation Mode (MCP First)

For all behavior/debug/change requests in this repository:

1. Use `codebase-memory-mcp` first for structural localization.
2. Identify the subsystem involved.
3. Rank the top 5 files most likely controlling the behavior.
4. Show inbound and outbound dependencies for the primary file/symbol.
5. Only then read the minimum files needed to confirm exact code facts.
6. Propose the smallest patch that solves the request.

Do not begin with broad file reading when structural MCP can answer first.

## Required Response Structure

Every analysis/change proposal should be split into:

- **A. graph-derived structural facts**
  - Derived from MCP graph/search/trace tools.
  - Include subsystem, top file ranking, and dependency paths.
- **B. file-derived exact code facts**
  - Only facts validated from direct file reads.
  - Keep reads minimal and targeted to the structural findings.
- **C. patch plan**
  - Smallest viable change set.
  - List exact files to edit and why each edit is necessary.

## Structural Query Sequence

Use this sequence by default:

1. Confirm index:
   - `list_projects`
   - If repo missing: `index_repository`
2. Repository architecture:
   - `get_architecture`
   - `get_graph_schema`
3. Problem localization:
   - `search_graph` for likely symbols/files
   - `trace_path` for inbound/outbound relationships
   - `query_graph` for focused dependency checks
4. Only then read files needed for confirmation.

## Ranking Heuristic for "Top 5 Controlling Files"

Prioritize files by:

1. Direct caller/callee relationship to target symbol.
2. Orchestration role (page/container/hook/store/router).
3. Shared state or request guard logic.
4. Frequency of structural connections in the local subgraph.
5. Test coverage relevance near the target behavior.

## Patch Principles

- Prefer smallest patch over refactor.
- Keep changes inside highest-ranked controlling files unless required.
- Add or update the nearest relevant test when practical.
- Avoid unrelated edits.

## PowerShell CLI Note

When invoking `codebase-memory-mcp.exe cli <tool>`, pass JSON args in single quotes to avoid escaping issues in PowerShell.
