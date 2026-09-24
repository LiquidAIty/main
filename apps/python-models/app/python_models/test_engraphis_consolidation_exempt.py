from __future__ import annotations

import time
from typing import Any

import pytest

from engraphis.core.consolidate import consolidate, consolidate_profiles
from engraphis.core.interfaces import MemoryType, Node, Scope
from engraphis.service import MemoryService


@pytest.fixture()
def service() -> MemoryService:
    value = MemoryService.create(":memory:", extractor="none", graph_extractor="none")
    try:
        yield value
    finally:
        value.close()


def _episode(
    service: MemoryService,
    workspace_id: str,
    *,
    ordinal: int,
    exempt: bool,
) -> str:
    label = "exempt" if exempt else "ordinary"
    result = service.engine.remember_with_resolution(
        f"{label} recurring episode {ordinal}",
        workspace_id=workspace_id,
        mtype=MemoryType.EPISODIC,
        scope=Scope.WORKSPACE,
        title=f"{label.title()} episode",
        metadata={"consolidation_exempt": True} if exempt else {},
        subject_key=f"{label}-subject",
        claim_kind="test_episode",
        resolve_conflicts=False,
        valid_from=1_700_000_000.0 + ordinal,
    )
    return str(result["id"])


def _report_source_ids(report: dict[str, Any]) -> set[str]:
    values: set[str] = set()
    for entry in report["digests_created"]:
        values.update(entry.get("would_consolidate") or entry.get("consolidates") or [])
    values.update(item["id"] for item in report["archived"])
    return values


def test_consolidation_exempt_episodes_are_neither_distilled_nor_archived(
    service: MemoryService,
) -> None:
    workspace_id = service.store.get_or_create_workspace("consolidation-test")
    ordinary_ids = {
        _episode(service, workspace_id, ordinal=index, exempt=False)
        for index in range(3)
    }
    exempt_ids = {
        _episode(service, workspace_id, ordinal=index + 10, exempt=True)
        for index in range(3)
    }

    report = consolidate(
        service.engine,
        workspace_id=workspace_id,
        min_cluster=3,
        archive_below=0.5,
        dry_run=True,
        now=time.time() + 1_000_000_000.0,
    )

    handled = _report_source_ids(report)
    assert ordinary_ids <= handled
    assert exempt_ids.isdisjoint(handled)
    assert all(service.store.get_memory(memory_id).valid_to is None for memory_id in exempt_ids)


def test_consolidation_exempt_episodes_do_not_feed_entity_profiles(
    service: MemoryService,
) -> None:
    workspace_id = service.store.get_or_create_workspace("profile-test")
    ordinary_ids = [
        _episode(service, workspace_id, ordinal=index, exempt=False)
        for index in range(3)
    ]
    exempt_ids = [
        _episode(service, workspace_id, ordinal=index + 10, exempt=True)
        for index in range(3)
    ]
    ordinary_entity_id = service.store.upsert_entity(Node(
        id="", name="Ordinary Subject", ntype="concept", workspace_id=workspace_id,
    ))
    exempt_entity_id = service.store.upsert_entity(Node(
        id="", name="Exempt Subject", ntype="concept", workspace_id=workspace_id,
    ))
    for memory_id in ordinary_ids:
        service.store.link_memory_entity(
            memory_id=memory_id,
            entity_id=ordinary_entity_id,
            workspace_id=workspace_id,
            repo_id=None,
            source_kind="structured_extractor",
            confidence=1.0,
        )
    for memory_id in exempt_ids:
        service.store.link_memory_entity(
            memory_id=memory_id,
            entity_id=exempt_entity_id,
            workspace_id=workspace_id,
            repo_id=None,
            source_kind="structured_extractor",
            confidence=1.0,
        )

    report = consolidate_profiles(
        service.engine,
        workspace_id=workspace_id,
        min_mentions=3,
        dry_run=True,
    )

    profiled = {entry["entity"] for entry in report["profiles_created"]}
    assert "Ordinary Subject" in profiled
    assert "Exempt Subject" not in profiled
