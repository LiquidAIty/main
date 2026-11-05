# Entity: Project Knowledge Graph
# Relationship: This file verifies the shared graph-reference schema preserves an optional exact Engraphis relationship identity.

from __future__ import annotations

from app.python_models.graph_reference_contracts import (
    GraphRecordReference,
)


def test_generic_graph_output_retains_engraphis_relationship_identity() -> None:
    reference = GraphRecordReference(
        engraphisRelationshipId="relationship-one",
    )

    assert reference.engraphisRelationshipId == "relationship-one"
