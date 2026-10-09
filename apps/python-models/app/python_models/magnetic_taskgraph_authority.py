"""Hermes profile, task-store, and saved blue-worker authority validation."""

from __future__ import annotations

import json
import importlib.util
import re
import sys
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator
class MagneticTaskGraphError(RuntimeError):
    pass


_TEAM_CARD_ID = "card_team"
_MAX_HANDOFF_SUMMARY_CHARS = 2_000
_LOWER_HEX_64_RE = re.compile(r"^[a-f0-9]{64}$", re.ASCII)
_HERMES_AUTHORITY_EVENT = "card_authority_bound"
_HERMES_TASK_IMPORT_LOCK = threading.RLock()


def _required_text(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise MagneticTaskGraphError(f"{field}_required")
    return text


def _runtime_paths() -> tuple[Path, Path]:
    repository = Path(__file__).resolve().parents[4]
    hermes_root = repository / "HermesLatest"
    hermes_home = hermes_root / ".hermes"
    if not hermes_root.is_dir():
        raise MagneticTaskGraphError("magnetic_taskgraph_hermes_runtime_missing")
    if str(hermes_root) not in sys.path:
        sys.path.insert(0, str(hermes_root))
    return hermes_root, hermes_home


@contextmanager
def _default_home_scope(hermes_home: Path) -> Iterator[None]:
    """Give Hermes profile APIs their repository root without cross-thread leakage."""
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    token = set_hermes_home_override(hermes_home)
    try:
        yield
    finally:
        reset_hermes_home_override(token)


def _hermes_model(provider: dict[str, Any], options: dict[str, Any]) -> tuple[str, str, str | None]:
    saved_provider = _required_text(provider.get("provider"), "magnetic_taskgraph_provider")
    access_mode = _required_text(provider.get("accessMode"), "magnetic_taskgraph_access_mode")
    model = _required_text(
        provider.get("providerModelId") or provider.get("modelKey")
        or options.get("providerModelId") or options.get("modelKey"),
        "magnetic_taskgraph_model",
    )
    mapping = {
        ("openai", "chatgpt-account"): ("openai-codex", "codex_app_server"),
        ("openai", "openai-api"): ("openai", None),
        ("openrouter", "openrouter-api"): ("openrouter", None),
        ("local_openai_compatible", "openai-api"): ("local_openai_compatible", None),
    }
    resolved = mapping.get((saved_provider, access_mode))
    if resolved is None:
        raise MagneticTaskGraphError(
            f"magnetic_taskgraph_provider_binding_unsupported:{saved_provider}:{access_mode}"
        )
    return resolved[0], model, resolved[1]


def _ensure_orchestrator_identity(
    spec: dict[str, Any], workers: list[dict[str, Any]],
) -> tuple[str, str, str, str | None]:
    hermes_profile = _required_text(spec.get("hermesProfile"), "magnetic_taskgraph_hermes_profile").lower()
    instructions = spec.get("instructions")
    if not isinstance(instructions, str) or not instructions.strip():
        raise MagneticTaskGraphError("magnetic_taskgraph_instructions_required")
    provider = spec.get("provider") if isinstance(spec.get("provider"), dict) else {}
    options = spec.get("runtimeOptions") if isinstance(spec.get("runtimeOptions"), dict) else {}
    hermes_provider, model, openai_runtime = _hermes_model(provider, options)
    _, hermes_home = _runtime_paths()

    with _default_home_scope(hermes_home):
        from hermes_cli.profiles import normalize_profile_name, validate_profile_name
        from hermes_constants import named_profile_is_live

        def profile_home(name: str) -> Path | None:
            canonical = normalize_profile_name(name)
            try:
                validate_profile_name(canonical)
            except ValueError:
                return None
            candidate = hermes_home if canonical == "default" else hermes_home / "profiles" / canonical
            if canonical == "default":
                return candidate if candidate.is_dir() else None
            return candidate if named_profile_is_live(candidate) else None

        orchestrator_home = profile_home(hermes_profile)
        if orchestrator_home is None:
            raise MagneticTaskGraphError(
                f"magnetic_taskgraph_orchestrator_profile_missing:{hermes_profile}"
            )
        missing = [
            _required_text(worker.get("profile"), "magnetic_taskgraph_worker_identity")
            for worker in workers
            if profile_home(_required_text(worker.get("profile"), "magnetic_taskgraph_worker_identity")) is None
        ]
        if missing:
            raise MagneticTaskGraphError(
                f"magnetic_taskgraph_worker_profile_missing:{','.join(missing)}"
            )

        from hermes_constants import reset_hermes_home_override, set_hermes_home_override
        from hermes_cli.config import load_config

        token = set_hermes_home_override(orchestrator_home)
        try:
            config = load_config() or {}
            model_config = config.get("model") or {}
            agent_config = config.get("agent") or {}
            soul_path = orchestrator_home / "SOUL.md"
            try:
                soul = soul_path.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                soul = None
            if (
                model_config.get("provider") != hermes_provider
                or model_config.get("default") != model
                or "system_prompt" in agent_config
                or soul != instructions
            ):
                raise MagneticTaskGraphError("magnetic_taskgraph_orchestrator_materialization_mismatch")
        finally:
            reset_hermes_home_override(token)
    return hermes_profile, hermes_provider, model, openai_runtime


def _task_db_path() -> Path:
    _, hermes_home = _runtime_paths()
    return hermes_home / "kanban.db"


@contextmanager
def hermes_task_runtime_scope() -> Iterator[None]:
    """Give embedded Hermes task calls their own flat ``utils.py`` binding.

    Graphiti and Hermes both publish a top-level ``utils`` module. The scope is
    locked because ``sys.modules`` is process-wide; every lazy Hermes import and
    task-store operation completes before the previous provider module returns.
    """

    hermes_root, _hermes_home = _runtime_paths()
    with _HERMES_TASK_IMPORT_LOCK:
        previous_utils = {
            name: module
            for name, module in tuple(sys.modules.items())
            if name == "utils" or name.startswith("utils.")
        }
        for name in previous_utils:
            sys.modules.pop(name, None)
        utils_path = hermes_root / "utils.py"
        spec = importlib.util.spec_from_file_location("utils", utils_path)
        if spec is None or spec.loader is None:
            raise MagneticTaskGraphError("magnetic_taskgraph_hermes_utils_missing")
        hermes_utils = importlib.util.module_from_spec(spec)
        sys.modules["utils"] = hermes_utils
        try:
            spec.loader.exec_module(hermes_utils)
            yield
        finally:
            for name in tuple(sys.modules):
                if name == "utils" or name.startswith("utils."):
                    sys.modules.pop(name, None)
            sys.modules.update(previous_utils)


def _task_store() -> tuple[Path, Any, Any]:
    """Return Hermes task modules while ``hermes_task_runtime_scope`` is active."""

    db_path = _task_db_path()
    from hermes_cli import kanban_db as task_db
    from hermes_cli import kanban_db_connect as task_db_connect

    return db_path, task_db, task_db_connect


def _worker_scope(workers: list[dict[str, Any]]) -> tuple[list[str], str]:
    identities: list[str] = []
    lines: list[str] = []
    seen: set[str] = set()
    for worker in workers:
        card_id = _required_text(worker.get("cardId"), "magnetic_taskgraph_worker_card")
        revision_id = _required_text(worker.get("cardRevisionId"), "magnetic_taskgraph_worker_revision")
        identity = _required_text(worker.get("profile"), "magnetic_taskgraph_worker_identity").lower()
        if identity in seen:
            raise MagneticTaskGraphError(f"magnetic_taskgraph_worker_identity_duplicate:{identity}")
        seen.add(identity)
        identities.append(identity)
        title = str(worker.get("title") or card_id).strip()
        description = str(worker.get("description") or "").strip()
        capabilities = worker.get("capabilities")
        eligible_tools: list[str] = []
        if capabilities is not None:
            if (
                not isinstance(capabilities, dict)
                or set(capabilities) != {"savedToolIds", "projectEligibleToolIds"}
                or not isinstance(capabilities.get("savedToolIds"), list)
                or not isinstance(capabilities.get("projectEligibleToolIds"), list)
                or len(capabilities["savedToolIds"]) > 128
                or len(capabilities["projectEligibleToolIds"]) > 128
            ):
                raise MagneticTaskGraphError("magnetic_taskgraph_worker_capabilities_invalid")
            saved_tools = [
                _required_text(value, "magnetic_taskgraph_worker_saved_capability")
                for value in capabilities["savedToolIds"]
            ]
            eligible_tools = [
                _required_text(value, "magnetic_taskgraph_worker_project_capability")
                for value in capabilities["projectEligibleToolIds"]
            ]
            if (
                len(saved_tools) != len(set(saved_tools))
                or len(eligible_tools) != len(set(eligible_tools))
                or not set(eligible_tools) <= set(saved_tools)
            ):
                raise MagneticTaskGraphError("magnetic_taskgraph_worker_capabilities_invalid")
        details = [description] if description else []
        if capabilities is not None:
            details.append(
                "Project-eligible tools: "
                + (", ".join(eligible_tools) if eligible_tools else "none")
            )
        capability = f"; {'; '.join(details)}" if details else ""
        lines.append(
            f"- {identity}: Card {card_id} revision {revision_id}; "
            f"{title}{capability}"
        )
    if not identities:
        raise MagneticTaskGraphError("magnetic_taskgraph_no_connected_workers")
    return identities, "\n".join(lines)


def _direct_team_worker(workers: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the sole Team worker, while rejecting a mismatched structural marker."""

    for worker in workers:
        card_id = _required_text(worker.get("cardId"), "magnetic_taskgraph_worker_card")
        marked_team = worker.get("teamTaskMode") is True
        if marked_team != (card_id == _TEAM_CARD_ID):
            raise MagneticTaskGraphError(f"magnetic_taskgraph_team_identity_invalid:{card_id}")
    if len(workers) == 1 and workers[0].get("cardId") == _TEAM_CARD_ID:
        return workers[0]
    return None


def _worker_authorities(
    workers: list[dict[str, Any]], value: Any,
) -> list[dict[str, str]]:
    if not isinstance(value, list) or len(value) != len(workers):
        raise MagneticTaskGraphError("magnetic_taskgraph_worker_authorities_invalid")
    authorities: list[dict[str, str]] = []
    seen: set[str] = set()
    expected_keys = {
        "cardId", "cardRevisionId", "profile", "configurationFingerprint",
    }
    for worker, candidate in zip(workers, value, strict=True):
        if not isinstance(candidate, dict) or set(candidate) != expected_keys:
            raise MagneticTaskGraphError("magnetic_taskgraph_worker_authorities_invalid")
        authority = {
            "cardId": _required_text(candidate.get("cardId"), "magnetic_taskgraph_authority_card"),
            "cardRevisionId": _required_text(
                candidate.get("cardRevisionId"), "magnetic_taskgraph_authority_revision",
            ),
            "profile": _required_text(
                candidate.get("profile"), "magnetic_taskgraph_authority_profile",
            ).lower(),
            "configurationFingerprint": _required_text(
                candidate.get("configurationFingerprint"),
                "magnetic_taskgraph_authority_configuration_fingerprint",
            ),
        }
        if (
            authority["cardId"] != _required_text(worker.get("cardId"), "magnetic_taskgraph_worker_card")
            or authority["cardRevisionId"] != _required_text(
                worker.get("cardRevisionId"), "magnetic_taskgraph_worker_revision",
            )
            or authority["profile"] != _required_text(
                worker.get("profile"), "magnetic_taskgraph_worker_identity",
            ).lower()
            or not _LOWER_HEX_64_RE.fullmatch(authority["configurationFingerprint"])
            or authority["profile"] in seen
        ):
            raise MagneticTaskGraphError("magnetic_taskgraph_worker_authorities_invalid")
        seen.add(authority["profile"])
        authorities.append(authority)
    return authorities


def _bind_hermes_worker_authorities(
    connection: Any,
    task_db: Any,
    root_id: str,
    authorities: list[dict[str, str]],
) -> None:
    expected = {"workers": authorities}
    with task_db.write_txn(connection):
        rows = connection.execute(
            "SELECT payload FROM task_events WHERE task_id = ? AND kind = ? ORDER BY id",
            (root_id, _HERMES_AUTHORITY_EVENT),
        ).fetchall()
        if not rows:
            task_db.append_task_event(connection, root_id, _HERMES_AUTHORITY_EVENT, expected)
            return
        if (
            len(rows) != 1
            or not isinstance(rows[0]["payload"], str)
            or _parse_worker_authority_event(rows[0]["payload"]) != expected
        ):
            raise MagneticTaskGraphError("magnetic_taskgraph_worker_authority_binding_mismatch")

def _parse_worker_authority_event(raw: str) -> dict[str, Any]:
    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate key")
            value[key] = item
        return value

    try:
        parsed = json.loads(
            raw,
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("invalid constant")),
        )
    except (TypeError, ValueError, RecursionError) as error:
        raise MagneticTaskGraphError("magnetic_taskgraph_worker_authority_event_invalid") from error
    if not isinstance(parsed, dict):
        raise MagneticTaskGraphError("magnetic_taskgraph_worker_authority_event_invalid")
    return parsed
