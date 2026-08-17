from __future__ import annotations

from pathlib import Path

from app.python_models.idd import (
    IddValidationError,
    load_input_data_dictionary,
    materialize_card_editor,
    materialize_catalog,
    materialize_tool_catalog,
    required_tool_caller_runtime_binding,
    validate_idf_islands,
    validate_record,
)


def test_literal_idd_is_the_only_loaded_rule_catalog() -> None:
    dictionary = load_input_data_dictionary()

    assert dictionary["dictionary"]["name"] == "LiquidAIty"
    assert dictionary["dictionary"]["idfFormat"] == "mixed-markdown"
    assert dictionary["dictionary"]["unknownIslands"] == "inert"
    assert {item["name"] for item in dictionary["records"]} == {
        "card-context", "coder-packet", "model-option", "native-reference",
        "tool-catalog-reference",
    }
    assert {item["name"] for item in dictionary["catalogs"]} == {
        "configured-models", "native-tools",
    }
    assert {item["name"] for item in dictionary["editorFields"]} == {
        "executionMode", "provider", "modelKey", "reasoningEffort",
        "temperature", "maxTokens", "maxTurns", "tools", "accessMode",
    }
    assert {item["name"] for item in dictionary["islands"]} == {
        "SYSTEM", "CARD", "SQL", "CYPHER", "MCP", "SCRIPT", "JSON",
        "SEARCH_TERMS", "KNOWN_CONTEXT", "RETURN",
    }


def test_owner_authored_example_idf_validates_as_the_canonical_mixed_format() -> None:
    example = Path(__file__).resolve().parents[4] / "LiquidAIty_example.idf"
    islands = validate_idf_islands(example.read_text(encoding="utf-8"))

    assert {name: len(values) for name, values in islands.items()} == {
        "SYSTEM": 1,
        "CARD": 1,
        "SQL": 2,
        "CYPHER": 1,
        "MCP": 2,
        "SCRIPT": 1,
        "JSON": 1,
        "SEARCH_TERMS": 1,
        "KNOWN_CONTEXT": 1,
        "RETURN": 1,
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
SELECT content_markdown FROM ag_catalog.saved_idf_revisions
WHERE idf_id = :idf_id AND revision = :revision;
[/SQL]

Continue the sentence after the query result.

[SCRIPT language=python]
result = unique[:25]
[/SCRIPT]

[JSON]
{"type":"native-references","references":[{"authority":"CodeGraph","nativeId":"symbol:one","reason":"verify ownership","asOf":"current","required":true}]}
[/JSON]
"""

    islands = validate_idf_islands(markdown)

    assert islands["CARD"][0]["content"].startswith("name: Research Helper")
    assert islands["SQL"][0]["content"].startswith("SELECT")
    assert islands["SCRIPT"][0]["attributes"] == {"language": "python"}


def test_unknown_future_islands_are_inert_until_the_idd_defines_them() -> None:
    markdown = """[FUTURE_NATIVE_LANGUAGE]
This remains ordinary inert context.
[/FUTURE_NATIVE_LANGUAGE]"""

    assert validate_idf_islands(markdown) == {}


def test_idd_errors_never_echo_values() -> None:
    secret = "sk-secret-that-must-never-appear"
    try:
        validate_record(
            "card-context",
            {
                "cardId": "card_research",
                "title": "Research",
                "prompt": secret,
                "runtimeType": "assistant_agent",
                "accessMode": "chatgpt-account",
                "executionMode": secret,
            },
        )
    except IddValidationError as error:
        assert str(error) == "idd_record_field_invalid:card-context.executionMode"
        assert secret not in str(error)
    else:
        raise AssertionError("invalid structured IDF record was accepted")


def test_script_language_is_required_without_echoing_script_content() -> None:
    secret = "sk-secret-that-must-never-appear"
    try:
        validate_idf_islands(f"[SCRIPT]\n{secret}\n[/SCRIPT]")
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
    assert fields["executionMode"]["options"] == [
        {"value": "single", "label": "Single"},
        {"value": "auto-kanban", "label": "Auto-Kanban"},
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
    assert {"agentgraph.inspect", "write_mag_one_instructions"}.issubset(tool_names)
    assert required_tool_caller_runtime_binding("run_mag_one") == "main_chat"
    assert required_tool_caller_runtime_binding("write_mag_one_instructions") is None
    assert required_tool_caller_runtime_binding("cbm.search_graph") is None


def test_materialized_catalog_errors_do_not_echo_secret_values() -> None:
    secret = "sk-secret-that-must-never-appear"
    try:
        materialize_catalog("configured-models", [{"provider": secret}])
    except IddValidationError as error:
        assert str(error) == "idd_record_field_required:model-option.key"
        assert secret not in str(error)
    else:
        raise AssertionError("invalid model catalog entry was accepted")
