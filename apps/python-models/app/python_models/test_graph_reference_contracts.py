from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.python_models.graph_reference_contracts import (
    DATA_ANCHOR_ID_FIELDS,
    DataAnchorReference,
    GraphRecordReference,
)


def test_generic_graph_output_retains_engraphis_relationship_identity() -> None:
    reference = GraphRecordReference(
        engraphisRelationshipId="relationship-one",
    )

    assert reference.engraphisRelationshipId == "relationship-one"


def test_selected_data_anchor_excludes_engraphis_relationship_identity() -> None:
    assert "engraphisRelationshipId" not in DATA_ANCHOR_ID_FIELDS
    with pytest.raises(ValidationError):
        DataAnchorReference.model_validate({
            "engraphisRelationshipId": "relationship-one",
            "reason": "Not a selectable direct record.",
            "priority": 0,
            "boundedExpansion": 0,
            "resultLimit": 1,
            "required": True,
        })
