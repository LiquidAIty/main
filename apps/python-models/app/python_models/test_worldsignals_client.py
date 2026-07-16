import hashlib
import hmac

import pytest

from app.python_models.worldsignals_client import (
    WORLDSIGNALS_RESTRICTED_COMMANDS,
    WorldSignalsClient,
    WorldSignalsError,
    _guard_command,
)


def test_hmac_headers_match_worldsignals_contract() -> None:
    client = WorldSignalsClient(base_url="http://127.0.0.1:8000", secret="test-secret")
    body = b'{"cmd":"get_summary","args":{}}'
    headers = client._headers("POST", "/api/ai/channel/command", body)
    message = "|".join([
        "POST",
        "/api/ai/channel/command",
        headers["X-SB-Timestamp"],
        headers["X-SB-Nonce"],
        hashlib.sha256(body).hexdigest(),
    ])
    expected = hmac.new(b"test-secret", message.encode(), hashlib.sha256).hexdigest()
    assert headers["X-SB-Signature"] == expected
    assert len(headers["X-SB-Nonce"]) >= 16


def test_mainstream_commands_pass_the_default_capability_boundary() -> None:
    # A representative mainstream research command is never gated.
    for cmd in ("get_summary", "find_entity", "correlate_entity", "search_news", "add_watch", "brief_area"):
        assert cmd not in WORLDSIGNALS_RESTRICTED_COMMANDS
        _guard_command(cmd)  # must not raise


def test_recon_commands_are_refused_without_explicit_extended_profile(monkeypatch) -> None:
    monkeypatch.delenv("WORLDSIGNALS_EXTENDED_PROFILE", raising=False)
    for cmd in ("osint_sweep", "osint_lookup", "get_sigint_totals", "join_infonet_swarm"):
        with pytest.raises(WorldSignalsError, match="extended_profile"):
            _guard_command(cmd)


def test_extended_profile_flag_unlocks_recon_commands(monkeypatch) -> None:
    monkeypatch.setenv("WORLDSIGNALS_EXTENDED_PROFILE", "1")
    _guard_command("osint_sweep")  # explicit operator opt-in — must not raise


def test_batch_rejects_a_restricted_command_in_the_list(monkeypatch) -> None:
    monkeypatch.delenv("WORLDSIGNALS_EXTENDED_PROFILE", raising=False)
    client = WorldSignalsClient(base_url="http://127.0.0.1:8000", secret="")
    with pytest.raises(WorldSignalsError, match="extended_profile"):
        client.batch([{"cmd": "get_summary"}, {"cmd": "osint_sweep"}])
