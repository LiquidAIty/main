"""Canonical semantic edge language shared by ThinkGraph and KnowGraph.

The vocabulary describes only the directed semantic relationship A -> B.
Think/Know authority, provenance, temporal content, and pipeline control outcomes
remain owned by their native graph paths and are intentionally absent here.
"""
from __future__ import annotations

import hashlib
import json


SHARED_JEV_RELATIONSHIPS = (
    "IS_A",
    "PART_OF",
    "HAS_PART",
    "CAUSES",
    "AFFECTS",
    "DEPENDS_ON",
    "ENABLES",
    "CONSTRAINS",
    "REQUIRES",
    "SUPPORTS",
    "CONTRADICTS",
    "QUALIFIES",
    "EXPLAINS",
    "ASSOCIATED_WITH",
    "ALTERNATIVE_TO",
    "COMPETES_WITH",
    "PROVIDES",
    "USES",
    "PRECEDES",
    "FOLLOWS",
)

SHARED_JEV_RELATIONSHIP_CRITERIA = {
    "IS_A": "A is an instance, subtype, or category member of B.",
    "PART_OF": "A is a constituent, division, component, or member of B.",
    "HAS_PART": "A contains B as a constituent, division, component, or member.",
    "CAUSES": "A produces or brings about B.",
    "AFFECTS": "A materially influences or changes B without a stronger causal claim.",
    "DEPENDS_ON": "A relies on B as an enabling condition, input, or prerequisite.",
    "ENABLES": "A makes B possible or materially easier to achieve.",
    "CONSTRAINS": "A limits, bounds, or restricts B.",
    "REQUIRES": "A explicitly needs B for its stated condition or outcome.",
    "SUPPORTS": "A provides evidence, resources, or conditions that strengthen B.",
    "CONTRADICTS": "A and B express materially incompatible claims, states, or requirements.",
    "QUALIFIES": "A narrows, conditions, or clarifies B without replacing it.",
    "EXPLAINS": "A gives a reason, mechanism, or interpretation for B.",
    "ASSOCIATED_WITH": "A and B have a meaningful relationship not captured more specifically.",
    "ALTERNATIVE_TO": "A is a distinct substitute or alternative option for B.",
    "COMPETES_WITH": "A and B compete in a market, contract, capability, or objective.",
    "PROVIDES": "A furnishes B as a product, service, resource, or capability.",
    "USES": "A employs B as a tool, input, platform, or resource.",
    "PRECEDES": "A occurs or applies before B in time or an explicit sequence.",
    "FOLLOWS": "A occurs or applies after B in time or an explicit sequence.",
}

SHARED_JEV_RELATIONSHIP_SCHEMA_VERSION = "jev.semantic-relationships.v1"
SHARED_JEV_RELATIONSHIP_SCHEMA_HASH = hashlib.sha256(
    json.dumps(SHARED_JEV_RELATIONSHIPS, separators=(",", ":")).encode("utf-8")
).hexdigest()

if tuple(SHARED_JEV_RELATIONSHIP_CRITERIA) != SHARED_JEV_RELATIONSHIPS:
    raise RuntimeError("shared_jev_relationship_criteria_mismatch")
