"""Agent-specific context, reference, handoff, and result lineage on Engraphis.

AgentGraph is composition, not another graph store. ThinkGraph and AgentGraph
share the one Engraphis database. All memory writes, governance, and links go
through Engraphis' native ``MemoryEngine``/``Store`` APIs; this module retains
only AgentGraph's bounded proposal contract, authority checks, rendering, and
cross-authority expansion instructions.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Callable

from engraphis.core.interfaces import MemoryRecord, MemoryType, Scope, SearchFilter

from app.python_models.thinkgraph_engraphis import ThinkGraphEngraphis, get_thinkgraph


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$")
_AUTHORITIES = {"thinkgraph", "knowgraph", "codegraph"}
_ITEM_KINDS = {"finding", "decision", "entity", "constraint", "question"}
_RELATIONSHIPS = {
    "SUPPORTS",
    "USES",
    "DEPENDS_ON",
    "CONTRADICTS",
    "ANSWERS",
    "REQUIRES",
    "RELATES_TO",
}
_MAX_ITEMS = 24
_MAX_RELATIONSHIPS = 48
_MAX_REFERENCES = 12
_MAX_PROPERTIES = 16
_MAX_TEXT = 500
_MAX_PROMPT = 4000


class AgentGraphError(ValueError):
    """Typed, user-visible AgentGraph contract failure."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _required_id(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not _ID.fullmatch(text):
        raise AgentGraphError(f"agentgraph_{field}_invalid")
    return text


def _text(value: Any, field: str, *, maximum: int = _MAX_TEXT, required: bool = True) -> str:
    text = str(value or "").strip()
    if (required and not text) or len(text) > maximum:
        raise AgentGraphError(f"agentgraph_{field}_invalid")
    return text


def _scalar_properties(value: Any, field: str) -> dict[str, str | int | float | bool]:
    if value is None:
        return {}
    if not isinstance(value, dict) or len(value) > _MAX_PROPERTIES:
        raise AgentGraphError(f"agentgraph_{field}_invalid")
    result: dict[str, str | int | float | bool] = {}
    for key, raw in value.items():
        name = _required_id(key, f"{field}_key")
        if not isinstance(raw, (str, int, float, bool)) or (
            isinstance(raw, str) and len(raw) > _MAX_TEXT
        ):
            raise AgentGraphError(f"agentgraph_{field}_scalar_required")
        result[name] = raw
    return result


def _default_graph_views(project_id: str, conversation_id: str) -> list[dict[str, Any]]:
    return list(get_thinkgraph().graph_views(project_id, conversation_id).get("views") or [])


def _default_receiver_validator(
    project_id: str,
    deck_id: str,
    receiving_agent_id: str,
) -> None:
    from app import control_plane

    deck, _revision = control_plane._load_deck(project_id, deck_id)
    card = next(
        (node for node in deck.get("nodes") or [] if str(node.get("id") or "") == receiving_agent_id),
        None,
    )
    if not isinstance(card, dict):
        raise AgentGraphError(f"agentgraph_receiving_agent_not_found: {receiving_agent_id}")
    if str(card.get("kind") or "") != "agent" or card.get("enabled") is False:
        raise AgentGraphError(f"agentgraph_receiving_agent_invalid: {receiving_agent_id}")


def _resolved_view(
    views: list[dict[str, Any]],
    *,
    authority: str,
    canonical_id: str,
) -> dict[str, Any]:
    view = next(
        (
            candidate
            for candidate in views
            if str(candidate.get("viewId") or "") == canonical_id
            and str(candidate.get("authority") or "") == authority
        ),
        None,
    )
    if not isinstance(view, dict):
        raise AgentGraphError(
            f"agentgraph_reference_not_found: authority={authority} canonical_id={canonical_id}"
        )
    return view


def _validate_proposal(
    proposal: dict[str, Any],
    *,
    project_id: str,
    conversation_id: str,
    graph_view_reader: Callable[[str, str], list[dict[str, Any]]],
) -> dict[str, Any]:
    allowed = {
        "prompt",
        "promptRef",
        "items",
        "relationships",
        "references",
        "priorContextId",
        "producingRunId",
    }
    unknown = sorted(set(proposal) - allowed)
    if unknown:
        raise AgentGraphError(f"agentgraph_proposal_fields_rejected: {','.join(unknown)}")
    prompt = _text(proposal.get("prompt"), "prompt", maximum=_MAX_PROMPT, required=False)
    prompt_ref = _text(proposal.get("promptRef"), "prompt_ref", required=False)
    if not prompt and not prompt_ref:
        raise AgentGraphError("agentgraph_prompt_or_prompt_ref_required")

    raw_items = proposal.get("items")
    if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= _MAX_ITEMS:
        raise AgentGraphError("agentgraph_items_must_contain_1_to_24_items")
    items: list[dict[str, Any]] = []
    local_ids: set[str] = set()
    for raw in raw_items:
        if not isinstance(raw, dict) or set(raw) - {"id", "kind", "text", "properties"}:
            raise AgentGraphError("agentgraph_item_shape_invalid")
        local_id = _required_id(raw.get("id"), "item_id")
        if local_id in local_ids:
            raise AgentGraphError(f"agentgraph_duplicate_local_id: {local_id}")
        kind = str(raw.get("kind") or "").strip().lower()
        if kind not in _ITEM_KINDS:
            raise AgentGraphError(f"agentgraph_item_kind_invalid: {kind}")
        local_ids.add(local_id)
        items.append(
            {
                "localId": local_id,
                "kind": kind,
                "text": _text(raw.get("text"), "item_text"),
                "properties": _scalar_properties(raw.get("properties"), "item_properties"),
            }
        )

    raw_references = proposal.get("references")
    if not isinstance(raw_references, list) or not 1 <= len(raw_references) <= _MAX_REFERENCES:
        raise AgentGraphError("agentgraph_references_must_contain_1_to_12_items")
    views = graph_view_reader(project_id, conversation_id)
    references: list[dict[str, Any]] = []
    for raw in raw_references:
        if not isinstance(raw, dict) or set(raw) - {"id", "authority", "canonicalId"}:
            raise AgentGraphError("agentgraph_reference_shape_invalid")
        local_id = _required_id(raw.get("id"), "reference_id")
        if local_id in local_ids:
            raise AgentGraphError(f"agentgraph_duplicate_local_id: {local_id}")
        authority = str(raw.get("authority") or "").strip().lower()
        if authority not in _AUTHORITIES:
            raise AgentGraphError(f"agentgraph_reference_authority_invalid: {authority}")
        canonical_id = _text(raw.get("canonicalId"), "reference_canonical_id")
        _resolved_view(views, authority=authority, canonical_id=canonical_id)
        local_ids.add(local_id)
        references.append(
            {
                "localId": local_id,
                "authority": authority,
                "canonicalId": canonical_id,
            }
        )

    raw_relationships = proposal.get("relationships")
    if not isinstance(raw_relationships, list) or not 1 <= len(raw_relationships) <= _MAX_RELATIONSHIPS:
        raise AgentGraphError("agentgraph_relationships_must_contain_1_to_48_items")
    relationships: list[dict[str, str]] = []
    for raw in raw_relationships:
        if not isinstance(raw, dict) or set(raw) - {"source", "target", "type"}:
            raise AgentGraphError("agentgraph_relationship_shape_invalid")
        source = _required_id(raw.get("source"), "relationship_source")
        target = _required_id(raw.get("target"), "relationship_target")
        predicate = str(raw.get("type") or "").strip().upper()
        if source not in local_ids or target not in local_ids or source == target:
            raise AgentGraphError("agentgraph_relationship_endpoint_invalid")
        if predicate not in _RELATIONSHIPS:
            raise AgentGraphError(f"agentgraph_relationship_type_invalid: {predicate}")
        relationships.append({"source": source, "target": target, "type": predicate})

    return {
        "prompt": prompt,
        "promptRef": prompt_ref,
        "items": items,
        "references": references,
        "relationships": relationships,
        "priorContextId": _text(
            proposal.get("priorContextId"),
            "prior_context_id",
            required=False,
        ),
        "producingRunId": _text(
            proposal.get("producingRunId"),
            "producing_run_id",
            required=False,
        ),
    }


def _scope(graph: ThinkGraphEngraphis, project_id: str) -> tuple[str, str]:
    workspace_id = graph.store.get_or_create_workspace(project_id)
    repo_id = graph.store.get_or_create_repo(workspace_id, "thinkgraph")
    return workspace_id, repo_id


def _records(graph: ThinkGraphEngraphis, project_id: str) -> list[MemoryRecord]:
    workspace_id, repo_id = _scope(graph, project_id)
    return graph.store.list_memories(
        SearchFilter(workspace_id=workspace_id, repo_id=repo_id),
    )


def _find(
    graph: ThinkGraphEngraphis,
    project_id: str,
    canonical_id: str,
    kind: str,
) -> MemoryRecord | None:
    return next(
        (
            record
            for record in _records(graph, project_id)
            if str(record.metadata.get("canonicalId") or "") == canonical_id
            and str(record.metadata.get("agentGraphKind") or "") == kind
        ),
        None,
    )


def _remember(
    graph: ThinkGraphEngraphis,
    *,
    project_id: str,
    conversation_id: str,
    canonical_id: str,
    kind: str,
    title: str,
    content: str,
    metadata: dict[str, Any],
    mtype: MemoryType,
) -> str:
    workspace_id, repo_id = _scope(graph, project_id)
    return graph.engine.remember(
        content,
        workspace_id=workspace_id,
        repo_id=repo_id,
        session_id=conversation_id,
        mtype=mtype,
        scope=Scope.REPO,
        title=title,
        metadata={
            **metadata,
            "canonicalId": canonical_id,
            "agentGraphKind": kind,
            "projectId": project_id,
            "conversationId": conversation_id,
            "provenance": {"authority": "agentgraph", "engine": "engraphis-v2"},
        },
        resolve_conflicts=False,
    )


def create_context(
    *,
    project_id: str,
    deck_id: str,
    conversation_id: str,
    receiving_agent_id: str,
    proposal: dict[str, Any],
    graph_view_reader: Callable[[str, str], list[dict[str, Any]]] = _default_graph_views,
    receiver_validator: Callable[[str, str, str], None] = _default_receiver_validator,
    graph: ThinkGraphEngraphis | None = None,
) -> dict[str, Any]:
    project_id = _text(project_id, "project_id")
    deck_id = _text(deck_id, "deck_id")
    conversation_id = _text(conversation_id, "conversation_id")
    receiving_agent_id = _required_id(receiving_agent_id, "receiving_agent_id")
    if not isinstance(proposal, dict):
        raise AgentGraphError("agentgraph_proposal_object_required")
    receiver_validator(project_id, deck_id, receiving_agent_id)
    validated = _validate_proposal(
        proposal,
        project_id=project_id,
        conversation_id=conversation_id,
        graph_view_reader=graph_view_reader,
    )
    context_id = (
        "agentctx:"
        + hashlib.sha256(
            f"{project_id}|{conversation_id}|{receiving_agent_id}|{_now()}".encode()
        ).hexdigest()[:24]
    )
    created_at = _now()
    graph = graph or get_thinkgraph()
    with graph.lock:
        prior_record = None
        if validated["priorContextId"]:
            prior_record = _find(
                graph,
                project_id,
                validated["priorContextId"],
                "context",
            )
            if prior_record is None:
                raise AgentGraphError(
                    f"agentgraph_prior_context_not_found: {validated['priorContextId']}"
                )

        context_memory_id = _remember(
            graph,
            project_id=project_id,
            conversation_id=conversation_id,
            canonical_id=context_id,
            kind="context",
            title=f"Agent context for {receiving_agent_id}",
            content=validated["prompt"] or validated["promptRef"],
            metadata={
                "context_id": context_id,
                "deck_id": deck_id,
                "receiving_agent_id": receiving_agent_id,
                "prompt": validated["prompt"],
                "prompt_ref": validated["promptRef"],
                "producing_run_id": validated["producingRunId"],
                "created_at": created_at,
            },
            mtype=MemoryType.WORKING,
        )

        persisted_ids: dict[str, str] = {}
        for item in validated["items"]:
            item_id = f"{context_id}:item:{item['localId']}"
            memory_id = _remember(
                graph,
                project_id=project_id,
                conversation_id=conversation_id,
                canonical_id=item_id,
                kind="item",
                title=f"{item['kind'].title()} for {context_id}",
                content=item["text"],
                metadata={
                    "item_id": item_id,
                    "local_id": item["localId"],
                    "context_id": context_id,
                    "kind": item["kind"],
                    "text": item["text"],
                    "properties_json": json.dumps(
                        item["properties"],
                        separators=(",", ":"),
                    ),
                },
                mtype=MemoryType.WORKING,
            )
            persisted_ids[item["localId"]] = memory_id
            graph.engine.link(context_memory_id, memory_id, relation="HAS_ITEM")

        reference_ids: list[str] = []
        for reference in validated["references"]:
            reference_id = (
                "agentref:"
                + hashlib.sha256(
                    f"{context_id}|{reference['authority']}|{reference['canonicalId']}".encode()
                ).hexdigest()[:24]
            )
            memory_id = _remember(
                graph,
                project_id=project_id,
                conversation_id=conversation_id,
                canonical_id=reference_id,
                kind="reference",
                title=f"{reference['authority']} reference for {context_id}",
                content=reference["canonicalId"],
                metadata={
                    "reference_id": reference_id,
                    "local_id": reference["localId"],
                    "context_id": context_id,
                    "authority": reference["authority"],
                    "canonical_id": reference["canonicalId"],
                },
                mtype=MemoryType.SEMANTIC,
            )
            reference_ids.append(reference_id)
            persisted_ids[reference["localId"]] = memory_id
            graph.engine.link(context_memory_id, memory_id, relation="HAS_REFERENCE")

        for relationship in validated["relationships"]:
            graph.engine.link(
                persisted_ids[relationship["source"]],
                persisted_ids[relationship["target"]],
                relation=relationship["type"],
            )
        if prior_record is not None:
            graph.engine.link(
                context_memory_id,
                prior_record.id,
                relation="DERIVED_FROM",
            )

    return {
        "ok": True,
        "contextId": context_id,
        "projectId": project_id,
        "conversationId": conversation_id,
        "receivingAgentId": receiving_agent_id,
        "referenceIds": reference_ids,
    }


def _metadata(record: MemoryRecord) -> dict[str, Any]:
    return dict(record.metadata or {})


def _context_rows(
    context_id: str,
    project_id: str,
    *,
    graph: ThinkGraphEngraphis,
) -> dict[str, Any]:
    context_record = _find(graph, project_id, context_id, "context")
    if context_record is None:
        raise AgentGraphError(f"agentgraph_context_not_found: {context_id}")
    records = [
        record
        for record in _records(graph, project_id)
        if str(record.metadata.get("context_id") or "") == context_id
    ]
    items = [record for record in records if record.metadata.get("agentGraphKind") == "item"]
    references = [
        record
        for record in records
        if record.metadata.get("agentGraphKind") == "reference"
    ]
    results = [
        record
        for record in records
        if record.metadata.get("agentGraphKind") == "result"
    ]
    related = {record.id: record for record in [*items, *references]}
    relationships: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for source in related.values():
        for link in graph.store.get_links(source.id):
            target_id = str(link["b"] if link["a"] == source.id else link["a"])
            relation = str(link.get("relation") or "")
            target = related.get(target_id)
            key = (source.id, relation, target_id)
            if (
                target is None
                or relation in {"HAS_ITEM", "HAS_REFERENCE", "PRODUCED", "DERIVED_FROM"}
                or key in seen
                or str(link["a"]) != source.id
            ):
                continue
            seen.add(key)
            relationships.append(
                {
                    "source": _metadata(source),
                    "type": relation,
                    "target": _metadata(target),
                }
            )
    return {
        "context": _metadata(context_record),
        "items": [_metadata(record) for record in items],
        "references": [_metadata(record) for record in references],
        "relationships": relationships,
        "agent": {"agent_id": context_record.metadata.get("receiving_agent_id")},
        "results": [_metadata(record) for record in results],
    }


def _expansion_for_view(reference: dict[str, Any], view: dict[str, Any]) -> dict[str, Any]:
    authority = str(reference["authority"])
    if authority == "codegraph":
        roots = [
            str(value)
            for value in (view.get("rootCanonicalNodeIds") or [])
            if str(value).strip()
        ]
        canonical = roots[0] if roots else str(reference["canonical_id"])
        return {
            "tool": "mcp__codebase-memory__search_graph",
            "arguments": {
                "project": os.environ.get(
                    "LIQUIDAITY_CODEGRAPH_PROJECT",
                    "C-Projects-main",
                ),
                "qn_pattern": f"^{re.escape(canonical)}$",
                "include_connected": True,
                "limit": 50,
            },
        }
    if authority == "knowgraph":
        return {
            "tool": "knowgraph.query",
            "arguments": {
                "projectId": reference["projectId"],
                "conversationId": reference["conversationId"],
                "query": str(view.get("query") or reference["canonical_id"]),
                "anchors": list(view.get("rootCanonicalNodeIds") or [])[:12],
                "maxResults": 5,
                "parentViewId": reference["canonical_id"],
            },
        }
    return {
        "tool": "engraphis_recall",
        "arguments": {
            "workspace": reference["projectId"],
            "repo": "thinkgraph",
            "query": str(view.get("query") or reference["canonical_id"]),
            "k": 20,
        },
    }


def _node_name(properties: dict[str, Any]) -> str:
    if properties.get("reference_id"):
        return f"Reference:{properties['reference_id']}"
    return f"{str(properties.get('kind') or 'item').title()}:{properties.get('text')}"


def _render_literate(rows: dict[str, Any]) -> str:
    context = rows["context"]
    references = {
        str(reference["reference_id"]): reference
        for reference in rows["references"]
    }
    lines = [
        f"[CONTEXT {context['context_id']}]",
        f"project = {context['projectId']} | conversation = {context['conversationId']}",
        f"prompt reference = {context.get('prompt_ref') or 'inline'}",
    ]
    for relationship in rows["relationships"]:
        lines.append(
            f"({_node_name(relationship['source'])})"
            f"-[:{relationship['type']}]->"
            f"({_node_name(relationship['target'])})"
        )
    lines.append(
        f"(Context:{context['context_id']})"
        f"-[:SENT_TO]->(Agent:{rows['agent'].get('agent_id')})"
    )
    for reference in references.values():
        expansion = reference["expansion"]
        lines.extend(
            [
                "",
                f"Reference {reference['reference_id']}:",
                f"  authority = {reference['authority']}",
                f"  canonical view = {reference['canonical_id']}",
                f"  expand with = {expansion['tool']}",
                f"  arguments = {json.dumps(expansion['arguments'], separators=(',', ':'))}",
            ]
        )
    return "\n".join(lines)


def read_context(
    context_id: str,
    project_id: str,
    *,
    graph_view_reader: Callable[[str, str], list[dict[str, Any]]] = _default_graph_views,
    graph: ThinkGraphEngraphis | None = None,
) -> dict[str, Any]:
    context_id = _text(context_id, "context_id")
    project_id = _text(project_id, "project_id")
    graph = graph or get_thinkgraph()
    with graph.lock:
        rows = _context_rows(context_id, project_id, graph=graph)
    views = graph_view_reader(project_id, str(rows["context"]["conversationId"]))
    for reference in rows["references"]:
        view = _resolved_view(
            views,
            authority=str(reference["authority"]),
            canonical_id=str(reference["canonical_id"]),
        )
        reference["expansion"] = _expansion_for_view(reference, view)
    return {
        "ok": True,
        "contextId": context_id,
        "projectId": project_id,
        "conversationId": rows["context"]["conversationId"],
        "receivingAgentId": rows["agent"].get("agent_id"),
        "literateQueryView": _render_literate(rows),
        "items": rows["items"],
        "relationships": rows["relationships"],
        "references": rows["references"],
        "results": rows["results"],
    }


def record_result(
    *,
    context_id: str,
    project_id: str,
    result_id: str,
    run_id: str,
    status: str,
    result_ref: str = "",
    graph: ThinkGraphEngraphis | None = None,
) -> dict[str, Any]:
    context_id = _text(context_id, "context_id")
    project_id = _text(project_id, "project_id")
    result_id = _required_id(result_id, "result_id")
    run_id = _text(run_id, "result_run_id")
    status = _text(status, "result_status")
    result_ref = _text(result_ref, "result_ref", required=False)
    graph = graph or get_thinkgraph()
    with graph.lock:
        context_record = _find(graph, project_id, context_id, "context")
        if context_record is None:
            raise AgentGraphError(f"agentgraph_context_not_found: {context_id}")
        existing = _find(graph, project_id, result_id, "result")
        desired = {
            "result_id": result_id,
            "context_id": context_id,
            "run_id": run_id,
            "status": status,
            "result_ref": result_ref,
        }
        if existing is not None and all(
            existing.metadata.get(key) == value
            for key, value in desired.items()
        ):
            return {"ok": True, "contextId": context_id, "resultId": result_id}
        if existing is not None:
            graph.engine.forget(
                existing.id,
                actor="agentgraph",
                reason="result lineage advanced",
            )
        result_memory_id = _remember(
            graph,
            project_id=project_id,
            conversation_id=str(context_record.metadata.get("conversationId") or ""),
            canonical_id=result_id,
            kind="result",
            title=f"Agent result {result_id}",
            content=json.dumps(desired, sort_keys=True, separators=(",", ":")),
            metadata={**desired, "created_at": _now()},
            mtype=MemoryType.EPISODIC,
        )
        graph.engine.link(context_record.id, result_memory_id, relation="PRODUCED")
    return {"ok": True, "contextId": context_id, "resultId": result_id}


async def expand_reference(
    reference_id: str,
    project_id: str,
    *,
    graph_view_reader: Callable[[str, str], list[dict[str, Any]]] = _default_graph_views,
    graph: ThinkGraphEngraphis | None = None,
) -> dict[str, Any]:
    reference_id = _text(reference_id, "reference_id")
    project_id = _text(project_id, "project_id")
    graph = graph or get_thinkgraph()
    with graph.lock:
        reference_record = _find(graph, project_id, reference_id, "reference")
    if reference_record is None:
        raise AgentGraphError(f"agentgraph_reference_not_found: {reference_id}")
    reference = _metadata(reference_record)
    views = await asyncio.to_thread(
        graph_view_reader,
        project_id,
        str(reference["conversationId"]),
    )
    view = _resolved_view(
        views,
        authority=str(reference["authority"]),
        canonical_id=str(reference["canonical_id"]),
    )
    expansion = _expansion_for_view(reference, view)
    authority = str(reference["authority"])
    if authority == "knowgraph":
        from app.python_models.tool_registry import retrieve_knowgraph_context_tool

        args = expansion["arguments"]
        result: dict[str, Any] = await retrieve_knowgraph_context_tool(
            project_id=str(args["projectId"]),
            conversation_id=str(args["conversationId"]),
            query=str(args["query"]),
            anchors=[str(value) for value in args["anchors"]],
            max_results=int(args["maxResults"]),
            parent_view_id=str(args["parentViewId"]),
        )
    elif authority == "thinkgraph":
        args = expansion["arguments"]
        result = await asyncio.to_thread(
            graph.recall,
            project_id,
            str(args["query"]),
            k=int(args["k"]),
        )
    else:
        # CodeGraph references return the persisted selection plus the exact native
        # CBM call the receiving agent can execute; AgentGraph never proxies or
        # narrows CBM.
        result = {"view": view, "nativeCall": expansion}
    if not isinstance(result, dict) or result.get("ok") is False:
        detail = result.get("error") if isinstance(result, dict) else "invalid_result"
        raise AgentGraphError(f"agentgraph_reference_expansion_failed: {detail}")
    return {
        "ok": True,
        "referenceId": reference_id,
        "authority": authority,
        "canonicalId": reference["canonical_id"],
        "delegatedTool": expansion["tool"],
        "result": result,
    }
