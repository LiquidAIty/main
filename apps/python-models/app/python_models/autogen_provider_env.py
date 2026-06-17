from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from autogen_core.models import ModelFamily
from autogen_ext.models.openai import OpenAIChatCompletionClient
from dotenv import load_dotenv
from pydantic import BaseModel


def _load_repo_env() -> None:
    # The Python rails starts with CWD apps/python-models (npm run dev:autogen),
    # so resolve apps/backend/.env from both CWD and the repo root above this file.
    candidates = [Path.cwd(), *Path(__file__).resolve().parents]
    for base in candidates:
        env_path = base / "apps" / "backend" / ".env"
        if env_path.exists():
            load_dotenv(env_path, override=False)
            return


_load_repo_env()


class AutoGenAgentConfig(BaseModel):
    provider: str
    provider_model_id: str
    system_prompt: str = ""
    temperature: float | None = None
    max_tokens: int | None = None


MAGENTIC_SAFE_OPENROUTER_PREFIXES = (
    "openai/gpt-5.1-chat",
    "openai/gpt-5.1-chat-",
)
MAGENTIC_SAFE_OPENAI_PREFIXES = (
    "gpt-5.1-chat",
    "gpt-5.1-chat-",
    "gpt-5.1-chat-latest",
)

# Model name fragments whose real APIs support OpenAI-style function calling
# and JSON mode. autogen-core 0.4.4 enforces these flags loudly: a model
# without function_calling cannot receive tools, and a model without
# json_output cannot serve the Magentic-One ledger.
_OPENAI_TOOL_CAPABLE_FRAGMENTS = (
    "gpt-4",
    "gpt-4o",
    "gpt-4.1",
    "gpt-5",
    "o1",
    "o3",
    "o4",
)


def _normalize_model_name(model_name: str) -> str:
    return str(model_name or "").strip().lower()


def _detect_model_family(model_name: str) -> str:
    # autogen-core 0.4.4 only knows GPT_35 / GPT_4 / GPT_4O / O1 / UNKNOWN.
    lower = _normalize_model_name(model_name)
    if "gpt-4o" in lower:
        return ModelFamily.GPT_4O
    if lower.startswith("o1") or "/o1" in lower:
        return ModelFamily.O1
    if "gpt-4" in lower:
        return ModelFamily.GPT_4
    if "gpt-3.5" in lower or "gpt-35" in lower:
        return ModelFamily.GPT_35
    return ModelFamily.UNKNOWN


def _supports_tools_and_json(model_name: str) -> bool:
    lower = _normalize_model_name(model_name)
    bare = lower.split("/", 1)[-1]
    return any(bare.startswith(fragment) or f"-{fragment}" in bare for fragment in _OPENAI_TOOL_CAPABLE_FRAGMENTS)


def _build_model_info(model_name: str) -> dict[str, Any]:
    capable = _supports_tools_and_json(model_name)
    return {
        "vision": False,
        "function_calling": capable,
        "json_output": capable,
        "family": _detect_model_family(model_name),
    }


def _requires_max_completion_tokens(provider: str, model_name: str) -> bool:
    normalized_provider = str(provider or "").strip().lower()
    normalized_model = _normalize_model_name(model_name)
    return normalized_provider == "openai" and normalized_model.startswith("gpt-5")


def _assert_magentic_safe_model(config: AutoGenAgentConfig) -> None:
    provider = str(config.provider or "").strip().lower()
    model_name = _normalize_model_name(config.provider_model_id)
    if provider == "openrouter":
        if any(model_name.startswith(prefix) for prefix in MAGENTIC_SAFE_OPENROUTER_PREFIXES):
            return
    elif provider == "openai":
        if any(model_name.startswith(prefix) for prefix in MAGENTIC_SAFE_OPENAI_PREFIXES):
            return

    raise RuntimeError(
        "magentic_model_not_approved: "
        f"provider={provider or 'unknown'} model={config.provider_model_id or 'unknown'} "
        "allowed=openrouter:openai/gpt-5.1-chat*,openai:gpt-5.1-chat*"
    )


def _build_model_client(config: AutoGenAgentConfig) -> OpenAIChatCompletionClient:
    provider = str(config.provider or "").strip().lower()
    model_name = str(config.provider_model_id or "").strip()
    if not provider or not model_name:
        raise RuntimeError(
            f"card_model_config_missing: provider={provider or 'missing'} model={model_name or 'missing'}"
        )
    if provider == "default" or model_name.lower() == "default":
        raise RuntimeError(
            f"card_model_config_default_forbidden: provider={provider} model={model_name}"
        )
    temperature = config.temperature if config.temperature is not None else 0.2

    max_tokens = config.max_tokens
    if max_tokens is not None:
        try:
            max_tokens = int(max_tokens)
            if max_tokens <= 0:
                print(f"normalized invalid maxTokens value {max_tokens} -> provider default")
                max_tokens = None
        except (ValueError, TypeError):
            print(f"normalized invalid maxTokens value {max_tokens} -> provider default")
            max_tokens = None

    if provider == "openrouter":
        api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("OPENROUTER_API_KEY is required for AutoGen provider execution")
        base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").strip()
        kwargs: dict[str, Any] = {
            "model": model_name,
            "api_key": api_key,
            "base_url": base_url,
            "model_info": _build_model_info(model_name),
            "temperature": temperature,
        }
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens
        return OpenAIChatCompletionClient(**kwargs)

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for AutoGen provider execution")
        kwargs: dict[str, Any] = {
            "model": model_name,
            "api_key": api_key,
            "model_info": _build_model_info(model_name),
        }
        if _requires_max_completion_tokens(provider, model_name):
            if max_tokens is not None:
                kwargs["max_completion_tokens"] = max_tokens
        else:
            kwargs["temperature"] = temperature
            if max_tokens is not None:
                kwargs["max_tokens"] = max_tokens
        base_url = os.getenv("OPENAI_BASE_URL", "").strip()
        if base_url:
            kwargs["base_url"] = base_url
        return OpenAIChatCompletionClient(**kwargs)

    raise RuntimeError(f"Unsupported AutoGen provider: {provider or 'unknown'}")
