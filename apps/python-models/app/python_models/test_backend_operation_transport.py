# Entity: Internal MCP Auth
# Relationship: Verifies Python rails accepts only exact loopback backend origins, emits the process secret only for internal calls, and refuses redirect forwarding.

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request

import pytest

from app import backend_operation_transport as transport


@pytest.mark.parametrize(
    "origin",
    (
        "https://127.0.0.1:4000",
        "http://example.test:4000",
        "http://127.0.0.1:4000/api",
        "http://user:password@127.0.0.1:4000",
        "http://127.0.0.1:4000?token=value",
        "http://127.0.0.1:4000#fragment",
        "http://127.0.0.1",
        "http://127.0.0.1:not-a-port",
    ),
)
def test_backend_origin_rejects_non_origin_or_non_loopback_values(origin: str) -> None:
    with pytest.raises(RuntimeError, match="main_backend_url"):
        transport.validated_backend_origin(origin)


def test_backend_origin_accepts_exact_loopback_http_origins() -> None:
    assert transport.validated_backend_origin("http://127.0.0.1:4000/") == (
        "http://127.0.0.1:4000"
    )
    assert transport.validated_backend_origin("http://localhost:4000") == (
        "http://localhost:4000"
    )
    assert transport.validated_backend_origin("http://[::1]:4000") == (
        "http://[::1]:4000"
    )


def test_internal_secret_is_emitted_only_when_explicitly_required(monkeypatch) -> None:
    monkeypatch.setenv("LIQUIDAITY_INTERNAL_MCP_SECRET", "s" * 32)

    assert transport._request_headers(require_internal_secret=False) == {
        "Content-Type": "application/json",
    }
    assert transport._request_headers(require_internal_secret=True) == {
        "Content-Type": "application/json",
        "X-LiquidAIty-Internal-MCP-Secret": "s" * 32,
    }


def test_internal_secret_is_required_for_internal_request(monkeypatch) -> None:
    monkeypatch.delenv("LIQUIDAITY_INTERNAL_MCP_SECRET", raising=False)

    with pytest.raises(RuntimeError, match="internal_mcp_secret_missing"):
        transport._request_headers(require_internal_secret=True)


def test_backend_transport_refuses_redirect_before_forwarding_secret() -> None:
    received_secrets: list[str] = []

    class TargetHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 - stdlib handler contract
            received_secrets.append(
                self.headers.get("X-LiquidAIty-Internal-MCP-Secret", "")
            )
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *_args) -> None:
            return None

    target = ThreadingHTTPServer(("127.0.0.1", 0), TargetHandler)
    target_thread = Thread(target=target.serve_forever, daemon=True)
    target_thread.start()

    class RedirectHandler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 - stdlib handler contract
            self.send_response(307)
            self.send_header(
                "Location",
                f"http://127.0.0.1:{target.server_port}/capture",
            )
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *_args) -> None:
            return None

    redirect = ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler)
    redirect_thread = Thread(target=redirect.serve_forever, daemon=True)
    redirect_thread.start()
    try:
        request = Request(
            f"http://127.0.0.1:{redirect.server_port}/api/internal",
            data=b"{}",
            headers={"X-LiquidAIty-Internal-MCP-Secret": "s" * 32},
            method="POST",
        )
        with pytest.raises(HTTPError) as error:
            transport.open_backend_request(request, timeout_seconds=2)
        assert error.value.code == 307
        assert received_secrets == []
    finally:
        redirect.shutdown()
        target.shutdown()
        redirect.server_close()
        target.server_close()
        redirect_thread.join(timeout=2)
        target_thread.join(timeout=2)
