"""Native Project-map context for admitted Main, KnowGraph and ThinkGraph turns.

Transport JSON is unwrapped for this request only. Hermes retains its Bot Chat
and transcript; unrelated conversation history is not extraction input.
Granted application operations supply context; native admissions remain execution authority.
"""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Project Knowledge Graph
# Relationship: Injects one compact map through native admission-bound reads, preserves prepared ThinkGraph delivery, and scopes Main and KnowGraph research context and calls to the current native turn.
import json
import logging
import math

logger = logging.getLogger(__name__)
# Hermes dispatches callbacks on separate threads; retain only the current
# native turn's context, keyed by its documented opaque turn_id, until turn end.
_turn_context = {}
_call_mcp = None
_recipient = "thinkgraph"


def _graph_call(name, arguments):
    result = _call_mcp("liquidaity", "project_graph." + name, arguments, timeout=20)
    if result.get("truncated") or result.get("ok") is False:
        logger.warning("project_graph_call_failed operation=%s error=%s", name, result.get("error", "truncated result"))
        raise ValueError("project_graph_context_unavailable")
    if isinstance(result, dict) and "result" in result:
        result = json.loads(result["result"]) if isinstance(result["result"], str) else result["result"]
    if not isinstance(result, dict) or result.get("error") or result.get("ok") is False:
        logger.warning("project_graph_call_rejected operation=%s error=%s", name,
                       result.get("error") if isinstance(result, dict) else "invalid response")
        raise ValueError("project_graph_context_unavailable")
    return result


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


def prepared_invocation(text):
    if _recipient == "thinkgraph":
        return invocation(text)
    if _recipient != "knowgraph" or not isinstance(text, str):
        return None
    _, marker, body = text.partition("PROJECT_RESEARCH_REQUEST:")
    reference, separator, envelope = body.partition("\n")
    parsed = invocation(envelope) if marker and separator else None
    if parsed and parsed[0]["projectMapContext"]["pairReference"] != reference:
        raise ValueError("project_graph_research_reference_mismatch")
    return parsed


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
        "Reuse canonical Entity names across graphs. Provider IDs are not interchangeable: "
        "engraphisEntityId belongs only to ThinkGraph; graphitiEntityId belongs only to KnowGraph. "
        "When graphitiEntityId is absent, omit entity_uuid from Graphiti writes and use entity_name; "
        "the existing name resolver creates the first permitted Graphiti representation. "
        "Jev weights describe relative preference among relationship labels, "
        "not the truth of the underlying claim. Candidates describe the same directed relationship; "
        "only the leading two are shown and omitted candidates may retain weight. The stored label "
        "is preserved separately. Graph ownership remains significant. Retrieve the relevant Thinks "
        "or Knows when this map is insufficient; their bodies are not included."
    )
    return explanation + "\n" + json.dumps(view, ensure_ascii=False, separators=(",", ":"))


def project_map_context(*, session_id, user_message, **kwargs):
    parsed = prepared_invocation(user_message)
    if _recipient in {"main", "knowgraph"}:
        turn = kwargs.get("turn_id")
        history = kwargs.get("conversation_history") or []
        user = next((row for row in reversed(history) if row.get("role") == "user"), {})
        admission = user.get("platform_message_id")
        if not admission or not turn or _call_mcp is None:
            return None
        _turn_context[turn] = {"admission": admission, "packet": (
            {"projectMapContext": parsed[0]["projectMapContext"]} if parsed else None), "sessionId": session_id}
    if parsed is None:
        return None  # Native tool discovery/reconnection precedes request middleware.
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
    parsed = prepared_invocation(parts[0].get("text")) if parts and isinstance(parts[0], dict) else None
    if _recipient in {"main", "knowgraph"} and parsed is None:
        context = _turn_context.get(kwargs.get("turn_id"))
        if not context:
            return None
        if context["packet"] is None:
            context["packet"] = _graph_call("read_map", {"_nativeAdmissionId": context["admission"]})
        packet = context["packet"]
        text = map_text(packet["projectMapContext"])
        if packet.get("selectedContext"):
            text += "\nSelected research context (Thinks are framing, not evidence):\n" + json.dumps(packet["selectedContext"], ensure_ascii=False)
        if _recipient == "knowgraph":
            text += "\nResearch assignment:\n" + json.dumps(packet["research"], ensure_ascii=False)
        content = current.get("content")
        rendered = ([*content, {"type": "text", "text": text}] if isinstance(content, list)
                    else str(content or "") + "\n\n" + text)
        prior = (messages[:index] if _recipient == "main" else
                 [row for row in messages[:index] if row.get("role") in {"system", "developer"}])
        return {"request": {**request, key: [*prior, {**current, "content": rendered}, *messages[index + 1:]]},
                "reason": "current scoped Project map"}
    if parsed is None:
        # Ordinary Main/KnowGraph turns retain their native history. Only the
        # established prepared ThinkGraph envelope excludes prior chat.
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
    parsed = prepared_invocation(user_message)
    if parsed is None:
        current = _turn_context.get(kwargs.get("turn_id"))
        if not current or not current.get("packet"):
            return
        context = current["packet"]["projectMapContext"]
    else:
        context = parsed[0]["projectMapContext"]
    encoded = json.dumps(request_messages, ensure_ascii=False)
    delivered = json.dumps(map_text(context), ensure_ascii=False)[1:-1] in encoded
    wrapped = parsed is not None and json.dumps(user_message, ensure_ascii=False)[1:-1] in encoded
    count = encoded.count(json.dumps(map_text(context), ensure_ascii=False)[1:-1])
    logger.info("project_graph_request session=%s map=%s delivered=%s copies=%s transport_wrapper_present=%s",
                session_id, context.get("mapSha256"), delivered, count, wrapped)


def register(ctx):
    global _call_mcp, _recipient
    _call_mcp = ctx.call_mcp
    _recipient = ctx.get_config("recipient", "thinkgraph")
    ctx.register_hook("pre_llm_call", project_map_context)
    ctx.register_middleware("llm_request", prepare_model_request)
    ctx.register_hook("pre_api_request", observe_map_delivery)
    ctx.register_hook("pre_tool_call", before_tool)
    ctx.register_hook("post_llm_call", end_context)
    ctx.register_hook("on_session_end", end_context)


def before_tool(*, tool_name, args, session_id="", **kwargs):
    graph_tool = tool_name.startswith(tuple("mcp__liquidaity__" + family
        for family in ("project_graph_", "graphiti_", "engraphis_")))
    current = _turn_context.get(kwargs.get("turn_id"))
    if not current:
        if _recipient in {"main", "knowgraph"} and (graph_tool
                or (tool_name == "message_agent" and str(args.get("target", "")).lstrip("@").casefold() == "knowgraph")):
            return {"action": "block", "message": "The current native turn has no authorized Project context; nothing was submitted."}
        return None
    admission = current["admission"]
    if graph_tool:
        return {"action": "modify", "args": {**args, "_nativeAdmissionId": admission}}
    if tool_name != "message_agent" or str(args.get("target", "")).lstrip("@").casefold() != "knowgraph":
        return None
    try:
        message = str(args.get("message") or "")
        if message.startswith("PROJECT_RESEARCH_REQUEST:"):
            return None  # A reference already prepared by the granted operation.
        selection = json.loads(message)
        prepared = _graph_call("prepare_research", {**selection, "_nativeAdmissionId": admission})
        return {"action": "modify", "args": {**args, "message": prepared["message"]}}
    except Exception as error:
        logger.warning("project_graph_research_not_sent reason=%s", error)
        return {"action": "block", "message": "Research context preparation failed; no message was delivered to KnowGraph. Do not retry automatically or guess different Entity IDs. Report the preparation failure."}


def end_context(*, session_id, turn_id="", **kwargs):
    if turn_id:
        _turn_context.pop(turn_id, None)
        return
    for turn, context in list(_turn_context.items()):
        if context["sessionId"] == session_id:
            _turn_context.pop(turn, None)
