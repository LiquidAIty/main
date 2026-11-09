"""Transient navigation context for the Project's existing graph viewport."""
# Entity: Project Knowledge Graph
# Relationship: Keeps the current displayed Entity/relationship map and optional open-node detail available without writing conversation or graph records.

from __future__ import annotations

import copy
import math
from threading import Lock
from typing import Any
from uuid import uuid4

from app.python_models.graph_read_contract import GraphReadError, canonical_json

# Presentation state only: provider IDs stay authoritative, and restart discards the view.
_VISIBLE_MAPS: dict[str, dict[str, Any]] = {}
_VISIBLE_MAP_LOCK = Lock()


def empty_project_entity_map(project: str) -> dict[str, Any]:
    return {"schemaVersion": "project-entity-map", "projectId": project,
            "sources": {"thinkgraph": False, "knowgraph": False, "codegraph": False},
            "entities": [], "relationships": []}


def _validated_map(project: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    """Validate the existing display contract without publishing or changing graph data."""
    if not project or not isinstance(snapshot, dict) or snapshot.get("projectId") != project:
        raise GraphReadError("project_entity_map_scope_invalid")
    if set(snapshot) != {"schemaVersion", "projectId", "sources", "entities", "relationships"}:
        raise GraphReadError("project_entity_map_fields_invalid")
    if snapshot["schemaVersion"] != "project-entity-map":
        raise GraphReadError("project_entity_map_schema_invalid")
    sources = snapshot["sources"]
    if not isinstance(sources, dict) or set(sources) != {"thinkgraph", "knowgraph", "codegraph"} \
            or any(type(value) is not bool for value in sources.values()):
        raise GraphReadError("project_entity_map_sources_invalid")
    entities, relationships = snapshot["entities"], snapshot["relationships"]
    if not isinstance(entities, list) or not isinstance(relationships, list):
        raise GraphReadError("project_entity_map_records_invalid")
    ids: set[str] = set()
    for entity in entities:
        if not isinstance(entity, dict) or not set(entity) <= {"id", "name", "providers", "filePath", "files", "categories", "weight"}:
            raise GraphReadError("project_entity_map_entity_invalid")
        if not isinstance(entity.get("id"), str) or not entity["id"] or entity["id"] in ids \
                or not isinstance(entity.get("name"), str) or not entity["name"]:
            raise GraphReadError("project_entity_map_entity_invalid")
        ids.add(entity["id"])
        if "weight" in entity and (type(entity["weight"]) not in (int, float)
                                   or not math.isfinite(entity["weight"]) or entity["weight"] < 0):
            raise GraphReadError("project_entity_map_weight_invalid")
        pointers = entity.get("providers")
        if not isinstance(pointers, list) or not pointers:
            raise GraphReadError("project_entity_map_pointer_invalid")
        for pointer in pointers:
            if not isinstance(pointer, dict) or set(pointer) != {"authority", "id"} \
                    or sources.get(pointer["authority"]) is not True \
                    or not isinstance(pointer["id"], str) or not pointer["id"]:
                raise GraphReadError("project_entity_map_pointer_invalid")
    edge_ids: set[str] = set()
    for edge in relationships:
        if not isinstance(edge, dict) or not set(edge) <= {"id", "source", "target", "authority", "label", "probability"} \
                or not isinstance(edge.get("id"), str) or not edge["id"] or edge["id"] in edge_ids \
                or edge.get("source") not in ids or edge.get("target") not in ids \
                or sources.get(edge.get("authority")) is not True \
                or not isinstance(edge.get("label"), str) or not edge["label"]:
            raise GraphReadError("project_entity_map_relationship_invalid")
        edge_ids.add(edge["id"])
        if "probability" in edge and (type(edge["probability"]) not in (int, float)
                                     or not 0 <= edge["probability"] <= 1):
            raise GraphReadError("project_entity_map_probability_invalid")
    encoded = canonical_json(snapshot).encode("utf-8")
    if len(encoded) > 1_000_000:
        raise GraphReadError("project_entity_map_input_limit_exceeded")
    return copy.deepcopy(snapshot)


def _without_code(snapshot: dict[str, Any], detail: Any, visible: bool = False) -> tuple[dict[str, Any], Any]:
    snapshot = copy.deepcopy(snapshot)
    snapshot['sources']['codegraph'] = visible
    entities = []
    for entity in snapshot['entities']:
        entity['providers'] = [pointer for pointer in entity['providers'] if pointer['authority'] != 'codegraph']
        if not entity['providers']:
            continue
        for field in ('files', 'filePath', 'categories'):
            entity.pop(field, None)
        entities.append(entity)
    snapshot['entities'] = entities
    ids = {entity['id'] for entity in entities}
    snapshot['relationships'] = [edge for edge in snapshot['relationships']
                                 if edge['authority'] != 'codegraph' and edge['source'] in ids and edge['target'] in ids]
    return snapshot, None if detail and detail.get('authority') == 'codegraph' else detail


def configure_project_code_selection(project: str, change: dict[str, Any]) -> dict[str, Any]:
    """One transient Project selection, shared by the user and Builder."""
    if not project:
        raise GraphReadError('project_required')
    with _VISIBLE_MAP_LOCK:
        view = _VISIBLE_MAPS.setdefault(project, {'map': empty_project_entity_map(project), 'openNode': None})
        current = view.setdefault('codeSelection', {
            'categories': [], 'selectedIds': [], 'visible': True, 'selectionId': str(uuid4()), 'revision': 0,
        })
        categories = change.get('categories', current['categories'])
        if not isinstance(categories, list) or any(not isinstance(item, dict)
                or not isinstance(item.get('id'), str) or not item['id']
                or not isinstance(item.get('label'), str) for item in categories):
            raise GraphReadError('invalid_code_categories')
        enable, disable = change.get('enable') or [], change.get('disable') or []
        if any(not isinstance(ids, list) or any(not isinstance(item, str) for item in ids) for ids in (enable, disable)):
            raise GraphReadError('invalid_category_selection')
        visible = change.get('visible', current['visible'])
        if type(visible) is not bool:
            raise GraphReadError('invalid_code_visibility')
        reason = None
        if (enable or disable) and change.get('selectionId') != current['selectionId']:
            reason = 'selection_changed'
        elif enable and not visible:
            reason = 'code_layer_off'
        if reason:
            next_selection = current
            changed = False
        else:
            available = {item['id'] for item in categories}
            if any(item not in available for item in enable + disable):
                raise GraphReadError('unknown_code_category')
            selected = (set(current['selectedIds']) & available) if visible else set()
            selected = (selected | set(enable)) - set(disable)
            next_selection = {**current, 'categories': categories, 'selectedIds': sorted(selected), 'visible': visible}
            changed = next_selection != current
            if changed:
                next_selection.update(selectionId=str(uuid4()), revision=current['revision'] + 1)
                view['codeSelection'] = next_selection
                view['map'], view['openNode'] = _without_code(view['map'], view['openNode'], visible)
        return {'ok': True, 'active': True, 'changed': changed, **({'reason': reason} if reason else {}),
                'visible': next_selection['visible'], 'selectionId': next_selection['selectionId'],
                'revision': next_selection['revision'], 'selectedIds': list(next_selection['selectedIds']),
                'categories': [{'id': item['id'], 'label': item['label']} for item in next_selection['categories']],
                'selectedFiles': sorted({path for item in next_selection['categories']
                                        if item['id'] in next_selection['selectedIds']
                                        for path in item.get('memberFilePaths', [])})}


def publish_project_entity_map(project: str, snapshot: dict[str, Any], open_node: Any = None,
                               selection_id: str | None = None) -> dict[str, Any]:
    """Accept typed display context, never graph writes or tool authorization."""
    snapshot = _validated_map(project, snapshot)
    detail = _selected_detail(snapshot, open_node)
    with _VISIBLE_MAP_LOCK:
        view = _VISIBLE_MAPS.setdefault(project, {})
        selection = view.get('codeSelection')
        if selection and (not selection['visible'] or not selection['selectedIds'] or selection_id != selection['selectionId']):
            snapshot, detail = _without_code(snapshot, detail, selection['visible'])
        view.update(map=snapshot, openNode=detail)
    return {"ok": True, "projectId": project}


def _selected_detail(snapshot: dict[str, Any], selected: Any) -> dict[str, Any] | None:
    if selected is None:
        return None
    if not isinstance(selected, dict) or set(selected) - {
        "id", "name", "authority", "thinks", "knows", "filePath", "categories", "contributions", "source",
    }:
        raise GraphReadError("project_entity_map_selection_invalid")
    authority, node_id = selected.get("authority"), selected.get("id")
    visible = next((entity for entity in snapshot["entities"]
                    if {"authority": authority, "id": node_id} in entity["providers"]), None)
    if visible is None:
        raise GraphReadError("project_entity_map_selection_not_visible")
    if authority not in {"thinkgraph", "knowgraph", "codegraph"}:
        raise GraphReadError("project_entity_map_authority_invalid")
    fields = {"thinkgraph": {"thinks"}, "knowgraph": {"knows"},
              "codegraph": {"filePath", "categories", "contributions", "source"}}[authority]
    if set(selected) - {"id", "name", "authority"} - fields:
        raise GraphReadError("project_entity_map_selection_invalid")
    for field in ("thinks", "knows"):
        if field in selected and (not isinstance(selected[field], list) or len(selected[field]) > 2
                or any(not isinstance(record, dict) or not isinstance(record.get("id"), str)
                       for record in selected[field])):
            raise GraphReadError("project_entity_map_selection_invalid")
    # These are the existing provider readers' already-rendered Inspector values.
    # Publication copies the displayed detail; the turn reader never queries a provider.
    from .graph_read_contract import GRAPH_RECORD_BODY_LIMIT, json_safe
    detail = json_safe(selected)
    encoded = canonical_json(detail)
    if len(encoded) > GRAPH_RECORD_BODY_LIMIT:
        raise GraphReadError("project_entity_map_selected_detail_limit_exceeded")
    return detail


def build_project_entity_map(project: str, *, include_open_node: bool = False) -> dict[str, Any]:
    with _VISIBLE_MAP_LOCK:
        view = _VISIBLE_MAPS.get(project, {"map": empty_project_entity_map(project), "openNode": None})
        result = copy.deepcopy(view["map"])
        detail = copy.deepcopy(view["openNode"]) if include_open_node else None
    if include_open_node:
        result["openNode"] = detail
    return result
