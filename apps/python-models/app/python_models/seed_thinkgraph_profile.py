"""Seed the ThinkGraph runtime profile v1 + starter skill into the database.

Idempotent upserts of explicit versioned records (SPEC: DB-backed runtime
assignments, never Markdown). Optionally assigns the starter skill and a bounded
ThinkGraph data binding to the persisted ThinkGraph card of one project/deck,
resolving the card STRUCTURALLY (runtimeBinding 'thinkgraph_agent') through the
existing backend deck route — never by display name, never invented.

Usage:
  python -m app.python_models.seed_thinkgraph_profile                # profile+skill only
  python -m app.python_models.seed_thinkgraph_profile <projectId> <deckId>   # + card assignment
"""

from __future__ import annotations

import json
import os
import sys
from urllib.request import Request, urlopen

from app.python_models import runtime_assignments as ra
from app.python_models import thinkgraph_profile as tg

STARTER_SKILL = ra.RuntimeSkill(
    skill_id="thinkgraph.compact_patch_discipline",
    version=1,
    status="promoted",
    applies_to_binding=tg.THINKGRAPH_RUNTIME_BINDING,
    guidance=(
        "Patch only durable project meaning: concepts, hypotheses, open questions, "
        "decisions, and unresolved relationships. Read the current scope first and "
        "reuse existing resource ids instead of creating near-duplicates. Prefer one "
        "small precise patch over a broad one; when nothing durable changed, return "
        "the structured no_patch result with the specific reason."
    ),
    required_tools=list(tg.THINKGRAPH_ALLOWED_TOOLS),
    required_data_binding_types=["thinkgraph_project_slice"],
    proof_refs=["thinkgraph-mcp-card-runtime-tool-loop-proof-2026-06-30"],
)


def _resolve_thinkgraph_card_id(project_id: str, deck_id: str) -> str:
    backend = os.environ.get("LIQUIDAITY_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")
    request = Request(f"{backend}/api/projects/{project_id}/decks/{deck_id}", method="GET")
    with urlopen(request, timeout=30) as response:  # noqa: S310 — loopback backend only
        payload = json.loads(response.read().decode("utf-8"))
    nodes = ((payload.get("deck") or {}).get("nodes")) or []
    matches = [n for n in nodes if str(n.get("runtimeBinding") or "") == tg.THINKGRAPH_RUNTIME_BINDING]
    if len(matches) != 1:
        raise SystemExit(f"thinkgraph_card_resolution_failed: {len(matches)} matches in {project_id}/{deck_id}")
    return str(matches[0]["id"])


def main() -> None:
    ra.ensure_tables()
    ra.upsert_profile(tg.PROFILE_V1)
    ra.upsert_skill(STARTER_SKILL)
    print(f"seeded profile {tg.PROFILE_V1.profile_id}.v{tg.PROFILE_V1.version}")
    print(f"seeded skill {STARTER_SKILL.skill_id}@v{STARTER_SKILL.version} ({STARTER_SKILL.status})")

    if len(sys.argv) >= 3:
        project_id, deck_id = sys.argv[1], sys.argv[2]
        card_id = _resolve_thinkgraph_card_id(project_id, deck_id)
        ra.assign_skill(
            project_id=project_id, deck_id=deck_id, card_id=card_id,
            skill_id=STARTER_SKILL.skill_id, skill_version=STARTER_SKILL.version,
            card_runtime_binding=tg.THINKGRAPH_RUNTIME_BINDING,
        )
        # Profile v1's declared data assignment: the completed current chat
        # exchange (the front door's server-authored pair) + a bounded ThinkGraph
        # slice. These are THIS profile's selected sources, not a universal limit.
        ra.assign_data_binding(
            project_id=project_id, deck_id=deck_id, card_id=card_id,
            binding_type="conversation_source", binding_ref={"scope": "current_exchange"},
        )
        ra.assign_data_binding(
            project_id=project_id, deck_id=deck_id, card_id=card_id,
            binding_type="thinkgraph_project_slice", binding_ref={"limit": 300},
        )
        print(f"assigned skill + conversation_source + thinkgraph_project_slice bindings to card {card_id} in {project_id}/{deck_id}")


if __name__ == "__main__":
    main()
