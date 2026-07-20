"""run_local_coder tool: the model supplies ONLY the logical task; the coder's
filesystem root + run id are injected server-side (never by the tool/model)."""

import asyncio
import json

from app.python_models import tool_registry as t


def _run_with_fake_backend(**kwargs):
    captured: dict = {}
    original = t._post_backend_json_sync

    def fake_post(path: str, payload: dict) -> str:
        captured["path"] = path
        captured["payload"] = payload
        return json.dumps({"ok": False, "report": {"coderPacketId": "srv", "status": "blocked"}})

    t._post_backend_json_sync = fake_post
    try:
        out = asyncio.run(t.run_local_coder(**kwargs))
    finally:
        t._post_backend_json_sync = original
    return captured, out


def test_posts_to_localcoder_run_with_task_only_no_root_no_id():
    captured, out = _run_with_fake_backend(
        objective="Audit the /localcoder/run trusted-root injection.",
        write_mode="edit",
        guardrails=["No fake success."],
        allowed_files=["apps/backend/src/routes/coder.routes.ts"],
        proof_required=["backend tsc"],
    )
    assert captured["path"] == "/api/coder/localcoder/run"
    packet = captured["payload"]["coderPacket"]
    # The tool never supplies the filesystem root or the run id — the backend does.
    assert "repoPath" not in packet
    assert "id" not in packet
    # The logical task the model supplied is carried through verbatim.
    assert packet["objective"] == "Audit the /localcoder/run trusted-root injection."
    assert packet["writeMode"] == "edit"
    assert packet["guardrails"] == ["No fake success."]
    assert packet["allowedFiles"] == ["apps/backend/src/routes/coder.routes.ts"]
    assert packet["proofRequired"] == ["backend tsc"]
    # Required non-empty fields are always present (schema-satisfying defaults).
    assert packet["planExcerpt"] and packet["contextSummary"] and packet["reportFormat"]
    # The authoritative backend report is returned verbatim — no fabricated success.
    assert "blocked" in out


def test_defaults_are_read_only_and_schema_safe():
    captured, _ = _run_with_fake_backend(objective="inspect only")
    packet = captured["payload"]["coderPacket"]
    assert packet["writeMode"] == "read-only"  # never defaults to edit
    assert packet["projectId"] == "default"
    # planExcerpt falls back to the objective; contextSummary has a real default.
    assert packet["planExcerpt"] == "inspect only"


def test_registered_and_manifested():
    assert "run_local_coder" in t.DEFAULT_TOOL_REGISTRY._specs
    ids = [m["id"] for m in t.tool_manifest()]
    assert "run_local_coder" in ids
