"""Shared local-development configuration boundary for the Python rails.

``apps/backend/.env`` is the canonical local-development secret source for BOTH the Node
backend and the Python rails. This module loads it ONCE, explicitly, with PROCESS ENV
taking precedence (deployed/production secrets win over the file). There is no arbitrary
parent-directory scanning for unrelated ``.env`` files and no silent multi-file fallback;
a single non-secret bootstrap variable (``LIQUIDAITY_ENV_FILE``) may point at an explicit
file for non-default setups.

Provider modules consume the TYPED, VALUE-FREE config objects exposed here instead of
scattering ``os.getenv`` calls. No secret value ever appears on a returned public object,
exception, log line, or serialized result.
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Mapping, Optional

from dotenv import load_dotenv

# One clear, non-secret bootstrap override for the canonical env-file path.
ENV_FILE_OVERRIDE = "LIQUIDAITY_ENV_FILE"

# Alpaca endpoint defaults (host roots; paper lane only).
DEFAULT_DATA_URL = "https://data.alpaca.markets"
DEFAULT_PAPER_TRADING_URL = "https://paper-api.alpaca.markets"
DEFAULT_STREAM_URL = "wss://stream.data.alpaca.markets"
LIVE_TRADING_HOST = "api.alpaca.markets"  # rejected by the paper/read-only lane

# Readiness statuses / modes (single source of truth, re-exported by providers).
READY = "ready"
UNCONFIGURED = "unconfigured"
INVALID_CONFIG = "invalid_configuration"
MODE_PAPER = "paper"
MODE_READ_ONLY = "read_only"
MODE_UNAVAILABLE = "unavailable"

_env_loaded = False


def _canonical_env_path() -> Optional[Path]:
    override = os.environ.get(ENV_FILE_OVERRIDE, "").strip()
    if override:
        candidate = Path(override)
        return candidate if candidate.exists() else None
    # apps/backend/.env resolved from this file's repo ancestry — a single known target,
    # not a scan of arbitrary .env files.
    for base in Path(__file__).resolve().parents:
        candidate = base / "apps" / "backend" / ".env"
        if candidate.exists():
            return candidate
    return None


def ensure_env_loaded(*, force: bool = False) -> None:
    """Load the canonical backend env file once. Process env always wins (override=False)."""
    global _env_loaded
    if _env_loaded and not force:
        return
    path = _canonical_env_path()
    if path is not None:
        load_dotenv(path, override=False)
    _env_loaded = True


def _source(env: Mapping[str, str] | None) -> Mapping[str, str]:
    if env is not None:
        return env
    ensure_env_loaded()
    return os.environ


def _host_root(url: str) -> str:
    """Reduce a configured base URL to scheme://host (drop any /v2/... path suffix)."""
    raw = str(url or "").strip()
    if "://" not in raw:
        return raw
    scheme, rest = raw.split("://", 1)
    host = rest.split("/", 1)[0]
    return f"{scheme}://{host}"


# ---------------------------------------------------------------------------
# Internal credential resolution (never serialized onto a public object).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AlpacaCredentials:
    key_id: str
    secret_key: str
    data_url: str = DEFAULT_DATA_URL
    paper_trading_url: str = DEFAULT_PAPER_TRADING_URL
    stream_url: str = DEFAULT_STREAM_URL
    mode: str = MODE_PAPER  # paper | live (live rejected by the lane)


def resolve_alpaca_credentials(
    env: Mapping[str, str] | None = None,
) -> Optional[AlpacaCredentials]:
    """Resolve paper-family Alpaca credentials from the canonical env, or ``None``.

    Reads the real backend variable names (``ALPACA_API_KEY_ID``/``ALPACA_API_SECRET_KEY``
    + ``ALPACA_BASE_URL``/``ALPACA_DATA_URL``/``ALPACA_STREAM_URL``/``ALPACA_PAPER``), with
    the Alpaca SDK aliases (``APCA_*``) accepted as a fallback. A live trading host or a
    falsy ``ALPACA_PAPER`` marks mode='live' so the caller can reject it.
    """
    src = _source(env)
    key = (src.get("ALPACA_API_KEY_ID") or src.get("APCA_API_KEY_ID") or "").strip()
    secret = (
        src.get("ALPACA_API_SECRET_KEY") or src.get("APCA_API_SECRET_KEY") or ""
    ).strip()
    if not key or not secret:
        return None
    trading_base = (
        src.get("ALPACA_BASE_URL") or src.get("APCA_API_BASE_URL") or ""
    ).strip()
    data_base = (src.get("ALPACA_DATA_URL") or "").strip()
    stream_base = (src.get("ALPACA_STREAM_URL") or "").strip()
    paper_flag = (src.get("ALPACA_PAPER") or "").strip().lower()
    mode = MODE_PAPER
    live_host = LIVE_TRADING_HOST in trading_base.lower() and "paper-api" not in trading_base.lower()
    if live_host or paper_flag in ("0", "false", "no", "off"):
        mode = "live"
    return AlpacaCredentials(
        key_id=key,
        secret_key=secret,
        data_url=_host_root(data_base) or DEFAULT_DATA_URL,
        paper_trading_url=_host_root(trading_base) or DEFAULT_PAPER_TRADING_URL,
        stream_url=_host_root(stream_base) or DEFAULT_STREAM_URL,
        mode=mode,
    )


def sec_api_key(env: Mapping[str, str] | None = None) -> str:
    """Resolve the SEC API key from the canonical env. Returned only to the provider
    transport — never placed on any public result. Empty string when unconfigured."""
    return str(_source(env).get("SEC_API_KEY") or "").strip()


# ---------------------------------------------------------------------------
# Public, value-free typed config objects.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AlpacaConfig:
    readiness: str  # ready | unconfigured | invalid_configuration
    mode: str  # paper | unavailable
    tradingBaseUrl: Optional[str] = None
    dataBaseUrl: Optional[str] = None
    streamBaseUrl: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class SecApiConfig:
    readiness: str  # ready | unconfigured
    provider: str = "sec_api"

    def to_dict(self) -> dict:
        return asdict(self)


def load_alpaca_config(env: Mapping[str, str] | None = None) -> AlpacaConfig:
    """Typed, value-free Alpaca config. Paper mode only; live configuration is rejected."""
    creds = resolve_alpaca_credentials(env)
    if creds is None:
        return AlpacaConfig(readiness=UNCONFIGURED, mode=MODE_UNAVAILABLE)
    if creds.mode == "live":
        return AlpacaConfig(readiness=INVALID_CONFIG, mode=MODE_UNAVAILABLE)
    return AlpacaConfig(
        readiness=READY,
        mode=MODE_PAPER,
        tradingBaseUrl=creds.paper_trading_url,
        dataBaseUrl=creds.data_url,
        streamBaseUrl=creds.stream_url,
    )


def load_sec_api_config(env: Mapping[str, str] | None = None) -> SecApiConfig:
    """Typed, value-free SEC API config."""
    return SecApiConfig(readiness=READY if sec_api_key(env) else UNCONFIGURED)


def detect_alpaca_readiness(
    capability: str,
    env: Mapping[str, str] | None = None,
):
    """Back-compat readiness shim returning a ProviderReadiness (defined in the provider
    module). Imported lazily to avoid a circular import."""
    from app.python_models.alpaca_market_data import ProviderReadiness

    config = load_alpaca_config(env)
    if config.readiness == UNCONFIGURED:
        return ProviderReadiness(
            provider="alpaca", capability=capability, status=UNCONFIGURED,
            mode=MODE_UNAVAILABLE,
            diagnostics="paper credentials absent (ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY)",
        )
    if config.readiness == INVALID_CONFIG:
        return ProviderReadiness(
            provider="alpaca", capability=capability, status=INVALID_CONFIG,
            mode=MODE_UNAVAILABLE,
            diagnostics="live trading configuration detected; this lane is paper/read-only only",
        )
    mode = MODE_READ_ONLY if capability == "market_data" else MODE_PAPER
    return ProviderReadiness(
        provider="alpaca", capability=capability, status=READY, mode=mode,
        diagnostics="paper credentials present",
    )
