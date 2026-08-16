from __future__ import annotations

from app.python_models import idf


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
