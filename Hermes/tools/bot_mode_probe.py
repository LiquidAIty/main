"""Bot Mode roster probe — canonical Bot Chat system prompt section.

When Bot Mode is active, the canonical "Bot Chat" session — ONLY that session
(agent/system_prompt.py enforces the ``BOT_CHAT_TITLE`` gate) — gets a "Messaging other
agents" section. An explicit profile-scoped roster requires the current profile's
``ui_meta['hermes-bots']`` marker; an absent roster preserves stock install-wide activation and
profile discovery. Silent (``""``) when Bot Mode is inactive or on any error. Older desktop builds appended a frozen copy of
the section to SOUL.md; ``strip_legacy_protocol`` drops it at load time so the live roster
here is the only copy any session sees. Cached per (process, home) so compression rebuilds
produce identical bytes. Toggle: ``agent.bot_mode_protocol``. Also hosts path/roster
helpers shared by ``bot_mode_dm`` and ``bot_relay``.
"""

from __future__ import annotations

import os
import re
import threading
from pathlib import Path

_PROTOCOL_HEADING = "## Messaging other agents"
# The legacy section through the next H2 heading (or EOF), plus the blank lines before it.
_LEGACY_PROTOCOL_RE = re.compile(r"\n*" + re.escape(_PROTOCOL_HEADING) + r"[ \t]*\n.*?(?=\n## |\Z)", re.S)


def strip_legacy_protocol(text: str) -> str:
    """SOUL text without the plugin-era "## Messaging other agents" section (idempotent)."""
    return _LEGACY_PROTOCOL_RE.sub("\n", text).strip() + "\n" if _PROTOCOL_HEADING in text else text

# The only session title that receives the protocol section. Must match the
# desktop plugin's createCanonicalChat title and the `-c "Bot Chat"` resume target.
BOT_CHAT_TITLE = "Bot Chat"

_lock = threading.Lock()
_cached: dict[str, str] = {}


# ── shared path / roster helpers ─────────────────────────────────────────────


def _default_home() -> str:
    """Ambient process HERMES_HOME (env, else the platform default) as a string."""
    from hermes_constants import get_process_hermes_home
    return str(get_process_hermes_home())


def _resolve_home(home: str | os.PathLike | None) -> Path:
    return Path(str(home) if home else _default_home())


def _swallow(fn, default):
    """``fn()`` or ``default`` on any exception — the probe must never crash a prompt build."""
    try:
        return fn()
    except Exception:
        return default


def _hermes_root(home: Path) -> Path:
    """Root ~/.hermes for both the default profile and named profiles."""
    return home.parent.parent if home.parent.name == "profiles" else home


def _profile_name(home: Path) -> str:
    return home.name if home.parent.name == "profiles" else "default"


def _handle(name: str) -> str:
    # The mention middleware aliases the default profile as @hermes.
    return "hermes" if name == "default" else name


def _all_live_profiles(root: Path) -> list[tuple[str, Path]]:
    """All live profiles for install-wide lifecycle work, never Bot target authority."""
    from hermes_constants import named_profile_is_live

    profiles = root / "profiles"
    named = _swallow(
        lambda: [(c.name, c) for c in sorted(profiles.iterdir()) if named_profile_is_live(c)] if profiles.is_dir() else [],
        [])
    return [("default", root), *named]


def resolve_live_profile_home(root: Path, name: str) -> Path | None:
    """Resolve one canonical profile name to a live home without enumerating Bot authority."""
    from hermes_cli.profiles import normalize_profile_name, validate_profile_name
    from hermes_constants import named_profile_is_live

    try:
        canonical = normalize_profile_name(name)
        validate_profile_name(canonical)
    except (TypeError, ValueError):
        return None
    if canonical == "default":
        return root if root.is_dir() else None
    candidate = root / "profiles" / canonical
    return candidate if named_profile_is_live(candidate) else None


def _configured_bot_profile_names(home: Path) -> tuple[bool, list]:
    """``(present, values)`` for this profile's presence-sensitive Bot roster.

    A malformed explicit value is present but empty so it fails closed. Only true absence
    selects stock standalone discovery.
    """
    from hermes_cli.config_effective import load_user_config_effective
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    token = set_hermes_home_override(str(home))
    try:
        config = load_user_config_effective() or {}
    finally:
        reset_hermes_home_override(token)
    bot_mode = config.get("bot_mode") if isinstance(config, dict) else None
    if not isinstance(bot_mode, dict) or "roster" not in bot_mode:
        return False, []
    roster = bot_mode.get("roster")
    return True, roster if isinstance(roster, list) else []


def resolve_bot_roster(home: str | os.PathLike | None = None) -> list[tuple[str, Path]]:
    """Resolve this profile's ordered local Bot roster.

    An absent setting preserves stock standalone discovery. An explicit list, including
    ``[]``, is exact target authority. Invalid, duplicate, self, unknown, or tombstoned
    entries are ignored without broadening either mode.
    """
    from hermes_cli.profiles import normalize_profile_name, validate_profile_name

    resolved = _resolve_home(home)
    root = _hermes_root(resolved)
    me = _profile_name(resolved)
    result: list[tuple[str, Path]] = []
    seen: set[str] = set()
    configured, configured_names = _swallow(
        lambda: _configured_bot_profile_names(resolved), (True, []),
    )
    raw_names = configured_names if configured else [name for name, _ in _all_live_profiles(root)]
    for raw_name in raw_names:
        if not isinstance(raw_name, str):
            continue
        try:
            name = normalize_profile_name(raw_name)
            validate_profile_name(name)
        except (TypeError, ValueError):
            continue
        if name == me or name in seen:
            continue
        profile_home = resolve_live_profile_home(root, name)
        if profile_home is None:
            continue
        seen.add(name)
        result.append((name, profile_home))
    return result


def _read_yaml_dict(path: Path, needle: str | None = None) -> dict | None:
    """YAML mapping at ``path``, or None when missing / not a mapping / unreadable. ``needle``:
    cheap substring precheck that skips the YAML parse on the dominant (unmanaged) path."""
    def _load():
        if not path.is_file():
            return None
        raw = path.read_text(encoding="utf-8", errors="replace")
        if needle is not None and needle not in raw:
            return None
        import yaml

        data = yaml.safe_load(raw)
        return data if isinstance(data, dict) else None

    return _swallow(_load, None)


def _bots_meta(data: dict | None) -> dict | None:
    """The ``ui_meta['hermes-bots']`` block of a parsed profile.yaml, if a dict."""
    ui_meta = data.get("ui_meta") if data else None
    bots = ui_meta.get("hermes-bots") if isinstance(ui_meta, dict) else None
    return bots if isinstance(bots, dict) else None


def _is_bot_managed(profile_dir: Path) -> bool:
    return _bots_meta(_read_yaml_dict(profile_dir / "profile.yaml", "hermes-bots")) is not None


def _any_bot_managed(root: Path) -> bool:
    return any(_is_bot_managed(profile_dir) for _name, profile_dir in _all_live_profiles(root))


def is_bot_mode_managed(home: str | os.PathLike | None = None) -> bool:
    """Bot activation for the current roster mode. Never raises.

    Explicit roster profiles require their own marker. With no roster setting, retain stock
    install-wide activation when any live profile is Bot-managed.
    """
    def _managed() -> bool:
        resolved = _resolve_home(home)
        configured, _names = _configured_bot_profile_names(resolved)
        return _is_bot_managed(resolved) if configured else _any_bot_managed(_hermes_root(resolved))

    return _swallow(_managed, False)


def _role_line(*parts: str) -> str:
    """'title — description' from the non-empty parts (either may be absent)."""
    return " — ".join(p for p in parts if p)


def _bullet(handle: str, *parts: str) -> str:
    """Roster line: '- `handle`' plus ' — part' for each non-empty part."""
    return _role_line(f"- `{handle}`", *parts)


def _profile_role(profile_dir: Path) -> str:
    """Teammate role line: Bot Mode title — profile description; tells a teammate
    WHO to message for a job. Single-line, ≤160 chars, "" when neither. Never raises."""
    def _role() -> str:
        data = _read_yaml_dict(profile_dir / "profile.yaml") or {}
        line = _role_line(str((_bots_meta(data) or {}).get("title") or "").strip(),
                          str(data.get("description") or "").strip())
        return " ".join(line.split())[:160]

    return _swallow(_role, "")


def _peers(root: Path) -> list[str]:
    """Registered peer gateway names (``hermes peer``) from config.yaml, read
    directly (no config-loader import; the section is absent on most installs). Never raises."""
    def _names() -> list[str]:
        peers = (_read_yaml_dict(root / "config.yaml", "bot_peers") or {}).get("bot_peers")
        return sorted(str(n) for n in peers if str(n).strip()) if isinstance(peers, dict) else []

    return _swallow(_names, [])


def _remote_roster(root: Path) -> list[dict]:
    """Desktop relay roster (``tools/bot_relay.py``); [] on any failure."""
    def _read():
        from tools.bot_relay import read_remote_roster

        return read_remote_roster(root)

    return _swallow(_read, [])


def _remote_paragraph(root: Path) -> str:
    """Addendum for agents on OTHER connected machines; only when the relay roster is non-empty."""
    roster = _remote_roster(root)
    if not roster:
        return ""
    from tools.bot_relay import remote_target_forms

    lines = [
        _bullet(f"@{form}", f"on {row['connection_label'] or row['connection_id']}", row["title"], row["description"])
        for row, form in zip(roster, remote_target_forms(roster))
    ]
    return (
        "\n\nTeammates on OTHER connected machines (reachable through the "
        "Desktop relay — message them with message_agent exactly like local "
        "teammates; replies arrive as completion notifications the same "
        "way):\n" + "\n".join(lines)
    )


def _peer_paragraph(root: Path) -> str:
    """Addendum for cross-machine DMs — only when peers exist."""
    peers = _peers(root)
    if not peers:
        return ""
    listed = ", ".join(f"`{p}`" for p in peers)
    return (
        "\n\nTeammates on OTHER machines: this install also has peer gateways "
        f"registered ({listed}). Message an agent on a peer the same way — "
        'message_agent with target "<peer>/<agent-name>" (or "<peer>" alone '
        "for the peer's main agent). Run `hermes peer list` for the live "
        "peer list."
    )


def _build_section(home: Path) -> str:
    root = _hermes_root(home)
    me = _profile_name(home)
    if not is_bot_mode_managed(home):
        return ""

    roster_lines = [_bullet(f"@{_handle(name)}", _profile_role(d)) for name, d in resolve_bot_roster(home)]
    roster_block = "\n".join(roster_lines) or "- (no teammates yet)"

    return (
        f"{_PROTOCOL_HEADING}\n"
        "This install runs Bot Mode: each Hermes profile is an agent teammate with "
        'one canonical "Bot Chat" conversation, and you have the `message_agent` '
        "tool to DM any of them. It is FIRE-AND-FORGET: it delivers your message "
        "with your attribution prefixed automatically and returns an acknowledgement "
        "immediately — it never returns the reply. Send it, finish your turn, and "
        "the reply arrives later as a background-process completion notification "
        "that wakes you; relay it to the user then, attributed to that agent. "
        "COMPOSE every message yourself — say what YOU need from that agent; never "
        "forward the user's words verbatim, and never reveal private 1:1 chat "
        "content. When the user says \"ask <name>\" or \"tell <name> ...\", that is "
        "a handoff: pick the right teammate from the roster below, message them "
        "with message_agent, and report back naming which agent replied. Message "
        "ONE clearly relevant teammate; don't fan out to several unless the user "
        "explicitly asked.\n"
        f'When YOU receive a "Message from 🤖 <name> (@<handle>):" message, a '
        "teammate agent is talking to you (not the user): address them, reply "
        "concisely via message_agent to their handle, and if it is a pure FYI "
        "with nothing to add, staying silent is fine — never ping-pong "
        "acknowledgements.\n"
        f"You are `@{_handle(me)}`. Your teammates (live roster; roles from their "
        "profiles):\n"
        f"{roster_block}"
        + _remote_paragraph(root)
        + _peer_paragraph(root)
    )


def get_bot_mode_protocol_section(home: str | os.PathLike | None = None, *, force_refresh: bool = False) -> str:
    """Cached probe entry point — one filesystem pass per (process, home). ``home`` should be
    the AGENT'S OWN resolved home (session-db derived), not ambient HERMES_HOME — build threads
    can lose the ContextVar override and the env var would then name the wrong profile."""
    resolved = str(_resolve_home(home))
    with _lock:
        if force_refresh or resolved not in _cached:
            _cached[resolved] = _swallow(lambda: _build_section(Path(resolved)), "")
        return _cached[resolved]


# ── capability epoch ─────────────────────────────────────────────────────────
# Bot Chat sessions are effectively eternal, so "build the prompt once" would strand
# capability changes (skills, toolsets, MCP, SOUL, roster, peers) forever. The fingerprint
# hashes exactly that surface; the built prompt embeds it and agent/conversation_loop.py
# rebuilds only when the stored epoch differs from disk — once per change, never per-turn drift.

_EPOCH_PREFIX = "Capability epoch: "
_EPOCH_RE_TEXT = r"Capability epoch: ([0-9a-f]{12})"


def capability_fingerprint(home: str | os.PathLike | None = None) -> str:
    """12-hex digest of the capability surface for ``home``'s profile: disabled skills +
    enabled toolsets + MCP config, SOUL.md bytes, installed skill names, the Bot-Mode roster
    (+ roles), peers and the relay roster. Deliberately NOT cached — the point is detecting
    on-disk drift against a stored prompt's epoch. Never raises ("unavailable" on failure)."""
    import hashlib
    import json

    resolved = _resolve_home(home)
    root = _hermes_root(resolved)
    surface: dict = {}
    try:
        # Canonical loader (managed overlay + env expansion + normalization),
        # scoped to the bot's home via the override the loaders already honor.
        from hermes_cli.config import load_config_readonly
        from hermes_constants import reset_hermes_home_override, set_hermes_home_override

        token = set_hermes_home_override(str(resolved))
        try:
            cfg = load_config_readonly() or {}
        finally:
            reset_hermes_home_override(token)
        skills_cfg = cfg.get("skills") if isinstance(cfg.get("skills"), dict) else {}
        tools_cfg = cfg.get("tools") if isinstance(cfg.get("tools"), dict) else {}
        surface["disabled_skills"] = sorted(str(s).lower() for s in (skills_cfg.get("disabled") or []))
        surface["enabled_toolsets"] = sorted(str(t) for t in (tools_cfg.get("enabled_toolsets") or []))
        mcp = cfg.get("mcp_servers")
        surface["mcp"] = json.dumps(mcp, sort_keys=True, default=str) if isinstance(mcp, dict) else ""
    except Exception:
        pass

    def _soul() -> str:
        soul = resolved / "SOUL.md"
        return hashlib.sha256(soul.read_bytes()).hexdigest() if soul.is_file() else ""

    def _skills() -> list[str]:
        skills_root = resolved / "skills"
        if not skills_root.is_dir():
            return []
        return sorted(str(p.parent.relative_to(skills_root)) for p in skills_root.glob("**/SKILL.md"))

    surface["soul"] = _swallow(_soul, "")
    surface["skills"] = _swallow(_skills, [])
    try:
        roster = resolve_bot_roster(resolved)
        surface["roster"] = [n for n, _d in roster]
        # Roles are part of the messaging surface: renaming a bot or editing a
        # description must refresh the roster block teammates pick recipients from.
        surface["roster_roles"] = [f"{n}:{_profile_role(d)}" for n, d in roster]
    except Exception:
        surface["roster"] = []
    # Protocol-text version salt: bumping it refreshes every eternal Bot Chat
    # prompt ONCE so existing bots adopt a new protocol section.
    surface["protocol_version"] = 2
    # Peer gateways and the Desktop relay roster are part of the messaging
    # surface too: registering a peer or (dis)connecting a machine must show up.
    surface["peers"] = _peers(root)
    surface["remote_roster"] = sorted(
        f"{r['connection_id']}:{r['profile']}:{r['title']}" for r in _remote_roster(root)
    )
    return _swallow(
        lambda: hashlib.sha256(json.dumps(surface, sort_keys=True).encode("utf-8")).hexdigest()[:12],
        "unavailable",
    )


def epoch_line(home: str | os.PathLike | None = None) -> str:
    """The epoch stamp appended to a Bot Chat prompt."""
    return f"{_EPOCH_PREFIX}{capability_fingerprint(home)}"


def stored_prompt_capability_stale(stored_prompt: str, home: str | os.PathLike | None = None) -> bool:
    """True when ``stored_prompt`` is a Bot Chat prompt whose embedded epoch no
    longer matches disk. Unstamped prompts are never stale. Fails closed to
    "not stale" — a broken probe must not become a rebuild-every-turn cache burner."""
    import re

    m = re.search(_EPOCH_RE_TEXT, stored_prompt or "")
    if not m:
        return False
    current = _swallow(lambda: capability_fingerprint(home), "unavailable")
    stale = current != "unavailable" and m.group(1) != current
    if stale:
        # The caller rebuilds the prompt exactly once after this verdict. Drop
        # the matching protocol-section cache first so the rebuilt prompt and
        # message_agent validation resolve the same current roster bytes.
        resolved = str(_resolve_home(home))
        with _lock:
            _cached.pop(resolved, None)
    return stale


def stored_bot_chat_prompt_needs_upgrade(stored_prompt: str, home: str | os.PathLike | None = None) -> bool:
    """True when a Bot Chat session's stored prompt PREDATES the epoch mechanism (no stamp —
    including SOUL-era prompts whose frozen roster rode in from SOUL.md). The caller must only
    ask for sessions titled "Bot Chat"; we rebuild only when the probe would actually emit a
    section, and every rebuilt prompt is stamped so this fires once. Fails closed."""
    if _EPOCH_PREFIX in (stored_prompt or ""):
        return False
    return _swallow(lambda: bool(get_bot_mode_protocol_section(home)), False)


def _reset_cache_for_tests() -> None:
    with _lock:
        _cached.clear()
