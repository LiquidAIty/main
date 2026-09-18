"""Tests for tools/bot_mode_probe.py — the Bot Mode teammate-protocol section."""

import textwrap

import pytest
import yaml

from tools import bot_mode_probe


@pytest.fixture(autouse=True)
def _fresh_cache():
    bot_mode_probe._reset_cache_for_tests()
    yield
    bot_mode_probe._reset_cache_for_tests()


def _write_bot_roster(home, names):
    path = home / "config.yaml"
    config = yaml.safe_load(path.read_text(encoding="utf-8")) if path.is_file() else {}
    config = config if isinstance(config, dict) else {}
    bot_mode = config.get("bot_mode") if isinstance(config.get("bot_mode"), dict) else {}
    bot_mode["roster"] = list(names)
    config["bot_mode"] = bot_mode
    path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")


def _mark_managed(home):
    (home / "profile.yaml").write_text(
        "ui_meta:\n  hermes-bots:\n    shape: cloud\n",
        encoding="utf-8",
    )


def _make_bot_profile(root, name, *, managed=True, soul=None, roster=None):
    d = root / "profiles" / name
    d.mkdir(parents=True, exist_ok=True)
    if managed:
        (d / "profile.yaml").write_text(
            textwrap.dedent(
                """\
                ui_meta:
                  hermes-bots:
                    shape: cloud
                    color: '#8b5cf6'
                """
            ),
            encoding="utf-8",
        )
    if soul is not None:
        (d / "SOUL.md").write_text(soul, encoding="utf-8")
    if roster is not None:
        _write_bot_roster(d, roster)
    return d


def test_roster_excludes_infra_dirs_and_tombstones(tmp_path):
    """The teammate roster applies the same identity predicate as ``profile list``: bare
    infrastructure dirs (``@sessions``, ``@logs``) and deleted profiles are not teammates (#99392)."""
    from hermes_constants import mark_named_profile_deleted

    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "researcher", managed=True)
    for stray in ("sessions", "logs"):
        (home / "profiles" / stray / "cron").mkdir(parents=True)
    ghost = _make_bot_profile(home, "ghost", managed=True)
    mark_named_profile_deleted(ghost)
    _write_bot_roster(home, ["sessions", "researcher", "ghost", "researcher"])

    assert [name for name, _ in bot_mode_probe.resolve_bot_roster(home)] == ["researcher"]
    section = bot_mode_probe.get_bot_mode_protocol_section(home)
    assert "`@researcher`" in section
    assert not any(f"`@{s}`" in section for s in ("sessions", "logs", "ghost", ".deleted"))


def test_silent_when_no_profile_is_bot_managed(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _make_bot_profile(home, "researcher", managed=False)
    assert bot_mode_probe.get_bot_mode_protocol_section(home) == ""


def test_emits_for_default_with_explicit_roster(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "researcher", managed=True)
    _write_bot_roster(home, ["researcher"])

    section = bot_mode_probe.get_bot_mode_protocol_section(home)
    assert section.startswith("## Messaging other agents")
    # default's callable alias is @hermes, never @default
    assert "@hermes" in section
    assert "@default" not in section
    assert "@researcher" in section
    assert "message_agent" in section


def test_emits_for_named_profile_with_own_handle(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    profile_dir = _make_bot_profile(home, "coder", managed=True, roster=["default"])

    section = bot_mode_probe.get_bot_mode_protocol_section(profile_dir)
    assert "@coder" in section
    # teammate roster excludes self, includes default (as @hermes)
    roster_block = section.split("Your teammates")[1]
    assert "`@hermes`" in roster_block
    assert "`@coder`" not in roster_block


def test_explicit_roster_preserves_order_and_filters_unsafe_entries(tmp_path):
    from hermes_constants import mark_named_profile_deleted

    home = tmp_path / ".hermes"
    home.mkdir()
    sender = _make_bot_profile(home, "sender", managed=True)
    for name in ("alpha", "beta"):
        _make_bot_profile(home, name, managed=True)
    ghost = _make_bot_profile(home, "ghost", managed=True)
    mark_named_profile_deleted(ghost)
    _write_bot_roster(
        sender,
        ["beta", "sender", "bad profile", "beta", "default", "ghost", "missing", 7, "alpha"],
    )

    assert [name for name, _ in bot_mode_probe.resolve_bot_roster(sender)] == [
        "beta", "default", "alpha",
    ]


def test_absent_roster_preserves_stock_live_profile_discovery(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _make_bot_profile(home, "unwired", managed=True)

    assert [name for name, _ in bot_mode_probe.resolve_bot_roster(home)] == ["unwired"]
    section = bot_mode_probe.get_bot_mode_protocol_section(home)
    assert "`@unwired`" in section


def test_explicit_empty_roster_never_falls_back_to_live_profiles(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "unwired", managed=True)
    _write_bot_roster(home, [])

    assert bot_mode_probe.resolve_bot_roster(home) == []
    section = bot_mode_probe.get_bot_mode_protocol_section(home)
    assert "- (no teammates yet)" in section
    assert "`@unwired`" not in section


def test_roster_lines_carry_roles(tmp_path):
    """Bots must know WHO to message: the roster carries title/description."""
    import textwrap as _tw

    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    d = home / "profiles" / "researcher"
    d.mkdir(parents=True)
    (d / "profile.yaml").write_text(
        _tw.dedent(
            """\
            description: Deep research and literature review
            ui_meta:
              hermes-bots:
                title: Research Buddy
            """
        ),
        encoding="utf-8",
    )
    _write_bot_roster(home, ["researcher"])

    section = bot_mode_probe.get_bot_mode_protocol_section(home)
    assert "`@researcher`" in section
    assert "Research Buddy" in section
    assert "Deep research and literature review" in section


def test_soul_legacy_protocol_no_longer_suppresses_live_section(tmp_path):
    """Plugin-era SOUL append is stripped at load time; the live roster is the only copy."""
    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "coder", managed=True)
    _write_bot_roster(home, ["coder"])
    (home / "SOUL.md").write_text(
        "# Me\n\n## Messaging other agents\nold plugin text\n", encoding="utf-8"
    )
    assert "`@coder`" in bot_mode_probe.get_bot_mode_protocol_section(home)
    assert bot_mode_probe.strip_legacy_protocol((home / "SOUL.md").read_text()) == "# Me\n"


def test_deterministic_across_calls(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "researcher", managed=True)
    _write_bot_roster(home, ["researcher"])
    first = bot_mode_probe.get_bot_mode_protocol_section(home)
    # Even if the filesystem changes, the cached result must be byte-stable
    # for the life of the process (prompt-cache invariant).
    _make_bot_profile(home, "newbot", managed=True)
    second = bot_mode_probe.get_bot_mode_protocol_section(home)
    assert first == second


def test_never_raises_on_garbage(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    profiles = home / "profiles" / "bad"
    profiles.mkdir(parents=True)
    (profiles / "profile.yaml").write_text("ui_meta: [unclosed", encoding="utf-8")
    assert isinstance(bot_mode_probe.get_bot_mode_protocol_section(home), str)

    monkeypatch.setattr(bot_mode_probe, "resolve_bot_roster", lambda root: (_ for _ in ()).throw(OSError("boom")))
    bot_mode_probe._reset_cache_for_tests()
    assert bot_mode_probe.get_bot_mode_protocol_section(home) == ""


# ── capability epoch ─────────────────────────────────────────────────────────


def test_fingerprint_stable_when_nothing_changes(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "researcher", managed=True)
    _write_bot_roster(home, ["researcher"])
    assert bot_mode_probe.capability_fingerprint(home) == bot_mode_probe.capability_fingerprint(home)


def test_fingerprint_changes_on_each_capability_axis(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "researcher", managed=True)
    _write_bot_roster(home, ["researcher"])
    base = bot_mode_probe.capability_fingerprint(home)

    # new skill installed
    skill = home / "skills" / "web" / "scraping"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: scraping\n---\n", encoding="utf-8")
    after_skill = bot_mode_probe.capability_fingerprint(home)
    assert after_skill != base

    # toolset pin changed
    (home / "config.yaml").write_text(
        "tools:\n  enabled_toolsets: [web]\nbot_mode:\n  roster: [researcher]\n",
        encoding="utf-8",
    )
    after_tools = bot_mode_probe.capability_fingerprint(home)
    assert after_tools != after_skill

    # MCP server added
    (home / "config.yaml").write_text(
        "tools:\n  enabled_toolsets: [web]\nmcp_servers:\n  github:\n    preset: github\n"
        "bot_mode:\n  roster: [researcher]\n",
        encoding="utf-8",
    )
    after_mcp = bot_mode_probe.capability_fingerprint(home)
    assert after_mcp != after_tools

    # SOUL edited
    (home / "SOUL.md").write_text("# New identity\n", encoding="utf-8")
    after_soul = bot_mode_probe.capability_fingerprint(home)
    assert after_soul != after_mcp

    # teammate added to the roster
    _make_bot_profile(home, "coder", managed=True)
    _write_bot_roster(home, ["researcher", "coder"])
    assert bot_mode_probe.capability_fingerprint(home) != after_soul


def test_stored_prompt_staleness(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "researcher", managed=True)
    _write_bot_roster(home, ["researcher"])

    stamped = "system stuff\n\n" + bot_mode_probe.epoch_line(home)
    # unchanged surface → not stale (cache preserved)
    assert not bot_mode_probe.stored_prompt_capability_stale(stamped, home)

    # capability change → stale exactly once
    skill = home / "skills" / "new-skill"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: new-skill\n---\n", encoding="utf-8")
    assert bot_mode_probe.stored_prompt_capability_stale(stamped, home)
    restamped = "system stuff\n\n" + bot_mode_probe.epoch_line(home)
    assert not bot_mode_probe.stored_prompt_capability_stale(restamped, home)

    # prompts without a stamp (every non-Bot-Chat session) are never stale
    assert not bot_mode_probe.stored_prompt_capability_stale("ordinary prompt", home)
    assert not bot_mode_probe.stored_prompt_capability_stale("", home)


def test_roster_epoch_change_invalidates_cached_protocol_section(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "researcher", managed=True)
    _make_bot_profile(home, "coder", managed=True)
    _write_bot_roster(home, ["researcher"])

    original = bot_mode_probe.get_bot_mode_protocol_section(home)
    assert "researcher" in original
    assert "coder" not in original
    stamped = original + "\n\n" + bot_mode_probe.epoch_line(home)

    _write_bot_roster(home, ["coder"])
    assert bot_mode_probe.stored_prompt_capability_stale(stamped, home)
    rebuilt = bot_mode_probe.get_bot_mode_protocol_section(home)
    assert "researcher" not in rebuilt
    assert "coder" in rebuilt


def test_legacy_bot_chat_upgrade(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "researcher", managed=True)
    _write_bot_roster(home, ["researcher"])

    legacy = "old prompt with no protocol and no stamp"
    # legacy Bot Chat on a managed install → upgrade once
    assert bot_mode_probe.stored_bot_chat_prompt_needs_upgrade(legacy, home)

    # a rebuilt prompt (stamped) never re-fires
    upgraded = legacy + "\n\n" + bot_mode_probe.get_bot_mode_protocol_section(home) + "\n\n" + bot_mode_probe.epoch_line(home)
    assert not bot_mode_probe.stored_bot_chat_prompt_needs_upgrade(upgraded, home)

    # SOUL-era prompt (frozen roster rode in from SOUL.md, no stamp) → upgrade once
    assert bot_mode_probe.stored_bot_chat_prompt_needs_upgrade(
        "prompt containing\n## Messaging other agents\nfrom SOUL", home
    )

    # unmanaged install → probe silent → never upgrades
    bot_mode_probe._reset_cache_for_tests()
    home2 = tmp_path / ".hermes2"
    home2.mkdir()
    assert not bot_mode_probe.stored_bot_chat_prompt_needs_upgrade(legacy, home2)


# ── peer gateways (cross-machine DMs) ────────────────────────────────────────


def test_peer_paragraph_absent_without_peers(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "researcher", managed=True)

    section = bot_mode_probe.get_bot_mode_protocol_section(home)
    assert "hermes peer dm" not in section
    assert "OTHER machines" not in section


def test_peer_paragraph_lists_registered_peers(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "researcher", managed=True)
    (home / "config.yaml").write_text(
        textwrap.dedent(
            """\
            bot_peers:
              spark:
                url: http://spark.lan:8377
              homelab:
                url: http://homelab.lan:8377
            """
        ),
        encoding="utf-8",
    )
    _write_bot_roster(home, ["researcher"])

    section = bot_mode_probe.get_bot_mode_protocol_section(home)
    assert "message_agent" in section
    assert '"<peer>/<agent-name>"' in section
    assert "`homelab`" in section and "`spark`" in section
    assert "hermes peer list" in section


def test_fingerprint_changes_when_a_peer_is_registered(tmp_path):
    home = tmp_path / ".hermes"
    home.mkdir()
    _mark_managed(home)
    _make_bot_profile(home, "researcher", managed=True)
    _write_bot_roster(home, ["researcher"])

    before = bot_mode_probe.capability_fingerprint(home)
    (home / "config.yaml").write_text(
        "bot_peers:\n  spark:\n    url: http://spark.lan:8377\nbot_mode:\n  roster: [researcher]\n",
        encoding="utf-8",
    )
    after = bot_mode_probe.capability_fingerprint(home)
    assert before != after
