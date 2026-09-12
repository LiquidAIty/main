# Restore Jeremiah's saved Agent Canvas

This folder contains the **10 named saved Cards and all 9 saved connections** from project
`1b1a6958-0658-4b1a-bf13-e2066582adb4`, deck `deck_builder`.

It is a plain-file Git recovery package. Assist 6 (`card_assist_rkxe5o`) was excluded because
Jeremiah identified it as a blank test agent. The old computer's databases and source profiles
were not changed. No database dump, ZIP, chat history, Run history or graph data is included.

## On the new computer

Clone the same repository, then give Codex this instruction:

> Read recovery/agent-system-export/README.md and manifest.json. Restore these exact ten
> saved Cards, their current revisions, 122 grants, nine profiles and nine edges into the
> new empty LiquidAIty installation. Preserve the exported IDs, prompt blocks, provider/model
> selections, runtime options, permissions, scripts, positions and handles. Use the existing
> Python Card domain and AGE ownership, and the raw source records here. Do not create new
> Card IDs, substitute defaults, add Assist 6, import histories or graph records, or redesign
> the UI. Verify checksums first. After restoring, compare saved readback field by field and
> open Agent Canvas to check the real Cards and wiring. Do not run agents until that check.

The repository source is already in Git at source HEAD
`fdd39a17561ba66e718179843ce82615d4a8ed00`. The new Git commit containing this package will
have a later HEAD; that does not change the recorded source baseline.

Install this repository's dependencies and native database schemas using its existing setup.
No dependencies, Docker images/volumes or virtual environments are shipped in this folder.
Provider authentication belongs to the new installation; credentials were deliberately excluded.
The `Kronos-main` Git submodule was uninitialized on the old computer; its pinned source is
a Git dependency, not an exported agent record.

## Contents

| File or folder | Authority preserved |
| --- | --- |
| cards.json | Exact ten agent_cards rows, their current agent_card_revisions, deck_card_memberships and current card_capability_grants |
| edges.json | Exact saved FLOW, MAGENTIC_OPTION and MAGENTIC_CONTROL edge properties and stable endpoint Card IDs |
| project.json | Required project identity, exact deck row and six saved prompt templates |
| profiles/ | Nine profiles' reusable configuration, SOUL, existing profile metadata, selected local skills, Main Honcho config and Builder's existing no-bundled-skills marker |
| manifest.json | Selection, source owners, per-profile source/export hashes, counts, exclusions, restore order and validation |
| SHA256SUMS.txt | SHA-256 of every package file except the checksum list itself |

The adjacent repo `.codex/config.toml` contains separately requested portable Codex preferences.
It is not an application profile and does not hold credentials.

## Restore order for Codex

This is a restoration into an **empty new installation**, not an import to run on the old computer.

1. Verify every entry in SHA256SUMS.txt and parse all JSON/YAML. Check the native table schema
   against this repository's current Card domain before writing.
2. Insert the exported parent project and deck. Preserve their IDs and saved values. The
   exported project deliberately omits obsolete project-agent configuration; only saved Cards
   own agent prompts/models/tools. New-machine authentication/grants must be established by
   the existing authentication flow, not copied User, Session or external-identity rows.
3. Insert the ten agent_cards rows with current_revision_id temporarily null; insert the
   exact exported revision rows; restore each Card's original current_revision_id. This
   ordering follows the circular Card/revision foreign keys. Do not regenerate revision IDs,
   revision numbers, content hashes or base prompts.
4. Insert exported memberships, capability grants and deck prompt templates. Preserve
   position_x, position_y, ordinal, parent_graph_id and presentation_config verbatim.
5. Use the existing AGE graph to create Card endpoint identities from projectId/deckId/cardId.
   Recreate the nine relations with their exported labels and every saved property. AGE
   internal graphids are storage-local; stable cardId and edgeId values must remain exact.
6. Copy profile files back to the repo-relative source paths recorded in manifest.json
   (`Hermes/.hermes/profiles/<profile>/...`). Preserve bytes. Do not copy a whole Hermes
   home, seed a different agent, or replace selected skills with newer variants.
7. Read back the deck through the current saved-Card authority and compare to the export.
   Confirm ten named Cards, nine exact directed edges, current grants, models, profiles and
   positions. Check the real Agent Canvas visually before model work.

Required source owners:
- `apps/python-models/app/python_models/card_domain.py::_load_deck_with_cursor`
- `apps/python-models/app/python_models/card_domain.py::_load_age_edges`
- `ag_catalog.agent_cards / agent_card_revisions / deck_card_memberships / card_capability_grants`
- `agentgraph.Card / FLOW / MAGENTIC_OPTION / MAGENTIC_CONTROL`

## Exactness and current limitations

- Main Chat, Magentic-One, Graph Agent, Trading Agent, WorldSignals, WorldView,
  Signal Analyst, Quant Analyst, ThinkGraph and Builder are included.
- All saved IDs are unchanged. The exported deck version is 233.
- Trading's Magentic option edge really has targetHandle `bus-out-2`; preserve it.
- Saved provider_model_id is null for Trading and WorldSignals; their model_key values
  are present. Do not silently fill these fields.
- Native profile permissions and disabled-skill lists are preserved. This export does
  not resolve any existing difference between a profile selection and its saved Card.
- Membership presentation_config is empty on every selected Card. Saved positions and
  runtime presentation options are preserved. The source UI supplies ordinary Card sizes;
  browser-only viewport/inspector state was explicitly excluded.
- Main's Honcho configuration is retained. The old local Honcho service/history was not
  available for migration; no memory data is supplied.
- Source-readback equality, parse checks and checksums passed. A successful restore,
  running services and Jeremiah's acceptance on the new computer remain unproven.

## Saving to Git on the old computer

Only the package and portable Codex preferences need to be staged for this migration:

```powershell
git add -- .codex/config.toml recovery/agent-system-export
git commit -m "Save named agents and canvas for computer migration"
git push origin main
```

The incomplete broader audit document and the mistaken full-export directory are not part
of that staging command. No commit or push was performed by Codex.

