from __future__ import annotations

import os

import pytest

from runtime_config import load_runtime_environment


def test_file_backed_secret_and_process_precedence(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
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
    monkeypatch.setenv("OPENAI_API_KEY_FILE", str(tmp_path / "missing-secret"))
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(RuntimeError) as error:
        load_runtime_environment()

    assert str(error.value) == "config_secret_file_unreadable: OPENAI_API_KEY_FILE"
