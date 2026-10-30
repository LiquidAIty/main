"""Native Project-map context for application-authored Bot deliveries.

Transport JSON is unwrapped for this request only. Hermes retains its Bot Chat
and transcript; unrelated conversation history is not extraction input.
No tools, graph writes, credentials, or session state are owned here.
"""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Project Knowledge Graph
# Relationship: Injects the current delivery's compact Project map with exact identities, directed relationships, temporal state and two stored Jev candidates, without evidence bodies or another graph read.
import json
import logging
import math

logger = logging.getLogger(__name__)


def invocation(text):
    if not isinstance(text, str):
        return None
    try:
        envelope, end = json.JSONDecoder().raw_decode(text.lstrip())
    except ValueError:
        return None
    if not isinstance(envelope, dict) or set(envelope) != {"input", "projectMapContext"}:
        return None
    context = envelope["projectMapContext"]
    if (not isinstance(envelope["input"], str) or not envelope["input"].strip()
            or not isinstance(context, dict) or any(
                not isinstance(context.get(key), str) or not context[key].strip()
                for key in ("ownerUserId", "projectId", "conversationId", "pairReference", "text")
            )):
        raise ValueError("project_graph_invocation_invalid")
    return envelope, text.lstrip()[end:]


def map_text(context):
    _, encoded = context["text"].rsplit("\n", 1)
    graph = json.loads(encoded)
    if graph["projectId"] != context["projectId"] or graph.get("complete") is not True:
        raise ValueError("project_graph_context_scope_invalid")
    relationships = []
    for relationship in graph["relationships"]:
        entry = {key: value for key, value in relationship.items()
                 if key not in {"sourceCanonicalName", "targetCanonicalName", "state"}}
        state = relationship.get("state", {})
        malformed = state is not None and not isinstance(state, dict)
        if not isinstance(state, dict):
            state = {}
        compact_state = {key: value for key, value in state.items()
                         if key in {"validAt", "invalidAt", "expiredAt"}}
        distribution = state.get("distribution")
        candidates = {}
        malformed |= distribution is not None and not isinstance(distribution, dict)
        if isinstance(distribution, dict):
            for label, weight in distribution.items():
                if (not isinstance(label, str) or not label.strip()
                        or isinstance(weight, bool) or not isinstance(weight, (int, float))
                        or not 0 <= weight <= 1 or not math.isfinite(weight)):
                    malformed = True
                elif weight > 0:
                    candidates[label] = weight
            malformed |= bool(distribution) and not candidates
        if malformed:
            logger.warning("project_graph_assessment_invalid project=%s relationship=%s",
                           graph["projectId"], relationship.get("engraphisRelationshipId")
                           or relationship.get("graphitiRelationshipId"))
        if candidates:
            compact_state["distribution"] = dict(sorted(
                candidates.items(), key=lambda item: (-item[1], item[0]))[:2])
        if compact_state:
            entry["state"] = compact_state
        relationships.append(entry)
    view = {"projectId": graph["projectId"], "complete": True,
            "entities": graph["entities"], "relationships": relationships}
    explanation = (
        "### Current Project Entity Map\n"
        "Reuse exact Entity IDs. Jev weights describe relative preference among relationship labels, "
        "not the truth of the underlying claim. Candidates describe the same directed relationship; "
        "only the leading two are shown and omitted candidates may retain weight. The stored label "
        "is preserved separately. Graph ownership remains significant. Retrieve the relevant Thinks "
        "or Knows when this map is insufficient; their bodies are not included."
    )
    return explanation + "\n" + json.dumps(view, ensure_ascii=False, separators=(",", ":"))


def project_map_context(*, session_id, user_message, **kwargs):
    parsed = invocation(user_message)
    if parsed is None:
        return None  # Not an application prepared-pair delivery.
    context = parsed[0]["projectMapContext"]
    logger.info("project_graph_context session=%s project=%s pair=%s counts=%s map=%s read_ms=%s",
                session_id, context["projectId"], context["pairReference"],
                context.get("counts"), context.get("mapSha256"), context.get("readDurationMs"))
    return {"context": map_text(context)}


def prepare_model_request(*, request, session_id, **kwargs):
    key = "messages" if isinstance(request.get("messages"), list) else "input"
    messages = request.get(key)
    if not isinstance(messages, list):
        return None
    # The latest user message is the current turn, including subsequent tool calls.
    index = next((i for i in range(len(messages) - 1, -1, -1)
                  if messages[i].get("role") == "user"), None)
    if index is None:
        return None
    current = messages[index]
    content = current.get("content")
    parts = content if isinstance(content, list) else [{"text": content}]
    if not parts or not isinstance(parts[0], dict):
        return None
    parsed = invocation(parts[0].get("text"))
    if parsed is None:
        return None
    envelope, injected = parsed
    text = envelope["input"] + injected
    rendered = [{**parts[0], "text": text}, *parts[1:]] if isinstance(content, list) else text
    system = [row for row in messages[:index] if row.get("role") in {"system", "developer"}]
    selected = [*system, {**current, "content": rendered}, *messages[index + 1:]]
    logger.info("project_graph_request_scope session=%s project=%s prior_messages_excluded=%d",
                session_id, envelope["projectMapContext"]["projectId"], index - len(system))
    return {"request": {**request, key: selected}, "reason": "application prepared pair and current Project map"}


def observe_map_delivery(*, session_id, user_message, request_messages, **kwargs):
    parsed = invocation(user_message)
    if parsed is None:
        return
    context = parsed[0]["projectMapContext"]
    encoded = json.dumps(request_messages, ensure_ascii=False)
    delivered = json.dumps(map_text(context), ensure_ascii=False)[1:-1] in encoded
    wrapped = json.dumps(user_message, ensure_ascii=False)[1:-1] in encoded
    logger.info("project_graph_request session=%s map=%s delivered=%s transport_wrapper_present=%s",
                session_id, context.get("mapSha256"), delivered, wrapped)


def register(ctx):
    ctx.register_hook("pre_llm_call", project_map_context)
    ctx.register_middleware("llm_request", prepare_model_request)
    ctx.register_hook("pre_api_request", observe_map_delivery)
