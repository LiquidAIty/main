from __future__ import annotations

import io
import json
import urllib.error
from types import SimpleNamespace

import pytest

import liquidaity_hermes_plugin as plugin


def _context():
    return SimpleNamespace(
        task_id="t_root",
        run_id="17",
        board="Triage",
        assignee="coder",
        profile="coder",
        workspace="C:/workspace",
        claim_lock="claim-token",
    )


class _Response:
    def __init__(self, payload: bytes):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit: int) -> bytes:
        return self._payload


class _Opener:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.request = None
        self.timeout = None

    def open(self, request, timeout):
        self.request = request
        self.timeout = timeout
        if self.error:
            raise self.error
        return self.response


def test_correlated_worker_receives_only_ephemeral_bearer(monkeypatch):
    bearer = "b" * 64
    opener = _Opener(_Response(json.dumps({"ok": True, "bearer": bearer}).encode()))
    monkeypatch.setattr(plugin.urllib.request, "build_opener", lambda *_args: opener)

    assert plugin._worker_environment(_context()) == {
        "LIQUIDAITY_CARD_BEARER": bearer
    }
    assert json.loads(opener.request.data) == {
        "taskId": "t_root",
        "nativeRunId": "17",
        "board": "Triage",
        "assignee": "coder",
        "profile": "coder",
        "workspace": "C:/workspace",
        "claimLock": "claim-token",
    }
    assert opener.timeout == plugin._TIMEOUT_SECONDS


def test_uncorrelated_stock_task_keeps_original_lane(monkeypatch):
    error = urllib.error.HTTPError(
        plugin._DEFAULT_ENDPOINT, 404, "not found", {}, io.BytesIO()
    )
    monkeypatch.setattr(
        plugin.urllib.request,
        "build_opener",
        lambda *_args: _Opener(error=error),
    )

    assert plugin._worker_environment(_context()) is None


@pytest.mark.parametrize(
    "payload",
    [
        b"not-json",
        json.dumps({"ok": True, "bearer": "too-short"}).encode(),
        json.dumps({"ok": False, "bearer": "b" * 64}).encode(),
    ],
)
def test_invalid_bearer_response_fails_closed(monkeypatch, payload):
    monkeypatch.setattr(
        plugin.urllib.request,
        "build_opener",
        lambda *_args: _Opener(_Response(payload)),
    )

    with pytest.raises(
        RuntimeError, match="liquidaity_card_bearer_lookup_response_invalid"
    ):
        plugin._worker_environment(_context())


def test_register_uses_stock_plugin_api():
    callbacks = []
    ctx = SimpleNamespace(
        register_kanban_worker_environment_provider=callbacks.append
    )

    plugin.register(ctx)

    assert callbacks == [plugin._worker_environment]

