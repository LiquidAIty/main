from __future__ import annotations

import pytest
from pydantic import ValidationError
from app.python_models.idd import IddValidationError, load_input_data_dictionary, materialize_card_editor, materialize_runtime_options, template_objects
from app.python_models.tool_registry import materialize_tool_catalog, required_tool_caller_runtime
from app.python_models.card_script import compile_card_script, generate_card_script_header, saved_script, script_presentation
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
    source = '''CARD_SCRIPT = {
    "mode": "outer_controller",
    "input": {"type": "object", "properties": {"mission": {"type": "string"}}, "required": ["mission"]},
    "output": {"type": "object", "properties": {"agent": {"type": "object", "properties": {"run": {"type": "boolean"}}, "required": ["run"]}}, "required": ["agent"]},
}
query = "SELECT title WHERE id = :id"
# ordinary Markdown and SQL stay inert
from hermes_tools import output
output.emit({"agent": {"run": False}, "query": query})
'''
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


def test_invalid_script_is_saved_but_degrades_to_exact_selected_mcp_tools() -> None:
    script = saved_script({"source": "not valid Python is inert", "version": 2})
    assert script["source"] == "not valid Python is inert"
    assert script["version"] == 2
    assert script["lastValidation"]["status"] == "invalid"
    assert script["lastValidation"]["errors"][0].startswith("card_script_syntax_invalid")
    assert script["nativeSupport"]["available"] is False
    presentation = script_presentation(
        {"enabled": True, "source": "return InvocationPreparation()"},
        selected_tools=["calculator"],
    )
    assert presentation["mode"] == "selected-mcp"
    assert presentation["presentedTools"] == ["calculator"]
    assert presentation["fallbackReason"] == "card_script_validation_failed"


def test_valid_script_compiles_literal_contract_and_selected_tool_handles() -> None:
    source = '''CARD_SCRIPT = {
    "mode": "outer_controller",
    "input": {"type": "object", "properties": {"mission": {"type": "string"}}, "required": ["mission"]},
    "output": {"type": "object", "properties": {"context": {"type": "object"}, "agent": {"type": "object", "properties": {"run": {"type": "boolean"}, "prompt": {"type": "string"}}, "required": ["run"]}}, "required": ["context", "agent"]},
    "max_tool_calls": 3,
}
from hermes_tools import SCRIPT, input, output, tools
tools.constellation.context = SCRIPT
context = tools.call("constellation.context", focus=input.mission)
output.emit({"context": context, "agent": {"run": True, "prompt": input.mission}})
'''
    compiled = compile_card_script(source, selected_tools=["constellation.context"])
    assert compiled["mode"] == "outer_controller"
    assert compiled["toolHandles"] == ["constellation.context"]
    assert compiled["toolStates"] == {"constellation.context": 1}
    assert compiled["scriptToolIds"] == ["constellation.context"]
    assert compiled["agentToolIds"] == []
    assert compiled["maxToolCalls"] == 3
    presentation = script_presentation(
        {"enabled": True, "source": source},
        selected_tools=["constellation.context"],
    )
    assert presentation["mode"] == "script"
    assert presentation["presentedTools"] == []
    assert presentation["script"]["nativeSupport"]["active"] is True
    with pytest.raises(ValueError, match="card_script_tool_not_selected:constellation.context"):
        compile_card_script(source, selected_tools=["graphiti.get_status"])


def test_valid_script_wraps_only_literal_handles_and_leaves_other_selected_mcp_tools_visible() -> None:
    source = '''CARD_SCRIPT = {
    "mode": "outer_controller",
    "input": {"type": "object", "properties": {"mission": {"type": "string"}}, "required": ["mission"]},
    "output": {"type": "object", "properties": {"agent": {"type": "object", "properties": {"run": {"type": "boolean"}}, "required": ["run"]}}, "required": ["agent"]},
}
from hermes_tools import SCRIPT, output, tools
tools.constellation.context = SCRIPT
tools.call("constellation.context")
output.emit({"agent": {"run": False}})
'''
    presentation = script_presentation(
        {"enabled": True, "source": source},
        selected_tools=["constellation.context", "graphiti.get_status"],
    )
    assert presentation["mode"] == "script"
    assert presentation["presentedTools"] == ["graphiti.get_status"]


def test_selected_tools_compile_off_script_agent_and_both_without_mutating_grants() -> None:
    source = '''CARD_SCRIPT = {
    "mode": "outer_controller",
    "input": {"type": "object", "properties": {"mission": {"type": "string"}}, "required": ["mission"]},
    "output": {"type": "object", "properties": {"agent": {"type": "object", "properties": {"run": {"type": "boolean"}}, "required": ["run"]}}, "required": ["agent"]},
}
from hermes_tools import AGENT, BOTH, OFF, SCRIPT, output, tools
tools.cbm.delete_project = 0
tools.cbm.search_graph = SCRIPT
tools.graphiti.get_status = AGENT
tools.constellation.context = BOTH
tools.call("cbm.search_graph")
tools.call("constellation.context")
output.emit({"agent": {"run": True}})
'''
    selected = [
        "cbm.delete_project", "cbm.search_graph",
        "graphiti.get_status", "constellation.context",
    ]
    compiled = compile_card_script(source, selected_tools=selected)
    assert compiled["toolStates"] == {
        "cbm.delete_project": 0,
        "cbm.search_graph": 1,
        "graphiti.get_status": 2,
        "constellation.context": 3,
    }
    assert compiled["offToolIds"] == ["cbm.delete_project"]
    assert compiled["scriptToolIds"] == ["cbm.search_graph", "constellation.context"]
    assert compiled["agentToolIds"] == ["graphiti.get_status", "constellation.context"]
    presentation = script_presentation(
        {"enabled": True, "source": source}, selected_tools=selected,
    )
    assert presentation["presentedTools"] == [
        "graphiti.get_status", "constellation.context",
    ]
    assert selected == [
        "cbm.delete_project", "cbm.search_graph",
        "graphiti.get_status", "constellation.context",
    ]


def test_authorized_all_healthy_tools_default_off_unless_saved_or_script_owned() -> None:
    source = '''CARD_SCRIPT = {
    "mode": "outer_controller",
    "input": {"type": "object", "properties": {"mission": {"type": "string"}}, "required": ["mission"]},
    "output": {"type": "object", "properties": {"agent": {"type": "object", "properties": {"run": {"type": "boolean"}}, "required": ["run"]}}, "required": ["agent"]},
}
from hermes_tools import SCRIPT, output, tools
tools.cbm.search_graph = SCRIPT
tools.call("cbm.search_graph")
output.emit({"agent": {"run": False}})
'''
    presentation = script_presentation(
        {"enabled": True, "source": source},
        selected_tools=["cbm.search_graph", "constellation.remember", "web_search"],
        default_agent_tools=["constellation.remember"],
    )
    assert presentation["mode"] == "script"
    assert presentation["presentedTools"] == ["constellation.remember"]
    assert presentation["script"]["compiled"]["toolStates"] == {
        "cbm.search_graph": 1,
        "constellation.remember": 2,
        "web_search": 0,
    }


def test_ungranted_tool_cannot_be_enabled_or_called() -> None:
    source = '''CARD_SCRIPT = {
    "mode": "outer_controller",
    "input": {"type": "object", "properties": {"mission": {"type": "string"}}, "required": ["mission"]},
    "output": {"type": "object", "properties": {"agent": {"type": "object", "properties": {"run": {"type": "boolean"}}, "required": ["run"]}}, "required": ["agent"]},
}
from hermes_tools import SCRIPT, output, tools
tools.cbm.delete_project = SCRIPT
output.emit({"agent": {"run": False}})
'''
    with pytest.raises(ValueError, match="card_script_tool_not_selected:cbm.delete_project"):
        compile_card_script(source, selected_tools=["cbm.search_graph"])


def test_generated_python_header_is_complete_read_only_and_grant_aware() -> None:
    catalog = [
        {
            "canonicalId": "cbm.search_graph", "access": "read",
            "availability": "available", "contracts": [{"inputSchema": {"type": "object"}}],
        },
        {
            "canonicalId": "cbm.delete_project", "access": "write",
            "availability": "available", "contracts": [{"inputSchema": {"type": "object"}}],
        },
    ]
    header = generate_card_script_header(
        catalog_tools=catalog,
        selected_tools=["cbm.search_graph"],
        card_id="card_main_chat",
    )
    assert header["schemaVersion"] == "liquidaity.card-script.header.v1"
    assert header["hash"] == generate_card_script_header(
        catalog_tools=catalog,
        selected_tools=["cbm.search_graph"],
        card_id="card_main_chat",
    )["hash"]
    assert "tools: Final[ToolControls]" in header["source"]
    assert "search_graph: SelectedToolHandle" in header["source"]
    assert "delete_project: UngrantedToolHandle" in header["source"]
    assert "role: Literal['leaf', 'team'] = 'team'" in header["source"]
    assert "orchestrator" not in header["source"]
    ordinary = generate_card_script_header(
        catalog_tools=catalog,
        selected_tools=["cbm.search_graph"],
        card_id="card_research",
    )
    assert "role: Literal['team'] = 'team'" in ordinary["source"]
    assert "leaf" not in ordinary["source"]
    assert "This file is not saved, executed, or sent to a model" in header["source"]
    implicit = generate_card_script_header(
        catalog_tools=catalog,
        selected_tools=["cbm.search_graph"],
        default_agent_tools=[],
        card_id="card_research",
    )
    assert "search_graph: SelectedToolHandle" in implicit["source"]
    assert "cbm.search_graph | READ | AVAILABLE | OFF" in implicit["source"]
    assert implicit["hash"] != ordinary["hash"]
    changed = generate_card_script_header(
        catalog_tools=catalog,
        selected_tools=["cbm.search_graph", "cbm.delete_project"],
        card_id="card_main_chat",
    )
    assert changed["hash"] != header["hash"]


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
    assert fields["maxTurns"]["minimum"] == 1


def test_ordinary_options_reuse_contracts_without_loading_the_builder_palette(monkeypatch):
    from app.python_models import idd
    models = [{"provider": "native-provider", "key": "current-model", "label": "Current model",
               "providerModelId": "native-model", "default": False}]
    palette = materialize_card_editor(models)

    def forbidden_palette_read():
        raise AssertionError("ordinary configuration must not read IDD")

    monkeypatch.setattr(idd, "load_input_data_dictionary", forbidden_palette_read)
    options = materialize_runtime_options(models)
    assert options == {key: palette[key] for key in ("fields", "catalogs")}
    assert set(options) == {"fields", "catalogs"}
    fields = {field["name"]: field for field in options["fields"]}
    assert fields["provider"]["options"] == [{"value": "native-provider", "label": "native-provider"}]
    assert fields["runtimeKind"]["options"] == [
        {"value": "hermes", "label": "hermes"}, {"value": "autogen", "label": "autogen"},
    ]
    assert materialize_runtime_options([])["catalogs"] == {"configured-models": []}


@pytest.mark.parametrize("models,code", [
    (None, "model_catalog_invalid"),
    ([{"provider": "sk-secret"}], "model_catalog_entry_invalid"),
    ([{"provider": "p", "key": "m", "label": "M", "providerModelId": "m"}] * 2,
     "model_catalog_identity_duplicate"),
])
def test_ordinary_options_keep_catalog_validation(models, code):
    with pytest.raises(IddValidationError) as error:
        materialize_runtime_options(models)
    assert str(error.value) == code
    assert "sk-secret" not in str(error.value)


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
        "name": "graphiti.search_nodes", "namespace": "graphiti", "sourceId": "graphiti",
        "nativeName": "search_nodes", "connectionKind": "external-mcp",
        "inputSchema": {"type": "object"}, "annotations": {"readOnlyHint": False},
    }])
    search = next(item for item in references if item["canonicalId"] == "graphiti.search_nodes")
    assert search["access"] == "read"
    assert search["contracts"][0]["annotations"] == {"readOnlyHint": False}
    assert "graphiti.search_nodes" in readable_tool_ids()


def test_constellation_tools_are_bounded_and_codegraph_stays_with_cbm():
    from app.python_models.tool_registry import external_mcp_tool_ids, readable_tool_ids, writable_tool_ids

    constellation = {
        "constellation.context", "constellation.inspect", "constellation.remember",
    }
    references = {item["canonicalId"]: item for item in materialize_tool_catalog([])}
    assert constellation.issubset(references)
    assert constellation.issubset(external_mcp_tool_ids())
    assert {"constellation.context", "constellation.inspect"}.issubset(readable_tool_ids())
    assert "constellation.remember" in writable_tool_ids()
    assert {"cbm.search_graph", "cbm.search_code"}.issubset(readable_tool_ids())


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
