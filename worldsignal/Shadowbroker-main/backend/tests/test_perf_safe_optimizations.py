"""Regression tests for UX-safe performance optimizations."""
from __future__ import annotations

import inspect


def test_slow_tier_skips_duplicate_time_critical_fetchers():
    """Weather + Ukraine alerts have dedicated scheduler jobs — not slow tier."""
    from services import data_fetcher

    source = inspect.getsource(data_fetcher.update_slow_data)
    slow_block = source.split("_run_tasks(\"slow-tier\"", 1)[0]
    assert "fetch_weather_alerts" not in slow_block
    assert "fetch_ukraine_air_raid_alerts" not in slow_block


def test_slow_tier_gates_correlation_engine_on_active_layer():
    from services import data_fetcher

    source = inspect.getsource(data_fetcher.update_slow_data)
    assert 'is_any_active("correlations")' in source


def test_health_uses_subset_refs_not_full_deepcopy():
    from routers import health as health_router

    source = inspect.getsource(health_router.health_check)
    assert "_health_data_snapshot()" in source
    assert "get_latest_data()" not in source

    snap_source = inspect.getsource(health_router._health_data_snapshot)
    assert "get_latest_data_subset_refs" in snap_source
    assert "deepcopy" not in snap_source


def test_active_layers_defaults_match_dashboard_first_paint():
    """Backend must not prefetch layers the dashboard starts with disabled."""
    from services.fetchers import _store

    off_by_default = {
        "cctv": False,
        "firms": False,
        "datacenters": False,
        "power_plants": False,
        "psk_reporter": False,
        "viirs_nightlights": False,
        "crowdthreat": False,
        "gt_risk": False,
    }
    for key, expected in off_by_default.items():
        assert _store.active_layers.get(key) is expected, key


def test_layer_enable_refresh_covers_cold_toggle_layers():
    from services import layer_enable_refresh

    source = inspect.getsource(layer_enable_refresh.refresh_newly_enabled_layers)
    for key in ("cctv", "firms", "power_plants", "psk_reporter", "datacenters"):
        assert key in layer_enable_refresh._INSTANT_LAYER_KEYS | layer_enable_refresh._SLOW_LAYER_KEYS
