from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[4]
HERMES_ROOT = REPO_ROOT / "HermesLatest"
_HERMES_PATH_ADDED = str(HERMES_ROOT) not in sys.path
if _HERMES_PATH_ADDED:
    sys.path.insert(0, str(HERMES_ROOT))

from plugins.memory.holographic import HolographicMemoryProvider  # noqa: E402

if _HERMES_PATH_ADDED:
    sys.path.remove(str(HERMES_ROOT))
# The plugin has already bound the helper it needs. Do not leave Hermes' flat
# utils.py occupying the installed Graphiti package's top-level `utils` name for
# unrelated tests in the same interpreter.
for _module_name in list(sys.modules):
    if _module_name == "utils" or _module_name.startswith("utils."):
        _module = sys.modules.get(_module_name)
        _origin = Path(str(getattr(_module, "__file__", "") or ""))
        try:
            _from_hermes = _origin.resolve().is_relative_to(HERMES_ROOT.resolve())
        except (OSError, ValueError):
            _from_hermes = False
        if _from_hermes:
            sys.modules.pop(_module_name, None)


@pytest.fixture(autouse=True)
def _isolated_hermes_import_path():
    sys.path.insert(0, str(HERMES_ROOT))
    try:
        yield
    finally:
        try:
            sys.path.remove(str(HERMES_ROOT))
        except ValueError:
            pass
        for module_name in list(sys.modules):
            if module_name == "utils" or module_name.startswith("utils."):
                module = sys.modules.get(module_name)
                origin = Path(str(getattr(module, "__file__", "") or ""))
                try:
                    from_hermes = origin.resolve().is_relative_to(HERMES_ROOT.resolve())
                except (OSError, ValueError):
                    from_hermes = False
                if from_hermes:
                    sys.modules.pop(module_name, None)


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
    helper_db = tmp_path / "helper" / "memory_store.db"
    main_lesson = (
        "For LiquidAIty runtime work, verify the complete canonical dev:fresh tree "
        "before declaring runtime readiness."
    )
    helper_lesson = (
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

    helper = _provider(helper_db, "helper-session-1")
    assert _tool(
        helper,
        "fact_store",
        action="search",
        query="canonical dev:fresh runtime readiness",
    )["count"] == 0
    helper_fact_id = int(
        _tool(
            helper,
            "fact_store",
            action="add",
            content=helper_lesson,
            category="tool",
            tags="verified-policy",
        )["fact_id"]
    )
    assert _tool(helper, "fact_feedback", action="helpful", fact_id=helper_fact_id)[
        "new_trust"
    ] == 0.55
    assert _tool(
        reconstructed_main,
        "fact_store",
        action="search",
        query="looping indefinitely blocker",
    )["count"] == 0

    helper.shutdown()
    reconstructed_main.shutdown()
    assert main_db.is_file()
    assert helper_db.is_file()
    assert main_db.resolve() != helper_db.resolve()
