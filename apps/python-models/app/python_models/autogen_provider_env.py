from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from autogen_core.models import ModelFamily
from autogen_ext.models.openai import OpenAIChatCompletionClient
from dotenv import load_dotenv
from pydantic import BaseModel


def _load_repo_env() -> None:
    env_path = Path("apps/backend/.env").resolve()
    if not env_path.exists():
        raise RuntimeError(f"backend_env_missing: required env file not found at {env_path}")
    load_dotenv(env_path, override=False)


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


def _detect_model_family(model_name: str) -> str:
    lower = str(model_name or "").strip().lower()
    if "gpt-5" in lower:
        return ModelFamily.GPT_5
    if "gpt-4o" in lower:
        return ModelFamily.GPT_4O
    if "gpt-4.1" in lower:
        return ModelFamily.GPT_41
    if lower.startswith("o4") or "/o4" in lower:
        return ModelFamily.O4
    if lower.startswith("o3") or "/o3" in lower:
        return ModelFamily.O3
    if lower.startswith("o1") or "/o1" in lower:
        return ModelFamily.O1
    if "claude-4-sonnet" in lower:
        return ModelFamily.CLAUDE_4_SONNET
    if "claude-4-opus" in lower:
        return ModelFamily.CLAUDE_4_OPUS
    if "claude-3.7-sonnet" in lower:
        return ModelFamily.CLAUDE_3_7_SONNET
    if "claude-3.5-sonnet" in lower:
        return ModelFamily.CLAUDE_3_5_SONNET
    if "claude-3.5-haiku" in lower:
        return ModelFamily.CLAUDE_3_5_HAIKU
    if "claude-3-haiku" in lower:
        return ModelFamily.CLAUDE_3_HAIKU
    if "gemini-2.5-pro" in lower:
        return ModelFamily.GEMINI_2_5_PRO
    if "gemini-2.5-flash" in lower:
        return ModelFamily.GEMINI_2_5_FLASH
    if "gemini-2.0-flash" in lower:
        return ModelFamily.GEMINI_2_0_FLASH
    if "llama-4-maverick" in lower:
        return ModelFamily.LLAMA_4_MAVERICK
    if "llama-4-scout" in lower:
        return ModelFamily.LLAMA_4_SCOUT
    if "llama-3.3-70b" in lower:
        return ModelFamily.LLAMA_3_3_70B
    if "llama-3.3-8b" in lower:
        return ModelFamily.LLAMA_3_3_8B
    if "deepseek-r1" in lower or "kimi-k2" in lower:
        return ModelFamily.R1
    return "openrouter-compatible"


def _build_model_info(model_name: str) -> dict[str, Any]:
    return {
        "vision": False,
        "function_calling": False,
        "json_output": False,
        "family": _detect_model_family(model_name),
        "structured_output": False,
        "multiple_system_messages": True,
    }


def _normalize_model_name(model_name: str) -> str:
    return str(model_name or "").strip().lower()


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
