from __future__ import annotations

import pytest
from pydantic import ValidationError
from app.python_models.idd import IddValidationError, load_input_data_dictionary, materialize_card_editor, template_objects
from app.python_models.tool_registry import materialize_tool_catalog, required_tool_caller_runtime
from app.python_models.card_script import saved_script, assert_script_execution_available
from app.python_models.orchestration_contracts import HermesRuntime


def test_literal_idd_is_the_only_loaded_builder_data() -> None:
    dictionary = load_input_data_dictionary()
    assert dictionary["dictionary"]["name"] == "LiquidAIty"
    assert dictionary["dictionary"]["purpose"] == "agent-builder"
    assert dictionary["dictionary"]["ordinaryText"] == "markdown"
    assert {"types", "objects", "templates", "relationships", "operations"}.issubset(dictionary)
    assert {"records", "catalogs", "models", "editorFields", "islands", "toolGroups"}.isdisjoint(dictionary)
    assert dictionary["types"]["GraphReference"]["source"].endswith(".NativeReference")
    assert template_objects(dictionary, "template_local_coder") == template_objects(dictionary, "template_assist")


def test_markdown_and_sql_are_data_not_a_second_island_language() -> None:
    from app.python_models import idd
    assert not hasattr(idd, "validate_input_islands")
    source = 'query = "SELECT title WHERE id = :id"\n# ordinary Markdown and SQL stay inert'
    saved = saved_script({"source": source})
    assert saved["source"] == source
    assert saved["lastValidation"]["executionTested"] is False


def test_unknown_future_objects_remain_absent_until_declared() -> None:
    palette = materialize_card_editor([])
    assert "future_native" not in palette["objects"]
    assert "future_native" not in template_objects(palette, "template_assist")


def test_runtime_errors_remain_at_the_executable_contract() -> None:
    secret = "sk-secret-that-must-never-appear"
    with pytest.raises(ValidationError):
        HermesRuntime.model_validate({"kind": "hermes", "mode": secret, "profile": "coder"})
    with pytest.raises(IddValidationError) as error:
        saved_script({"enabled": secret, "source": secret})
    assert str(error.value) == "card_script_configuration_invalid"
    assert secret not in str(error.value)


def test_script_storage_is_inert_and_execution_fails_closed() -> None:
    script = saved_script({"source": "not valid Python is inert", "version": 2})
    assert script["source"] == "not valid Python is inert"
    assert script["version"] == 2
    assert script["lastValidation"] == {"status": "unvalidated", "executionTested": False}
    assert script["nativeSupport"]["available"] is False
    with pytest.raises(IddValidationError, match="card_script_isolated_native_execution_unavailable"):
        assert_script_execution_available({"enabled": True, "source": "return InvocationPreparation()"})
    assert_script_execution_available(None)
    assert_script_execution_available({"enabled": False, "source": "not valid Python is inert"})


def test_card_editor_projects_current_models_and_executable_bounds() -> None:
    materialized = materialize_card_editor([{
        "provider": "openrouter", "key": "provider/model", "label": "Provider Model",
        "providerModelId": "provider/model", "default": False,
    }])
    assert materialized["catalogs"]["configured-models"][0]["key"] == "provider/model"
    fields = {field["name"]: field for field in materialized["fields"]}
    assert fields["modelKey"]["catalog"] == "configured-models"
    assert fields["tools"]["catalog"] == "native-tools"
    assert [item["value"] for item in fields["runtimeMode"]["options"]] == [
        "main", "delegate", "kanban", "assistant", "magentic_one",
    ]
    assert fields["temperature"]["minimum"] == 0.0
    assert fields["maxTokens"]["minimum"] == 1


def test_live_mcp_contract_is_ingested_into_the_one_permanent_idd_vocabulary() -> None:
    annotations = {"readOnlyHint": True, "destructiveHint": False}
    security = [{"type": "oauth2", "scopes": ["liquidaity.main"]}]
    references = materialize_tool_catalog([{
        "name": "cbm.search_graph",
        "kind": "tool",
        "namespace": "cbm",
        "sourceId": "cbm",
        "nativeName": "search_graph",
        "connectionKind": "external-mcp",
        "description": "Native search description.",
        "inputSchema": {"type": "object", "properties": {"project": {"type": "string"}}},
        "outputSchema": {"type": "object"},
        "annotations": annotations,
        "securitySchemes": security,
    }])
    by_id = {reference["canonicalId"]: reference for reference in references}

    assert "cbm.search_graph" in by_id
    assert "graphiti.search_nodes" in by_id
    assert by_id["graphiti.search_nodes"]["availability"] == "disabled"
    live = by_id["cbm.search_graph"]
    assert live["availability"] == "available"
    assert live["access"] == "read"
    assert live["contracts"] == [{
        "sourceId": "cbm",
        "nativeName": "search_graph",
        "connectionKind": "external-mcp",
        "available": True,
        "description": "Native search description.",
        "inputSchema": {"type": "object", "properties": {"project": {"type": "string"}}},
        "outputSchema": {"type": "object"},
        "annotations": annotations,
        "securitySchemes": security,
    }]


def test_native_side_effect_annotations_do_not_redefine_idd_read_availability():
    from app.python_models.tool_registry import readable_tool_ids

    references = materialize_tool_catalog([{
        "name": "engraphis.recall", "namespace": "engraphis", "sourceId": "engraphis",
        "nativeName": "engraphis_recall", "connectionKind": "external-mcp",
        "inputSchema": {"type": "object"}, "annotations": {"readOnlyHint": False},
    }])
    recall = next(item for item in references if item["canonicalId"] == "engraphis.recall")
    assert recall["access"] == "read"
    assert recall["contracts"][0]["annotations"] == {"readOnlyHint": False}
    assert "engraphis.recall" in readable_tool_ids()


def test_engraphis_code_projection_is_operator_only_without_removing_declarations():
    from app.python_models.tool_registry import external_mcp_tool_ids, readable_tool_ids, writable_tool_ids

    admin = {f"engraphis.{name}" for name in (
        "export_code_graph", "index_repo", "search_code", "code_path", "code_impact",
    )}
    references = {item["canonicalId"]: item for item in materialize_tool_catalog([])}
    assert admin.issubset(references)
    assert all(references[name]["publication"] == "private-admin" for name in admin)
    assert all(references[name]["availability"] == "disabled" for name in admin)
    assert admin.isdisjoint(external_mcp_tool_ids() | readable_tool_ids() | writable_tool_ids())
    assert {"cbm.search_graph", "cbm.search_code", "engraphis.recall"}.issubset(readable_tool_ids())


def test_explicit_tool_permissions_come_from_the_idd() -> None:
    dictionary = load_input_data_dictionary()
    tool_names = {
        tool["id"] for tool in dictionary["operations"]
    }
    assert {"agentgraph.inspect", "run_mag_one"}.issubset(tool_names)
    assert required_tool_caller_runtime("run_mag_one") == {"kind": "hermes", "mode": "main"}
    assert required_tool_caller_runtime("cbm.search_graph") is None
    from app.python_models.tool_registry import readable_tool_ids, writable_tool_ids
    assert "cbm.search_graph" in readable_tool_ids()
    assert "cbm.index_repository" in writable_tool_ids()
    assert "write_mag_one_instructions" in writable_tool_ids()
    assert "card.load_graph_references" in writable_tool_ids()
    assert "write_mag_one_instructions" not in readable_tool_ids()


def test_materialized_catalog_errors_do_not_echo_secret_values() -> None:
    secret = "sk-secret-that-must-never-appear"
    try:
        materialize_card_editor([{"provider": secret}])
    except IddValidationError as error:
        assert str(error) == "model_catalog_entry_invalid"
        assert secret not in str(error)
    else:
        raise AssertionError("invalid model catalog entry was accepted")



def test_new_native_option_and_stale_selection_need_no_static_declaration():
    native = {"id": "external.search", "kind": "tool", "owner": "Example MCP",
              "source": "connection:example", "schema": {"type": "object", "properties": {
                  "query": {"type": "string"}}, "required": ["query"]}}
    palette = materialize_card_editor([], native_options=[native], selected_ids=["external.search", "removed.tool"])
    by_id = {item["id"]: item for item in palette["options"]}
    assert by_id["external.search"]["availability"] == "available"
    assert by_id["external.search"]["selected"] is True
    assert by_id["external.search"]["effective"] is False
    assert by_id["removed.tool"]["availability"] == "unavailable"
    assert by_id["removed.tool"]["diagnostics"] == ["saved_selection_stale"]
    assert palette["fingerprint"] != materialize_card_editor([])["fingerprint"]
    unknown_host = {**native, "owner": "LiquidAIty"}
    host_palette = materialize_card_editor([], native_options=[unknown_host])
    assert next(item for item in host_palette["options"] if item["id"] == "external.search")["availability"] == "unavailable"
    assert by_id["external.search"]["schema"] == native["schema"]


def test_labels_do_not_change_object_identity_and_templates_select_objects():
    from copy import deepcopy
    palette = materialize_card_editor([])
    before = template_objects(palette, "template_assist")
    changed = deepcopy(palette)
    changed["objects"]["mission"]["label"] = "A new display label"
    assert template_objects(changed, "template_assist") == before
    changed["templates"]["template_assist"]["objects"].remove("mission")
    assert "mission" not in template_objects(changed, "template_assist")
    assert "mission" in before


def test_typed_objects_and_cardinality_are_declared_data():
    palette = materialize_card_editor([])
    palette["objects"]["notes"] = {"type": "InstructionsObject", "cardinality": "optional", "label": "Notes"}
    palette["templates"]["template_assist"]["objects"].append("notes")
    assert "notes" in template_objects(palette, "template_assist")
    assert palette["objects"]["notes"]["cardinality"] == "optional"
    assert palette["objects"]["files"]["cardinality"] == "repeatable"
    assert palette["types"]["InstructionsObject"]["fields"] == [
        {"id": "stable", "type": "Text", "required": True},
    ]


def test_new_composable_object_is_read_from_idd_without_a_python_dictionary(tmp_path, monkeypatch):
    from app.python_models import idd
    before = materialize_card_editor([])
    declared = idd.IDD_PATH.read_text(encoding="utf-8") + '''
[types.ReviewNote]
kind = "record"
fields = [{id="text", type="Text", required=true}]
[objects.review_note]
type = "ReviewNote"
cardinality = "required"
label = "Review note"
[templates.template_review]
extends = "template_assist"
objects = ["review_note"]
'''
    path = tmp_path / "LiquidAIty.idd"
    path.write_text(declared, encoding="utf-8")
    monkeypatch.setattr(idd, "IDD_PATH", path)
    palette = materialize_card_editor([])
    assert palette["fingerprint"] != before["fingerprint"]
    assert {"mission", "agent", "review_note"}.issubset(template_objects(palette, "template_review"))
    assert palette["objects"]["review_note"]["type"] == "ReviewNote"
    assert palette["types"]["ReviewNote"]["fields"] == [{"id": "text", "type": "Text", "required": True}]
    assert all(option["effective"] is False for option in palette["options"])
