# Codebase-Memory Notes

## Source Paper

**Codebase-Memory: Tree-Sitter-Based Knowledge Graphs for LLM Code Exploration via MCP**  
Martin Vogel, Falk Meyer-Eschenbach, Severin Kohler, Elias Gruenewald, Felix Balzer  
arXiv:2603.27277v1 (Mar 28, 2026)

---

## What It Is

Codebase-Memory is a code-intelligence system that builds a persistent structural knowledge graph from source code and exposes graph queries to LLM agents through MCP tools.

The key shift is:
- from repeated text file exploration (`read`, `grep`, `ls`)  
- to pre-indexed structural retrieval (call graph, dependencies, impact, architecture)

---

## Why It Matters

The paper argues that most coding-agent questions are structural:
- "What calls this?"
- "What breaks if this changes?"
- "What are the hub modules?"

Text-only exploration answers these by many iterative tool calls and high token burn.  
Codebase-Memory answers them with graph queries over precomputed relationships.

Reported benchmark headline:
- ~83% answer quality vs ~92% for file-explorer baseline
- ~10x fewer tokens
- ~2.1x fewer tool calls
- strongest gains on graph-native questions (hub/caller/dependency traversal)

---

## System Architecture (Paper Summary)

Three-stage model:
1. **Parse**: Tree-Sitter extraction (66 languages in this implementation)
2. **Build**: Multi-pass graph construction and linking
3. **Serve**: MCP tool interface for LLM agents

Storage:
- SQLite property graph (single file)
- incremental updates via file-watching + XXH3 hashing

Deployment:
- single statically linked C binary
- no external runtime services required for core operation

---

## Graph Model

Node examples:
- Project, Folder, File, Module
- Function, Method, Class, Interface, Type, Route

Edge examples:
- `CALLS`, `IMPORTS`, `DEFINES`, `CONTAINS_*`
- `HTTP_CALLS`, `ASYNC_CALLS`
- `HANDLES`, `IMPLEMENTS`, `INHERITS`
- `CONFIGURES`, `TESTS`, `MEMBER_OF`

The model is designed for direct LLM-consumable structural queries.

---

## Build Pipeline Highlights

The paper describes a multi-pass pipeline:
- structure discovery
- parallel extraction
- call/reference resolution
- enrichment (tests, configs, routes, semantic links)
- flush to SQLite
- post-index analytics (e.g., community detection)

Call resolution uses a prioritized multi-strategy matcher:
- import-based resolution
- same-module resolution
- unique/suffix/fuzzy fallbacks

For some languages, type-aware hybrid resolution improves call-link accuracy.

---

## MCP Tool Surface (Conceptual)

Grouped tool types:
- **Indexing**: build/update/check/delete project index
- **Query**: search symbols, trace call paths, query graph
- **Analysis**: architecture/schema/change impact
- **Code**: snippet lookup and text search (for source confirmation)

Practical usage pattern:
1. run structural MCP queries first
2. narrow candidate files
3. read only minimal source needed
4. make smallest patch

---

## Strengths vs Limitations

Strengths:
- major token/call savings for structural exploration
- fast graph-native traversal (sub-ms to low-ms query class)
- persistent memory of repository structure across sessions

Limitations:
- not a full replacement for source reads (exact behavior still needs code confirmation)
- weaker in macro-heavy/dynamic/runtime-only logic
- quality still slightly below exhaustive file exploration in some query classes

Best practice is hybrid:
- graph-first localization
- source-level verification second

---

## Security and Trust Model (Paper Summary)

The paper emphasizes MCP supply-chain risk and describes defense-in-depth controls:
- static audits for dangerous calls
- binary string/network/path checks
- malformed payload robustness tests
- dependency integrity checks
- signed and attested release pipeline

Takeaway: MCP server trust must be treated like privileged tooling trust.

---

## Relevance to LiquidAIty Workflow

For this repo, the paper supports our current operating pattern:
- use `codebase-memory-mcp` first for structural localization
- rank controlling files and map dependencies
- read only the minimum files required
- keep patch scope minimal

This improves speed/cost while preserving correctness through code-level confirmation.

---

## Citation

If referencing this internally:

> Vogel M, Meyer-Eschenbach F, Kohler S, Gruenewald E, Balzer F.  
> Codebase-Memory: Tree-Sitter-Based Knowledge Graphs for LLM Code Exploration via MCP.  
> arXiv:2603.27277v1, 2026.
