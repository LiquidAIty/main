"""Saved blue-worker validation and package-safe Hermes taskgraph transport."""

# Entity: Magnetic TaskGraph
# Relationship: Validates exact saved blue-worker authority and invokes Hermes's public taskgraph adapter without importing or mutating Hermes modules in Python rails.

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any


class MagneticTaskGraphError(RuntimeError):
    pass


_TEAM_CARD_ID = "card_team"
_MAX_HANDOFF_SUMMARY_CHARS = 2_000
_ADAPTER_TIMEOUT_SECONDS = 60
_ADAPTER_RESPONSE_BYTES = 2_000_000


def _required_text(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise MagneticTaskGraphError(f"{field}_required")
    return text


def _runtime_paths() -> tuple[Path, Path, Path]:
    repository = Path(__file__).resolve().parents[4]
    hermes_root = repository / "HermesLatest"
    hermes_home = hermes_root / ".hermes"
    candidates = (
        hermes_root / ".venv" / "Scripts" / "python.exe",
        hermes_root / ".venv" / "bin" / "python",
    )
    python = next((candidate for candidate in candidates if candidate.is_file()), None)
    if not hermes_root.is_dir() or not hermes_home.is_dir() or python is None:
        raise MagneticTaskGraphError("magnetic_taskgraph_hermes_runtime_missing")
    return hermes_root, hermes_home, python


def call_hermes_taskgraph_adapter(
    request: dict[str, Any],
    *,
    timeout_seconds: int = _ADAPTER_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    hermes_root, hermes_home, python = _runtime_paths()
    encoded = json.dumps(
        request,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    environment = {
        **os.environ,
        "HERMES_HOME": str(hermes_home),
        "PYTHONUTF8": "1",
        "PYTHONIOENCODING": "utf-8",
    }
    try:
        completed = subprocess.run(
            [str(python), "-m", "hermes_cli.taskgraph_adapter"],
            cwd=str(hermes_root),
            env=environment,
            input=encoded,
            text=True,
            encoding="utf-8",
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise MagneticTaskGraphError(
            f"magnetic_taskgraph_hermes_adapter_unavailable:{error.__class__.__name__}"
        ) from error
    if len(completed.stdout.encode("utf-8")) > _ADAPTER_RESPONSE_BYTES:
        raise MagneticTaskGraphError("magnetic_taskgraph_hermes_adapter_response_too_large")
    try:
        response = json.loads(completed.stdout)
    except (TypeError, ValueError) as error:
        raise MagneticTaskGraphError("magnetic_taskgraph_hermes_adapter_response_invalid") from error
    if not isinstance(response, dict):
        raise MagneticTaskGraphError("magnetic_taskgraph_hermes_adapter_response_invalid")
    if completed.returncode != 0 or response.get("ok") is not True:
        code = str(response.get("error") or "failed").strip()[:240]
        raise MagneticTaskGraphError(f"magnetic_taskgraph_hermes_adapter_failed:{code}")
    return response


def _hermes_model(provider: dict[str, Any], options: dict[str, Any]) -> tuple[str, str]:
    saved_provider = _required_text(provider.get("provider"), "magnetic_taskgraph_provider")
    access_mode = _required_text(provider.get("accessMode"), "magnetic_taskgraph_access_mode")
    model = _required_text(
        provider.get("providerModelId") or provider.get("modelKey")
        or options.get("providerModelId") or options.get("modelKey"),
        "magnetic_taskgraph_model",
    )
    mapping = {
        ("openai", "chatgpt-account"): "openai-codex",
        ("openai", "openai-api"): "openai",
        ("openrouter", "openrouter-api"): "openrouter",
        ("local_openai_compatible", "openai-api"): "local_openai_compatible",
    }
    resolved = mapping.get((saved_provider, access_mode))
    if resolved is None:
        raise MagneticTaskGraphError(
            f"magnetic_taskgraph_provider_binding_unsupported:{saved_provider}:{access_mode}"
        )
    return resolved, model


def _ensure_orchestrator_identity(
    spec: dict[str, Any], workers: list[dict[str, Any]],
) -> tuple[str, str, str]:
    profile = _required_text(
        spec.get("hermesProfile"), "magnetic_taskgraph_hermes_profile",
    ).lower()
    instructions = _required_text(
        spec.get("instructions"), "magnetic_taskgraph_instructions",
    )
    provider = spec.get("provider") if isinstance(spec.get("provider"), dict) else {}
    options = spec.get("runtimeOptions") if isinstance(spec.get("runtimeOptions"), dict) else {}
    hermes_provider, model = _hermes_model(provider, options)
    worker_profiles = [
        _required_text(worker.get("profile"), "magnetic_taskgraph_worker_identity").lower()
        for worker in workers
    ]
    call_hermes_taskgraph_adapter({
        "action": "validate_profiles",
        "profile": profile,
        "provider": hermes_provider,
        "model": model,
        "instructions": instructions,
        "workers": worker_profiles,
    })
    return profile, hermes_provider, model


def _worker_scope(workers: list[dict[str, Any]]) -> tuple[list[str], str]:
    identities: list[str] = []
    lines: list[str] = []
    seen: set[str] = set()
    for worker in workers:
        card_id = _required_text(worker.get("cardId"), "magnetic_taskgraph_worker_card")
        revision_id = _required_text(
            worker.get("cardRevisionId"), "magnetic_taskgraph_worker_revision",
        )
        identity = _required_text(
            worker.get("profile"), "magnetic_taskgraph_worker_identity",
        ).lower()
        if identity in seen:
            raise MagneticTaskGraphError(
                f"magnetic_taskgraph_worker_identity_duplicate:{identity}"
            )
        seen.add(identity)
        identities.append(identity)
        title = str(worker.get("title") or card_id).strip()
        description = str(worker.get("description") or "").strip()
        capabilities = worker.get("capabilities")
        eligible_tools: list[str] = []
        if capabilities is not None:
            if (
                not isinstance(capabilities, dict)
                or set(capabilities) != {"savedToolIds"}
                or not isinstance(capabilities.get("savedToolIds"), list)
                or len(capabilities["savedToolIds"]) > 128
            ):
                raise MagneticTaskGraphError(
                    "magnetic_taskgraph_worker_capabilities_invalid"
                )
            eligible_tools = [
                _required_text(value, "magnetic_taskgraph_worker_saved_capability")
                for value in capabilities["savedToolIds"]
            ]
            if len(eligible_tools) != len(set(eligible_tools)):
                raise MagneticTaskGraphError(
                    "magnetic_taskgraph_worker_capabilities_invalid"
                )
        details = [description] if description else []
        if capabilities is not None:
            details.append(
                "Saved Card tools: "
                + (", ".join(eligible_tools) if eligible_tools else "none")
            )
        suffix = f"; {'; '.join(details)}" if details else ""
        lines.append(
            f"- {identity}: Card {card_id} revision {revision_id}; {title}{suffix}"
        )
    if not identities:
        raise MagneticTaskGraphError("magnetic_taskgraph_no_connected_workers")
    return identities, "\n".join(lines)


def _direct_team_worker(workers: list[dict[str, Any]]) -> dict[str, Any] | None:
    for worker in workers:
        card_id = _required_text(worker.get("cardId"), "magnetic_taskgraph_worker_card")
        marked_team = worker.get("teamTaskMode") is True
        if marked_team != (card_id == _TEAM_CARD_ID):
            raise MagneticTaskGraphError(
                f"magnetic_taskgraph_team_identity_invalid:{card_id}"
            )
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
    expected_keys = {"cardId", "cardRevisionId", "profile"}
    for worker, candidate in zip(workers, value, strict=True):
        if not isinstance(candidate, dict) or set(candidate) != expected_keys:
            raise MagneticTaskGraphError("magnetic_taskgraph_worker_authorities_invalid")
        authority = {
            "cardId": _required_text(
                candidate.get("cardId"), "magnetic_taskgraph_authority_card",
            ),
            "cardRevisionId": _required_text(
                candidate.get("cardRevisionId"), "magnetic_taskgraph_authority_revision",
            ),
            "profile": _required_text(
                candidate.get("profile"), "magnetic_taskgraph_authority_profile",
            ).lower(),
        }
        if (
            authority["cardId"] != _required_text(
                worker.get("cardId"), "magnetic_taskgraph_worker_card",
            )
            or authority["cardRevisionId"] != _required_text(
                worker.get("cardRevisionId"), "magnetic_taskgraph_worker_revision",
            )
            or authority["profile"] != _required_text(
                worker.get("profile"), "magnetic_taskgraph_worker_identity",
            ).lower()
            or authority["profile"] in seen
        ):
            raise MagneticTaskGraphError("magnetic_taskgraph_worker_authorities_invalid")
        seen.add(authority["profile"])
        authorities.append(authority)
    return authorities
