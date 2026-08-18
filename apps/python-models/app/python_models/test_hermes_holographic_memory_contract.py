from __future__ import annotations

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
HERMES_ROOT = REPO_ROOT / "Hermes"
if str(HERMES_ROOT) not in sys.path:
    sys.path.insert(0, str(HERMES_ROOT))

from plugins.memory.holographic import HolographicMemoryProvider  # noqa: E402


def _provider(db_path: Path, session_id: str) -> HolographicMemoryProvider:
    provider = HolographicMemoryProvider(
        config={
            "db_path": str(db_path),
            "auto_extract": False,
            "default_trust": 0.5,
            "min_trust_threshold": 0.3,
            "hrr_dim": 1024,
            "temporal_decay_half_life": 0,
        }
    )
    provider.initialize(session_id=session_id)
    return provider


def _tool(provider: HolographicMemoryProvider, name: str, **args: object) -> dict:
    return json.loads(provider.handle_tool_call(name, args))


def test_real_holographic_provider_persists_feedback_and_isolates_profiles(tmp_path: Path) -> None:
    main_db = tmp_path / "main" / "memory_store.db"
    steward_db = tmp_path / "steward" / "memory_store.db"
    main_lesson = (
        "For LiquidAIty runtime work, verify the complete canonical dev:fresh tree "
        "before declaring runtime readiness."
    )
    steward_lesson = (
        "Complete the bounded solvable work first, then report the unresolved 20 percent "
        "instead of looping indefinitely on one blocker."
    )

    main = _provider(main_db, "main-session-1")
    assert {schema["name"] for schema in main.get_tool_schemas()} == {
        "fact_store",
        "fact_feedback",
    }
    main_add = _tool(
        main,
        "fact_store",
        action="add",
        content=main_lesson,
        category="tool",
        tags="verified-policy",
    )
    main_fact_id = int(main_add["fact_id"])
    assert main_fact_id > 0
    assert _tool(main, "fact_feedback", action="helpful", fact_id=main_fact_id)[
        "new_trust"
    ] == 0.55

    unique_unretained = "Harmless session sentence that must not be captured automatically."
    main.on_session_end(
        [
            {"role": "user", "content": unique_unretained},
            {"role": "assistant", "content": "Acknowledged."},
        ]
    )
    assert _tool(main, "fact_store", action="search", query="Harmless session sentence")[
        "count"
    ] == 0
    main.shutdown()

    reconstructed_main = _provider(main_db, "main-session-2")
    recalled_main = _tool(
        reconstructed_main,
        "fact_store",
        action="search",
        query="canonical dev:fresh runtime readiness",
    )
    assert recalled_main["count"] == 1
    assert recalled_main["results"][0]["fact_id"] == main_fact_id
    assert recalled_main["results"][0]["content"] == main_lesson

    steward = _provider(steward_db, "steward-session-1")
    assert _tool(
        steward,
        "fact_store",
        action="search",
        query="canonical dev:fresh runtime readiness",
    )["count"] == 0
    steward_fact_id = int(
        _tool(
            steward,
            "fact_store",
            action="add",
            content=steward_lesson,
            category="tool",
            tags="verified-policy",
        )["fact_id"]
    )
    assert _tool(steward, "fact_feedback", action="helpful", fact_id=steward_fact_id)[
        "new_trust"
    ] == 0.55
    assert _tool(
        reconstructed_main,
        "fact_store",
        action="search",
        query="looping indefinitely blocker",
    )["count"] == 0

    steward.shutdown()
    reconstructed_main.shutdown()
    assert main_db.is_file()
    assert steward_db.is_file()
    assert main_db.resolve() != steward_db.resolve()
