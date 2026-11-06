from __future__ import annotations

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: KnowGraph
# Relationship: This file contributes proof of explicit environment loading and fail-closed configuration behavior to the KnowGraph feature.
# Entity: Credentials
# Relationship: This file contributes proof of file-backed secret loading, process-secret precedence, and secret-safe errors to the Credentials feature.

import os

import pytest

from runtime_config import load_runtime_environment


def test_file_backed_secret_and_process_precedence(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    env_file = tmp_path / "runtime.env"
    env_file.write_text("", encoding="utf-8")
    monkeypatch.setenv("LIQUIDAITY_ENV_FILE", str(env_file))
    secret_file = tmp_path / "neo4j-password"
    secret_file.write_text("file-secret\n", encoding="utf-8")
    monkeypatch.setenv("NEO4J_PASSWORD_FILE", str(secret_file))
    monkeypatch.delenv("NEO4J_PASSWORD", raising=False)

    load_runtime_environment()
    assert os.environ["NEO4J_PASSWORD"] == "file-secret"

    monkeypatch.setenv("NEO4J_PASSWORD", "process-secret")
    load_runtime_environment()
    assert os.environ["NEO4J_PASSWORD"] == "process-secret"


def test_unreadable_secret_error_names_variable_not_value(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    env_file = tmp_path / "runtime.env"
    env_file.write_text("", encoding="utf-8")
    monkeypatch.setenv("LIQUIDAITY_ENV_FILE", str(env_file))
    monkeypatch.setenv("OPENAI_API_KEY_FILE", str(tmp_path / "missing-secret"))
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(RuntimeError) as error:
        load_runtime_environment()

    assert str(error.value) == "config_secret_file_unreadable: OPENAI_API_KEY_FILE"


def test_explicit_missing_env_file_fails_closed(tmp_path, monkeypatch):
    monkeypatch.setenv("LIQUIDAITY_ENV_FILE", str(tmp_path / "missing.env"))

    with pytest.raises(RuntimeError) as error:
        load_runtime_environment()

    assert str(error.value) == (
        "config_env_file_unreadable: LIQUIDAITY_ENV_FILE"
    )


def test_one_explicit_env_file_is_loaded_without_merging_neighbors(tmp_path, monkeypatch):
    selected = tmp_path / "selected.env"
    selected.write_text("OPENROUTER_API_KEY=selected-value\n", encoding="utf-8")
    (tmp_path / ".env").write_text(
        "OPENAI_API_KEY=neighbor-value\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("LIQUIDAITY_ENV_FILE", str(selected))
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    load_runtime_environment()

    assert os.environ["OPENROUTER_API_KEY"] == "selected-value"
    assert "OPENAI_API_KEY" not in os.environ
