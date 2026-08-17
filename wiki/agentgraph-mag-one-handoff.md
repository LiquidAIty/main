---
id: feature.agentgraph-mag-one-handoff
title: Transient IDF and Native Mag One
kind: feature
status: current_partial
proof_level: focused_tests_source_and_persistence_readback

cbm:
  project_identity: C-Projects-LiquidAIty-main
  index_root: C:/Projects/LiquidAIty/main
  coverage: refresh_required_after_current_working_tree

roots:
  current_replacement_files:
    - LiquidAIty.idd
    - apps/backend/migrations/022_relational_agent_domain.sql
    - apps/backend/src/decks/store.ts
    - apps/backend/src/routes/coder.routes.ts
    - apps/python-models/app/python_models/card_domain.py
    - apps/python-models/app/python_models/idd.py
    - apps/python-models/app/python_models/magentic_agentchat.py
---

# Transient IDF and Native Mag One

## Outcome

The existing Project owns Decks and stable Cards. PostgreSQL stores stable Deck/Card revisions,
facets, grants, layout, prompt-free Runs, and explicit artifact metadata. React Flow edits Card
relationships and AGE stores those accepted relationships as authority.

IDD is the repo-root `LiquidAIty.idd` dictionary. IDF is one transient communication materialized in
Python memory from a stable Card plus the current assignment, selected context/tools, constraints, and
output contract. The Inspector-visible bytes are the bytes sent to the selected runtime and are then
discarded. IDF is not an assignment row, approval record, receipt, transcript, or training archive.

Native AutoGen `MagenticOneGroupChat` remains Mag One execution authority. The outer mission is one
transient IDF; worker eligibility comes from user-authored AGE `MAGENTIC_OPTION` relationships, and
the native Task Progress Ledger remains private AutoGen state.

## Current replacement seam

```text
Project + Deck
→ relational Card revision and runtime facets
→ AGE Card topology
→ Card Inspector / IDF Editor
→ Python transient materialization and exact edit validation
→ Hermes, AutoGen/Mag One, Coder, or direct assistant native runtime
→ prompt-free Run status and explicit artifacts
→ best-effort AGE execution telemetry
```

TypeScript is limited to UI, HTTP/SSE/auth, and proven byte/process transport. It does not select
Cards, profiles, providers, workers, or tools; materialize IDFs; persist domain lifecycle; or synthesize
receipts. The old durable IDF draft/revision/approval and Mag One prompt-store paths have no active
writer.

## Must not break

1. The Projects system remains unchanged; Agent Builder is a view, not a domain entity.
2. Stable Cards own identity, common prompt, provider/model/access/runtime, grants, and separate Hermes
   and AutoGen facets.
3. AGE topology writes fail closed; prompt-free execution telemetry is best-effort.
4. Native Mag One remains `MagenticOneGroupChat`; private ledgers are not persisted or reconstructed.
5. OpenClaude/LocalCoder remains the sole Coder and owns repository/process/test/CoderReport behavior.
6. No provider/model/tool fallback and no automatic raw prompt, IDF, context, response, or transcript
   archive. Only an explicit Save IDF action may preserve the exact canonical IDF revision.

## Valid proof

- migration 022 applies once and preserves the existing Project identity;
- the legacy deck snapshot is recoverable and relational/AGE reconstruction is field-equivalent;
- two transient previews differ while the stable Card and all raw legacy table counts remain unchanged;
- exact edited IDF bytes validate while protected Card configuration changes fail closed;
- Agent Builder and Main read the same Project/Deck/Card authority;
- focused source tests, typechecks, full supervised startup, and read-only plugin receipts pass;
- a real provider call remains a separate proof and must never be faked or silently substituted.
