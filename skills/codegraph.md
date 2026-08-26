# Skill: CodeGraph — codebase memory via CBM MCP

@skill id=codegraph
@type Skill
@status active
@graph codegraph
@store sql-cbm
@related_to thinkgraph
@related_to knowgraph

## Purpose

CodeGraph is **codebase memory**: repository structure, symbols, files, and
dependencies, used for code understanding and scoped coding work. Store: SQL, owned
by the existing codebase-memory (CBM) indexer. Read through CBM MCP tools — it is
NOT another TypeScript planner/context-packet subsystem.

## Authority

- The **CBM indexer** WRITES CodeGraph (through the existing codebase-memory/indexing system).
- Granted **Hermes Main, Coder, and Kanban Cards** READ CodeGraph through MCP (search/scoped
  repository reads).
- CBM maps code structure and impact; it is not a runtime permission gate. Direct source reads,
  compile output, focused tests, and live proof win when graph memory disagrees.

## Boundary (what must NOT come back)

No `graphContextBuilder`, no `CoderContextPacket` planner maze, no PlanFlow prepare
endpoint, no Task Ledger grounding, no ThinkGraph-derived code packet, no duplicate
TypeScript code-reasoning engine, and no TypeScript CBM carrier. The coding runtime uses LiquidAIty's
application-published `cbm.*` catalog. The application MCP owns the only native stdio frontend into the
Docker service; coding clients never configure or launch native CBM directly.

## Rules

- Code only. No graph-based planner packets, no direct UI/database writes.
- Use scoped repository reads and require proof before edits.
- Hermes Cards read CodeGraph to produce file pointers; Main delegates to the Coder
  to implement on the pointed files.
