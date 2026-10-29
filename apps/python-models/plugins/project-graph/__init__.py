"""Native context hook; no tools, graph writes, credentials, or session owner."""
# Entity: Project Knowledge Graph
# Relationship: Supplies the server-read Project map frozen into the native invocation, without changing graph meaning or exposing a new tool.
import json
import logging

logger = logging.getLogger(__name__)


def project_map_context(*, session_id, **kwargs):
    from agent.session_client_env import bound_client_env

    raw = (bound_client_env() or {}).get("PROJECT_GRAPH_CONTEXT")
    if raw is None:
        # Ordinary non-application invocations have no authorized map contract.
        logger.warning("project_graph_scope_missing session=%s", session_id)
        return {"context": "Project map unavailable: no application invocation context was supplied."}
    try:
        context = json.loads(raw)
        if not isinstance(context, dict) or any(
            not isinstance(context.get(key), str) or not context[key].strip()
            for key in ("ownerUserId", "projectId", "conversationId", "pairReference", "text")
        ):
            raise ValueError("invalid invocation map context")
        logger.info(
            "project_graph_context session=%s project=%s pair=%s counts=%s map=%s read_ms=%s",
            session_id, context["projectId"], context["pairReference"],
            context.get("counts"), context.get("mapSha256"), context.get("readDurationMs"),
        )
        return {"context": context["text"]}
    except (ValueError, TypeError, KeyError):
        logger.error("project_graph_context_invalid session=%s", session_id)
        return {"context": "Project map unavailable: invalid application invocation context. Do not substitute another Project's map."}


def observe_map_delivery(*, session_id, request_messages, **kwargs):
    """Log actual request inclusion without retaining or logging message bodies."""
    from agent.session_client_env import bound_client_env

    raw = (bound_client_env() or {}).get("PROJECT_GRAPH_CONTEXT")
    if not raw:
        return
    context = json.loads(raw)
    expected = json.dumps(context["text"], ensure_ascii=False)[1:-1]
    delivered = expected in json.dumps(request_messages, ensure_ascii=False)
    logger.info("project_graph_request session=%s map=%s delivered=%s",
                session_id, context.get("mapSha256"), delivered)


def register(ctx):
    ctx.register_hook("pre_llm_call", project_map_context)
    ctx.register_hook("pre_api_request", observe_map_delivery)
