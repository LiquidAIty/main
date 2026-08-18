from __future__ import annotations

from app.python_models import idf
from app.python_models.idd import validate_idf_islands


def test_legacy_idf_module_is_read_only() -> None:
    assert callable(idf.read_input_data_file)
    assert not hasattr(idf, "create_input_data_file")
    assert not hasattr(idf, "revise_input_data_file")
    assert not hasattr(idf, "approve_input_data_file")


def test_legacy_idf_read_validates_required_identity_without_a_database_write() -> None:
    try:
        idf.read_input_data_file(project_id="", idf_id="legacy-idf")
    except idf.InputDataFileError as error:
        assert str(error) == "idf_project_id_invalid"
    else:
        raise AssertionError("missing legacy Project identity was accepted")


def test_transient_renderer_preserves_exact_non_directional_content() -> None:
    card_context = {
        "cardId": "card-one",
        "title": "One",
        "prompt": "stable system",
        "runtime": {"kind": "autogen", "mode": "assistant"},
        "accessMode": "openrouter-api",
        "provider": "openrouter",
        "providerModelId": "model-one",
        "tools": ["graphiti.search_nodes"],
    }
    rendered = idf.render_content_markdown(
        system_text="stable system",
        user_text="temporary assignment",
        card_context=card_context,
        dynamic_context_markdown="temporary context",
        native_references=[{
            "authority": "KnowGraph",
            "nativeId": "node-one",
            "reason": "answer the selected question",
            "asOf": "2026-08-14T00:00:00Z",
            "required": True,
        }],
    )
    islands = validate_idf_islands(rendered)
    assert islands["SYSTEM"][0]["content"] == "stable system"
    assert "temporary assignment" in rendered
    assert "temporary context" in rendered
    assert "[CARD]" in rendered
    assert '"type": "serialized-card"' in rendered
    assert '"cardId": "card-one"' in rendered
    assert '"nativeId": "node-one"' in rendered
