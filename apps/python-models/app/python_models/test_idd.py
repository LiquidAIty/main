from __future__ import annotations

from app.python_models.idd import (
    IddValidationError,
    load_input_data_dictionary,
    materialize_card_editor,
    materialize_catalog,
    materialize_tool_catalog,
    required_tool_caller_runtime,
    validate_input_islands,
    validate_record,
)


def test_literal_idd_is_the_only_loaded_rule_catalog() -> None:
    dictionary = load_input_data_dictionary()

    assert dictionary["dictionary"]["name"] == "LiquidAIty"
    assert dictionary["dictionary"]["idfFormat"] == "card-model-call"
    assert dictionary["dictionary"]["unknownIslands"] == "inert"
    assert {item["name"] for item in dictionary["records"]} == {
        "card-context", "model-option", "native-reference",
        "tool-catalog-reference",
    }
    assert {item["name"] for item in dictionary["catalogs"]} == {
        "configured-models", "native-tools",
    }
    assert {item["name"] for item in dictionary["editorFields"]} == {
        "runtimeKind", "runtimeMode", "runtimeProfile", "provider", "modelKey", "reasoningEffort",
        "temperature", "maxTokens", "maxTurns", "tools", "accessMode",
    }
    assert {item["name"] for item in dictionary["islands"]} == {
        "SYSTEM", "CARD", "SQL", "CYPHER", "MCP", "SCRIPT", "JSON",
        "SEARCH_TERMS", "KNOWN_CONTEXT", "RETURN",
    }


def test_idd_accepts_loose_text_and_native_language_islands() -> None:
    markdown = """Ordinary Markdown can appear before, between, and after islands.

[SYSTEM]
Use graph-first discovery.
[/SYSTEM]

[CARD]
name: Research Helper
role: planning, research, memory
[/CARD]

[SQL]
SELECT title FROM ag_catalog.cards
WHERE card_id = :card_id;
[/SQL]

Continue the sentence after the query result.

[SCRIPT language=python]
result = unique[:25]
[/SCRIPT]

[JSON]
{"type":"native-references","references":[{"authority":"CodeGraph","nativeId":"symbol:one","reason":"verify ownership","asOf":"current","required":true}]}
[/JSON]
"""

    islands = validate_input_islands(markdown)

    assert islands["CARD"][0]["content"].startswith("name: Research Helper")
    assert islands["SQL"][0]["content"].startswith("SELECT")
    assert islands["SCRIPT"][0]["attributes"] == {"language": "python"}


def test_unknown_future_islands_are_inert_until_the_idd_defines_them() -> None:
    markdown = """[FUTURE_NATIVE_LANGUAGE]
This remains ordinary inert context.
[/FUTURE_NATIVE_LANGUAGE]"""

    assert validate_input_islands(markdown) == {}


def test_idd_errors_never_echo_values() -> None:
    secret = "sk-secret-that-must-never-appear"
    try:
        validate_record(
            "card-context",
            {
                "cardId": "card_research",
                "title": "Research",
                "prompt": secret,
                "runtime": secret,
                "accessMode": "chatgpt-account",
            },
        )
    except IddValidationError as error:
        assert str(error) == "idd_record_field_invalid:card-context.runtime"
        assert secret not in str(error)
    else:
        raise AssertionError("invalid structured input record was accepted")


def test_script_language_is_required_without_echoing_script_content() -> None:
    secret = "sk-secret-that-must-never-appear"
    try:
        validate_input_islands(f"[SCRIPT]\n{secret}\n[/SCRIPT]")
    except IddValidationError as error:
        assert str(error) == "idd_island_attribute_required:SCRIPT"
        assert secret not in str(error)
    else:
        raise AssertionError("SCRIPT without its IDD-required language was accepted")


def test_card_editor_materializes_models_and_bounds_from_the_literal_idd() -> None:
    materialized = materialize_card_editor([
        {
            "provider": "openrouter",
            "key": "provider/model",
            "label": "Provider Model",
            "providerModelId": "provider/model",
            "default": False,
        },
    ])

    assert materialized["catalogs"]["configured-models"][0]["key"] == "provider/model"
    fields = {field["name"]: field for field in materialized["fields"]}
    assert fields["modelKey"]["catalog"] == "configured-models"
    assert fields["tools"]["catalog"] == "native-tools"
    assert fields["runtimeMode"]["options"] == [
        {"value": "main", "label": "Main"},
        {"value": "delegate", "label": "Delegate"},
        {"value": "kanban", "label": "Kanban"},
        {"value": "assistant", "label": "Assistant"},
        {"value": "magentic_one", "label": "Magentic-One"},
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


def test_explicit_tool_permissions_come_from_the_idd() -> None:
    dictionary = load_input_data_dictionary()
    tool_names = {
        tool["name"]
        for group in dictionary["toolGroups"]
        for tool in group["tools"]
    }
    assert {"agentgraph.inspect", "run_mag_one"}.issubset(tool_names)
    assert required_tool_caller_runtime("run_mag_one") == {"kind": "hermes", "mode": "main"}
    assert required_tool_caller_runtime("cbm.search_graph") is None


def test_materialized_catalog_errors_do_not_echo_secret_values() -> None:
    secret = "sk-secret-that-must-never-appear"
    try:
        materialize_catalog("configured-models", [{"provider": secret}])
    except IddValidationError as error:
        assert str(error) == "idd_record_field_required:model-option.key"
        assert secret not in str(error)
    else:
        raise AssertionError("invalid model catalog entry was accepted")
