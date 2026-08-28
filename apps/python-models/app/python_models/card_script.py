"""Saved Card Script placeholder; authoring and safe execution are deferred.

Enabled Scripts fail before graph reads or IDF materialization. No executor,
language tooling, model call, tool call, or IDF writer belongs to this module.
"""
from __future__ import annotations

from hashlib import sha256
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.python_models.idd import IddValidationError

SCRIPT_UNAVAILABLE = "card_script_isolated_native_execution_unavailable"


class CardScript(BaseModel):
    """Optional data in the existing saved Card runtime-extension field."""
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool = False
    source: str = Field(default="", max_length=32_768)
    version: int = Field(default=1, ge=1)
    sourceHash: str = ""
    paletteFingerprint: str = ""
    lastValidation: dict[str, Any] = Field(default_factory=dict)
    nativeSupport: dict[str, Any] = Field(default_factory=dict)


def saved_script(value: Any) -> dict[str, Any]:
    try:
        script = CardScript.model_validate(value)
    except ValidationError as error:
        raise IddValidationError("card_script_configuration_invalid") from error
    # Source identity/support only; these fields never authenticate code.
    script.sourceHash = sha256(script.source.encode("utf-8")).hexdigest()
    script.lastValidation = {"status": "unvalidated", "executionTested": False}
    script.nativeSupport = {"available": False, "reason": SCRIPT_UNAVAILABLE}
    return script.model_dump()


def assert_script_execution_available(value: Any) -> None:
    if value is None:
        return
    script = saved_script(value)
    if script["enabled"]:
        raise IddValidationError(SCRIPT_UNAVAILABLE)
