# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Jev Decisions
# Relationship: This file verifies graph relationship decisions reuse one canonical predicate vocabulary while retaining provider-local control outcomes.
# Entity: ThinkGraph
# Relationship: This file verifies ThinkGraph imports the exact shared relationship tuple.
# Entity: KnowGraph
# Relationship: This file verifies KnowGraph appends only its nonpersisted insufficient-context outcome to the shared relationship tuple.

from app.python_models import knowgraph_jev, thinkgraph_relationship_vocabulary
from app.python_models.jev_edge_ontology import SHARED_JEV_RELATIONSHIPS


EXPECTED_SHARED_RELATIONSHIPS = (
    "IS_A", "PART_OF", "HAS_PART", "CAUSES", "AFFECTS", "DEPENDS_ON",
    "ENABLES", "CONSTRAINS", "REQUIRES", "SUPPORTS", "CONTRADICTS",
    "QUALIFIES", "EXPLAINS", "ASSOCIATED_WITH", "ALTERNATIVE_TO",
    "COMPETES_WITH", "PROVIDES", "USES", "PRECEDES", "FOLLOWS",
)


def test_graph_twins_share_the_same_seed_twenty_and_control_outcomes_stay_local() -> None:
    assert SHARED_JEV_RELATIONSHIPS == EXPECTED_SHARED_RELATIONSHIPS
    assert (
        thinkgraph_relationship_vocabulary.SHARED_JEV_RELATIONSHIPS
        is SHARED_JEV_RELATIONSHIPS
    )
    assert knowgraph_jev.SHARED_JEV_RELATIONSHIPS is SHARED_JEV_RELATIONSHIPS
    assert knowgraph_jev.KNOWGRAPH_JEV_CHOICES[:20] == SHARED_JEV_RELATIONSHIPS
    assert knowgraph_jev.KNOWGRAPH_JEV_CHOICES[20:] == ("INSUFFICIENT_CONTEXT",)
