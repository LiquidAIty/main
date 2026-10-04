"""Process-owned configuration boundary for the LiquidAIty KnowGraph service."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

FILE_BACKED_CONFIG = (
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "NEO4J_PASSWORD",
)


def _resolve_file_backed_config() -> None:
    for variable in FILE_BACKED_CONFIG:
        file_variable = f"{variable}_FILE"
        configured_path = os.environ.get(file_variable, "").strip()
        if not configured_path or os.environ.get(variable, "").strip():
            continue
        try:
            os.environ[variable] = Path(configured_path).read_text(encoding="utf-8").rstrip("\r\n")
        except OSError as error:
            raise RuntimeError(f"config_secret_file_unreadable: {file_variable}") from error


def load_runtime_environment() -> None:
    _resolve_file_backed_config()
    service_dir = Path(__file__).resolve().parent
    repo_root = service_dir.parents[1]
    candidates = (
        service_dir / ".env",
        repo_root / "apps" / "backend" / ".env",
        repo_root / ".env",
    )
    for candidate in dict.fromkeys(candidates):
        if candidate.is_file():
            load_dotenv(candidate, override=False)
    _resolve_file_backed_config()
