from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.teams import MagenticOneGroupChat, RoundRobinGroupChat, SelectorGroupChat

from app.python_models.autogen_provider_env import (
    AutoGenAgentConfig,
    _assert_magentic_safe_model,
    _build_model_client,
)
from app.python_models.autogen_research import (
    _extract_json_object,
    _message_to_text,
)
from app.python_models.orchestration_contracts import (
    AssistantResponseReport,
    BlackboardEntry,
    BlackboardWriteReport,
    ContextPack,
    GapInput,
    KnowGraphUpdateReport,
    OrchestratorMetrics,
    OrchestratorRunResponse,
    PlanContext,
    PlanUpdateReport,
    SearchTaskInput,
    ThinkGraphContext,
    ThinkGraphUpdateReport,
    TripletInput,
    WorkspaceObjectContext,
)


@dataclass
class _PassResult:
    final_response_text: str
    blackboard_entries: list[BlackboardEntry]
    plan: PlanContext
    think_graph: ThinkGraphContext
    know_graph: KnowGraphUpdateReport
    transcript: list[str]
    stop_reason: str | None
    turns_used: int


DEFAULT_SELECTOR_PROMPT = (
    "You select the next participant for this card runtime. "
    "Available participants:\n{roles}\n\n"
    "Conversation so far:\n{history}\n\n"
    "Choose the next speaker from {participants}. Return only the role name."
)


def _trim_text(value: object, limit: int) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 3)].rstrip()}..."


def _compact_triplets(triplets: list[TripletInput], limit: int) -> list[dict[str, object]]:
    return [
        {
            "entityA": triplet.entityA,
            "relationshipType": triplet.relationshipType,
            "entityB": triplet.entityB,
        }
        for triplet in triplets[:limit]
    ]


def _compact_gaps(gaps: list[GapInput], limit: int) -> list[dict[str, object]]:
    return [
        {
            "entityA": gap.entityA,
            "relationshipType": gap.relationshipType,
            "entityB": gap.entityB,
            "gapType": gap.gapType,
            "priority": gap.priority,
            "reason": _trim_text(gap.reason, 140),
        }
        for gap in gaps[:limit]
    ]


def _context_payload_json(context: ContextPack) -> str:
    compact_payload = {
        "session": {
            "projectId": context.session.projectId,
            "turnId": context.session.turnId,
            "route": context.session.route,
        },
        "userText": _trim_text(context.userText, 340),
        "priorAssistantText": _trim_text(context.priorAssistantText, 120),
        "blackboard": {
            "current_goal": _trim_text(context.blackboard.current_goal, 120),
            "what_matters_now": context.blackboard.what_matters_now[:3],
            "open_questions": context.blackboard.open_questions[:3],
            "findings": context.blackboard.findings[:2],
            "next_move": _trim_text(context.blackboard.next_move, 120),
        },
        "plan": {
            "status": context.plan.status,
            "anchor_excerpt": _trim_text(context.plan.anchor, 380),
            "whatChanged": context.plan.whatChanged[:3],
            "openQuestions": context.plan.openQuestions[:3],
            "sources": context.plan.sources[:3],
        },
        "thinkGraph": {
            "priorityEntities": context.thinkGraph.priorityEntities[:4],
            "priorityRelationships": context.thinkGraph.priorityRelationships[:3],
            "triplets": _compact_triplets(context.thinkGraph.triplets, 3),
            "openQuestions": context.thinkGraph.openQuestions[:3],
        },
        "knowGraph": {
            "researchDocumentCount": context.knowGraph.researchDocumentCount,
            "gaps": _compact_gaps(context.knowGraph.gaps, 3),
            "graphFacts": [
                {
                    "entityA": fact.entityA,
                    "relationshipType": fact.relationshipType,
                    "entityB": fact.entityB,
                    "sourceName": _trim_text(fact.sourceName, 80),
                }
                for fact in context.knowGraph.graphFacts[:2]
            ],
            "evidence": [
                {
                    "title": _trim_text(evidence.title, 80),
                    "url": evidence.url,
                    "snippet": _trim_text(evidence.snippet, 120),
                }
                for evidence in context.knowGraph.evidence[:1]
            ],
        },
        "attachments": [
            {
                "documentId": attachment.documentId,
                "fileName": attachment.fileName,
            }
            for attachment in context.attachments[:3]
        ],
        "maxResearchTasks": max(1, min(context.maxResearchTasks, 4)),
    }
    return json.dumps(compact_payload, ensure_ascii=True)


def _normalize_plan(raw: object) -> PlanContext:
    if not isinstance(raw, dict):
        raise RuntimeError("orchestrator_plan_missing")
    status_raw = str(raw.get("status") or "").strip().lower()
    if status_raw in {"updated", "revise", "revised_now"}:
        status = "revised"
    elif status_raw in {"grounded", "confirmed", "stable"}:
        status = "grounded"
    else:
        status = "draft" if status_raw not in {"draft", "revised"} else status_raw
    payload = {
        "anchor": str(raw.get("anchor") or "").strip(),
        "whatChanged": _coerce_string_list(raw.get("whatChanged") or raw.get("what_changed") or [])[:4],
        "openQuestions": _coerce_string_list(raw.get("openQuestions") or raw.get("open_questions") or [])[:4],
        "sources": _coerce_string_list(raw.get("sources") or [])[:4],
        "deltaSummary": _short_summary(raw.get("deltaSummary") or raw.get("delta_summary"), "Plan updated", limit=96),
        "status": status,
    }
    return PlanContext.model_validate(payload)


def _coerce_string_list(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    values: list[str] = []
    seen: set[str] = set()
    for item in raw:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        values.append(text)
    return values


def _short_summary(value: object, fallback: str, limit: int = 88) -> str:
    text = _trim_text(value, limit)
    return text or fallback


def _clean_final_response_text(value: object) -> str:
    text = " ".join(str(value or "").strip().split())
    if not text:
        return ""
    sentences = [segment.strip() for segment in re.split(r"(?<=[.!?])\s+", text) if segment.strip()]
    skip_follow_up_prefixes = (
        "this completes",
        "this aligns",
        "this means",
        "in practice",
        "the goal is",
    )
    cleaned: list[str] = []
    for sentence in sentences:
        lower = sentence.lower()
        if cleaned and lower.startswith(skip_follow_up_prefixes):
            continue
        cleaned.append(sentence)
        if len(cleaned) >= 2:
            break
    return _trim_text(" ".join(cleaned or [text]), 170)


def _first_action_sentence(value: object) -> str:
    text = _clean_final_response_text(value)
    if not text:
        return ""
    first = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0].strip()
    return _trim_text(first, 120)


def _clean_search_query(value: object) -> str:
    text = " ".join(str(value or "").strip().split())
    lower = text.lower()
    prefixes = (
        "search for ",
        "look up ",
        "find evidence about ",
        "find evidence for ",
        "research ",
    )
    for prefix in prefixes:
        if lower.startswith(prefix):
            text = text[len(prefix) :].strip()
            break
    return _trim_text(text, 160)


def _blackboard_entry_has_value(entry: BlackboardEntry) -> bool:
    return bool(
        (entry.valueText and entry.valueText.strip())
        or [item for item in entry.valueList if str(item).strip()]
    )


def _normalize_blackboard_entries(raw: object) -> list[BlackboardEntry]:
    if not isinstance(raw, list):
        return []

    scalar_fields = {"current_goal", "next_move"}
    aggregated: dict[str, BlackboardEntry] = {}

    for item in raw:
        if not isinstance(item, dict):
            continue
        field = str(item.get("field") or "").strip()
        if not field:
            continue
        value_text = _trim_text(item.get("valueText"), 160) or None
        value_list = _coerce_string_list(item.get("valueList") or [])[:4]
        mode = str(item.get("mode") or "").strip().lower() or ("set" if field in scalar_fields else "append")
        entry = BlackboardEntry(
            field=field,
            mode="set" if field in scalar_fields else ("append" if mode == "append" else "set"),
            valueText=value_text if field in scalar_fields else None,
            valueList=value_list if field not in scalar_fields else [],
            sourceAgent=str(item.get("sourceAgent") or "Response_Writer").strip() or "Response_Writer",
            summary=_short_summary(
                item.get("summary") or value_text or (value_list[0] if value_list else ""),
                "State update",
                limit=72,
            ),
        )
        if not _blackboard_entry_has_value(entry):
            continue
        if field in scalar_fields:
            aggregated[field] = entry
            continue
        previous = aggregated.get(field)
        merged_list = [
            *([] if previous is None else previous.valueList),
            *entry.valueList,
        ]
        aggregated[field] = BlackboardEntry(
            field=field,
            mode="set",
            valueList=_coerce_string_list(merged_list)[:4],
            sourceAgent=entry.sourceAgent,
            summary=entry.summary,
        )

    ordered_fields = [
        "current_goal",
        "what_matters_now",
        "open_questions",
        "findings",
        "next_move",
        "suggestions",
        "next_options",
    ]
    return [aggregated[field] for field in ordered_fields if field in aggregated][:4]


def _normalize_triplets(raw: object) -> list[TripletInput]:
    if not isinstance(raw, list):
        return []
    triplets: list[TripletInput] = []
    for item in raw:
        try:
            if isinstance(item, dict):
                triplets.append(TripletInput.model_validate(item))
                continue
            if isinstance(item, (list, tuple)) and len(item) >= 3:
                entity_a = str(item[0] or "").strip()
                rel = str(item[1] or "").strip()
                entity_b = str(item[2] or "").strip()
                if entity_a and rel and entity_b:
                    triplets.append(
                        TripletInput(
                            entityA=entity_a,
                            relationshipType=rel,
                            entityB=entity_b,
                        )
                    )
        except Exception:
            continue
    return triplets


def _normalize_gaps(raw: object) -> list[GapInput]:
    if not isinstance(raw, list):
        return []
    gaps: list[GapInput] = []
    for item in raw:
        try:
            if isinstance(item, dict):
                gaps.append(GapInput.model_validate(item))
                continue
            if isinstance(item, (list, tuple)) and len(item) >= 4:
                entity_a = str(item[0] or "").strip()
                rel = str(item[1] or "").strip()
                entity_b = str(item[2] or "").strip()
                gap_type = str(item[3] or "").strip() or "missing_evidence"
                if entity_a and rel and entity_b:
                    gaps.append(
                        GapInput(
                            entityA=entity_a,
                            relationshipType=rel,
                            entityB=entity_b,
                            gapType=gap_type,
                        )
                    )
        except Exception:
            continue
    return gaps


def _normalize_search_tasks(raw: object, limit: int) -> list[SearchTaskInput]:
    if not isinstance(raw, list):
        return []
    seen: set[tuple[str, str]] = set()
    tasks: list[SearchTaskInput] = []
    for item in raw:
        try:
            if isinstance(item, dict):
                payload = dict(item)
                if "triplet" in payload:
                    triplets = _normalize_triplets([payload.get("triplet")])
                    payload["triplet"] = triplets[0] if triplets else None
                if "gap" in payload:
                    gaps = _normalize_gaps([payload.get("gap")])
                    payload["gap"] = gaps[0] if gaps else None
                payload["query"] = _clean_search_query(payload.get("query"))
                if not payload["query"]:
                    continue
                payload["intent"] = str(payload.get("intent") or "verify").strip() or "verify"
                payload["priority"] = str(payload.get("priority") or "high").strip() or "high"
                task = SearchTaskInput.model_validate(payload)
                dedupe_key = (task.query.lower(), task.intent.lower())
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                tasks.append(task)
                continue
            query = _clean_search_query(item)
            if query:
                dedupe_key = (query.lower(), "verify")
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                tasks.append(SearchTaskInput(query=query))
        except Exception:
            continue
        if len(tasks) >= limit:
            break
    return tasks[:limit]


def _derive_search_tasks(
    max_research_tasks: int,
    think_graph: ThinkGraphContext,
    know_graph: KnowGraphUpdateReport,
    plan: PlanContext,
) -> list[SearchTaskInput]:
    seeded = _normalize_search_tasks(know_graph.searchTasks, max_research_tasks)
    if seeded:
        return seeded[:max_research_tasks]

    derived: list[SearchTaskInput] = []
    seen: set[tuple[str, str]] = set()

    def push(task: SearchTaskInput) -> None:
        if len(derived) >= max_research_tasks:
            return
        key = (task.query.lower(), task.intent.lower())
        if key in seen:
            return
        seen.add(key)
        derived.append(task)

    for gap in know_graph.gaps[:2]:
        query = _clean_search_query(
            f"{gap.entityA} {gap.relationshipType.replace('_', ' ')} {gap.entityB} evidence {gap.reason or ''}"
        )
        if query:
            push(
                SearchTaskInput(
                    query=query,
                    intent="verify",
                    priority=gap.priority or "high",
                    gap=gap,
                )
            )

    for triplet in (know_graph.triplets or think_graph.triplets)[:2]:
        query = _clean_search_query(
            f"{triplet.entityA} {triplet.relationshipType.replace('_', ' ')} {triplet.entityB} source evidence"
        )
        if query:
            push(
                SearchTaskInput(
                    query=query,
                    intent="verify",
                    priority="high",
                    triplet=triplet,
                )
            )

    question_entities = think_graph.priorityEntities[:2] or know_graph.priorityEntities[:2]
    for question in _coerce_string_list(
        [*know_graph.openQuestions, *think_graph.openQuestions, *plan.openQuestions]
    )[:3]:
        suffix = f" {question_entities[0]}" if question_entities else ""
        query = _clean_search_query(f"{question}{suffix}")
        if query:
            push(
                SearchTaskInput(
                    query=query,
                    intent="discover",
                    priority="medium",
                )
            )

    return derived[:max_research_tasks]


def _ensure_knowgraph_output(
    know_graph: KnowGraphUpdateReport,
    think_graph: ThinkGraphContext,
    plan: PlanContext,
    max_research_tasks: int,
) -> KnowGraphUpdateReport:
    search_tasks = _derive_search_tasks(max_research_tasks, think_graph, know_graph, plan)
    priority_entities = _coerce_string_list(
        [
            *know_graph.priorityEntities,
            *think_graph.priorityEntities,
            *[task.triplet.entityA for task in search_tasks if task.triplet],
            *[task.triplet.entityB for task in search_tasks if task.triplet],
            *[task.gap.entityA for task in search_tasks if task.gap],
            *[task.gap.entityB for task in search_tasks if task.gap],
        ]
    )[:4]
    summary = (
        f"Research follow-up with {len(search_tasks)} concrete tasks"
        if search_tasks
        else know_graph.summary or "Research follow-up"
    )
    return know_graph.model_copy(
        update={
            "summary": _short_summary(summary, "Research follow-up", limit=80),
            "searchTasks": search_tasks,
            "priorityEntities": priority_entities,
        }
    )


def _normalize_thinkgraph(raw: object) -> ThinkGraphContext:
    if not isinstance(raw, dict):
        raise RuntimeError("orchestrator_thinkgraph_missing")
    payload = {
        "priorityEntities": _coerce_string_list(raw.get("priorityEntities") or raw.get("priority_entities") or [])[:4],
        "priorityRelationships": _coerce_string_list(
            raw.get("priorityRelationships") or raw.get("priority_relationships") or []
        )[:4],
        "triplets": _normalize_triplets(raw.get("triplets") or [])[:4],
        "openQuestions": _coerce_string_list(raw.get("openQuestions") or raw.get("open_questions") or [])[:4],
    }
    return ThinkGraphContext.model_validate(payload)


def _normalize_knowgraph(raw: object, max_research_tasks: int) -> KnowGraphUpdateReport:
    if not isinstance(raw, dict):
        raise RuntimeError("orchestrator_knowgraph_missing")
    payload = {
        "kind": "knowgraph_update",
        "sourceAgent": str(raw.get("sourceAgent") or "Research_Coordinator"),
        "summary": _short_summary(raw.get("summary"), "Structured KnowGraph research directives", limit=80),
        "searchTasks": _normalize_search_tasks(raw.get("searchTasks") or raw.get("search_tasks") or [], max_research_tasks),
        "priorityEntities": _coerce_string_list(raw.get("priorityEntities") or raw.get("priority_entities") or [])[:4],
        "priorityRelationships": _coerce_string_list(
            raw.get("priorityRelationships") or raw.get("priority_relationships") or []
        )[:4],
        "triplets": _normalize_triplets(raw.get("triplets") or [])[:4],
        "gaps": _normalize_gaps(raw.get("gaps") or [])[:4],
        "openQuestions": _coerce_string_list(raw.get("openQuestions") or raw.get("open_questions") or [])[:4],
    }
    return KnowGraphUpdateReport.model_validate(payload)


def _default_card_runtime_plan(context: ContextPack) -> PlanContext:
    runtime = context.cardRuntime
    callable_heads = []
    if runtime is not None and isinstance(runtime.magentic, dict):
        callable_heads = runtime.magentic.get("callableHeads") or []
    return PlanContext(
        anchor=str(getattr(runtime, "prompt", "") or context.systemPrompt or "").strip(),
        whatChanged=[],
        openQuestions=_coerce_string_list(context.blackboard.open_questions)[:4],
        sources=_coerce_string_list(
            [str(item.get("title") or "").strip() for item in callable_heads if isinstance(item, dict)]
        )[:4],
        deltaSummary="Card runtime updated",
        status="draft",
    )


def _default_card_runtime_thinkgraph(context: ContextPack) -> ThinkGraphContext:
    runtime = context.cardRuntime
    callable_heads = []
    if runtime is not None and isinstance(runtime.magentic, dict):
        callable_heads = runtime.magentic.get("callableHeads") or []
    return ThinkGraphContext(
        priorityEntities=_coerce_string_list(
            [str(item.get("title") or "").strip() for item in callable_heads if isinstance(item, dict)]
        )[:4],
        priorityRelationships=[],
        triplets=[],
        openQuestions=_coerce_string_list(context.blackboard.open_questions)[:4],
    )


def _default_card_runtime_knowgraph(context: ContextPack) -> KnowGraphUpdateReport:
    return KnowGraphUpdateReport(
        sourceAgent="Runtime_Synthesizer",
        summary="Card runtime research directives",
        searchTasks=[],
        priorityEntities=[],
        priorityRelationships=[],
        triplets=[],
        gaps=[],
        openQuestions=[],
    )


def _message_source(message: object) -> str:
    return str(getattr(message, "source", "") or "").strip()


def _count_turns(messages: list[object]) -> int:
    return sum(1 for message in messages if _message_source(message) in {"Research_Coordinator", "Response_Writer"})


def _has_explicit_next_move(blackboard_entries: list[BlackboardEntry]) -> bool:
    for entry in blackboard_entries:
        if entry.field == "next_move" and entry.valueText and entry.valueText.strip():
            return True
    return False


def _ensure_blackboard_entries(
    blackboard_entries: list[BlackboardEntry],
    final_response_text: str,
    plan: PlanContext,
    think_graph: ThinkGraphContext,
    know_graph: KnowGraphUpdateReport,
) -> list[BlackboardEntry]:
    ensured = list(blackboard_entries[:4])
    seen_fields = {entry.field for entry in ensured}

    if "next_move" not in seen_fields and final_response_text:
        ensured.insert(
            0,
            BlackboardEntry(
                field="next_move",
                mode="set",
                valueText=_first_action_sentence(final_response_text),
                sourceAgent="Response_Writer",
                summary="Best next move",
            ),
        )
        seen_fields.add("next_move")

    if "what_matters_now" not in seen_fields:
        items: list[str] = []
        if know_graph.searchTasks:
            items.append(_trim_text(f"Verify: {know_graph.searchTasks[0].query}", 120))
        if plan.whatChanged:
            items.append(_trim_text(plan.whatChanged[0], 120))
        if items:
            ensured.append(
                BlackboardEntry(
                    field="what_matters_now",
                    mode="set",
                    valueList=_coerce_string_list(items)[:2],
                    sourceAgent="Response_Writer",
                    summary="Immediate focus",
                )
            )

    if "open_questions" not in seen_fields:
        open_questions = _coerce_string_list([*plan.openQuestions, *think_graph.openQuestions])[:3]
        if open_questions:
            ensured.append(
                BlackboardEntry(
                    field="open_questions",
                    mode="set",
                    valueList=open_questions,
                    sourceAgent="Research_Coordinator",
                    summary="Remaining open questions",
                )
            )

    return ensured[:4]


def _needs_refinement(result: _PassResult) -> bool:
    open_question_count = (
        len(result.plan.openQuestions)
        + len(result.think_graph.openQuestions)
        + len(result.know_graph.openQuestions)
    )
    search_task_count = len(result.know_graph.searchTasks)
    if open_question_count <= 0 and search_task_count <= 0:
        return False
    weak_next_move = not _has_explicit_next_move(result.blackboard_entries)
    long_answer = len(result.final_response_text) > 160
    thin_state = len(result.blackboard_entries) < 2
    return weak_next_move or long_answer or thin_state


def _refinement_payload_json(context: ContextPack, result: _PassResult) -> str:
    blackboard_focus = []
    for entry in result.blackboard_entries[:4]:
        blackboard_focus.append(
            {
                "field": entry.field,
                "summary": _short_summary(entry.summary, "Blackboard update", limit=56),
                "valueText": _trim_text(entry.valueText, 120) if entry.valueText else None,
                "valueList": entry.valueList[:3],
            }
        )

    refinement_payload = {
        "session": {
            "projectId": context.session.projectId,
            "turnId": context.session.turnId,
        },
        "userText": _trim_text(context.userText, 320),
        "firstPass": {
            "finalResponseText": _clean_final_response_text(result.final_response_text),
            "blackboardTop": blackboard_focus,
            "planOpenQuestions": result.plan.openQuestions[:4],
            "thinkGraph": {
                "priorityEntities": result.think_graph.priorityEntities[:4],
                "triplets": _compact_triplets(result.think_graph.triplets, 3),
                "openQuestions": result.think_graph.openQuestions[:4],
            },
            "knowGraph": {
                "searchTasks": [
                    {
                        "query": task.query,
                        "intent": task.intent,
                        "priority": task.priority,
                    }
                    for task in result.know_graph.searchTasks[:4]
                ],
                "openQuestions": result.know_graph.openQuestions[:4],
            },
        },
    }
    return json.dumps(refinement_payload, ensure_ascii=True)


def _build_team(model_client: object, response_policy: str, max_research_tasks: int, max_turns: int) -> MagenticOneGroupChat:
    research_coordinator = AssistantAgent(
        name="Research_Coordinator",
        model_client=model_client,
        description="Produces only the minimum useful research directives needed to reduce uncertainty.",
        system_message="\n\n".join(
            [
                "You are the research coordination worker for one assistant turn.",
                "Only decide whether follow-up KnowGraph research is needed and what the smallest high-value search task set is.",
                f"Never emit more than {max_research_tasks} search tasks.",
                "Prefer specific, verifyable search queries over broad research themes.",
                "If unresolved questions or graph gaps remain, emit concrete searchTasks tied to those gaps, triplets, or entities.",
                "Do not emit search tasks when the answer is already grounded and complete.",
                "Do not restate the full context, system design, or user request back to the team.",
                "Do not ask the user follow-up questions.",
                "Reply with compact working notes only.",
            ]
        ).strip(),
    )

    response_writer = AssistantAgent(
        name="Response_Writer",
        model_client=model_client,
        description="Produces the final user response and the minimum state updates needed for blackboard and plan/wiki.",
        system_message="\n\n".join(
            list(
                filter(
                    None,
                    [
                        response_policy,
                        "You are the final response and state-writing worker for one assistant turn.",
                        "Write the answer in one or two short sentences.",
                        "Lead with the direct answer or best next move.",
                        "Use plain language and concise next-step wording.",
                        "Do not narrate the system, architecture, or process unless the user explicitly asked for it.",
                        "Only ask for clarification if execution is genuinely blocked.",
                        "Do not restate the full context, system design, or worker notes.",
                        "Reply with compact working notes only.",
                    ],
                )
            )
        ).strip(),
    )

    return MagenticOneGroupChat(
        [research_coordinator, response_writer],
        model_client=model_client,
        max_turns=max_turns,
        max_stalls=1,
        final_answer_prompt="\n".join(
            [
                "Task:",
                "{task}",
                "",
                "Return exactly one JSON object and stop. No markdown. No commentary.",
                "Required top-level keys:",
                "finalResponseText",
                "blackboardEntries",
                "plan",
                "thinkGraph",
                "knowGraph",
                "",
                "Convergence rules:",
                "- finish now using the information already in the conversation",
                "- finalResponseText: at most 2 short sentences, lead with the best next move",
                "- answer the user directly, not the system",
                "- do not restate the whole system or context",
                "- remove filler and repetition",
                "- only ask the user for clarification if the task is impossible without it",
                "- blackboardEntries: at most 4 entries, only real blackboard fields",
                "- blackboard next_move should be concrete and immediately actionable",
                "- add what_matters_now only if there is a real immediate focus or verification task",
                "- each blackboard summary must be short and concrete",
                "- plan.whatChanged/openQuestions/sources: short arrays, at most 4 items each",
                "- thinkGraph arrays: short, at most 4 items",
                f"- knowGraph.searchTasks: at most {max_research_tasks} items",
                "- emit knowGraph.searchTasks when unresolved questions or graph gaps actually warrant follow-up",
                "- knowGraph.searchTasks must be specific search queries, not generic research themes",
                "- knowGraph must contain only research directives, not invented evidence",
            ]
        ),
    )


def _normalize_agent_name(value: object, fallback: str) -> str:
    text = re.sub(r"[^A-Za-z0-9_]+", "_", str(value or "").strip()).strip("_")
    if not text:
        return fallback
    if text[0].isdigit():
        text = f"agent_{text}"
    return text[:48]


def _workspace_object_context_payload(context: WorkspaceObjectContext | None) -> dict[str, object]:
    if context is None:
        return {}
    payload: dict[str, object] = {}
    text_limits = {
        "activeSurface": 64,
        "activeWorkbench": 64,
        "repoPath": 220,
        "workspaceRoot": 220,
        "graphSource": 64,
        "analysisStatus": 64,
        "workspaceView": 64,
        "selectedNodeId": 96,
        "selectedNodeName": 120,
        "selectedObjectId": 96,
        "selectedObjectType": 64,
        "selectedObjectTitle": 120,
        "selectedText": 240,
        "openObjectSummary": 400,
    }
    for key, limit in text_limits.items():
        value = _trim_text(getattr(context, key), limit)
        if value:
            payload[key] = value
    if context.connectedWorkbenchAgent is not None:
        payload["connectedWorkbenchAgent"] = bool(context.connectedWorkbenchAgent)
    for key in ("activeMagenticParticipants", "availableCanvasAgents", "excludedAgents"):
        values = [
            _trim_text(item, 96)
            for item in list(getattr(context, key) or [])[:12]
            if _trim_text(item, 96)
        ]
        if values:
            payload[key] = values
    return payload


def _build_object_awareness_block(context: ContextPack) -> str:
    payload = _workspace_object_context_payload(context.workspaceObjectContext)
    if not payload:
        return ""
    return "\n".join(
        [
            "Object awareness:",
            json.dumps(payload, ensure_ascii=True),
            "This context is read-only.",
            "Do not mutate UI objects, fill fields, run disconnected agents, or execute tools from this context.",
            "If action is needed, describe the recommended next step only for future Plan Canvas approval.",
        ]
    )


def _build_card_runtime_payload_json(context: ContextPack) -> str:
    runtime = context.cardRuntime
    if runtime is None:
        raise RuntimeError("card_runtime_missing")
    payload = {
        "card": {
            "cardId": runtime.cardId,
            "title": runtime.title,
            "runtimeType": runtime.runtimeType,
            "prompt": _trim_text(runtime.prompt, 240),
            "runtimeOptions": runtime.runtimeOptions,
        },
        "userText": _trim_text(context.userText, 320),
        "priorAssistantText": _trim_text(context.priorAssistantText, 120),
        "blackboard": {
            "current_goal": _trim_text(context.blackboard.current_goal, 120),
            "what_matters_now": context.blackboard.what_matters_now[:3],
            "open_questions": context.blackboard.open_questions[:3],
            "next_move": _trim_text(context.blackboard.next_move, 120),
        },
        "assistant": runtime.assistant or {},
        "magentic": runtime.magentic or {},
        "participants": [
            {
                "cardId": item.cardId,
                "title": item.title,
                "runtimeType": item.runtimeType,
                "runtimeBinding": item.runtimeBinding,
                "role": item.role,
                "tools": item.tools,
                "skills": item.skills,
                "personas": item.personas,
                "knowledgeSources": item.knowledgeSources,
                "connectedTo": item.connectedTo,
                "provider": item.provider,
                "providerModelId": item.providerModelId,
            }
            for item in runtime.participants
        ],
        "graphFlow": runtime.graphFlow or {},
        "workspaceObjectContext": _workspace_object_context_payload(context.workspaceObjectContext),
    }
    return json.dumps(payload, ensure_ascii=True)


def _get_cached_model_client(
    cache: dict[tuple[str, str, float | None, int | None], object],
    config: AutoGenAgentConfig,
) -> object:
    key = (
        str(config.provider or "").strip().lower(),
        str(config.provider_model_id or "").strip(),
        config.temperature,
        config.max_tokens,
    )
    client = cache.get(key)
    if client is None:
        client = _build_model_client(config)
        cache[key] = client
    return client


def _build_card_team_participants(
    context: ContextPack,
    default_model_config: AutoGenAgentConfig,
    cache: dict[tuple[str, str, float | None, int | None], object],
) -> list[AssistantAgent]:
    runtime = context.cardRuntime
    if runtime is None:
        raise RuntimeError("card_runtime_missing")
    if not runtime.participants:
        raise RuntimeError(
            f"team_runtime_participants_required: runtimeType={runtime.runtimeType} cardId={runtime.cardId}"
        )

    participants: list[AssistantAgent] = []
    seen_names: set[str] = set()
    for index, participant in enumerate(runtime.participants):
        config = AutoGenAgentConfig(
            provider=str(participant.provider or default_model_config.provider).strip() or default_model_config.provider,
            provider_model_id=str(participant.providerModelId or default_model_config.provider_model_id).strip()
            or default_model_config.provider_model_id,
            system_prompt=participant.prompt or "",
            temperature=participant.temperature if participant.temperature is not None else default_model_config.temperature,
            max_tokens=participant.maxTokens if participant.maxTokens is not None else default_model_config.max_tokens,
        )
        model_client = _get_cached_model_client(cache, config)
        name = _normalize_agent_name(participant.title or participant.cardId, f"participant_{index + 1}")
        if name in seen_names:
            name = _normalize_agent_name(f"{name}_{index + 1}", f"participant_{index + 1}")
        seen_names.add(name)
        system_message_parts = [
            str(participant.prompt or "").strip(),
            f"Canvas role: {participant.role}." if participant.role else "",
            f"Runtime binding: {participant.runtimeBinding}." if participant.runtimeBinding else "",
            "Configured canvas tools: " + ", ".join(participant.tools) + "." if participant.tools else "",
            f"Connected to orchestrator card: {participant.connectedTo}." if participant.connectedTo else "",
            "Stay concise and task-focused.",
            "Do not restate the whole deck, system, or user request.",
            "Contribute only the minimum useful next message for this card runtime.",
        ]
        participants.append(
            AssistantAgent(
                name=name,
                model_client=model_client,
                description=_trim_text(participant.title or participant.cardId, 120),
                system_message="\n\n".join(part for part in system_message_parts if part).strip(),
            )
        )
    return participants


def _build_card_team(
    context: ContextPack,
    team_model_client: object,
    participants: list[AssistantAgent],
) -> object:
    runtime = context.cardRuntime
    if runtime is None:
        raise RuntimeError("card_runtime_missing")

    runtime_type = runtime.runtimeType
    runtime_options = dict(runtime.runtimeOptions or {})
    max_turns = max(1, min(int(runtime_options.get("maxTurns") or 6), 16))

    if runtime_type == "magentic_one":
        max_stalls = max(1, min(int(runtime_options.get("maxStalls") or 1), 4))
        final_answer_prompt = str(runtime_options.get("finalAnswerPrompt") or "").strip()
        kwargs: dict[str, object] = {
            "model_client": team_model_client,
            "max_turns": max_turns,
            "max_stalls": max_stalls,
        }
        if final_answer_prompt:
            kwargs["final_answer_prompt"] = final_answer_prompt
        return MagenticOneGroupChat(
            participants,
            **kwargs,
        )

    if runtime_type == "selector":
        selector_prompt = str(runtime_options.get("selectorPrompt") or "").strip()
        if isinstance(runtime_options.get("allowRepeatedSpeaker"), bool):
            allow_repeated = bool(runtime_options.get("allowRepeatedSpeaker"))
        else:
            repeated_behavior = str(runtime_options.get("repeatedSpeakerBehavior") or "").strip().lower()
            allow_repeated = repeated_behavior == "allow"
        return SelectorGroupChat(
            participants,
            model_client=team_model_client,
            max_turns=max_turns,
            selector_prompt=selector_prompt or DEFAULT_SELECTOR_PROMPT,
            allow_repeated_speaker=allow_repeated,
        )

    if runtime_type == "round_robin":
        return RoundRobinGroupChat(
            participants,
            max_turns=max_turns,
        )

    if runtime_type == "swarm":
        raise RuntimeError(
            f"team_runtime_not_supported: runtimeType=swarm cardId={runtime.cardId} reason=explicit_handoff_graph_not_implemented"
        )

    if runtime_type == "graph_flow":
        raise RuntimeError(
            f"team_runtime_not_supported: runtimeType=graph_flow cardId={runtime.cardId} reason=workflow_runtime_not_implemented"
        )

    if runtime_type == "adapter":
        raise RuntimeError(
            f"team_runtime_not_supported: runtimeType=adapter cardId={runtime.cardId} reason=adapter_target_execution_not_implemented"
        )

    raise RuntimeError(f"team_runtime_not_supported: runtimeType={runtime_type} cardId={runtime.cardId}")


def _build_card_runtime_task_text(context: ContextPack) -> str:
    runtime = context.cardRuntime
    if runtime is None:
        raise RuntimeError("card_runtime_missing")
    task_parts = [
        f"Run the agent card '{runtime.title}' using its configured runtime pattern.",
        "Use the compact execution context below as the full task context.",
        "Do not restate the entire context back and forth.",
        "Keep internal messages short and convergent.",
    ]
    object_awareness = _build_object_awareness_block(context)
    if object_awareness:
        task_parts.extend(["", object_awareness])
    task_parts.extend(["", _build_card_runtime_payload_json(context)])
    return "\n".join(task_parts)


def _count_named_turns(messages: list[object], allowed_sources: set[str]) -> int:
    return sum(1 for message in messages if _message_source(message) in allowed_sources)


async def _synthesize_card_runtime_result(
    context: ContextPack,
    team_model_client: object,
    transcript: list[str],
) -> _PassResult:
    runtime = context.cardRuntime
    if runtime is None:
        raise RuntimeError("card_runtime_missing")
    synthesizer = AssistantAgent(
        name="Runtime_Synthesizer",
        model_client=team_model_client,
        description="Converts a completed card runtime transcript into the final structured card output.",
        system_message="\n\n".join(
            [
                "You synthesize the final result of one LiquidAIty agent card runtime.",
                "Return exactly one JSON object with keys: finalResponseText, blackboardEntries, plan, thinkGraph, knowGraph.",
                "Keep finalResponseText to one or two short sentences.",
                "blackboardEntries must be concrete and useful, at most 4 entries.",
                "Emit knowGraph.searchTasks only when unresolved questions or graph gaps clearly warrant follow-up.",
                "Do not narrate architecture, system behavior, or process unless the card explicitly asks for it.",
            ]
        ).strip(),
    )
    synth_task = "\n".join(
        [
            "Synthesize the completed card runtime transcript into the final structured card result.",
            "",
            "Card runtime context:",
            _build_card_runtime_payload_json(context),
            "",
            "Team transcript:",
            "\n".join(transcript[-12:]),
        ]
    )
    result = await synthesizer.run(task=synth_task)
    messages = [_message_to_text(message) for message in result.messages]
    parsed: dict[str, object] | None = None
    for text in reversed(messages):
        parsed = _extract_json_object(text)
        if parsed:
            break
    if not parsed:
        raise RuntimeError("card_runtime_missing_json")

    final_response_text = _clean_final_response_text(parsed.get("finalResponseText"))
    if not final_response_text:
        raise RuntimeError("card_runtime_missing_final_response_text")

    try:
        plan = _normalize_plan(parsed.get("plan"))
    except Exception:
        plan = _default_card_runtime_plan(context)

    try:
        think_graph = _normalize_thinkgraph(parsed.get("thinkGraph"))
    except Exception:
        think_graph = _default_card_runtime_thinkgraph(context)

    try:
        know_graph = _normalize_knowgraph(parsed.get("knowGraph"), max(1, min(context.maxResearchTasks, 4)))
    except Exception:
        know_graph = _default_card_runtime_knowgraph(context)

    return _PassResult(
        final_response_text=final_response_text,
        blackboard_entries=_normalize_blackboard_entries(parsed.get("blackboardEntries")),
        plan=plan,
        think_graph=think_graph,
        know_graph=know_graph,
        transcript=messages,
        stop_reason=result.stop_reason,
        turns_used=_count_named_turns(list(result.messages), {"Runtime_Synthesizer"}),
    )


async def _orchestrate_card_runtime_context(context: ContextPack) -> OrchestratorRunResponse:
    runtime = context.cardRuntime
    if runtime is None:
        raise RuntimeError("card_runtime_missing")
    if runtime.runtimeType != "magentic_one":
        raise RuntimeError(
            f"team_runtime_not_supported: runtimeType={runtime.runtimeType} cardId={runtime.cardId}"
        )

    runtime_options = dict(runtime.runtimeOptions or {})
    provider = str(runtime_options.get("provider") or context.session.modelProvider).strip().lower()
    provider_model_id = str(
        runtime_options.get("modelKey")
        or context.session.providerModelId
        or context.session.modelKey
    ).strip()
    if not provider_model_id:
        raise RuntimeError(
            f"card_runtime_model_missing: runtimeType={runtime.runtimeType} cardId={runtime.cardId}"
        )

    model_config = AutoGenAgentConfig(
        provider=provider,
        provider_model_id=provider_model_id,
        system_prompt=str(runtime.prompt or context.systemPrompt or "").strip(),
        temperature=(
            float(runtime_options.get("temperature"))
            if runtime_options.get("temperature") is not None
            else 0.05
        ),
        max_tokens=(
            int(runtime_options.get("maxTokens"))
            if runtime_options.get("maxTokens") is not None
            else 850
        ),
    )
    _assert_magentic_safe_model(model_config)
    team_model_client = _build_model_client(model_config)
    participant_cache: dict[tuple[str, str, float | None, int | None], object] = {}

    started_at = time.perf_counter()
    try:
        participants = _build_card_team_participants(context, model_config, participant_cache)
        team = _build_card_team(context, team_model_client, participants)
        team_task = _build_card_runtime_task_text(context)
        result = await team.run(task=team_task)
        transcript = [_message_to_text(message) for message in result.messages]

        final_pass = await _synthesize_card_runtime_result(context, team_model_client, transcript)
        know_graph = _ensure_knowgraph_output(
            final_pass.know_graph,
            final_pass.think_graph,
            final_pass.plan,
            max(1, min(context.maxResearchTasks, 4)),
        )
        blackboard_entries = _ensure_blackboard_entries(
            final_pass.blackboard_entries,
            final_pass.final_response_text,
            final_pass.plan,
            final_pass.think_graph,
            know_graph,
        )
        plan = final_pass.plan
        think_graph = final_pass.think_graph
        final_response_text = final_pass.final_response_text

        report_backs = [
            AssistantResponseReport(
                sourceAgent="Runtime_Synthesizer",
                summary="Final assistant response for the current card runtime",
                finalResponseText=final_response_text,
            ),
            PlanUpdateReport(
                sourceAgent="Runtime_Synthesizer",
                summary=plan.deltaSummary or "Plan/wiki updated from card runtime output",
                plan=plan,
            ),
            BlackboardWriteReport(
                sourceAgent="Runtime_Synthesizer",
                summary="Blackboard updates from card runtime output",
                entries=blackboard_entries,
            ),
            ThinkGraphUpdateReport(
                sourceAgent="Runtime_Synthesizer",
                summary="ThinkGraph follow-up priorities from card runtime output",
                priorityEntities=think_graph.priorityEntities,
                triplets=think_graph.triplets,
                openQuestions=think_graph.openQuestions,
            ),
            know_graph,
        ]

        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        metrics = OrchestratorMetrics(
            elapsedMs=elapsed_ms,
            turnsUsed=final_pass.turns_used,
            reportBackCount=len(report_backs),
            blackboardWriteCount=len(blackboard_entries),
            searchTaskCount=len(know_graph.searchTasks),
            refinementApplied=False,
        )
        return OrchestratorRunResponse(
            ok=True,
            session=context.session,
            stopReason=result.stop_reason or final_pass.stop_reason,
            finalResponseText=final_response_text,
            blackboardEntries=blackboard_entries,
            plan=plan,
            thinkGraph=think_graph,
            knowGraph=know_graph,
            reportBacks=report_backs,
            transcript=transcript[-10:],
            metrics=metrics,
        )
    finally:
        for client in participant_cache.values():
            if client is team_model_client:
                continue
            close_method = getattr(client, "close", None)
            if callable(close_method):
                await close_method()
        await team_model_client.close()


async def _run_orchestrator_pass(
    context: ContextPack,
    model_client: object,
    response_policy: str,
    max_research_tasks: int,
    task_text: str,
    max_turns: int,
) -> _PassResult:
    team = _build_team(model_client, response_policy, max_research_tasks, max_turns)
    result = await team.run(task=task_text)
    transcript = [_message_to_text(message) for message in result.messages]
    parsed: dict[str, object] | None = None
    for text in reversed(transcript):
        parsed = _extract_json_object(text)
        if parsed:
            break
    if not parsed:
        raise RuntimeError("orchestrator_missing_json")

    final_response_text = _clean_final_response_text(parsed.get("finalResponseText"))
    if not final_response_text:
        raise RuntimeError("orchestrator_missing_final_response_text")

    return _PassResult(
        final_response_text=final_response_text,
        blackboard_entries=_normalize_blackboard_entries(parsed.get("blackboardEntries")),
        plan=_normalize_plan(parsed.get("plan")),
        think_graph=_normalize_thinkgraph(parsed.get("thinkGraph")),
        know_graph=_normalize_knowgraph(parsed.get("knowGraph"), max_research_tasks),
        transcript=transcript,
        stop_reason=result.stop_reason,
        turns_used=_count_turns(list(result.messages)),
    )


async def orchestrate_context_pack(context: ContextPack) -> OrchestratorRunResponse:
    if context.cardRuntime is not None:
        return await _orchestrate_card_runtime_context(context)

    max_research_tasks = max(1, min(context.maxResearchTasks, 4))
    response_policy = _trim_text(context.systemPrompt, 360)
    model_config = AutoGenAgentConfig(
        provider=context.session.modelProvider,
        provider_model_id=context.session.providerModelId,
        system_prompt=response_policy,
        temperature=0.05,
        max_tokens=850,
    )
    _assert_magentic_safe_model(model_config)
    model_client = _build_model_client(model_config)

    started_at = time.perf_counter()
    try:
        first_pass = await _run_orchestrator_pass(
            context=context,
            model_client=model_client,
            response_policy=response_policy,
            max_research_tasks=max_research_tasks,
            max_turns=6,
            task_text="\n".join(
                [
                    "Complete one assistant turn for the LiquidAIty runtime.",
                    "Use the compact context below as the single execution context.",
                    "One handoff to each worker is usually enough.",
                    "Do not repeat the context to each other.",
                    "Produce the final answer plus structured writes for plan/wiki, blackboard, ThinkGraph, and KnowGraph.",
                    "",
                    _context_payload_json(context),
                ]
            ),
        )
        print(
            "[AUTOGEN_ORCH][pass=1] projectId=%s turnId=%s stop_reason=%s turns=%s"
            % (
                context.session.projectId,
                context.session.turnId,
                first_pass.stop_reason or "none",
                first_pass.turns_used,
            ),
            flush=True,
        )

        refinement_applied = False
        total_turns = first_pass.turns_used
        final_pass = first_pass
        combined_transcript = list(first_pass.transcript)

        if _needs_refinement(first_pass):
            refinement_applied = True
            second_pass = await _run_orchestrator_pass(
                context=context,
                model_client=model_client,
                response_policy=response_policy,
                max_research_tasks=max_research_tasks,
                max_turns=3,
                task_text="\n".join(
                    [
                        "Refine the previous assistant pass for clean completion.",
                        "Use the first-pass blackboard and ThinkGraph outputs as control signals.",
                        "Converge now. This is the only refinement pass.",
                        "Keep only the most useful unresolved questions and search tasks.",
                        "Make the answer shorter, the blackboard cleaner, and the search tasks more actionable.",
                        "",
                        _refinement_payload_json(context, first_pass),
                    ]
                ),
            )
            print(
                "[AUTOGEN_ORCH][pass=2] projectId=%s turnId=%s stop_reason=%s turns=%s"
                % (
                    context.session.projectId,
                    context.session.turnId,
                    second_pass.stop_reason or "none",
                    second_pass.turns_used,
                ),
                flush=True,
            )
            total_turns += second_pass.turns_used
            final_pass = second_pass
            combined_transcript.extend(["[REFINEMENT PASS]"])
            combined_transcript.extend(second_pass.transcript)

        final_response_text = final_pass.final_response_text
        know_graph = _ensure_knowgraph_output(
            final_pass.know_graph,
            final_pass.think_graph,
            final_pass.plan,
            max_research_tasks,
        )
        blackboard_entries = _ensure_blackboard_entries(
            final_pass.blackboard_entries,
            final_response_text,
            final_pass.plan,
            final_pass.think_graph,
            know_graph,
        )
        plan = final_pass.plan
        think_graph = final_pass.think_graph

        report_backs = [
            AssistantResponseReport(
                sourceAgent="Response_Writer",
                summary="Final assistant response for the current turn",
                finalResponseText=final_response_text,
            ),
            PlanUpdateReport(
                sourceAgent="Response_Writer",
                summary=plan.deltaSummary or "Plan/wiki updated from orchestrator output",
                plan=plan,
            ),
            BlackboardWriteReport(
                sourceAgent="Response_Writer",
                summary="Blackboard updates from orchestrator output",
                entries=blackboard_entries,
            ),
            ThinkGraphUpdateReport(
                sourceAgent="Research_Coordinator",
                summary="ThinkGraph follow-up priorities from orchestrator output",
                priorityEntities=think_graph.priorityEntities,
                triplets=think_graph.triplets,
                openQuestions=think_graph.openQuestions,
            ),
            know_graph,
        ]

        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        metrics = OrchestratorMetrics(
            elapsedMs=elapsed_ms,
            turnsUsed=total_turns,
            reportBackCount=len(report_backs),
            blackboardWriteCount=len(blackboard_entries),
            searchTaskCount=len(know_graph.searchTasks),
            refinementApplied=refinement_applied,
        )
        print(
            "[AUTOGEN_ORCH][done] projectId=%s turnId=%s stop_reason=%s elapsed_ms=%s turns=%s report_backs=%s blackboard_writes=%s search_tasks=%s refinement=%s"
            % (
                context.session.projectId,
                context.session.turnId,
                final_pass.stop_reason or "none",
                metrics.elapsedMs,
                metrics.turnsUsed,
                metrics.reportBackCount,
                metrics.blackboardWriteCount,
                metrics.searchTaskCount,
                "true" if metrics.refinementApplied else "false",
            ),
            flush=True,
        )

        return OrchestratorRunResponse(
            ok=True,
            session=context.session,
            stopReason=final_pass.stop_reason,
            finalResponseText=final_response_text,
            blackboardEntries=blackboard_entries,
            plan=plan,
            thinkGraph=think_graph,
            knowGraph=know_graph,
            reportBacks=report_backs,
            transcript=combined_transcript[-10:],
            metrics=metrics,
        )
    finally:
        await model_client.close()
