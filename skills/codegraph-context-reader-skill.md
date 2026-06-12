# Skill: CodeGraph Context Reader

@skill id=codegraph-context-reader
@type Skill
@status learning
@applies_to specs/codegraph-context-reader-spec.md
@related_to skill-packet-fable-handoff
@related_to codebasedmemory
@requires codebasedmemory
@requires skill-packet-fable-handoff
@requires fresh_cbm_index

## Vector Summary

Compose a compact Code Evidence Packet from fresh Codebase-Memory / CodeGraph lookups — relevant
files, symbols, routes, tests, snippets, call paths, queries used, and warnings — and embed it in
the planner-initiated Context Packet so the active CoderPacket and coder start with current code
truth.

## Use When

Use when preparing code evidence for a Fable attempt, defining what fresh CBM lookups feed the
Context Packet/CoderPacket, or changing the Code Evidence Packet contract.

## Guardrails

@guardrail id=codegraph-context-reader.cbm-tools-only
@guardrail id=codegraph-context-reader.no-copied-code-in-skills
@guardrail id=codegraph-context-reader.no-fake-cbm-access
@guardrail id=codegraph-context-reader.missing-code-evidence-blocks

* Use Codebase-Memory MCP tools as the API; never read or depend on the hidden CBM SQLite file.
* CodeGraph supplies fresh code evidence only; agent learning memory lives in SkillGraph.
* Skill files store code refs and query patterns, never copied code snippets.
* Host code never fakes CBM access: the scout composes the packet and the renderer validates it.
* Missing or stale required code evidence blocks CoderPacket readiness; it is not acceptable
  context.

## Current Procedure

Legacy implementation evidence from attempt prepare-001:

1. Scout refreshes CBM and records method/status/nodes/edges into the packet's `cbm` field.
2. Scout runs the Skill Memory Packet query patterns first, then CBM graph tools
   (`search_graph`, `query_graph`, `search_code`, `get_code_snippet`, `trace_path`) for the task
   prompt and spec; graph-first, focused text search only after narrowing.
3. Scout direct-reads files behind every claim, fills the Code Evidence Packet shape from
   `specs/codegraph-context-reader-spec.md`, records every tool call in `queries_used`, and adds
   honest `warnings` (including CBM blind spots such as untracked files).
4. Scout saves the packet JSON and renders the handoff:
   `py -3.12 services/knowgraph/skill_ingest.py handoff --prompt "<task>" --spec "<spec>" --code-evidence <packet.json>`.
   The renderer validates `source=codegraph_cbm` and `packet_version` loudly and embeds the JSON
   verbatim as `## Code Evidence Packet` after the Skill Memory Packet. The current helper's
   missing-packet placeholder is implementation debt; current product law requires blocking
   CoderPacket readiness until fresh evidence exists.
5. Fable verifies packet refs by direct read before relying on them (Required Behavior 4).

## Active Attempt

@attempt id=codegraph-context-reader.prepare-001
@status active
@source_spec specs/codegraph-context-reader-spec.md
@source_prompt "create MVP CodeGraph Context Reader so Fable handoff includes fresh code evidence packet along with skill memory packet"
@requires_fresh_cbm true

Bounded scope:

* define the Code Evidence Packet shape and scout composition contract in the spec
* extend the existing handoff renderer with a validated `--code-evidence <packet.json>` embed
  point placed after the Skill Memory Packet
* add tests; prove one real scout-composed packet end to end when possible

@query id=codegraph-context-reader.render "py -3.12 services/knowgraph/skill_ingest.py handoff --prompt <task> --spec <spec-path> --code-evidence <packet.json>"
@query id=codegraph-context-reader.compose "refresh CBM, run skill packet query patterns, then search_graph/query_graph/search_code/get_code_snippet/trace_path for the task prompt, direct-read before claims, fill the packet shape"

@attempt_result id=codegraph-context-reader.prepare-001
@status succeeded
@cbm_after nodes=5289 edges=9506
@proved_by 52 unit tests passed via py -3.12 -m unittest discover -s services/knowgraph -p test_skill*.py
@proved_by live handoff rendered all five sections in order with a real scout-composed Code Evidence Packet built from an actual CBM search_graph call
@proved_by invalid code evidence packet failed loudly with SKILL_INGEST_FAILURE before any output
@validated_by py -3.12 -m unittest discover -s services/knowgraph -p "test_skill*.py" -v
@touches_code services/knowgraph/skill_ingest.py
@touches_code services/knowgraph/test_skill_retrieve.py

### Work Done

Created `specs/codegraph-context-reader-spec.md`: packet shape, CBM-tools-as-API core rule, scout
composition contract, and the five-section handoff shape. Extended `build_fable_prompt()` with a
`## Code Evidence Packet` section placed after the Skill Memory Packet, added
`load_code_evidence()` with loud validation (`source=codegraph_cbm`, `packet_version`), and the
`--code-evidence <packet.json>` option on the `handoff` command. Added one Code Evidence Packet
line to the Fable Prompt Contract in `specs/skill-packet-fable-handoff-spec.md` and a
verify-refs-by-direct-read clause to Required Behavior. Added five tests. CBM tools are MCP-only,
so host code never composes the packet; the scout layer does — no fake CBM access exists.

### Proof

* `py -3.12 -m unittest discover -s services/knowgraph -p "test_skill*.py" -v`: 52 tests, OK.
* Live: real `search_graph` call composed a genuine packet (ingest_text_document, ingest_pdf,
  ingest_code evidence); `handoff --code-evidence` rendered Task Prompt, Source Spec, Skill
  Memory Packet, Code Evidence Packet, Required Behavior in order, exit 0.
* Live: packet with wrong source failed loudly; missing/invalid/missing-version cases covered by
  unit tests.
* Ingest of this skill file: first run created 15 nodes / 17 relationships, second run 0 / 0.

### Actual Graph And Code Delta

Neo4j gained 15 nodes and 17 relationships for skill `codegraph-context-reader` (now 5 skills
indexed). Code delta: code-evidence embed point plus validation in
`services/knowgraph/skill_ingest.py`, five tests, one new spec, one contract line in the handoff
spec, this skill file. CBM after reads 5289 nodes / 9506 edges, unchanged, because the CBM
indexer only sees git-tracked files and committing is out of scope.

Reasoning receipt:

* chosen approach: scout-composed packet validated and embedded by the deterministic renderer;
  CBM MCP tools as the only API; explicit placeholder when no packet is attached.
* rejected alternatives: calling CBM from host Python (tools are MCP-only — would require faking
  access or coupling to the hidden SQLite store, both forbidden); auto-composing evidence inside
  the CLI; vector search.
* failed or blocked paths: none in this attempt; `--include-code-evidence` auto-composition was
  evaluated and correctly rejected as impossible without fake CBM access.
* guardrails created: cbm-tools-only; no-copied-code-in-skills; no-fake-cbm-access.
* retry direction: none needed; next is one real end-to-end attempt carrying both packets.

Skill update:

* Current Procedure updated: yes
* Successful Example added: yes
* Failed Attempt added: no
* Query Pattern added: yes

## Successful Examples

Attempt prepare-001 (2026-06-12): a real CBM `search_graph` call ("knowgraph neo4j ingest text
document") produced genuine file/symbol/route evidence; the composed packet, including an honest
warning about untracked files being invisible to CBM, rendered into a 372-line five-section Fable
handoff. Retrieve current code fresh via CBM query on `services/knowgraph/skill_ingest.py`; do
not copy snippets from this file.

## Failed Attempts And Guardrails

No composition attempt has failed yet. Auto-composition from host Python is recorded as rejected,
not failed: CBM tools are MCP-only and faking access is forbidden by guardrail.
