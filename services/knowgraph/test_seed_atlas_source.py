"""Focused tests for the read-only seed-atlas source boundary (SEED_ATLAS_PATH contract).

Proves: a configured workbook reads ONE real fixture with a SHA-256 fingerprint + full provenance,
marked unverified_seed; an unconfigured path is an explicit unavailable state; a configured-but-
missing path is an explicit unavailable state; NO Downloads/candidate scanning happens in the normal
runtime path; and the relationship-kind / crossover matching is preserved.

  apps/python-models/.venv/Scripts/python.exe -m pytest services/knowgraph/test_seed_atlas_source.py -q
"""
from __future__ import annotations

import openpyxl

import seed_atlas_source as sas


def _make_workbook(path, sheet="Institutional Managers"):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(["Ticker", "Company", "Owner", "Updated"])
    ws.append(["RDW", "Redwire Corporation", "The Vanguard Group", "8/8/2023"])
    ws.append(["ZZZZ", "Other Co", "Someone Else", "1/1/2020"])
    wb.save(path)
    return path


def test_relationship_kind_distinction():
    assert sas._relationship_kind("Institutional Managers") == "reported_institutional_position"
    assert sas._relationship_kind("Founder Family Leads") == "founder_or_family_context"
    assert sas._relationship_kind("Owner Leads") == "owner_or_parent_relationship"
    assert sas._relationship_kind("Consumer Source Rows") == "brand_or_product_relationship"
    assert sas._relationship_kind("Universe") == "seed_atlas_context"


def test_match_resolves_ticker_cik_name_only():
    m = sas.SeedAtlasSource._match
    assert m(["x", "RDW", "y"], "RDW", "1819810", ["redwire"]).startswith("ticker:RDW")
    assert m(["1819810"], "ZZZZ", "1819810", []).startswith("cik:1819810")
    assert m(["Redwire Corporation"], "ZZZZ", "", ["redwire"]).startswith("name:redwire")
    assert m(["unrelated text"], "RDW", "1819810", ["redwire"]) == ""


def test_no_downloads_candidate_scanning_in_runtime_path(monkeypatch):
    # The module must not carry any documented Downloads candidate list, and with no SEED_ATLAS_PATH
    # configured the resolver returns nothing (it never scans Downloads or any other directory).
    assert not hasattr(sas, "_DOCUMENTED_CANDIDATES")
    monkeypatch.delenv(sas.SEED_ATLAS_PATH_ENV, raising=False)
    assert sas._configured_path(None) == ""


def test_unconfigured_path_is_explicit_unavailable(monkeypatch):
    monkeypatch.delenv(sas.SEED_ATLAS_PATH_ENV, raising=False)
    src = sas.load_seed_atlas()
    assert src.available is False
    assert src.reason_code == sas.REASON_NOT_CONFIGURED
    res = src.lookup(ticker="RDW", cik="0001819810", names=["Redwire"])
    assert res["status"] == sas.SEED_UNAVAILABLE
    assert res["reason_code"] == sas.REASON_NOT_CONFIGURED
    assert res["items"] == []


def test_missing_file_is_explicit_unavailable(monkeypatch, tmp_path):
    missing = tmp_path / "nope.xlsx"
    monkeypatch.setenv(sas.SEED_ATLAS_PATH_ENV, str(missing))
    src = sas.load_seed_atlas()
    assert src.available is False
    assert src.reason_code == sas.REASON_MISSING_FILE
    res = src.lookup(ticker="RDW")
    assert res["status"] == sas.SEED_UNAVAILABLE
    assert res["reason_code"] == sas.REASON_MISSING_FILE


def test_configured_workbook_reads_with_fingerprint_and_provenance(monkeypatch, tmp_path):
    wb_path = _make_workbook(tmp_path / "seed_fixture.xlsx")
    monkeypatch.setenv(sas.SEED_ATLAS_PATH_ENV, str(wb_path))
    src = sas.load_seed_atlas()
    assert src.available
    assert len(src.workbook_fingerprint) == 64  # SHA-256 hex
    res = src.lookup(ticker="RDW", cik="", names=["Redwire"], max_rows=6)
    assert res["status"] == sas.SEED_FOUND
    assert res["workbook_fingerprint"] == src.workbook_fingerprint
    assert res["source_id"].startswith("seed_atlas::seed_fixture.xlsx::")
    row = res["items"][0]
    for field in ("source_id", "configured_locator", "workbook", "worksheet", "row_index",
                  "workbook_modified_at", "workbook_fingerprint", "raw", "raw_cells",
                  "source_as_of", "imported_at"):
        assert field in row
    assert row["verification_state"] == "unverified_seed"
    assert row["relationship_kind"] == "reported_institutional_position"
    assert row["raw"]["Owner"] == "The Vanguard Group"
    assert row["source_as_of"] == "8/8/2023"
    assert "RDW" in row["matched_on"]


def test_fingerprint_changes_when_content_changes(monkeypatch, tmp_path):
    a = _make_workbook(tmp_path / "a.xlsx")
    fp_a = sas.load_seed_atlas(str(a)).workbook_fingerprint
    b = _make_workbook(tmp_path / "b.xlsx", sheet="Owner Leads")  # different content
    fp_b = sas.load_seed_atlas(str(b)).workbook_fingerprint
    assert fp_a and fp_b and fp_a != fp_b


def test_locator_is_not_a_raw_home_path(monkeypatch, tmp_path):
    wb_path = _make_workbook(tmp_path / "seed_fixture.xlsx")
    src = sas.load_seed_atlas(str(wb_path))
    # tmp_path is outside HOME here, so the locator falls back to the file name (never a home path)
    assert "\\Users\\" not in src.configured_locator and "/Users/" not in src.configured_locator
