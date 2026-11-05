"""Builder writes are limited to non-core blue workers."""

# Entity: Builder Card
# Relationship: Proves Builder may create worker candidates and edit their blue membership but cannot change core system Cards or orange wires.

import pytest

from app.application_tool_error import ApplicationToolError
from app.builder_worker_policy import (
    require_builder_wire_change,
    require_builder_worker_creation,
    require_builder_worker_update,
)


def _deck():
    return {
        "nodes": [
            {"id": "card_main_chat"},
            {"id": "builder"},
            {"id": "card_team"},
            {"id": "card_magentic"},
            {"id": "worker-blue"},
            {"id": "unwired"},
        ],
        "edges": [
            {
                "id": "main-builder",
                "source": "card_main_chat",
                "target": "builder",
                "edgeType": "flow",
            },
            {
                "id": "team-blue",
                "source": "card_team",
                "target": "card_magentic",
                "edgeType": "magentic_option",
            },
            {
                "id": "worker-blue",
                "source": "card_magentic",
                "target": "worker-blue",
                "edgeType": "magentic_option",
            },
        ],
    }


def test_builder_creates_only_new_ordinary_worker_candidates():
    require_builder_worker_creation(
        "builder",
        runtime_kind="hermes",
        runtime_mode="delegate",
        runtime_profile="new-worker",
    )
    for mode, profile in (("main", "new-main"), ("delegate", "team")):
        with pytest.raises(
            ApplicationToolError,
            match="builder_can_create_only_blue_worker_candidates",
        ):
            require_builder_worker_creation(
                "builder",
                runtime_kind="hermes",
                runtime_mode=mode,
                runtime_profile=profile,
            )


def test_builder_updates_only_noncore_blue_workers():
    deck = _deck()
    require_builder_worker_update("builder", deck, "worker-blue")
    for target in ("card_main_chat", "card_team", "card_magentic", "unwired"):
        with pytest.raises(
            ApplicationToolError,
            match="builder_can_update_only_noncore_blue_workers",
        ):
            require_builder_worker_update("builder", deck, target)


def test_builder_changes_only_noncore_blue_worker_wires():
    deck = _deck()
    worker_wire = deck["edges"][2]
    require_builder_wire_change(
        "builder",
        deck,
        op="remove",
        wire={"id": "worker-blue"},
        prior=worker_wire,
        resolved_type="magentic_option",
        source="",
        target="",
    )
    with pytest.raises(ApplicationToolError, match="builder_cannot_change_core_system_wires"):
        require_builder_wire_change(
            "builder",
            deck,
            op="remove",
            wire={"id": "team-blue"},
            prior=deck["edges"][1],
            resolved_type="magentic_option",
            source="",
            target="",
        )
    with pytest.raises(ApplicationToolError, match="builder_can_change_only_blue_worker_wires"):
        require_builder_wire_change(
            "builder",
            deck,
            op="upsert",
            wire={
                "source": "builder",
                "target": "worker-blue",
                "edgeType": "flow",
            },
            prior=None,
            resolved_type="flow",
            source="builder",
            target="worker-blue",
        )
    with pytest.raises(
        ApplicationToolError,
        match="builder_new_worker_wire_is_created_with_card",
    ):
        require_builder_wire_change(
            "builder",
            deck,
            op="upsert",
            wire={
                "source": "card_magentic",
                "target": "unwired",
                "edgeType": "magentic_option",
            },
            prior=None,
            resolved_type="magentic_option",
            source="card_magentic",
            target="unwired",
        )
    with pytest.raises(
        ApplicationToolError,
        match="builder_can_update_only_noncore_blue_workers",
    ):
        require_builder_worker_update("builder", deck, "unwired")


def test_non_builder_callers_keep_their_separate_grant_contract():
    require_builder_worker_update("other-authorized-card", _deck(), "card_main_chat")
    require_builder_worker_creation(
        "other-authorized-card",
        runtime_kind="hermes",
        runtime_mode="main",
        runtime_profile="main",
    )
