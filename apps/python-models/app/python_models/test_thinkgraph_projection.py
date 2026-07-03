"""Focused ThinkGraphProjectionV1 assembly coverage (pure — no DB, no fixtures
persisted anywhere). Row dicts below mirror the exact map shape the AGE queries
in thinkgraph_projection.read_projection return."""

from app.python_models.thinkgraph_projection import SCHEMA_VERSION, assemble_projection

RESOURCES = [
    {
        "id": "hyp_gemma_validation_gate",
        "label": "Gemma semantic worker validation-gate hypothesis",
        "kind": "resource",
        "turn_id": "tg:msg_1040",
        "conversation_id": "spec-front-door-proof",
        "user_message_id": "msg_da7f",
        "assistant_message_id": "msg_1040",
        "card_id": "card_thinkgraph_agent",
        "correlation_id": "tg:msg_1040",
        "updated_at": "2026-07-03T01:31:28.982Z",
    },
    {
        "id": "concept_training_signal_records",
        "label": "TrainingSignal records dependency",
        "kind": "resource",
        "correlation_id": "tg:msg_1040",
    },
]

STATEMENTS = [
    {
        "id": "stmt_gemma_hyp",
        "subject": "hyp_gemma_validation_gate",
        "predicate_term": "depends_on",
        "object": "concept_training_signal_records",
        "review": "provisional",
        "rationale": "Validation gate depends on TrainingSignal records.",
        "turn_id": "tg:msg_1040",
        "correlation_id": "tg:msg_1040",
        "card_id": "card_thinkgraph_agent",
    },
]

RELATIONS = [
    {
        "from": "concept_training_signal_records",
        "to": "hyp_gemma_validation_gate",
        "predicate": "co_occurred_with",
        "observation_count": 1,
        "card_id": "card_thinkgraph_agent",
        "correlation_id": "tg:msg_1040",
    },
]


def test_real_stored_ids_labels_kinds_and_provenance_are_preserved():
    projection = assemble_projection("proj-1", RESOURCES, STATEMENTS, RELATIONS)
    assert projection["schemaVersion"] == SCHEMA_VERSION
    assert projection["projectId"] == "proj-1"

    by_id = {n["id"]: n for n in projection["nodes"]}
    resource = by_id["hyp_gemma_validation_gate"]
    assert resource["label"] == "Gemma semantic worker validation-gate hypothesis"
    assert resource["kind"] == "resource"
    assert resource["sourceRef"] == "tg:msg_1040"
    assert resource["visual"] == {"nodeClass": "resource", "x": None, "y": None}
    assert resource["provenance"] == {
        "conversationId": "spec-front-door-proof",
        "userMessageId": "msg_da7f",
        "assistantMessageId": "msg_1040",
        "cardId": "card_thinkgraph_agent",
        "correlationId": "tg:msg_1040",
        "updatedAt": "2026-07-03T01:31:28.982Z",
    }

    statement = by_id["stmt_gemma_hyp"]
    assert statement["kind"] == "statement"
    assert statement["label"] == "Validation gate depends on TrainingSignal records."
    assert statement["visual"]["nodeClass"] == "statement"
    assert statement["provenance"]["review"] == "provisional"


def test_real_source_target_and_predicates_preserved_on_edges():
    projection = assemble_projection("proj-1", RESOURCES, STATEMENTS, RELATIONS)
    by_id = {e["id"]: e for e in projection["edges"]}

    subj = by_id["stmt_gemma_hyp|subj"]
    assert subj["source"] == "hyp_gemma_validation_gate"
    assert subj["target"] == "stmt_gemma_hyp"
    assert subj["predicate"] == "depends_on"
    assert subj["visual"] == {"edgeClass": "semantic_relation", "directed": True}

    obj = by_id["stmt_gemma_hyp|obj"]
    assert obj["source"] == "stmt_gemma_hyp"
    assert obj["target"] == "concept_training_signal_records"

    co = by_id["concept_training_signal_records|co|hyp_gemma_validation_gate"]
    assert co["predicate"] == "co_occurred_with"
    assert co["visual"] == {"edgeClass": "co_occurrence", "directed": False}
    assert co["provenance"]["observationCount"] == 1


def test_nothing_is_invented_and_dangling_references_are_dropped_only():
    projection = assemble_projection("proj-1", RESOURCES, STATEMENTS, RELATIONS)
    # exactly: 2 resources + 1 statement nodes; 2 statement-endpoint edges + 1 co-occurrence
    assert len(projection["nodes"]) == 3
    assert len(projection["edges"]) == 3
    ids = [n["id"] for n in projection["nodes"]] + [e["id"] for e in projection["edges"]]
    assert len(set(ids)) == len(ids)  # no merging, no duplication

    # A statement whose stored subject points at a resource NOT in this project
    # slice renders its node but not the dangling edge (Cytoscape rejects it).
    dangling = [{"id": "stmt_x", "subject": "ghost", "predicate_term": "asks_about", "object": "hyp_gemma_validation_gate"}]
    projection2 = assemble_projection("proj-1", RESOURCES, dangling, [])
    edge_ids = [e["id"] for e in projection2["edges"]]
    assert "stmt_x|subj" not in edge_ids
    assert "stmt_x|obj" in edge_ids

    # Relations between unknown endpoints are dropped, never fabricated around.
    projection3 = assemble_projection("proj-1", RESOURCES, [], [{"from": "ghost", "to": "hyp_gemma_validation_gate"}])
    assert projection3["edges"] == []


def test_unknown_kinds_and_predicates_get_explicit_unknown_classes_preserving_originals():
    odd_resource = [{"id": "n1", "label": "N1", "kind": "future_kind"}]
    projection = assemble_projection("proj-1", odd_resource, [], [])
    node = projection["nodes"][0]
    assert node["kind"] == "future_kind"  # original preserved
    assert node["visual"]["nodeClass"] == "unknown_node"

    no_predicate_statement = [{"id": "st1", "subject": "n1", "predicate_term": "", "object": ""}]
    projection2 = assemble_projection("proj-1", odd_resource, no_predicate_statement, [])
    edge = next(e for e in projection2["edges"] if e["id"] == "st1|subj")
    assert edge["visual"]["edgeClass"] == "unknown_relation"
    assert "predicate" not in edge  # nothing invented


def test_empty_rows_produce_an_honest_empty_projection():
    projection = assemble_projection("proj-1", [], [], [])
    assert projection == {
        "schemaVersion": SCHEMA_VERSION,
        "projectId": "proj-1",
        "nodes": [],
        "edges": [],
    }
