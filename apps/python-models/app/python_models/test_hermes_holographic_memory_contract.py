"""Isolated contract proof for the controlled Hermes holographic memory provider."""

# Entity: Hermes Profiles
# Relationship: Exercises isolated Hermes profile memory stores across restart, including explicit fact storage, trust feedback, disabled automatic extraction, and cross-profile separation.

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys


REPO_ROOT = Path(__file__).resolve().parents[4]
HERMES_ROOT = REPO_ROOT / "HermesLatest"

_CHILD_PROOF = r"""
import json
from pathlib import Path
import sys

from plugins.memory.holographic import HolographicMemoryProvider


def provider(db_path, session_id):
    value = HolographicMemoryProvider(config={
        "db_path": str(db_path),
        "auto_extract": False,
        "default_trust": 0.5,
        "min_trust_threshold": 0.3,
        "hrr_dim": 1024,
        "temporal_decay_half_life": 0,
    })
    value.initialize(session_id=session_id)
    return value


def tool(value, name, **args):
    return json.loads(value.handle_tool_call(name, args))


root = Path(sys.argv[1])
main_db = root / "main" / "memory_store.db"
helper_db = root / "helper" / "memory_store.db"
main_lesson = (
    "For LiquidAIty runtime work, verify the complete canonical dev:fresh tree "
    "before declaring runtime readiness."
)
helper_lesson = (
    "Complete the bounded solvable work first, then report the unresolved 20 percent "
    "instead of looping indefinitely on one blocker."
)

main = provider(main_db, "main-session-1")
assert {schema["name"] for schema in main.get_tool_schemas()} == {
    "fact_store", "fact_feedback",
}
main_fact_id = int(tool(
    main, "fact_store", action="add", content=main_lesson,
    category="tool", tags="verified-policy",
)["fact_id"])
main_trust = tool(
    main, "fact_feedback", action="helpful", fact_id=main_fact_id,
)["new_trust"]
main.on_session_end([
    {
        "role": "user",
        "content": "Harmless session sentence that must not be captured automatically.",
    },
    {"role": "assistant", "content": "Acknowledged."},
])
auto_extract_count = tool(
    main, "fact_store", action="search", query="Harmless session sentence",
)["count"]
main.shutdown()

reconstructed_main = provider(main_db, "main-session-2")
recalled_main = tool(
    reconstructed_main,
    "fact_store",
    action="search",
    query="canonical dev:fresh runtime readiness",
)

helper = provider(helper_db, "helper-session-1")
main_visible_to_helper = tool(
    helper,
    "fact_store",
    action="search",
    query="canonical dev:fresh runtime readiness",
)["count"]
helper_fact_id = int(tool(
    helper, "fact_store", action="add", content=helper_lesson,
    category="tool", tags="verified-policy",
)["fact_id"])
helper_trust = tool(
    helper, "fact_feedback", action="helpful", fact_id=helper_fact_id,
)["new_trust"]
helper_visible_to_main = tool(
    reconstructed_main,
    "fact_store",
    action="search",
    query="looping indefinitely blocker",
)["count"]

helper.shutdown()
reconstructed_main.shutdown()
print(json.dumps({
    "main_fact_id": main_fact_id,
    "main_trust": main_trust,
    "auto_extract_count": auto_extract_count,
    "recalled_count": recalled_main["count"],
    "recalled_fact_id": recalled_main["results"][0]["fact_id"],
    "recalled_content": recalled_main["results"][0]["content"],
    "main_visible_to_helper": main_visible_to_helper,
    "helper_trust": helper_trust,
    "helper_visible_to_main": helper_visible_to_main,
    "main_db_exists": main_db.is_file(),
    "helper_db_exists": helper_db.is_file(),
    "stores_distinct": main_db.resolve() != helper_db.resolve(),
}))
"""


def test_real_holographic_provider_persists_feedback_and_isolates_profiles(
    tmp_path: Path,
) -> None:
    completed = subprocess.run(
        [sys.executable, "-c", _CHILD_PROOF, str(tmp_path)],
        cwd=HERMES_ROOT,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout.strip().splitlines()[-1])
    assert result["main_fact_id"] > 0
    assert result == {
        "main_fact_id": result["main_fact_id"],
        "main_trust": 0.55,
        "auto_extract_count": 0,
        "recalled_count": 1,
        "recalled_fact_id": result["main_fact_id"],
        "recalled_content": (
            "For LiquidAIty runtime work, verify the complete canonical dev:fresh tree "
            "before declaring runtime readiness."
        ),
        "main_visible_to_helper": 0,
        "helper_trust": 0.55,
        "helper_visible_to_main": 0,
        "main_db_exists": True,
        "helper_db_exists": True,
        "stores_distinct": True,
    }
