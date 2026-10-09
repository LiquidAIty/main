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
