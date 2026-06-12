# AGENTS.md

## Documentation Model

Markdown is an agent execution layer. Keep it current, scoped, and queryable.

* `AGENTS.md` is repo law.
* `PLAN.md` is the full current idea and route.
* `specs/*.md` are durable parts of the plan.
* `skills/*.md` are living progressive-work artifacts containing bounded attempts, reusable
  procedures, guardrails, proofs, and graphable examples.

Do not create root `SPEC.md`, root `SKILL.md`, `KNOWLEDGE.md`, duplicate agent laws, random notes,
progress, evidence, handoff files, or completed-task piles.

## Progressive Skill Loop

A prompt is raw intent. A real code or task prompt becomes a bounded attempt inside a skill file
only when implementation work begins. Process-normalization and steering prompts do not become
attempts unless they explicitly start real implementation work.

Before writing an attempt, Codex must read `AGENTS.md`, `PLAN.md`, relevant specs, relevant skills,
and fresh CBM graph context. Codex must search existing skills using prompt meaning, referenced
specs, fresh CBM files/symbols/nodes, touched subsystem, existing guardrails, and related skills.

If a matching skill exists, append the attempt there. If no matching skill exists, create a short
new one-file skill stub and append the attempt there. Record:

`No matching skill found; successful completion must create a new skill.`

Every code change must attach to a skill. Fable executes only the bounded attempt.

Every successful code attempt updates a skill with task-inverted action steps, graphable example
metadata, proof claims, validation or smoke commands, a query-ready pattern, and touched
nodes/files/symbols. Every failed attempt updates a skill with failed proof, why it failed, a
guardrail, and a bounded retry direction.

One skill equals one graphable Markdown file at `skills/<skillname>.md` by default. Do not split one
skill into subfolders or separate JSON, query, or example files unless explicitly requested. Fresh
CBM query every time is the freshness mechanism. Do not store raw diffs as durable skill memory.
Retrieve code examples fresh through CBM/CodeGraph queries unless a tiny snippet is essential.

## Skills

A skill is a reusable procedure, not a task log. By default, one skill is one
`skills/<skillname>.md` file. Do not split a skill into subfiles unless explicitly requested.

Skills may contain OWL-ish graphable Markdown lines that later import into JSON, Postgres, or
ThinkGraph. Retrieve current code snippets fresh by graph query and direct reads instead of storing
copied code as durable skill memory.

Every skill/example query refreshes or proves fresh CBM first. Fresh graph queries are the
freshness mechanism; do not use stale-check cache logic or cached paths as truth.

Durable skill memory is graphable nodes, edges, proof claims, validation commands, query shapes,
source-task metadata, and small reusable how-to text. Raw diffs and giant patches are not durable
memory.

Skills form a growing graph. Connect each successful code task's skill to relevant specs, source
tasks, touched CodeGraph nodes, changed files, changed symbols, proof claims, validation commands,
and related skills.

## Required Workflow

1. Read `AGENTS.md`, `PLAN.md`, and relevant specs.
2. Refresh or prove fresh CBM and confirm ready status.
3. Record counts and relevant graph nodes, edges, files, and symbols.
4. Search the skill graph using prompt, specs, current graph structure, subsystem, and guardrails.
5. For real implementation work, append a bounded attempt to a matching skill or create the
   smallest useful one-file skill stub.
6. Use graph tools before focused text search.
7. Use focused grep/rg only for exact checks or unavailable graph-backed source search.
8. Direct-read files before claims, edits, or citations.
9. Work only inside the bounded skill attempt.
10. Run required proof without faking success.
11. Refresh or prove fresh CBM after changes.
12. Record actual graph/code delta and update the skill with success or failure evidence.

CBM is a structural map, not unquestioned truth. Direct reads, command output, installed-package
proof, tests, compile, and real smoke results win when they disagree with CBM.

## Scope And Runtime Guardrails

Do not broaden scope or start the next task without instruction. Do not commit, push, branch,
stash, reset, rebase, merge, or tag unless explicitly requested.

Preserve the ReactFlow/TypeScript control plane, host Node backend, host Python sidecar, and real
Microsoft AutoGen v0.4.4 / Magentic-One runtime. No provider/model fallback, fake `finalOutput`,
mocked sidecar success, Python-invented tools, AgentChat, AutoGen Studio, Semantic Kernel,
Microsoft Agent Framework, LangChain runtime foundation, Redis/RQ AutoGen runtime, or Docker
python-models runtime unless explicitly reversed by the user.

## Reporting

Serious runs report verdict, files read, CBM before, relevant graph structure, work done, proof,
CBM after, actual graph/code delta, promotion result, risks, and next state.

Do not include routine git output, patch dumps, or large grep output.
