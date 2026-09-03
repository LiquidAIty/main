from __future__ import annotations

import pytest

from app.python_models.card_subsystem import normalize_card_subsystems


def test_normalizes_product_neutral_python_attachment() -> None:
    value = [{
        "id": "lumibot",
        "label": "LumiBot",
        "adapter": {
            "kind": "python",
            "contractVersion": "card-subsystem.v1",
            "capabilities": ["state", "events", "commands", "artifacts", "readiness"],
        },
        "cardTab": {"enabled": True},
        "configurationSchema": "trading.card.v1",
    }]

    assert normalize_card_subsystems(value) == value


def test_rejects_unknown_capability_without_domain_inference() -> None:
    with pytest.raises(ValueError, match="card_subsystem_capabilities_invalid"):
        normalize_card_subsystems([{
            "id": "system",
            "label": "System",
            "adapter": {
                "kind": "python",
                "contractVersion": "card-subsystem.v1",
                "capabilities": ["place_live_order"],
            },
            "cardTab": {"enabled": True},
        }])
