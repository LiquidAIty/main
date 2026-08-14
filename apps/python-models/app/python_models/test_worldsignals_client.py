import hashlib
import hmac
import json

import pytest

from app.python_models import worldsignals_client as wsc
from app.python_models import tool_registry as tr
from app.python_models.worldsignals_client import (
    WORLDSIGNALS_RESTRICTED_COMMANDS,
    WorldSignalsClient,
    WorldSignalsError,
    _guard_command,
    worldsignals_capabilities,
)


def _fake_upstream(monkeypatch, *, tool_names: list[str]) -> None:
    """Stand in for the vendor endpoints only — the projection under test is ours."""
    monkeypatch.setattr(
        WorldSignalsClient,
        "capabilities",
        lambda _self: {
            "ok": True,
            "version": "0.9.82",
            "routing": {"preferred_entry": "route_query", "expensive_commands": ["get_report"]},
            # Transport blocks the model can never act on — must be projected away.
            "auth": {"secret": "x" * 400},
            "sse_channel": {"url": "y" * 400},
            "rest_endpoints": {"a": "z" * 400},
            "transport": {"b": "w" * 400},
        },
    )
    monkeypatch.setattr(
        WorldSignalsClient,
        "tools",
        lambda _self: {
            "ok": True,
            "version": "0.9.82",
            "access_tier": "agent",
            "available_commands": list(tool_names),
            "tools": [
                {
                    "name": name,
                    "type": "read",
                    "description": "d" * 900,
                    "parameters": {"q": "string"},
                    "returns": "r" * 900,
                }
                for name in tool_names
            ],
            "tips": ["t" * 400],
        },
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


def test_command_operation_classes_come_from_the_canonical_manifest(monkeypatch) -> None:
    client = WorldSignalsClient(base_url="http://127.0.0.1:8000", secret="")
    monkeypatch.setattr(
        client,
        "tools",
        lambda: {
            "tools": [
                {"name": "channel_status", "type": "read"},
                {"name": "add_watch", "type": "write"},
            ]
        },
    )

    assert client.command_operation_classes(["channel_status", "add_watch"]) == [
        "read",
        "write",
    ]
    with pytest.raises(WorldSignalsError, match="operation_class_unavailable"):
        client.command_operation_classes(["not_in_manifest"])


# ── manifest projection: the model's context is a budget, not a dumping ground ──
# Live upstream returns ~74,300 chars (~18.5k tokens) per capabilities call.


def test_manifest_omits_transport_blocks_the_model_cannot_act_on(monkeypatch) -> None:
    monkeypatch.delenv("WORLDSIGNALS_EXTENDED_PROFILE", raising=False)
    _fake_upstream(monkeypatch, tool_names=["get_summary", "find_entity"])
    payload = json.dumps(worldsignals_capabilities())
    for dropped in ("auth", "sse_channel", "rest_endpoints", "transport", "tips", "returns"):
        assert dropped not in payload, f"{dropped} must not reach the model"
    # What actually selects a command survives.
    result = worldsignals_capabilities()
    assert result["capabilities"]["routing"]["expensive_commands"] == ["get_report"]
    assert result["tools"]["tools"][0]["parameters"] == {"q": "string"}


def test_manifest_does_not_advertise_commands_the_guard_will_refuse(monkeypatch) -> None:
    monkeypatch.delenv("WORLDSIGNALS_EXTENDED_PROFILE", raising=False)
    _fake_upstream(monkeypatch, tool_names=["get_summary", "osint_sweep", "get_sigint_totals"])
    result = worldsignals_capabilities()
    names = {tool["name"] for tool in result["tools"]["tools"]}
    assert names == {"get_summary"}
    assert not names & set(WORLDSIGNALS_RESTRICTED_COMMANDS)
    assert "osint_sweep" not in result["tools"]["available_commands"]
    assert result["tools"]["profile"] == "mainstream"
    assert result["tools"]["omitted_restricted_commands"] == 2
    assert result["tools"]["omissions"] == [
        {"name": "osint_sweep", "reason": "requires_explicit_extended_profile"},
        {
            "name": "get_sigint_totals",
            "reason": "requires_explicit_extended_profile",
        },
    ]


def test_extended_profile_advertises_the_full_roster(monkeypatch) -> None:
    monkeypatch.setenv("WORLDSIGNALS_EXTENDED_PROFILE", "1")
    _fake_upstream(monkeypatch, tool_names=["get_summary", "osint_sweep"])
    result = worldsignals_capabilities()
    names = {tool["name"] for tool in result["tools"]["tools"]}
    assert names == {"get_summary", "osint_sweep"}
    assert result["tools"]["profile"] == "extended"
    assert result["tools"]["omitted_restricted_commands"] == 0


def test_long_descriptions_are_bounded(monkeypatch) -> None:
    monkeypatch.delenv("WORLDSIGNALS_EXTENDED_PROFILE", raising=False)
    _fake_upstream(monkeypatch, tool_names=["get_summary"])
    described = worldsignals_capabilities()["tools"]["tools"][0]["description"]
    assert len(described) <= wsc._TOOL_DESCRIPTION_MAX
    assert described.endswith("…")


def test_manifest_filters_and_exact_command_schema_are_bounded(monkeypatch) -> None:
    monkeypatch.delenv("WORLDSIGNALS_EXTENDED_PROFILE", raising=False)
    monkeypatch.setattr(
        WorldSignalsClient,
        "capabilities",
        lambda _self: {"ok": True, "version": "0.9.82"},
    )
    monkeypatch.setattr(
        WorldSignalsClient,
        "tools",
        lambda _self: {
            "ok": True,
            "tools": [
                {
                    "name": "market_snapshot",
                    "type": "read",
                    "domain": "markets",
                    "description": "Current market prices.",
                    "parameters": {"symbol": {"type": "string"}},
                },
                {
                    "name": "add_watch",
                    "type": "write",
                    "domain": "markets",
                    "description": "Create a market watch.",
                    "parameters": {"symbol": {"type": "string"}},
                },
                {
                    "name": "weather_now",
                    "type": "read",
                    "domain": "weather",
                    "description": "Current conditions.",
                    "parameters": {"location": {"type": "string"}},
                },
            ],
        },
    )

    reads = worldsignals_capabilities(domain="markets", operation_class="read")
    assert [tool["name"] for tool in reads["tools"]["tools"]] == ["market_snapshot"]
    assert reads["tools"]["inventory"] == {"total": 3, "read": 2, "write": 1, "other": 0}

    exact = worldsignals_capabilities(command="weather_now")
    assert exact["tools"]["match_count"] == 1
    assert exact["tools"]["tools"][0]["parameters"] == {"location": {"type": "string"}}

    keyword = worldsignals_capabilities(keyword="watch", limit=1)
    assert [tool["name"] for tool in keyword["tools"]["tools"]] == ["add_watch"]
    assert keyword["tools"]["truncated"] is False


def test_worldsignals_registry_uses_native_callable_without_assignment_side_effects() -> None:
    resolved = tr.DEFAULT_TOOL_REGISTRY.resolve_selected(["worldsignals.command"])
    assert len(resolved) == 1
    assert resolved[0].name == "worldsignals.command"
