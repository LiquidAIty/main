"""Product-neutral saved-Card attachment contract for external subsystems."""

from __future__ import annotations

import re
from typing import Any


CARD_SUBSYSTEM_CONTRACT_VERSION = "card-subsystem.v1"
CARD_SUBSYSTEM_CAPABILITIES = frozenset({
    "state", "events", "commands", "artifacts", "readiness",
})
_IDENTITY = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


def normalize_card_subsystems(value: Any) -> list[dict[str, Any]]:
    """Validate attachment identity/presentation without interpreting its domain."""

    if not isinstance(value, list) or len(value) > 16:
        raise ValueError("card_subsystems_list_invalid")
    result: list[dict[str, Any]] = []
    ids: set[str] = set()
    labels: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) - {
            "id", "label", "adapter", "cardTab", "configurationSchema",
        }:
            raise ValueError("card_subsystem_fields_invalid")
        subsystem_id = str(item.get("id") or "").strip()
        label = str(item.get("label") or "").strip()
        if not _IDENTITY.fullmatch(subsystem_id):
            raise ValueError("card_subsystem_id_invalid")
        if not label or len(label) > 80:
            raise ValueError("card_subsystem_label_invalid")
        if subsystem_id in ids or label.casefold() in labels:
            raise ValueError("card_subsystem_duplicate")
        adapter = item.get("adapter")
        if not isinstance(adapter, dict) or set(adapter) != {
            "kind", "contractVersion", "capabilities",
        }:
            raise ValueError("card_subsystem_adapter_invalid")
        if adapter.get("kind") != "python":
            raise ValueError("card_subsystem_adapter_kind_invalid")
        if adapter.get("contractVersion") != CARD_SUBSYSTEM_CONTRACT_VERSION:
            raise ValueError("card_subsystem_contract_invalid")
        capabilities = adapter.get("capabilities")
        if (
            not isinstance(capabilities, list)
            or not capabilities
            or len(capabilities) != len(set(capabilities))
            or any(capability not in CARD_SUBSYSTEM_CAPABILITIES for capability in capabilities)
        ):
            raise ValueError("card_subsystem_capabilities_invalid")
        card_tab = item.get("cardTab")
        if not isinstance(card_tab, dict) or set(card_tab) != {"enabled"}:
            raise ValueError("card_subsystem_card_tab_invalid")
        if not isinstance(card_tab.get("enabled"), bool):
            raise ValueError("card_subsystem_card_tab_enabled_invalid")
        configuration_schema = item.get("configurationSchema")
        if configuration_schema is not None and (
            not isinstance(configuration_schema, str)
            or not _IDENTITY.fullmatch(configuration_schema.strip())
        ):
            raise ValueError("card_subsystem_configuration_schema_invalid")
        ids.add(subsystem_id)
        labels.add(label.casefold())
        result.append({
            "id": subsystem_id,
            "label": label,
            "adapter": {
                "kind": "python",
                "contractVersion": CARD_SUBSYSTEM_CONTRACT_VERSION,
                "capabilities": list(capabilities),
            },
            "cardTab": {"enabled": card_tab["enabled"]},
            "configurationSchema": configuration_schema.strip()
            if isinstance(configuration_schema, str) else None,
        })
    return result
