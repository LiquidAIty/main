"""Focused thinkgraph.projection.v1 assembly coverage (pure — no DB, no
fixtures persisted anywhere). Row dicts below mirror the exact map shape the
AGE queries in thinkgraph_projection.read_projection return. One direct
graph model: nouns (Resource) and verb-phrase relationships (Statement) only
— no lifecycle, no frame, no kind/tag vocabulary in the returned shape.
Mechanics only — synthetic rows are never product proof."""

from app.python_models.thinkgraph_projection import SCHEMA_VERSION, assemble_projection

# Mirrors "ASTS may depend on SpaceX launch services" plus a repeated-mention
# entity (mention_count > 1 from prior turns) and an unreferenced older noun.
RESOURCES = [
    {"id": "asts", "label": "ASTS", "mention_count": 3, "last_mentioned_at": "2026-07-04T00:00:00Z", "properties": {"ticker": "ASTS", "volatility": "high"}},
    {"id": "spacex_launch_services", "label": "SpaceX launch services", "mention_count": 1, "last_mentioned_at": "2026-07-04T00:00:00Z"},
    {"id": "rdw", "label": "RDW", "mention_count": 0},
    {"id": "unreferenced", "label": "Older noun no statement references"},
]

STATEMENTS = [
    {
        "id": "st_asts_depends_on_spacex",
        "subject": "asts",
        "predicate_term": "may depend on",
        "object": "spacex_launch_services",
        "mention_count": 2,
        "last_mentioned_at": "2026-07-04T00:00:00Z",
        "properties": {"source": "working project reasoning"},
    },
    # Referenced but the object was never in RESOURCES — the renderer skips
    # this with a reason; Python passes it through unfiltered.
    {"id": "st_dangling", "subject": "rdw", "predicate_term": "is affected by", "object": "contract_awards"},
]


def build():
    return assemble_projection("proj-1", RESOURCES, STATEMENTS)


def test_schema_and_project_id():
    projection = build()
    assert projection["schemaVersion"] == SCHEMA_VERSION
    assert projection["projectId"] == "proj-1"


def test_no_lifecycle_kind_or_class_vocabulary_anywhere():
    projection = build()
    for banned in ("kind", "tag", "activeFrame", "frame", "presentation", "visual", "nodeClass", "edgeClass", "directed"):
        assert banned not in json_keys(projection)


def json_keys(value) -> set:
    keys: set = set()
    if isinstance(value, dict):
        keys |= set(value.keys())
        for v in value.values():
            keys |= json_keys(v)
    elif isinstance(value, list):
        for v in value:
            keys |= json_keys(v)
    return keys


def test_resources_become_ordinary_nodes_with_mention_and_properties():
    projection = build()
    by_id = {n["id"]: n for n in projection["nodes"]}
    asts = by_id["asts"]
    assert asts["label"] == "ASTS"
    assert asts["mentionCount"] == 3
    assert asts["provenanceCount"] == 3
    assert asts["lastMentionedAt"] == "2026-07-04T00:00:00Z"
    assert asts["properties"] == {"ticker": "ASTS", "volatility": "high"}

    rdw = by_id["rdw"]
    assert rdw["mentionCount"] == 0
    assert rdw["properties"] == {}
    assert "lastMentionedAt" not in rdw  # never mentioned yet — nothing invented

    # Exactly one node per returned resource row.
    assert len(projection["nodes"]) == len(RESOURCES)


def test_statements_become_direct_verb_phrase_edges_never_their_own_node():
    projection = build()
    node_ids = {n["id"] for n in projection["nodes"]}
    for st in STATEMENTS:
        assert st["id"] not in node_ids

    by_id = {e["id"]: e for e in projection["edges"]}
    depends = by_id["st_asts_depends_on_spacex"]
    assert depends["source"] == "asts"
    assert depends["target"] == "spacex_launch_services"
    assert depends["predicate"] == "may depend on"  # full verb phrase preserved verbatim
    assert depends["mentionCount"] == 2
    assert depends["provenanceCount"] == 2
    assert depends["properties"] == {"source": "working project reasoning"}


def test_dangling_statement_endpoint_is_still_returned_python_does_not_pre_filter():
    # Python is not the endpoint-validity authority — the renderer already
    # owns skip-with-reason reporting. Python passes real stored data through.
    projection = build()
    by_id = {e["id"]: e for e in projection["edges"]}
    dangling = by_id["st_dangling"]
    assert dangling["source"] == "rdw"
    assert dangling["target"] == "contract_awards"
    assert dangling["mentionCount"] == 0
    assert dangling["properties"] == {}


def test_co_occurrence_is_not_part_of_this_projection():
    # assemble_projection takes only resources + statements now — there is no
    # parameter slot for co-occurrence relations at all in this projection.
    import inspect

    params = list(inspect.signature(assemble_projection).parameters)
    assert params == ["project_id", "resource_rows", "statement_rows"]


def test_no_label_text_parsing_only_stored_fields_are_returned():
    # Even a label shouting "evidence gap" stays exactly what it says — no
    # derived category, no invented kind.
    resources = [{"id": "n1", "label": "EvidenceGaps_Unknown_Confirmed"}]
    projection = assemble_projection("proj-1", resources, [])
    node = projection["nodes"][0]
    assert node["label"] == "EvidenceGaps_Unknown_Confirmed"  # untouched
    assert set(node.keys()) == {"id", "label", "mentionCount", "properties", "provenanceCount"}


def test_empty_rows_produce_an_honest_empty_projection():
    projection = assemble_projection("proj-1", [], [])
    assert projection == {
        "schemaVersion": SCHEMA_VERSION,
        "projectId": "proj-1",
        "nodes": [],
        "edges": [],
    }
