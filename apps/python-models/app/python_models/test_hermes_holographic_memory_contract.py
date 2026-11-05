# Entity: Hermes Profiles
# Relationship: This file verifies LiquidAIty declares the current external Hermes Holographic provider dependency without pretending the provider implementation is vendored or loaded.

from __future__ import annotations

from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[4]
HERMES_ROOT = REPO_ROOT / "HermesLatest"
PLUGIN_ROOT = REPO_ROOT / "apps" / "hermes-liquidaity-plugin"


def test_current_hermes_catalog_and_liquidaity_manifest_bind_holographic_plugin() -> None:
    catalog = yaml.safe_load(
        (HERMES_ROOT / "plugin-catalog" / "holographic.yaml").read_text(encoding="utf-8")
    )
    manifest = yaml.safe_load(
        (PLUGIN_ROOT / "plugin.yaml").read_text(encoding="utf-8")
    )

    assert catalog["name"] == "holographic"
    assert catalog["category"] == "memory"
    assert catalog["repo"].startswith("https://github.com/")
    assert catalog["sha"]
    assert catalog["docs_url"].startswith(catalog["repo"])
    assert catalog["requires_hermes"].startswith(">=")
    assert manifest["requires_plugins"] == ["holographic"]
