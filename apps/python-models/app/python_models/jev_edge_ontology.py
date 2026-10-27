"""Canonical semantic edge language shared by ThinkGraph and KnowGraph.

The vocabulary describes only the directed semantic relationship A -> B.
Think/Know authority, provenance, temporal content, and pipeline control outcomes
remain owned by their provider graph paths and are intentionally absent here.
"""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Jev Decisions
# Relationship: This file defines the canonical directed relationship vocabulary, selection criteria, and schema fingerprint used by graph classification decisions.
# Entity: ThinkGraph
# Relationship: This file supplies ThinkGraph relationship normalization with the shared canonical predicate vocabulary while leaving Engraphis as writer.
# Entity: KnowGraph
# Relationship: This file supplies KnowGraph relationship classification with the same canonical predicates while leaving Graphiti facts unchanged.

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

SHARED_JEV_RELATIONSHIP_SCHEMA_HASH = hashlib.sha256(
    json.dumps(SHARED_JEV_RELATIONSHIPS, separators=(",", ":")).encode("utf-8")
).hexdigest()

if tuple(SHARED_JEV_RELATIONSHIP_CRITERIA) != SHARED_JEV_RELATIONSHIPS:
    raise RuntimeError("shared_jev_relationship_criteria_mismatch")
