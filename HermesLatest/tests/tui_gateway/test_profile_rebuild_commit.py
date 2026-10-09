"""Session-only tools ingress and rebuild failure preserve profile isolation."""
import threading
from types import SimpleNamespace

import pytest
import yaml


@pytest.mark.parametrize("explicit_profile", [None, "default"])
def test_tools_configure_uses_live_session_profile(tmp_path, monkeypatch, explicit_profile):
    from tui_gateway import server
    from hermes_constants import get_hermes_home

    home = tmp_path / ".hermes"
    profile = home / "profiles" / "worker"
    profile.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    config = {"platform_toolsets": {"cli": ["terminal", "web"]}}
    for path in (home, profile):
        (path / "config.yaml").write_text(yaml.safe_dump(config))
    launch_before = (home / "config.yaml").read_bytes()
    seen = []
    monkeypatch.setattr(server, "_reset_session_agent", lambda *_: seen.append(get_hermes_home()) or {})
    monkeypatch.setitem(server._sessions, "profile-tools", {"profile_home": str(profile)})
    params = {"session_id": "profile-tools", "action": "disable", "names": ["terminal"]}
    if explicit_profile is not None:
        params["profile"] = explicit_profile
    response = server._methods["tools.configure"](1, params)
    assert "error" not in response
    assert (home / "config.yaml").read_bytes() == launch_before
    assert "terminal" not in yaml.safe_load((profile / "config.yaml").read_text())["platform_toolsets"]["cli"]
    assert seen == [profile]
    assert get_hermes_home() == home
    worker_before = (profile / "config.yaml").read_bytes()
    monkeypatch.delitem(server._sessions, "profile-tools")
    response = server._methods["tools.configure"](2, params)
    assert response["error"]["code"] == 4001
    assert (home / "config.yaml").read_bytes() == launch_before
    assert (profile / "config.yaml").read_bytes() == worker_before
    response = server._methods["tools.configure"](3, {"action": "disable", "names": ["terminal"]})
    assert "error" not in response and not response["result"]["reset"]
    assert (home / "config.yaml").read_bytes() != launch_before
    assert (profile / "config.yaml").read_bytes() == worker_before


@pytest.mark.parametrize("path", ["reset", "capabilities"])
@pytest.mark.parametrize("has_agent_db", [True, False])
def test_rebuild_preparation_failure_keeps_reachable_owner(tmp_path, monkeypatch, path, has_agent_db):
    from tui_gateway import server
    from hermes_state import SessionDB
    from hermes_constants import get_hermes_home

    home = tmp_path / ".hermes"
    profile = home / "profiles" / "worker"
    profile.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    db = SessionDB(db_path=profile / "state.db")
    old = SimpleNamespace(_session_db=db if has_agent_db else None,
                          _owns_session_db=has_agent_db, _session_title_hint="Bot Chat")
    session = {"agent": old, "profile_home": str(profile), "session_key": "profile-key",
               "profile_capabilities_seen": "before", "source": "desktop", "cwd": str(tmp_path),
               "history": [], "history_lock": threading.Lock(), "history_version": 0}
    built = []
    def make_agent(*_args, session_db=None, **_kwargs):
        replacement = SimpleNamespace(_session_db=session_db, _owns_session_db=False)
        built.append(replacement)
        return replacement
    def fail_config():
        raise RuntimeError("preparation failed")
    monkeypatch.setattr(server, "_make_agent", make_agent)
    monkeypatch.setattr(server, "_config_model_target", fail_config)
    monkeypatch.setattr(
        "tools.bot_mode_probe.capability_fingerprint",
        lambda _home, roster_override=None: "after",
    )
    try:
        if path == "reset":
            with pytest.raises(RuntimeError, match="preparation failed"):
                server._reset_session_agent("profile-tools", session)
        else:
            server._sync_profile_capabilities("profile-tools", session)
        assert session["agent"] is old
        assert old._owns_session_db is has_agent_db
        assert not built, "prepare config before allocating a replacement"
        assert get_hermes_home() == home
        db.create_session("still-owned", "tui")
    finally:
        db.close()
        for agent in built:
            if agent._session_db is not db and agent._owns_session_db:
                agent._session_db.close()


def test_follow_profile_config_refreshes_agent_without_replacing_session_history(
    tmp_path, monkeypatch,
):
    from tui_gateway import server

    old = SimpleNamespace(_session_db=None, _owns_session_db=False,
                          _session_title_hint="Card Chat:stable")
    history = [{"role": "user", "content": "before"}]
    session = {
        "agent": old,
        "profile_home": str(tmp_path / "profiles" / "main"),
        "session_key": "stored-main",
        "follow_profile_config": True,
        "bot_mode_roster": ["knowgraph"],
        "profile_capabilities_seen": "before",
        "source": "desktop",
        "cwd": str(tmp_path),
        "history": history,
        "history_lock": threading.Lock(),
        "history_version": 4,
    }
    observed = []
    replacement = SimpleNamespace(_session_db=None, _owns_session_db=False)

    def fingerprint(home, roster_override=None):
        observed.append((home, roster_override))
        return "after"

    def rebuild(sid, current, **kwargs):
        assert sid == "live-main"
        assert current is session
        assert kwargs["session_id"] == "stored-main"
        current["agent"] = replacement
        return replacement

    monkeypatch.setattr("tools.bot_mode_probe.capability_fingerprint", fingerprint)
    monkeypatch.setattr(server, "_set_session_context", lambda *_args, **_kwargs: ())
    monkeypatch.setattr(server, "_clear_session_context", lambda _tokens: None)
    monkeypatch.setattr(server, "_rebuild_session_agent", rebuild)
    monkeypatch.setattr(server, "_emit", lambda *_args, **_kwargs: None)

    server._sync_profile_capabilities("live-main", session)

    assert observed == [(session["profile_home"], ["knowgraph"])]
    assert session["agent"] is replacement
    assert session["history"] is history
    assert session["history_version"] == 4
    assert session["session_key"] == "stored-main"


def test_non_following_non_bot_session_does_not_refresh_capabilities(monkeypatch):
    from tui_gateway import server

    agent = SimpleNamespace(_session_title_hint="Ordinary Chat")
    session = {"agent": agent, "session_key": "stored-ordinary"}
    monkeypatch.setattr(
        "tools.bot_mode_probe.capability_fingerprint",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("must not fingerprint")),
    )

    server._sync_profile_capabilities("live-ordinary", session)

    assert session == {"agent": agent, "session_key": "stored-ordinary"}


def test_follow_profile_config_refresh_failure_blocks_the_turn_and_retries(monkeypatch):
    from tui_gateway import server

    old = SimpleNamespace(_session_db=None, _owns_session_db=False,
                          _session_title_hint="Card Chat:stable")
    session = {
        "agent": old,
        "profile_home": "profile-main",
        "session_key": "stored-main",
        "follow_profile_config": True,
        "profile_capabilities_seen": "before",
        "source": "desktop",
        "cwd": ".",
    }
    monkeypatch.setattr(
        "tools.bot_mode_probe.capability_fingerprint",
        lambda _home, roster_override=None: "after",
    )
    monkeypatch.setattr(
        "tools.bot_mode_probe.invalidate_bot_mode_protocol_cache",
        lambda _home: None,
    )
    monkeypatch.setattr(server, "_set_session_context", lambda *_args, **_kwargs: ())
    monkeypatch.setattr(server, "_clear_session_context", lambda _tokens: None)
    monkeypatch.setattr(
        server,
        "_rebuild_session_agent",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("rebuild failed")),
    )

    with pytest.raises(RuntimeError, match="profile_capability_refresh_failed"):
        server._sync_profile_capabilities("live-main", session)

    assert session["agent"] is old
    assert session["profile_capabilities_seen"] == "before"


def test_expected_profile_fingerprint_mismatch_blocks_before_rebuild(monkeypatch):
    from tui_gateway import server

    old = SimpleNamespace(_session_db=None, _owns_session_db=False,
                          _session_title_hint="Card Chat:stable")
    session = {
        "agent": old,
        "profile_home": "profile-main",
        "session_key": "stored-main",
        "follow_profile_config": True,
        "bot_mode_roster": ["knowgraph"],
        "profile_capabilities_seen": "aaaaaaaaaaaa",
    }
    monkeypatch.setattr(
        "tools.bot_mode_probe.capability_fingerprint",
        lambda _home, roster_override=None: "bbbbbbbbbbbb",
    )
    monkeypatch.setattr(
        server,
        "_rebuild_session_agent",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("mismatch must fail before rebuild")
        ),
    )

    with pytest.raises(RuntimeError, match="profile_capability_fingerprint_mismatch"):
        server._sync_profile_capabilities(
            "live-main",
            session,
            "cccccccccccc",
        )

    assert session["agent"] is old
    assert session["profile_capabilities_seen"] == "aaaaaaaaaaaa"


def test_live_capability_rebuild_uses_current_overrides_not_stale_resume_snapshot(
    monkeypatch, tmp_path,
):
    from tui_gateway import server

    session_db = object()
    old = SimpleNamespace(
        _session_db=session_db,
        _owns_session_db=False,
        _session_title_hint="Card Chat:stable",
    )
    session = {
        "agent": old,
        "profile_home": None,
        "session_key": "stored-main",
        "source": "desktop",
        "cwd": str(tmp_path),
        "follow_profile_config": True,
        "model_override": {"model": "current-model", "provider": "current-provider"},
        "resume_runtime_overrides": {
            "model_override": {"model": "stale-model", "provider": "stale-provider"},
            "provider_override": "stale-provider",
        },
        "create_reasoning_override": {},
        "create_service_tier_override": "",
    }
    captured = {}
    replacement = SimpleNamespace(_session_db=session_db, _owns_session_db=False)

    def make_agent(*_args, **kwargs):
        captured.update(kwargs)
        return replacement

    monkeypatch.setattr(server, "_bind_build_profile_scopes", lambda _home: None)
    monkeypatch.setattr(server, "_config_model_target", lambda: ("profile-model", "profile-provider"))
    monkeypatch.setattr(
        server,
        "_session_profile_capability_fingerprint",
        lambda _session: "0123456789ab",
    )
    monkeypatch.setattr(server, "_make_agent", make_agent)

    server._rebuild_session_agent(
        "live-main",
        session,
        session_id="stored-main",
    )

    assert captured["model_override"] == {
        "model": "current-model", "provider": "current-provider",
    }
    assert "provider_override" not in captured
    assert captured["reasoning_config_override"] == {}
    assert captured["service_tier_override"] == ""
    assert captured["cwd_override"] == str(tmp_path)


def test_profile_change_during_agent_build_keeps_the_previous_agent(monkeypatch, tmp_path):
    from tui_gateway import server

    old = SimpleNamespace(
        _session_db=object(),
        _owns_session_db=False,
        _session_title_hint="Card Chat:stable",
    )
    closed = []
    replacement = SimpleNamespace(
        _session_db=old._session_db,
        _owns_session_db=False,
        close=lambda: closed.append(True),
    )
    session = {
        "agent": old,
        "profile_home": None,
        "session_key": "stored-main",
        "source": "desktop",
        "cwd": str(tmp_path),
        "follow_profile_config": True,
    }
    fingerprints = iter(["aaaaaaaaaaaa", "bbbbbbbbbbbb"])
    monkeypatch.setattr(server, "_bind_build_profile_scopes", lambda _home: None)
    monkeypatch.setattr(server, "_config_model_target", lambda: ("model", "provider"))
    monkeypatch.setattr(
        server,
        "_session_profile_capability_fingerprint",
        lambda _session: next(fingerprints),
    )
    monkeypatch.setattr(server, "_make_agent", lambda *_args, **_kwargs: replacement)

    with pytest.raises(RuntimeError, match="profile_changed_during_agent_build"):
        server._rebuild_session_agent(
            "live-main",
            session,
            session_id="stored-main",
        )

    assert session["agent"] is old
    assert closed == [True]
