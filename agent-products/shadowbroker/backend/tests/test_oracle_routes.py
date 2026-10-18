import asyncio
import json

import pytest
from starlette.requests import Request

from routers import mesh_oracle as oracle_routes
from services import prediction_markets_settings
from services.fetchers import prediction_markets


def _request(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "method": "GET",
            "path": path,
        }
    )


def _market(title: str, category: str, volume: int) -> dict:
    return {
        "title": title,
        "category": category,
        "volume": volume,
        "volume_24h": volume // 10,
        "consensus_pct": 60,
        "polymarket_pct": 60,
        "kalshi_pct": None,
        "sources": [],
        "outcomes": [],
        "slug": title.lower().replace(" ", "-"),
    }


def test_markets_includes_sports_and_release_fields(monkeypatch):
    monkeypatch.setattr(
        oracle_routes,
        "get_latest_data",
        lambda: {"prediction_markets": [_market("Final", "SPORTS", 100)]},
    )
    monkeypatch.setattr(
        "services.mesh.mesh_oracle.oracle_ledger.get_all_market_consensus",
        lambda: {},
    )

    response = asyncio.run(oracle_routes.oracle_markets(_request("/api/mesh/oracle/markets")))

    assert response["total_count"] == 1
    assert response["cat_totals"]["SPORTS"] == 1
    assert response["categories"]["SPORTS"][0]["title"] == "Final"
    assert "kalshi_volume" in response["categories"]["SPORTS"][0]


def test_markets_more_supports_all_and_clamps_pagination(monkeypatch):
    markets = [_market(f"Market {index}", "NEWS", 100 - index) for index in range(5)]
    monkeypatch.setattr(
        oracle_routes,
        "get_latest_data",
        lambda: {"prediction_markets": markets},
    )

    response = asyncio.run(
        oracle_routes.oracle_markets_more(
            _request("/api/mesh/oracle/markets/more"),
            category="all",
            offset=-10,
            limit=2,
        )
    )

    assert response["category"] == "ALL"
    assert response["offset"] == 0
    assert response["total"] == 5
    assert response["has_more"] is True
    assert [row["title"] for row in response["markets"]] == ["Market 0", "Market 1"]


def test_search_refuses_provider_calls_until_operator_opts_in(monkeypatch):
    monkeypatch.setattr(prediction_markets_settings, "prediction_markets_fetch_enabled", lambda: False)
    monkeypatch.setattr(
        prediction_markets,
        "search_polymarket_direct",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("provider call must not run")),
    )
    monkeypatch.setattr(
        prediction_markets,
        "search_kalshi_direct",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("provider call must not run")),
    )

    response = asyncio.run(
        oracle_routes.oracle_search(_request("/api/mesh/oracle/search"), q="energy", limit=50)
    )

    assert response.status_code == 409
    payload = json.loads(response.body)
    assert payload["error"] == "prediction_markets_disabled"
    assert payload["results"] == []


def test_search_returns_stable_offset_page_and_has_more(monkeypatch):
    monkeypatch.setattr(prediction_markets_settings, "prediction_markets_fetch_enabled", lambda: True)
    seen_limits: list[int] = []

    def search_poly(_query: str, limit: int, offset: int) -> list[dict]:
        seen_limits.append(limit)
        assert offset == 0
        return [_market(f"Market {index}", "NEWS", 100 - index) for index in range(8)]

    monkeypatch.setattr(prediction_markets, "search_polymarket_direct", search_poly)
    monkeypatch.setattr(prediction_markets, "search_kalshi_direct", lambda *_args: [])
    monkeypatch.setattr(oracle_routes, "get_latest_data", lambda: {"prediction_markets": []})

    response = asyncio.run(
        oracle_routes.oracle_search(
            _request("/api/mesh/oracle/search"),
            q="market",
            limit=3,
            offset=2,
        )
    )

    assert seen_limits == [30]
    assert response["offset"] == 2
    assert response["count"] == 3
    assert response["has_more"] is True
    assert response["total_seen"] == 8
    assert [row["title"] for row in response["results"]] == ["Market 2", "Market 3", "Market 4"]


def test_search_keeps_partial_results_when_one_provider_fails(monkeypatch):
    monkeypatch.setattr(prediction_markets_settings, "prediction_markets_fetch_enabled", lambda: True)
    monkeypatch.setattr(
        prediction_markets,
        "search_polymarket_direct",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("provider unavailable")),
    )
    monkeypatch.setattr(
        prediction_markets,
        "search_kalshi_direct",
        lambda *_args: [_market("Kalshi result", "FINANCE", 50)],
    )
    monkeypatch.setattr(oracle_routes, "get_latest_data", lambda: {"prediction_markets": []})

    response = asyncio.run(
        oracle_routes.oracle_search(_request("/api/mesh/oracle/search"), q="kalshi")
    )

    assert [row["title"] for row in response["results"]] == ["Kalshi result"]
    assert response["provider_errors"] == ["polymarket"]


def test_oracle_maintenance_never_infers_outcomes(monkeypatch):
    from services import data_fetcher
    from services.mesh import mesh_oracle

    calls: list[str] = []

    class CleanupOnlyLedger:
        def cleanup_old_data(self):
            calls.append("cleanup")

    monkeypatch.setattr(mesh_oracle, "oracle_ledger", CleanupOnlyLedger())

    data_fetcher._oracle_maintenance_sweep()

    assert calls == ["cleanup"]


def test_oracle_routes_have_one_registered_owner():
    import main

    owners: dict[str, list[str]] = {}
    for route in main.app.routes:
        path = getattr(route, "path", "")
        endpoint = getattr(route, "endpoint", None)
        for method in getattr(route, "methods", set()) or set():
            if path == "/api/oracle/region-intel" or path.startswith("/api/mesh/oracle/"):
                owners.setdefault(f"{method} {path}", []).append(endpoint.__module__)

    assert owners
    assert all(len(modules) == 1 for modules in owners.values())
    assert owners["GET /api/oracle/region-intel"] == ["routers.sigint"]
    assert all(
        modules == ["routers.mesh_oracle"]
        for key, modules in owners.items()
        if "/api/mesh/oracle/" in key
    )


def test_oracle_ledger_commits_accepted_prediction_atomically(monkeypatch, tmp_path):
    from services.mesh import mesh_oracle

    ledger_path = tmp_path / "oracle_ledger.json"
    monkeypatch.setattr(mesh_oracle, "DATA_DIR", tmp_path)
    monkeypatch.setattr(mesh_oracle, "ORACLE_FILE", ledger_path)
    ledger = mesh_oracle.OracleLedger()

    ok, _detail = ledger.place_prediction("node-1", "Exact market", "yes", 40)

    assert ok is True
    payload = json.loads(ledger_path.read_text(encoding="utf-8"))
    assert payload["predictions"][0]["market_title"] == "Exact market"
    assert not (tmp_path / ".oracle_ledger.json.tmp").exists()


def test_oracle_ledger_refuses_to_replace_corrupt_persisted_state(monkeypatch, tmp_path):
    from services.mesh import mesh_oracle

    ledger_path = tmp_path / "oracle_ledger.json"
    ledger_path.write_text("{not-json", encoding="utf-8")
    monkeypatch.setattr(mesh_oracle, "DATA_DIR", tmp_path)
    monkeypatch.setattr(mesh_oracle, "ORACLE_FILE", ledger_path)

    ledger = mesh_oracle.OracleLedger()

    with pytest.raises(RuntimeError, match="persisted state could not be loaded"):
        ledger.get_total_oracle_rep("node-1")
    assert ledger_path.read_text(encoding="utf-8") == "{not-json"
