"""Shared construction and idempotence for native Team transcript results.

LIQUIDAITY VENDOR PATCH: keep alternate trusted host transports on Hermes'
existing transcript owners without duplicating result formatting or identity.
"""

from __future__ import annotations

from typing import Any


_TERMINAL_STATES = frozenset({"completed", "blocked", "failed", "cancelled"})


def prepare_native_team_result(
    history: list[Any],
    *,
    task_id: str,
    result: str,
    terminal_state: str,
) -> dict[str, Any] | None:
    """Return one validated assistant message, or ``None`` when already present.

    The caller retains its native session lock and persistence owner.  Sharing
    this helper keeps ACP and interactive CLI delivery byte-for-byte aligned
    without introducing another transcript store.
    """

    native_task_id = str(task_id or "").strip()
    result_text = str(result or "").strip()
    state = str(terminal_state or "").strip().lower()
    if not native_task_id or not result_text:
        raise ValueError("hermes_team_result_incomplete")
    if state not in _TERMINAL_STATES:
        raise ValueError("hermes_team_result_state_invalid")
    for message in history:
        if not isinstance(message, dict):
            continue
        display = message.get("display_metadata")
        if (
            message.get("display_kind") == "native_team_result"
            and isinstance(display, dict)
            and display.get("nativeTaskId") == native_task_id
        ):
            return None
    return {
        "role": "assistant",
        "content": result_text,
        "display_kind": "native_team_result",
        "display_metadata": {
            "nativeTaskId": native_task_id,
            "terminalState": state,
        },
    }
