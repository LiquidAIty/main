# AutoSkill Policy Spec

## Purpose

Define when skills are created and updated, so skill memory compounds without flooding the repo
with speculative stubs. AutoSkill turns AI-edited repos into learning repos: every run can
produce or update reusable skill memory so future agents avoid repeated mistakes.

## Rules

* Do not create skills for every obvious file or subsystem.
* Default: create or update skills when real work touches an area.
* A skill can be a learning surface, not only a proven winner.
* If no matching skill exists for a real attempt, create a skill stub and record:
  `No matching skill found; successful completion must create a new skill.`
* If a matching skill exists, append/update the attempt, result, guardrail, query pattern, or
  proof there.
* Failed attempts must be stored: failed proof, why it failed, a guardrail, and a bounded retry
  direction.
* Reasoning receipts must be stored: chosen approach, rejected alternatives, failed/blocked
  paths, guardrails created, retry direction.
* Seed skills are allowed for core or risky subsystems that will soon be edited.
* Seed skills must be evidence-based and direct-read backed: no claims without direct-read docs
  or CBM evidence.

## Approved Early Seed Skills

* codebasedmemory
* knowgraph-skill-ingestion
* knowgraph-skill-retrieval
* skill-packet-fable-handoff
* codegraph-context-reader
* magentic-one-runtime
* thinkgraph-planning-memory
* graph-context-prompt-writer

No other seed skills are approved; new ones require real work touching the area or an explicit
policy update.

## Lifecycle

1. Real prompt becomes a bounded attempt inside a matching or new skill (`AGENTS.md` law).
2. Attempt executes with fresh CBM and packet-based handoff context.
3. Success updates procedure, example, proof, validation, and query metadata.
4. Failure updates failed-attempt, guardrail, and retry metadata.
5. Skill files re-ingest into SkillGraph
   (`py -3.12 services/knowgraph/skill_ingest.py ingest --repo-root .`).
6. Next retrieval surfaces the new lesson.

## Acceptance

* Skill creation has a default trigger (real work), an allowed exception (approved seeds), and a
  hard floor (evidence-based, direct-read backed).
* Failed attempts and reasoning receipts are mandatory memory, not optional.
* The approved seed list above is the complete current set.
