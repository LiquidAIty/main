"""Config-provenance coverage for the shared typed provider config boundary.

These tests are deterministic (explicit env mappings or a temp env file) and never read
or assert on real secret values — only presence and readiness.
"""

import json
import os

from app.python_models.provider_config import (
    ENV_FILE_OVERRIDE,
    INVALID_CONFIG,
    MODE_PAPER,
    READY,
    UNCONFIGURED,
    _canonical_env_path,
    ensure_env_loaded,
    load_alpaca_config,
    load_sec_api_config,
    resolve_alpaca_credentials,
)


def test_canonical_path_targets_backend_env_only():
    os.environ.pop(ENV_FILE_OVERRIDE, None)
    path = _canonical_env_path()
    # Either resolves to the single known target or None — never an arbitrary .env scan.
    assert path is None or path.as_posix().endswith("apps/backend/.env")


def test_alpaca_config_ready_with_paper_keys():
    env = {
        "ALPACA_API_KEY_ID": "k",
        "ALPACA_API_SECRET_KEY": "s",
        "ALPACA_PAPER": "1",
        "ALPACA_BASE_URL": "https://paper-api.alpaca.markets/v2",
    }
    config = load_alpaca_config(env)
    assert config.readiness == READY and config.mode == MODE_PAPER


def test_alpaca_config_rejects_live_base_url():
    env = {"ALPACA_API_KEY_ID": "k", "ALPACA_API_SECRET_KEY": "s", "ALPACA_BASE_URL": "https://api.alpaca.markets/v2"}
    assert load_alpaca_config(env).readiness == INVALID_CONFIG


def test_alpaca_config_rejects_paper_disabled():
    env = {"ALPACA_API_KEY_ID": "k", "ALPACA_API_SECRET_KEY": "s", "ALPACA_PAPER": "0"}
    assert load_alpaca_config(env).readiness == INVALID_CONFIG


def test_alpaca_config_unconfigured_without_keys():
    assert load_alpaca_config({}).readiness == UNCONFIGURED


def test_sec_config_presence_only():
    assert load_sec_api_config({"SEC_API_KEY": "x"}).readiness == READY
    assert load_sec_api_config({}).readiness == UNCONFIGURED


def test_explicit_env_mapping_is_used_verbatim():
    # An explicit env mapping (the process-env analog) is honored directly; precedence
    # over the file is via load_dotenv(override=False) in ensure_env_loaded.
    creds = resolve_alpaca_credentials({"ALPACA_API_KEY_ID": "x", "ALPACA_API_SECRET_KEY": "y"})
    assert creds is not None and creds.mode == MODE_PAPER


def test_env_file_override_loads_that_exact_file_only(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "ALPACA_API_KEY_ID=fake_kid\nALPACA_API_SECRET_KEY=fake_secret\nALPACA_PAPER=1\n",
        encoding="utf-8",
    )
    os.environ[ENV_FILE_OVERRIDE] = str(env_file)
    try:
        ensure_env_loaded(force=True)
        # presence only — loaded from the one explicit file, no second .env scanned
        assert os.environ.get("ALPACA_API_KEY_ID")  # truthy
        assert load_alpaca_config().readiness == READY
    finally:
        os.environ.pop(ENV_FILE_OVERRIDE, None)
        for key in ("ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY", "ALPACA_PAPER"):
            os.environ.pop(key, None)
        ensure_env_loaded(force=True)  # restore canonical load


def test_public_config_never_carries_secret_values():
    env = {"ALPACA_API_KEY_ID": "SECRETKID", "ALPACA_API_SECRET_KEY": "SECRETVAL", "SEC_API_KEY": "SECKEY"}
    blob = json.dumps(load_alpaca_config(env).to_dict()) + json.dumps(load_sec_api_config(env).to_dict())
    assert "SECRETKID" not in blob and "SECRETVAL" not in blob and "SECKEY" not in blob
