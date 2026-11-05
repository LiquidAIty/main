# Entity: Hermes UI Integration
# Relationship: Exposes only the authenticated dashboard-plugin routes for publishing the in-process navigation map; task presentation reads Hermes's bundled Kanban API directly.
"""Authenticated dashboard publication seam for the in-process navigation map."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

from fastapi import APIRouter, HTTPException


def _runtime():
    key = "_liquidaity_navigation_map_runtime"
    if key in sys.modules:
        return sys.modules[key]
    path = Path(__file__).resolve().parents[1] / "navigation_map.py"
    spec = importlib.util.spec_from_file_location(key, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("liquidaity_navigation_map_loader_unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[key] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(key, None)
        raise
    return module


router = APIRouter()


@router.get("/navigation-map")
async def navigation_map_status(profile: str):
    return {"ok": True, **_runtime().navigation_status(profile)}


@router.put("/navigation-map")
async def publish_navigation_map(body: dict, profile: str):
    try:
        return {"ok": True, **_runtime().publish_navigation_map(body, profile)}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.delete("/navigation-map")
async def clear_navigation_map(profile: str):
    return {"ok": True, **_runtime().clear_navigation_map(profile)}
