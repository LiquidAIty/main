# CodeGraph Context Reader Spec

> Transition policy: this is a legacy/source document, not the default planning memory or active
> job contract. `PLAN.md`, `AGENTS.md`, and the current CoderPacket/spec-as-prompt are authoritative.

## Name

CodeGraph Context Reader

## Purpose

Given a task prompt and optional Skill Memory Packet, retrieve fresh code evidence from
Codebase-Memory / CodeGraph before Fable works.

SkillGraph (KnowGraph / Neo4j) carries what agents learned: guardrails, failed attempts,
decisions, proof requirements, query patterns. CodeGraph / CBM carries what code exists right
now: relevant files, symbols, routes, tests, snippets, and call paths. The Code Evidence Packet
is fresh code evidence only — it is never agent learning memory, and skill files store only code
refs and query patterns, never copied code.

## Core Rule

Use the Codebase-Memory MCP tools as the API. CBM storage (its SQLite file) is an implementation
detail; nothing may read or depend on it directly.

CBM tools are exposed over MCP to the agent/scout layer, not to host Python. Therefore the scout
composes the Code Evidence Packet by running CBM tools; host code only validates and embeds the
finished packet into the Fable prompt. No host code fakes CBM access.

## Inputs

* task prompt
* optional spec path
* optional Skill Memory Packet JSON (its `query_patterns` seed CBM lookups)
* optional file refs
* optional symbol refs
* optional limit

## Outputs

Code Evidence Packet:

```json
{
  "packet_version": 1,
  "source": "codegraph_cbm",
  "query": {
    "prompt": "...",
    "spec": "...",
    "skill_packet_used": true
  },
  "cbm": { "method": "full", "status": "ready", "nodes": 0, "edges": 0 },
  "files": [],
  "symbols": [],
  "routes": [],
  "tests": [],
  "snippets": [],
  "call_paths": [],
  "queries_used": [],
  "warnings": [],
  "proof_commands": []
}
```

Field notes:

* `files`/`symbols`/`routes`/`tests`: qualified names plus `file_path:line` refs from graph tools.
* `snippets`: small graph-resolved excerpts or refs (`{"ref": "path:line", "text": "..."}`);
  direct-read before any claim; keep excerpts tiny.
* `call_paths`: results of call-path tracing (`trace_path`) when relevant.
* `queries_used`: every CBM tool call made (tool name plus arguments), so the packet is replayable.
* `warnings`: uncertainty, stale-index doubts, ambiguous matches, empty lookups.
* `proof_commands`: suggested validation commands when obvious (tests, compile, smoke).
* `cbm`: the fresh-index proof recorded at composition time.

## MVP Behavior

1. Fresh CBM is required before composition; record method/status/nodes/edges in the packet.
2. If a Skill Memory Packet is present, run its `query_patterns` first.
3. Use CBM tools: `search_graph`, `query_graph`, `search_code`, `get_code_snippet`, and
   `trace_path` (call-path tracing); `detect_changes` and `get_architecture` when scoping needs
   them.
4. Prefer graph-first lookup; focused text search only after graph narrowing.
5. Direct-read files before claims; snippets must come from current files, not memory.
6. Return one compact packet for the Fable handoff; cap list lengths and snippet sizes.
7. Do not store copied code inside skill files.
8. Store only code refs and query patterns in skill memory.

## Composition Contract (Scout Layer)

The scout/Codex layer owns packet composition:

1. Scout refreshes CBM and records the index proof.
2. Scout runs skill packet query patterns, then graph lookups for the task prompt and spec.
3. Scout direct-reads the files behind every claim it includes.
4. Scout fills the packet shape above, records `queries_used`, and adds `warnings` honestly.
5. Scout saves the packet JSON and renders the Fable prompt:

```powershell
py -3.12 services/knowgraph/skill_ingest.py handoff --prompt "<task>" --spec "<spec>" --code-evidence <packet.json>
```

The renderer validates the JSON loudly (`packet_version`, `source: codegraph_cbm`) and embeds it
verbatim. A missing packet renders an explicit placeholder telling the scout to attach one; it is
never silently fabricated.

## Fable Handoff Shape

The full handoff prompt contains, in order:

1. Task Prompt
2. Source Spec
3. Skill Memory Packet (learned memory; see `specs/skill-packet-fable-handoff-spec.md`)
4. Code Evidence Packet (fresh code evidence; this spec)
5. Required Behavior / Proof

## Not Included Yet

* UI graph viewer
* direct SQLite CBM reads
* vector search
* full graph visualization
* automatic code modification
* ThinkGraph merge
* KnowGraph research merge

## Acceptance

* spec and skill exist
* CodeGraph role is clear: fresh code evidence only, not agent learning memory
* SkillGraph role is clear: learned guardrails/attempts/decisions/proof/query patterns
* the handoff carries both Skill Memory Packet and Code Evidence Packet, in that order
* no direct dependency on CBM hidden SQLite
* no fake implementation: host code embeds and validates; only the scout calls CBM tools
* tests pass if code changes

## Validation

```powershell
py -3.12 -m unittest discover -s services/knowgraph -p "test_skill*.py" -v
py -3.12 services/knowgraph/skill_ingest.py handoff --prompt "<task>" --code-evidence <packet.json>
```
