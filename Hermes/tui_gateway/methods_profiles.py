"""Profile JSON-RPC handlers — the ws twin of the dashboard's /api/profiles.

Motivation: desktop plugins reach the backend exclusively through the
generic ws JSON-RPC door (`host.request`).  Profile enumeration/creation
previously lived only on the dashboard REST router, which plugins cannot
reach, so anything "one chat per agent profile"-shaped (bot rosters,
profile pickers, team panes) was impossible to build as a plugin.  These
handlers delegate to the same `hermes_cli.profiles` primitives the REST
endpoints use.

Handlers are rebound onto server.py's globals at install time — see
method_ctx.py.  They may reference server.py module globals (`_ok`,
`_err`, `is_truthy_value`, ...) that are not imported here.
"""

from .method_ctx import HandlerRegistry

_registry = HandlerRegistry()
method = _registry.method


@method("profiles.list")
def _(rid, params: dict) -> dict:
    """List Hermes profiles (name, path, model, description, skill count).

    ``include_sessions`` (default true) additionally reports each profile's
    most recent conversation as ``last_session`` so a roster UI can paint
    per-agent previews without N follow-up calls.

    NOTE: helpers must be nested — install() rebinds this handler's
    __globals__ onto server.py, so module-level names here are invisible.
    """

    def _latest_message_preview(db, session_id):
        """Short excerpt of the NEWEST user/assistant message in a session.

        Rosters show this under each agent's name — messaging-app semantics
        (latest exchange), unlike the shared first-message preview that
        session lists use for recognition. Tool rows, inactive rows, and
        empty content are skipped; agent-delivery prefixes are kept
        (callers style them). Same query shape as
        SessionDB.latest_message_row_id.
        """
        try:
            with db._lock:
                row = db._conn.execute(
                    "SELECT content FROM messages"
                    " WHERE session_id = ? AND role IN ('user', 'assistant')"
                    " AND active = 1"
                    " AND content IS NOT NULL AND TRIM(content) != ''"
                    " ORDER BY id DESC LIMIT 1",
                    (session_id,),
                ).fetchone()
        except Exception:
            return ""
        if not row:
            return ""
        text = " ".join(str(row[0] or "").split()).strip()
        if len(text) > 80:
            return text[:80] + "..."
        return text

    def _canonical_session_row(profile_path):
        """Summary of the profile's canonical "Bot Chat" registry row, or None.

        The canonical chat's identity is the NAME: the session titled exactly
        "Bot Chat" on this profile (core UNIQUE(title) makes it a registry of
        at most one row). Complements ``last_session``: that field answers
        "what is the newest conversation", this answers "where is the
        forever-chat" — so a roster row's preview and its click target
        describe the same session (hermes-agent#88200) with no client-side
        pointer involved.

        Exact-lookup semantics, deliberately different from the listing:
        hidden rows still resolve (canonical chats are always hidden),
        compression lineages resolve to the live tip with the same resolver
        ``session.resume`` uses, and denied internal sources (tool/kanban)
        count as absent. The reported ``id`` stays the durable registry row
        while ``resolved_id`` names the live tip. Best-effort: any failure
        degrades to None rather than failing the whole profiles.list call.
        """
        try:
            from pathlib import Path

            db_path = Path(profile_path) / "state.db"
            if not db_path.exists():
                return None
            from hermes_state import SessionDB

            deny = frozenset({"kanban", "tool"})
            db = SessionDB(db_path=db_path)
            try:
                row = db.get_session_by_title("Bot Chat")
                if not row:
                    return None
                session_id = str(row.get("id") or "").strip()
                if not session_id:
                    return None
                if (row.get("source") or "").strip().lower() in deny:
                    return None
                if row.get("archived"):
                    # An archived canonical row usually means the user
                    # deliberately retired it — report absent. But the
                    # ws-orphan reaper / older agent cleanup can archive it
                    # by accident (end_reason ws_orphan_reap / agent_close):
                    # the canonical chat is identity-scoped (the bot's
                    # forever conversation), so an accidental archive is
                    # user-visible amnesia. Resurrect those — un-archive and
                    # keep resolving — reusing the same recoverable-reason
                    # set as gateway stale-route recovery (#92687).
                    if not db.unarchive_recoverable_session(session_id):
                        return None
                try:
                    tip = db.resolve_resume_session_id(session_id) or session_id
                except Exception:
                    tip = session_id
                tip_row = db.get_session(tip) or row
                preview = ""
                try:
                    preview = _latest_message_preview(db, tip)
                except Exception:
                    pass
                return {
                    "id": session_id,
                    "resolved_id": tip,
                    "root_title": row.get("title") or "",
                    "title": tip_row.get("title") or "",
                    "preview": preview,
                    "started_at": tip_row.get("started_at") or row.get("started_at") or 0,
                    "last_active": (
                        tip_row.get("last_activity_at")
                        or tip_row.get("started_at")
                        or row.get("started_at")
                        or 0
                    ),
                    "message_count": tip_row.get("message_count") or 0,
                }
            finally:
                try:
                    db.close()
                except Exception:
                    pass
        except Exception:
            return None

    def _latest_profile_session_rows(profile_path):
        """(newest human-facing session, newest worker session) for a profile.

        First element mirrors session.list's deny-list (drops ``tool``
        sub-agent rows and ``kanban`` dispatcher workers). Second element is
        the newest DENIED row — the freshest kanban/tool worker — so roster
        UIs can show that a profile is actively working even though worker
        sessions never surface in conversation lists (hermes-agent#90268).
        Workers heartbeat ``last_activity_at`` every ≤60s while running
        (#72016), so a live worker's ``last_active`` stays fresh and the
        client can apply its own liveness window. Best-effort: any failure
        (missing state.db, locked db, older schema) degrades to (None, None)
        rather than failing the whole profiles.list call.
        """
        try:
            from pathlib import Path

            db_path = Path(profile_path) / "state.db"
            if not db_path.exists():
                return None, None
            from hermes_state import SessionDB

            deny = frozenset({"kanban", "tool"})
            db = SessionDB(db_path=db_path)
            try:
                human = None
                worker = None
                for s in db.list_sessions_rich(
                    source=None, limit=20, order_by_last_active=True, compact_rows=True
                ):
                    src = (s.get("source") or "").strip().lower()
                    if src in deny:
                        if worker is None:
                            worker = {
                                "id": s["id"],
                                "source": src,
                                "title": s.get("title") or "",
                                "last_active": s.get("last_active") or s.get("started_at") or 0,
                            }
                        continue
                    if human is not None:
                        continue
                    row = {
                        "id": s["id"],
                        "title": s.get("title") or "",
                        "preview": s.get("preview") or "",
                        "started_at": s.get("started_at") or 0,
                        "last_active": s.get("last_active") or s.get("started_at") or 0,
                        "message_count": s.get("message_count") or 0,
                    }
                    # Roster surfaces want "where the conversation IS", not
                    # where it began: override the shared first-message
                    # preview with the newest user/assistant text. Best-
                    # effort — any failure keeps the first-message preview.
                    try:
                        latest = _latest_message_preview(db, s["id"])
                        if latest:
                            row["preview"] = latest
                    except Exception:
                        pass
                    human = row
                    if worker is not None:
                        break
                return human, worker
            finally:
                try:
                    db.close()
                except Exception:
                    pass
        except Exception:
            return None, None

    try:
        from hermes_cli.profiles import list_profiles

        include_sessions = is_truthy_value(params.get("include_sessions", True))
        out = []
        for p in list_profiles():
            row = {
                "name": p.name,
                "path": str(p.path),
                "is_default": bool(p.is_default),
                "model": p.model,
                "provider": p.provider,
                "description": getattr(p, "description", "") or "",
                "display_name": getattr(p, "display_name", "") or "",
                "skill_count": getattr(p, "skill_count", 0) or 0,
            }
            if include_sessions:
                last_row, worker_row = _latest_profile_session_rows(p.path)
                row["last_session"] = last_row
                # Freshest kanban/tool worker (or None) — lets rosters count
                # a profile as active while its worker runs (#90268). Older
                # clients ignore the extra field.
                row["worker_session"] = worker_row
                # The profile's canonical "Bot Chat" registry row (or None) —
                # identity is the NAME, resolved server-side on every listing
                # so no client ever needs to carry a session pointer.
                row["canonical_session"] = _canonical_session_row(p.path)

            # Client-agnostic UI metadata (avatars, accent colors, pinned
            # order, …) — stored server-side in profile.yaml so every
            # machine connecting to this gateway paints the same roster.
            try:
                import yaml as _yaml
                from pathlib import Path as _Path

                meta_path = _Path(str(p.path)) / "profile.yaml"
                # Presence of this field feature-detects gateway-owned CAS,
                # including a brand-new profile whose revision map is empty.
                row["ui_meta_revisions"] = {}
                if meta_path.is_file():
                    with open(meta_path, "r", encoding="utf-8") as f:
                        raw_meta = _yaml.safe_load(f) or {}
                    ui_meta = raw_meta.get("ui_meta")
                    if isinstance(ui_meta, dict) and ui_meta:
                        row["ui_meta"] = ui_meta
                    revisions = raw_meta.get("_ui_meta_revisions")
                    if isinstance(revisions, dict) and revisions:
                        row["ui_meta_revisions"] = {
                            str(key): max(0, int(value))
                            for key, value in revisions.items()
                            if isinstance(value, int) and not isinstance(value, bool)
                        }
            except Exception:
                pass

            # Cheap existence flag so roster UIs know to profiles.get_asset
            # without a probe call per profile per paint.
            try:
                from pathlib import Path as _Path

                assets = _Path(str(p.path)) / "assets"
                row["has_avatar"] = any(
                    (assets / f"avatar.{ext}").is_file() for ext in ("png", "jpg", "webp")
                )
            except Exception:
                row["has_avatar"] = False
            out.append(row)
        # Capability flag: this backend's prompt builder injects the Bot Mode
        # teammate-messaging protocol (tools/bot_mode_probe.py) into every
        # session of Bot-Mode-managed installs. Clients that would otherwise
        # append the protocol to SOUL.md (the desktop's hermes-bots plugin)
        # must skip their SOUL writes when this is present.
        return _ok(rid, {"profiles": out, "bot_mode_protocol": True})
    except Exception as e:
        return _err(rid, 5061, str(e))


@method("profiles.create")
def _(rid, params: dict) -> dict:
    """Create a profile — the ws twin of POST /api/profiles.

    Params: ``name`` (required, lowercase slug), ``description``,
    ``clone_from`` (source profile; omitted = fresh profile with bundled
    skills), ``clone_all``, ``no_skills``, ``soul`` (SOUL.md content),
    ``model`` + ``provider`` (optional model pin, best-effort), and
    ``mirror_credentials`` (default true) — copy the launch profile's
    ``.env`` and ``auth.json`` into the new profile, and inherit its
    model.provider/model.default when no explicit pin is given.

    Credential mirroring exists because ``create_profile()`` deliberately
    seeds a comment-only ``.env`` and never copies ``auth.json`` (OAuth
    tokens / credential pools), so a profile created headlessly from a
    plugin was born with NO inference provider — the first message failed
    with "No inference provider configured" and there is no interactive
    ``hermes setup`` in that flow to recover. A profile spawned as an
    always-available teammate must be able to think out of the box; callers
    that want an isolated/credential-free profile pass
    ``mirror_credentials: false``.
    """

    def _has_real_env_content(env_path) -> bool:
        """True when .env has any non-comment, non-blank line."""
        try:
            for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
                stripped = line.strip()
                if stripped and not stripped.startswith("#"):
                    return True
        except Exception:
            pass
        return False

    name = str(params.get("name") or "").strip()
    if not name:
        return _err(rid, 4061, "name required")
    try:
        from hermes_cli import profiles as profiles_mod

        clone_from = str(params.get("clone_from") or "").strip() or None
        clone_all = is_truthy_value(params.get("clone_all", False))
        path = profiles_mod.create_profile(
            name=name,
            clone_from=clone_from,
            clone_all=clone_all,
            clone_config=bool(clone_from) and not clone_all,
            no_skills=is_truthy_value(params.get("no_skills", False)),
            description=str(params.get("description") or "").strip() or None,
        )
    except (ValueError, FileExistsError, FileNotFoundError) as e:
        return _err(rid, 4062, str(e))
    except Exception as e:
        return _err(rid, 5062, str(e))

    # Mirror the CLI/REST create flow: fresh profiles get the bundled
    # skills; safe alias wrapper. Both best-effort.
    try:
        if not clone_from:
            profiles_mod.seed_profile_skills(path, quiet=True)
    except Exception:
        pass
    try:
        if not profiles_mod.check_alias_collision(name):
            profiles_mod.create_wrapper_script(name)
    except Exception:
        pass

    soul = params.get("soul")
    soul_written = False
    if isinstance(soul, str) and soul.strip():
        try:
            (path / "SOUL.md").write_text(soul, encoding="utf-8")
            soul_written = True
        except Exception:
            pass

    # Credential + provider mirroring (default ON): a headless-created
    # profile must be able to run a first turn. Copy the launch profile's
    # .env (only over the seeded comment-only stub — never clobber real
    # secrets a clone brought along) and auth.json (only when absent), then
    # inherit model.provider/model.default unless the caller pinned a model.
    #
    # ``share_auth`` (default false): SKIP the auth.json copy so the new
    # profile reads OAuth/token state through the global-root fallback
    # instead (hermes_cli.auth: profile reads fall back to the global
    # store, and token refreshes write THROUGH to it). A copy forks token
    # state — the first refresh in either store invalidates the other
    # for single-use refresh tokens. Sharing keeps one live token pool
    # for the main profile and every bot. Static .env keys still copy
    # (no refresh semantics, so copying is safe).
    mirrored = {"env": False, "auth": False, "model_inherited": False, "voice": False}
    share_auth = is_truthy_value(params.get("share_auth", False))
    if share_auth:
        mirrored["auth"] = "shared"
    if is_truthy_value(params.get("mirror_credentials", True)):
        import shutil

        from hermes_constants import get_hermes_home

        launch_home = get_hermes_home()
        try:
            src_env = launch_home / ".env"
            dst_env = path / ".env"
            if src_env.is_file() and _has_real_env_content(src_env) and not _has_real_env_content(dst_env):
                shutil.copy2(src_env, dst_env)
                try:
                    os.chmod(str(dst_env), 0o600)
                except OSError:
                    pass
                mirrored["env"] = True
        except Exception:
            pass
        try:
            src_auth = launch_home / "auth.json"
            dst_auth = path / "auth.json"
            if not share_auth and src_auth.is_file() and not dst_auth.exists():
                shutil.copy2(src_auth, dst_auth)
                try:
                    os.chmod(str(dst_auth), 0o600)
                except OSError:
                    pass
                mirrored["auth"] = True
        except Exception:
            pass

    model = str(params.get("model") or "").strip()
    provider = str(params.get("provider") or "").strip()
    model_set = False

    def _mirror_voice_sections() -> bool:
        """Copy voice config (stt/tts/voice) from the launch profile.

        Desktop dictation and TTS are profile-scoped: /api/audio/transcribe
        resolves the ``stt`` section inside the TARGET profile's home. A
        freshly created profile has only a ``model`` section, so voice fell
        back to defaults (local whisper, often not installed) and dictation
        "didn't work in bot mode" while working on the primary profile.

        Reads/writes go through the canonical loaders scoped to the target
        profile via the context-local HERMES_HOME override — the same
        mechanism as ``_write_profile_model`` (config-read-guard: no raw
        yaml on config.yaml).
        """
        try:
            from hermes_cli.config import (
                load_config_readonly,
                read_user_config_raw,
                save_config,
            )
            from hermes_constants import (
                reset_hermes_home_override,
                set_hermes_home_override,
            )

            src_cfg = load_config_readonly() or {}
            sections = {
                k: src_cfg[k] for k in ("stt", "tts", "voice") if src_cfg.get(k)
            }
            if not sections:
                return False

            token = set_hermes_home_override(str(path))
            try:
                # Write-back round-trip on the raw file: load_config() would
                # merge DEFAULT_CONFIG, making every section look present and
                # the mirror a no-op (and save_config would then persist the
                # entire default tree into the fresh profile).
                dst_cfg = read_user_config_raw() or {}
                changed = False
                for key, value in sections.items():
                    if key not in dst_cfg:
                        dst_cfg[key] = value
                        changed = True
                if changed:
                    save_config(dst_cfg)
            finally:
                reset_hermes_home_override(token)
            return changed
        except Exception:
            return False

    if is_truthy_value(params.get("mirror_credentials", True)):
        mirrored["voice"] = _mirror_voice_sections()

    if model and provider:
        try:
            from hermes_cli.web_routers.profiles import _write_profile_model

            _write_profile_model(path, provider, model)
            model_set = True
        except Exception:
            pass
    elif is_truthy_value(params.get("mirror_credentials", True)):
        # No explicit pin: inherit the launch profile's provider+model so the
        # first turn resolves. Gate on the MODEL SECTION being absent, not on
        # config.yaml existing — earlier mirroring steps (voice sections,
        # #85755) legitimately create the file first, and a file-existence
        # gate silently skipped inheritance for every non-clone bot
        # ("No inference provider configured" on first message, tester
        # report). Clones bring their own model section and stay untouched.
        try:
            from hermes_cli.config import load_config_readonly, read_user_config_raw
            from hermes_cli.web_routers.profiles import _write_profile_model
            from hermes_constants import (
                reset_hermes_home_override,
                set_hermes_home_override,
            )

            token = set_hermes_home_override(str(path))
            try:
                dst_model = (read_user_config_raw() or {}).get("model") or {}
            finally:
                reset_hermes_home_override(token)

            if not (dst_model.get("provider") and dst_model.get("default")):
                cfg = load_config_readonly() or {}
                model_cfg = cfg.get("model") or {}
                inherited_provider = str(model_cfg.get("provider") or "")
                inherited_model = str(model_cfg.get("default") or "")
                if inherited_provider and inherited_model:
                    _write_profile_model(path, inherited_provider, inherited_model)
                    mirrored["model_inherited"] = True
        except Exception:
            pass

    return _ok(
        rid,
        {
            "ok": True,
            "name": name,
            "path": str(path),
            "soul_written": soul_written,
            "model_set": model_set,
            "mirrored": mirrored,
        },
    )


@method("profiles.describe")
def _(rid, params: dict) -> dict:
    """Full configuration snapshot of one profile, for an editor UI.

    Params: ``name`` (required), plus optional ``probe_honcho`` for the
    Main Inspector's bounded read-only reachability check. Result:
    ``{name, description, soul, model: {provider, default}, skills:
    [{name, enabled}], toolsets: [{name, description, tool_count, enabled}]}``

    Skill enablement mirrors the disabled-list model (installed = enabled
    unless in ``skills.disabled``). Toolset enablement reports the profile's
    ``tools.enabled_toolsets`` pin, or every toolset enabled when unpinned.
    All reads are scoped to the profile via the HERMES_HOME override.
    """
    name = str(params.get("name") or "").strip()
    if not name:
        return _err(rid, 4063, "name required")
    try:
        from pathlib import Path

        from hermes_cli.profiles import get_profile_dir
        from hermes_constants import reset_hermes_home_override, set_hermes_home_override

        profile_dir = Path(get_profile_dir(name))
        if not profile_dir.is_dir():
            return _err(rid, 4064, f"profile '{name}' not found")

        token = set_hermes_home_override(str(profile_dir))
        try:
            from hermes_cli.config import load_config
            from hermes_cli.skills_config import get_disabled_skills

            cfg = load_config() or {}
            disabled = {s.lower() for s in get_disabled_skills(cfg)}

            installed = []
            skills_root = profile_dir / "skills"
            if skills_root.is_dir():
                for md in sorted(skills_root.rglob("SKILL.md")):
                    skill_name = md.parent.name
                    installed.append(
                        {"name": skill_name, "enabled": skill_name.lower() not in disabled}
                    )

            # Toolsets: the same filtered universe the `hermes tools`
            # checklist offers — configurable toolsets (built-in + plugin),
            # minus platform-restricted ones that don't apply here — with
            # enablement resolved the way the runtime actually resolves it.
            # The raw registry (get_all_toolsets) leaks internal platform
            # composites (hermes-discord, feishu_drive, ...) and reports
            # everything "enabled" whenever the profile has no pin, which a
            # capabilities UI then faithfully mis-renders (tester report).
            from hermes_cli.tools_config import (
                _get_effective_configurable_toolsets,
                _get_platform_tools,
                _toolset_allowed_for_platform,
            )
            from toolsets import resolve_toolset

            tools_cfg = cfg.get("tools") if isinstance(cfg.get("tools"), dict) else {}
            pinned = tools_cfg.get("enabled_toolsets")
            pinned_set = (
                {str(t).strip() for t in pinned if str(t).strip()}
                if isinstance(pinned, list)
                else None
            )
            try:
                platform_enabled = set(
                    _get_platform_tools(cfg, "cli", include_default_mcp_servers=False)
                )
            except Exception:
                platform_enabled = set()
            try:
                from hermes_cli.tools_config import _DEFAULT_OFF_TOOLSETS
            except Exception:
                _DEFAULT_OFF_TOOLSETS = set()
            toolsets_out = []
            for ts_name, ts_label, ts_desc in _get_effective_configurable_toolsets():
                if not _toolset_allowed_for_platform(ts_name, "cli"):
                    continue
                enabled = (
                    ts_name in pinned_set
                    if pinned_set is not None
                    else ts_name in platform_enabled
                )
                # Default-off integrations (a2a, yuanbao, spotify, ...) are
                # opt-ins; when the profile hasn't opted in they're noise in
                # a per-profile editor — `hermes tools` / Settings is where
                # you turn them on globally first. Enabled ones still show.
                # yuanbao rides the same rule: a region-specific integration
                # that isn't in _DEFAULT_OFF_TOOLSETS but is equally opt-in.
                if (ts_name in _DEFAULT_OFF_TOOLSETS or ts_name == "yuanbao") and not enabled:
                    continue
                try:
                    tool_count = len(set(resolve_toolset(ts_name)))
                except Exception:
                    tool_count = 0
                toolsets_out.append(
                    {
                        "name": ts_name,
                        "label": ts_label,
                        "description": ts_desc or "",
                        "tool_count": tool_count,
                        "enabled": enabled,
                    }
                )

            soul_path = profile_dir / "SOUL.md"
            soul = ""
            try:
                if soul_path.is_file():
                    soul = soul_path.read_text(encoding="utf-8", errors="replace")
            except Exception:
                pass

            # MCP servers configured for this profile (config.yaml
            # mcp_servers). Report name + enabled + a transport hint so a
            # capabilities UI can list and toggle them without parsing the
            # raw config shape.
            mcp_out = []
            try:
                mcp_cfg = cfg.get("mcp_servers")
                if isinstance(mcp_cfg, dict):
                    for srv_name in sorted(mcp_cfg.keys()):
                        entry = mcp_cfg.get(srv_name)
                        if not isinstance(entry, dict):
                            continue
                        transport = "stdio"
                        if entry.get("url"):
                            transport = str(entry.get("transport") or "http")
                        mcp_out.append(
                            {
                                "name": str(srv_name),
                                "enabled": not is_truthy_value(entry.get("disabled", False)),
                                "transport": transport,
                            }
                        )
            except Exception:
                pass

            model_cfg = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}
            auxiliary_cfg = (
                cfg.get("auxiliary") if isinstance(cfg.get("auxiliary"), dict) else {}
            )
            review_cfg = (
                auxiliary_cfg.get("background_review")
                if isinstance(auxiliary_cfg.get("background_review"), dict)
                else {}
            )
            delegation_cfg = (
                cfg.get("delegation") if isinstance(cfg.get("delegation"), dict) else {}
            )

            # LIQUIDAITY VENDOR PATCH: secret-free native memory discovery and
            # readiness for the bound Card Inspector. Provider IDs come from
            # Hermes' own discovery surface; this is status/readback, not a
            # copied catalog or a network probe.
            memory_cfg = cfg.get("memory") if isinstance(cfg.get("memory"), dict) else {}
            selected_memory = str(memory_cfg.get("provider") or "").strip() or "builtin"
            installed_memory = []
            try:
                from plugins.memory import list_memory_provider_names

                installed_memory = list_memory_provider_names()
            except Exception:
                installed_memory = []
            memory_status = {
                "selected": selected_memory,
                "installed_providers": installed_memory,
                "installed": selected_memory == "builtin" or selected_memory in installed_memory,
                "available": selected_memory == "builtin",
                "availability_reason": None,
                "target": "profile_builtin" if selected_memory == "builtin" else "external",
                "credential_status": "not_required" if selected_memory == "builtin" else "unknown",
                "credential_source": "not_required" if selected_memory == "builtin" else None,
                "setup_action": None,
                "history_database_path": str(profile_dir / "state.db"),
                "curated_memory_enabled": is_truthy_value(
                    memory_cfg.get("memory_enabled"), default=True
                ),
                "user_profile_enabled": is_truthy_value(
                    memory_cfg.get("user_profile_enabled"), default=True
                ),
                "database": None,
            }
            if selected_memory != "builtin":
                memory_status["setup_action"] = (
                    f"hermes --profile {name} memory setup {selected_memory}"
                )
                if selected_memory not in installed_memory:
                    memory_status["availability_reason"] = "provider_not_installed"
                else:
                    try:
                        from plugins.memory import load_memory_provider

                        provider = load_memory_provider(
                            selected_memory, register_skills=False
                        )
                        memory_status["available"] = bool(
                            provider and provider.is_available()
                        )
                        if not memory_status["available"]:
                            memory_status["availability_reason"] = (
                                "provider_configuration_required"
                            )
                    except Exception:
                        memory_status["availability_reason"] = (
                            "provider_availability_check_failed"
                        )

            if selected_memory == "holographic":
                try:
                    plugin_cfg = (
                        (cfg.get("plugins") or {}).get("hermes-memory-store")
                        if isinstance(cfg.get("plugins"), dict)
                        else {}
                    )
                    if not isinstance(plugin_cfg, dict):
                        plugin_cfg = {}
                    raw_db_path = str(
                        plugin_cfg.get("db_path") or profile_dir / "memory_store.db"
                    )
                    raw_db_path = raw_db_path.replace(
                        "$HERMES_HOME", str(profile_dir)
                    ).replace("${HERMES_HOME}", str(profile_dir))
                    db_path = Path(raw_db_path).expanduser()
                    fact_count = 0
                    if db_path.is_file():
                        import sqlite3

                        connection = sqlite3.connect(
                            f"file:{db_path.as_posix()}?mode=ro", uri=True
                        )
                        try:
                            fact_count = int(
                                connection.execute(
                                    "SELECT COUNT(*) FROM facts"
                                ).fetchone()[0]
                            )
                        finally:
                            connection.close()
                    memory_status.update({
                        "target": "profile_sqlite",
                        "credential_status": "not_required",
                        "credential_source": "not_required",
                        "setup_action": None,
                        "database": {
                            "kind": "sqlite",
                            "path": str(db_path),
                            "exists": db_path.is_file(),
                            "fact_count": fact_count,
                        },
                    })
                except Exception:
                    memory_status["availability_reason"] = (
                        memory_status["availability_reason"]
                        or "holographic_status_read_failed"
                    )
            # Resolve Honcho configuration at most once, and only when the
            # profile selects it or Main explicitly requests Inspector status.
            honcho = None
            honcho_configuration = None
            if selected_memory == "honcho" or params.get("probe_honcho") is True:
                try:
                    import json as _json
                    from plugins.memory.honcho.client import (
                        HonchoClientConfig,
                        _host_block,
                        profile_host_key,
                    )

                    honcho = HonchoClientConfig.from_global_config(
                        host=profile_host_key(name)
                    )
                    raw_honcho = {}
                    config_path = honcho.bound_config_path()
                    if config_path.is_file():
                        try:
                            loaded_honcho = _json.loads(
                                config_path.read_text(encoding="utf-8")
                            )
                            if isinstance(loaded_honcho, dict):
                                raw_honcho = loaded_honcho
                        except Exception:
                            raw_honcho = {}
                    host_block = _host_block(raw_honcho, honcho.host)
                    oauth_block = (
                        host_block.get("oauth")
                        if isinstance(host_block.get("oauth"), dict)
                        else raw_honcho.get("oauth")
                    )
                    configured = bool(
                        honcho.enabled and (honcho.api_key or honcho.base_url)
                    )
                    self_hosted = bool(honcho.base_url)
                    honcho_configuration = {
                        "configuration_status": (
                            "configured" if configured else "not_configured"
                        ),
                        "availability_reason": (
                            None if configured
                            else "honcho_credentials_or_base_url_required"
                        ),
                        "target": (
                            "honcho_self_hosted" if self_hosted
                            else "honcho_cloud"
                        ),
                        "credential_status": (
                            "configured" if configured else "not_configured"
                        ),
                        "credential_source": (
                            "oauth_grant"
                            if isinstance(oauth_block, dict)
                            and oauth_block.get("refreshToken")
                            else f"honcho_config:{config_path}"
                            if host_block.get("apiKey") or raw_honcho.get("apiKey")
                            else "HONCHO_API_KEY" if honcho.api_key
                            else "self_hosted_base_url" if self_hosted
                            else None
                        ),
                    }
                except Exception:
                    honcho_configuration = None

            if selected_memory == "honcho":
                if honcho_configuration is None:
                    memory_status.update({
                        "available": False,
                        "availability_reason": "honcho_status_read_failed",
                        "target": "honcho_cloud_or_self_hosted_unresolved",
                        "credential_status": "unknown",
                    })
                else:
                    configured = (
                        honcho_configuration["configuration_status"] == "configured"
                    )
                    memory_status.update({
                        "available": configured,
                        "availability_reason": honcho_configuration["availability_reason"],
                        "target": honcho_configuration["target"],
                        "credential_status": honcho_configuration["credential_status"],
                        "credential_source": honcho_configuration["credential_source"],
                        "setup_action": (
                            None if configured
                            else f"hermes --profile {name} memory setup honcho"
                        ),
                    })

            # Main alone requests this separate, secret-free status block.
            # Ordinary reads and every Run-start synchronization omit the
            # flag and therefore perform no Honcho network I/O.
            honcho_status = None
            if params.get("probe_honcho") is True:
                setup_action = f"hermes --profile {name} memory setup honcho"
                status_action = f"hermes --profile {name} honcho status"
                if honcho_configuration is None or honcho is None:
                    honcho_status = {
                        "selected": selected_memory == "honcho",
                        "configuration_status": "not_configured",
                        "connection_status": "not_checked",
                        "availability_reason": "honcho_status_read_failed",
                        "target": "honcho_cloud_or_self_hosted_unresolved",
                        "credential_status": "unknown",
                        "credential_source": None,
                        "setup_action": setup_action,
                        "status_action": status_action,
                    }
                else:
                    configured = (
                        honcho_configuration["configuration_status"] == "configured"
                    )
                    connection_status = (
                        "not_configured" if not configured else "not_checked"
                    )
                    availability_reason = honcho_configuration["availability_reason"]
                    if configured:
                        try:
                            import httpx

                            probe_base_url = (
                                honcho.base_url or "https://api.honcho.dev"
                            ).rstrip("/")
                            probe_timeout = min(2.0, float(honcho.timeout or 2.0))
                            response = httpx.get(
                                f"{probe_base_url}/health",
                                timeout=max(0.2, probe_timeout),
                                follow_redirects=False,
                            )
                            if response.status_code < 500:
                                connection_status = "connected"
                                availability_reason = None
                            else:
                                connection_status = "configured_unreachable"
                                availability_reason = (
                                    f"honcho_health_http_{response.status_code}"
                                )
                        except Exception:
                            connection_status = "configured_unreachable"
                            availability_reason = "honcho_health_unreachable"
                    honcho_status = {
                        "selected": selected_memory == "honcho",
                        **honcho_configuration,
                        "connection_status": connection_status,
                        "availability_reason": availability_reason,
                        "setup_action": setup_action,
                        "status_action": status_action,
                    }

            description = ""
            try:
                from hermes_cli.profiles import read_profile_meta

                description = str(read_profile_meta(profile_dir).get("description") or "")
            except Exception:
                pass

            return _ok(
                rid,
                {
                    "name": name,
                    "description": description,
                    "soul": soul,
                    "model": {
                        "provider": str(model_cfg.get("provider") or ""),
                        "default": str(model_cfg.get("default") or ""),
                    },
                    # LIQUIDAITY VENDOR PATCH: expose only the native,
                    # secret-free auxiliary review selector so a profile UI
                    # can configure and prove Hermes' existing self-learning
                    # path without reading config.yaml directly.
                    "background_review": {
                        "enabled": is_truthy_value(review_cfg.get("enabled"), default=True),
                        "provider": str(review_cfg.get("provider") or "auto"),
                        "model": str(review_cfg.get("model") or ""),
                        "max_input_tokens": review_cfg.get("max_input_tokens"),
                    },
                    # LIQUIDAITY VENDOR PATCH: expose Hermes' native top-level
                    # delegation provider/model selector without secrets. The
                    # actual delegate_task implementation reads this section.
                    "subagent_model": {
                        "provider": str(delegation_cfg.get("provider") or ""),
                        "model": str(delegation_cfg.get("model") or ""),
                    },
                    "memory": memory_status,
                    "honcho": honcho_status,
                    "skills": installed,
                    "toolsets": toolsets_out,
                    "toolsets_pinned": pinned_set is not None,
                    "mcp_servers": mcp_out,
                },
            )
        finally:
            reset_hermes_home_override(token)
    except Exception as e:
        return _err(rid, 5063, str(e))


@method("profiles.configure")
def _(rid, params: dict) -> dict:
    """Apply configuration changes to a profile (editor Save).

    Params: ``name`` (required) plus any of:
    ``description`` (str), ``soul`` (str, full SOUL.md replacement),
    ``model`` + ``provider`` (both required together),
    ``disabled_skills`` (list[str], replace semantics),
    ``enabled_toolsets`` (list[str], replace semantics; empty list clears
    the pin so every toolset is enabled again), and
    ``background_review`` (object; native auxiliary review enabled/provider/
    model/max_input_tokens), and
    ``subagent_model`` (object; native delegation provider/model), and
    ``memory_provider`` (native provider ID or ``builtin``), and
    ``ui_meta_expected_revisions`` (dict[str, int], optional compare-and-swap
    preconditions for keys supplied in ``ui_meta``).

    Each section is applied independently and best-effort; the result
    reports per-section success so a UI can surface partial failures.
    """
    name = str(params.get("name") or "").strip()
    if not name:
        return _err(rid, 4063, "name required")
    try:
        from pathlib import Path

        from hermes_cli.profiles import get_profile_dir
        from hermes_constants import reset_hermes_home_override, set_hermes_home_override

        profile_dir = Path(get_profile_dir(name))
        if not profile_dir.is_dir():
            return _err(rid, 4064, f"profile '{name}' not found")

        applied = {}

        if isinstance(params.get("ui_meta"), dict):
            # Client-agnostic UI metadata (avatar/pet/etc.), merged key-wise
            # into profile.yaml's ui_meta block. A key set to None deletes it.
            # Size-capped: this rides profiles.list on every roster paint, so
            # large blobs (e.g. raw base64 images) are rejected — persist big
            # assets elsewhere and store a reference.
            try:
                import json as _json

                incoming = params["ui_meta"]
                if len(_json.dumps(incoming)) > 65536:
                    applied["ui_meta"] = False
                else:
                    import yaml as _yaml

                    expected = params.get("ui_meta_expected_revisions")
                    if expected is not None and not isinstance(expected, dict):
                        raise ValueError("ui_meta_expected_revisions must be an object")

                    meta_path = profile_dir / "profile.yaml"
                    with _profile_ui_meta_lock:
                        existing = {}
                        if meta_path.is_file():
                            try:
                                with open(meta_path, "r", encoding="utf-8") as f:
                                    loaded = _yaml.safe_load(f) or {}
                                if isinstance(loaded, dict):
                                    existing = loaded
                            except Exception:
                                existing = {}

                        raw_revisions = existing.get("_ui_meta_revisions")
                        revisions = dict(raw_revisions) if isinstance(raw_revisions, dict) else {}
                        revisions = {
                            str(key): max(0, int(value))
                            for key, value in revisions.items()
                            if isinstance(value, int) and not isinstance(value, bool)
                        }
                        conflicts = {}
                        if isinstance(expected, dict):
                            for key in incoming:
                                wanted = expected.get(key)
                                actual = revisions.get(key, 0)
                                if (
                                    not isinstance(wanted, int)
                                    or isinstance(wanted, bool)
                                    or wanted < 0
                                    or wanted != actual
                                ):
                                    conflicts[key] = {"expected": wanted, "actual": actual}

                        if conflicts:
                            applied["ui_meta"] = False
                            applied["ui_meta_conflicts"] = conflicts
                            applied["ui_meta_revisions"] = {
                                key: revisions.get(key, 0) for key in incoming
                            }
                        else:
                            current = existing.get("ui_meta")
                            if not isinstance(current, dict):
                                current = {}
                            for key, value in incoming.items():
                                if value is None:
                                    current.pop(key, None)
                                else:
                                    current[key] = value
                                revisions[key] = revisions.get(key, 0) + 1
                            if current:
                                existing["ui_meta"] = current
                            else:
                                existing.pop("ui_meta", None)
                            # Revisions intentionally survive deletion: a
                            # stale client must not recreate a removed key by
                            # presenting the initial revision again.
                            existing["_ui_meta_revisions"] = revisions
                            from utils import atomic_yaml_write

                            atomic_yaml_write(meta_path, existing, sort_keys=False)
                            applied["ui_meta"] = True
                            applied["ui_meta_revisions"] = {
                                key: revisions[key] for key in incoming
                            }
            except Exception:
                applied["ui_meta"] = False

        if isinstance(params.get("soul"), str):
            try:
                (profile_dir / "SOUL.md").write_text(params["soul"], encoding="utf-8")
                applied["soul"] = True
            except Exception:
                applied["soul"] = False

        if isinstance(params.get("description"), str):
            try:
                from hermes_cli.profiles import write_profile_meta

                write_profile_meta(
                    profile_dir,
                    description=params["description"].strip(),
                    description_auto=False,
                )
                applied["description"] = True
            except Exception:
                applied["description"] = False

        model = str(params.get("model") or "").strip()
        provider = str(params.get("provider") or "").strip()
        if model and provider:
            try:
                from hermes_cli.web_routers.profiles import _write_profile_model

                _write_profile_model(profile_dir, provider, model)
                applied["model"] = True
            except Exception:
                applied["model"] = False

        needs_cfg = (
            isinstance(params.get("disabled_skills"), list)
            or isinstance(params.get("enabled_toolsets"), list)
            or isinstance(params.get("enabled_mcp_servers"), list)
            or isinstance(params.get("background_review"), dict)
            or isinstance(params.get("subagent_model"), dict)
            or isinstance(params.get("memory_provider"), str)
        )
        if needs_cfg:
            # Launch profile's MCP catalog, read BEFORE the home override
            # flips config resolution to the target profile.
            launch_mcp = {}
            if isinstance(params.get("enabled_mcp_servers"), list):
                try:
                    from hermes_cli.config import load_config_readonly

                    launch_cfg = load_config_readonly() or {}
                    if isinstance(launch_cfg.get("mcp_servers"), dict):
                        launch_mcp = launch_cfg["mcp_servers"]
                except Exception:
                    launch_mcp = {}

            token = set_hermes_home_override(str(profile_dir))
            try:
                from hermes_cli.config import load_config, save_config

                cfg = load_config() or {}

                if isinstance(params.get("disabled_skills"), list):
                    try:
                        from hermes_cli.skills_config import save_disabled_skills

                        wanted = {
                            str(s).strip()
                            for s in params["disabled_skills"]
                            if str(s).strip()
                        }
                        save_disabled_skills(cfg, wanted)
                        applied["skills"] = True
                        cfg = load_config() or {}
                    except Exception:
                        applied["skills"] = False

                if isinstance(params.get("enabled_toolsets"), list):
                    try:
                        wanted = [str(t).strip() for t in params["enabled_toolsets"] if str(t).strip()]
                        tools_cfg = cfg.get("tools") if isinstance(cfg.get("tools"), dict) else {}
                        if wanted:
                            tools_cfg["enabled_toolsets"] = sorted(set(wanted))
                        else:
                            tools_cfg.pop("enabled_toolsets", None)
                        cfg["tools"] = tools_cfg
                        save_config(cfg)
                        applied["toolsets"] = True
                    except Exception:
                        applied["toolsets"] = False

                if isinstance(params.get("background_review"), dict):
                    # LIQUIDAITY VENDOR PATCH: use Hermes' existing
                    # auxiliary.background_review contract. This is profile
                    # configuration only; credentials continue to resolve via
                    # the selected native provider.
                    try:
                        incoming = params["background_review"]
                        unknown = sorted(
                            set(incoming)
                            - {"enabled", "provider", "model", "max_input_tokens"}
                        )
                        if unknown:
                            raise ValueError(
                                f"unknown background_review field: {unknown[0]}"
                            )
                        if not isinstance(incoming.get("enabled", True), bool):
                            raise ValueError("background_review.enabled must be bool")
                        review_provider = str(incoming.get("provider") or "auto").strip()
                        review_model = str(incoming.get("model") or "").strip()
                        if review_provider != "auto" and not review_model:
                            raise ValueError(
                                "background_review.model required for explicit provider"
                            )
                        max_input_tokens = incoming.get("max_input_tokens")
                        if max_input_tokens is not None and (
                            not isinstance(max_input_tokens, int)
                            or isinstance(max_input_tokens, bool)
                        ):
                            raise ValueError(
                                "background_review.max_input_tokens must be int"
                            )
                        cfg = load_config() or {}
                        auxiliary_cfg = (
                            cfg.get("auxiliary")
                            if isinstance(cfg.get("auxiliary"), dict)
                            else {}
                        )
                        review_cfg = {
                            "enabled": incoming.get("enabled", True),
                            "provider": review_provider,
                            "model": review_model,
                        }
                        if max_input_tokens is not None:
                            review_cfg["max_input_tokens"] = max_input_tokens
                        auxiliary_cfg["background_review"] = review_cfg
                        cfg["auxiliary"] = auxiliary_cfg
                        save_config(cfg)
                        applied["background_review"] = True
                    except Exception:
                        applied["background_review"] = False

                if isinstance(params.get("subagent_model"), dict):
                    # LIQUIDAITY VENDOR PATCH: configure only Hermes' existing
                    # top-level delegation selector. Bounds, tools, depth and
                    # concurrency remain owned by the native delegation path.
                    try:
                        incoming = params["subagent_model"]
                        unknown = sorted(set(incoming) - {"provider", "model"})
                        if unknown:
                            raise ValueError(
                                f"unknown subagent_model field: {unknown[0]}"
                            )
                        child_provider = str(incoming.get("provider") or "").strip()
                        child_model = str(incoming.get("model") or "").strip()
                        if not child_provider or not child_model:
                            raise ValueError(
                                "subagent_model.provider and model required"
                            )
                        cfg = load_config() or {}
                        delegation_cfg = (
                            cfg.get("delegation")
                            if isinstance(cfg.get("delegation"), dict)
                            else {}
                        )
                        delegation_cfg["provider"] = child_provider
                        delegation_cfg["model"] = child_model
                        cfg["delegation"] = delegation_cfg
                        save_config(cfg)
                        applied["subagent_model"] = True
                    except Exception:
                        applied["subagent_model"] = False

                if isinstance(params.get("memory_provider"), str):
                    # LIQUIDAITY VENDOR PATCH: select Hermes' existing single
                    # external-memory provider. Secrets and provider-specific
                    # setup remain in their native secure configuration seams.
                    try:
                        selected = str(params["memory_provider"] or "").strip()
                        if not selected or len(selected) > 128:
                            raise ValueError("memory_provider invalid")
                        cfg = load_config() or {}
                        memory_cfg = (
                            cfg.get("memory")
                            if isinstance(cfg.get("memory"), dict)
                            else {}
                        )
                        if selected == "builtin":
                            memory_cfg.pop("provider", None)
                        else:
                            memory_cfg["provider"] = selected
                        cfg["memory"] = memory_cfg
                        save_config(cfg)
                        applied["memory_provider"] = True
                    except Exception:
                        applied["memory_provider"] = False

                # ``enabled_mcp_servers`` (list[str], replace semantics):
                # toggle the profile's mcp_servers entries via the standard
                # ``disabled`` flag. Enabling a server the profile doesn't
                # define copies its definition from the LAUNCH profile's
                # config (capabilities UIs offer the main profile's catalog);
                # unknown names are skipped, never invented. Server defs are
                # config, not secrets — credentials stay in .env/auth.
                if isinstance(params.get("enabled_mcp_servers"), list):
                    try:
                        wanted = {
                            str(s).strip()
                            for s in params["enabled_mcp_servers"]
                            if str(s).strip()
                        }
                        cfg = load_config() or {}
                        mcp_cfg = (
                            cfg.get("mcp_servers")
                            if isinstance(cfg.get("mcp_servers"), dict)
                            else {}
                        )

                        for srv in wanted:
                            if srv in mcp_cfg and isinstance(mcp_cfg[srv], dict):
                                mcp_cfg[srv].pop("disabled", None)
                            elif srv in launch_mcp and isinstance(launch_mcp[srv], dict):
                                mcp_cfg[srv] = dict(launch_mcp[srv])
                                mcp_cfg[srv].pop("disabled", None)
                        for srv, entry in mcp_cfg.items():
                            if srv not in wanted and isinstance(entry, dict):
                                entry["disabled"] = True

                        if mcp_cfg:
                            cfg["mcp_servers"] = mcp_cfg
                        save_config(cfg)
                        applied["mcp_servers"] = True
                    except Exception:
                        applied["mcp_servers"] = False
            finally:
                reset_hermes_home_override(token)

        return _ok(rid, {"ok": all(applied.values()) if applied else True, "applied": applied})
    except Exception as e:
        return _err(rid, 5064, str(e))


@method("profiles.set_asset")
def _(rid, params: dict) -> dict:
    """Store a small binary asset (e.g. avatar image) in a profile's dir.

    Params: ``name`` (profile), ``asset`` (currently only ``"avatar"``),
    ``data`` (data URL or raw base64; PNG/JPEG/WebP; decoded size capped at
    2MB), or ``clear: true`` to delete. Written atomically as
    ``assets/<asset>.<ext>`` inside the profile directory — server-side, so
    every client machine sees the same image via ``profiles.get_asset``.

    Result: ``{ok, asset, size}`` (``size`` 0 on clear).
    """
    name = str(params.get("name") or "").strip()
    asset = str(params.get("asset") or "avatar").strip().lower()
    if not name:
        return _err(rid, 4063, "name required")
    if asset not in {"avatar"}:
        return _err(rid, 4066, f"unknown asset '{asset}' (supported: avatar)")
    try:
        import base64
        import re as _re
        from pathlib import Path as _Path

        from hermes_cli.profiles import get_profile_dir

        profile_dir = _Path(get_profile_dir(name))
        if not profile_dir.is_dir():
            return _err(rid, 4064, f"profile '{name}' not found")

        assets_dir = profile_dir / "assets"
        exts = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}

        if is_truthy_value(params.get("clear", False)):
            removed = 0
            for ext in exts.values():
                target = assets_dir / f"{asset}.{ext}"
                if target.is_file():
                    target.unlink()
                    removed += 1
            return _ok(rid, {"ok": True, "asset": asset, "size": 0, "removed": removed})

        data = str(params.get("data") or "")
        if not data:
            return _err(rid, 4067, "data required (data URL or base64)")

        mime = "image/png"
        match = _re.match(r"^data:(image/(?:png|jpeg|webp));base64,(.*)$", data, _re.DOTALL)
        if match:
            mime, payload = match.group(1), match.group(2)
        else:
            payload = data

        try:
            blob = base64.b64decode(payload, validate=True)
        except Exception:
            return _err(rid, 4068, "data is not valid base64")

        if len(blob) > 2_000_000:
            return _err(rid, 4069, f"asset too large ({len(blob)} bytes; max 2MB)")

        # Magic-byte check — don't trust the declared mime.
        if blob[:8] == b"\x89PNG\r\n\x1a\n":
            mime = "image/png"
        elif blob[:3] == b"\xff\xd8\xff":
            mime = "image/jpeg"
        elif blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
            mime = "image/webp"
        else:
            return _err(rid, 4070, "unsupported image format (PNG/JPEG/WebP only)")

        assets_dir.mkdir(parents=True, exist_ok=True)
        # One canonical file per asset: clear other extensions first.
        for ext in exts.values():
            stale = assets_dir / f"{asset}.{ext}"
            if stale.is_file():
                stale.unlink()

        target = assets_dir / f"{asset}.{exts[mime]}"
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_bytes(blob)
        tmp.replace(target)
        return _ok(rid, {"ok": True, "asset": asset, "size": len(blob)})
    except Exception as e:
        return _err(rid, 5065, str(e))


@method("profiles.get_asset")
def _(rid, params: dict) -> dict:
    """Fetch a profile asset as a data URL.

    Params: ``name`` (profile), ``asset`` (default ``"avatar"``).
    Result: ``{found, data?, mime?, size?}`` — ``found: false`` (not an
    error) when the asset doesn't exist, so roster UIs can probe cheaply.
    """
    name = str(params.get("name") or "").strip()
    asset = str(params.get("asset") or "avatar").strip().lower()
    if not name:
        return _err(rid, 4063, "name required")
    try:
        import base64
        from pathlib import Path as _Path

        from hermes_cli.profiles import get_profile_dir

        profile_dir = _Path(get_profile_dir(name))
        if not profile_dir.is_dir():
            return _err(rid, 4064, f"profile '{name}' not found")

        mimes = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}
        for ext, mime in mimes.items():
            target = profile_dir / "assets" / f"{asset}.{ext}"
            if target.is_file():
                blob = target.read_bytes()
                return _ok(
                    rid,
                    {
                        "found": True,
                        "mime": mime,
                        "size": len(blob),
                        "data": f"data:{mime};base64,{base64.b64encode(blob).decode('ascii')}",
                    },
                )
        return _ok(rid, {"found": False})
    except Exception as e:
        return _err(rid, 5066, str(e))


def register(server) -> None:
    _registry.install(server)
