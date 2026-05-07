from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from pydantic import BaseModel, Field

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.teams import MagenticOneGroupChat
from autogen_core.models import ModelFamily
from autogen_ext.models.openai import OpenAIChatCompletionClient


def _load_repo_env() -> None:
    resolved = Path(__file__).resolve()
    env_candidates = []
    if len(resolved.parents) > 4:
        env_candidates.append(resolved.parents[4] / "apps" / "backend" / ".env")
    if len(resolved.parents) > 3:
        env_candidates.append(resolved.parents[3] / ".env")
    env_candidates.append(Path.cwd() / "apps" / "backend" / ".env")
    env_candidates.append(Path.cwd() / ".env")
    for env_path in env_candidates:
        if env_path.exists():
            load_dotenv(env_path, override=False)
            break


_load_repo_env()


class AutoGenAgentConfig(BaseModel):
    provider: str
    provider_model_id: str
    system_prompt: str = ""
    temperature: float | None = None
    max_tokens: int | None = None


class TripletInput(BaseModel):
    entityA: str
    relationshipType: str
    entityB: str
    confidence: float | None = None
    source: str | None = None


class GapInput(BaseModel):
    entityA: str
    relationshipType: str
    entityB: str
    gapType: str
    priority: str = "high"
    reason: str = ""


class SearchTaskInput(BaseModel):
    query: str
    intent: str = "verify"
    priority: str = "high"
    triplet: TripletInput | None = None
    gap: GapInput | None = None


class ResearchPlanRequest(BaseModel):
    project_id: str
    turn_id: str
    query: str
    priority_entities: list[str] = Field(default_factory=list)
    priority_relationships: list[str] = Field(default_factory=list)
    triplets: list[TripletInput] = Field(default_factory=list)
    gaps: list[GapInput] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    draft_tasks: list[SearchTaskInput] = Field(default_factory=list)
    max_tasks: int = 6
    agent: AutoGenAgentConfig


class SearchTaskOutput(BaseModel):
    query: str
    intent: str = "verify"
    priority: str = "high"
    triplet: TripletInput | None = None


class ResearchPlanResponse(BaseModel):
    ok: bool
    planner: str
    project_id: str
    turn_id: str
    query: str
    planned_task_count: int
    search_tasks: list[SearchTaskOutput] = Field(default_factory=list)
    stop_reason: str | None = None
    transcript: list[str] = Field(default_factory=list)


MAGENTIC_SAFE_OPENROUTER_PREFIXES = (
    "openai/gpt-5.1-chat",
    "openai/gpt-5.1-chat-",
)
MAGENTIC_SAFE_OPENAI_PREFIXES = (
    "gpt-5.1-chat",
    "gpt-5.1-chat-",
    "gpt-5.1-chat-latest",
)


def _detect_model_family(model_name: str) -> str:
    lower = str(model_name or "").strip().lower()
    if "gpt-5" in lower:
        return ModelFamily.GPT_5
    if "gpt-4o" in lower:
        return ModelFamily.GPT_4O
    if "gpt-4.1" in lower:
        return ModelFamily.GPT_41
    if lower.startswith("o4") or "/o4" in lower:
        return ModelFamily.O4
    if lower.startswith("o3") or "/o3" in lower:
        return ModelFamily.O3
    if lower.startswith("o1") or "/o1" in lower:
        return ModelFamily.O1
    if "claude-4-sonnet" in lower:
        return ModelFamily.CLAUDE_4_SONNET
    if "claude-4-opus" in lower:
        return ModelFamily.CLAUDE_4_OPUS
    if "claude-3.7-sonnet" in lower:
        return ModelFamily.CLAUDE_3_7_SONNET
    if "claude-3.5-sonnet" in lower:
        return ModelFamily.CLAUDE_3_5_SONNET
    if "claude-3.5-haiku" in lower:
        return ModelFamily.CLAUDE_3_5_HAIKU
    if "claude-3-haiku" in lower:
        return ModelFamily.CLAUDE_3_HAIKU
    if "gemini-2.5-pro" in lower:
        return ModelFamily.GEMINI_2_5_PRO
    if "gemini-2.5-flash" in lower:
        return ModelFamily.GEMINI_2_5_FLASH
    if "gemini-2.0-flash" in lower:
        return ModelFamily.GEMINI_2_0_FLASH
    if "llama-4-maverick" in lower:
        return ModelFamily.LLAMA_4_MAVERICK
    if "llama-4-scout" in lower:
        return ModelFamily.LLAMA_4_SCOUT
    if "llama-3.3-70b" in lower:
        return ModelFamily.LLAMA_3_3_70B
    if "llama-3.3-8b" in lower:
        return ModelFamily.LLAMA_3_3_8B
    if "deepseek-r1" in lower or "kimi-k2" in lower:
        return ModelFamily.R1
    return "openrouter-compatible"


def _build_model_info(model_name: str) -> dict[str, Any]:
    return {
        "vision": False,
        "function_calling": False,
        "json_output": False,
        "family": _detect_model_family(model_name),
        "structured_output": False,
        "multiple_system_messages": True,
    }


def _normalize_model_name(model_name: str) -> str:
    return str(model_name or "").strip().lower()


def _assert_magentic_safe_model(config: AutoGenAgentConfig) -> None:
    provider = str(config.provider or "").strip().lower()
    model_name = _normalize_model_name(config.provider_model_id)
    if provider == "openrouter":
        if any(model_name.startswith(prefix) for prefix in MAGENTIC_SAFE_OPENROUTER_PREFIXES):
            return
    elif provider == "openai":
        if any(model_name.startswith(prefix) for prefix in MAGENTIC_SAFE_OPENAI_PREFIXES):
            return

    raise RuntimeError(
        "magentic_model_not_approved: "
        f"provider={provider or 'unknown'} model={config.provider_model_id or 'unknown'} "
        "allowed=openrouter:openai/gpt-5.1-chat*,openai:gpt-5.1-chat*"
    )


def _build_model_client(config: AutoGenAgentConfig) -> OpenAIChatCompletionClient:
    provider = str(config.provider or "").strip().lower()
    model_name = str(config.provider_model_id or "").strip()
    temperature = config.temperature if config.temperature is not None else 0.2
    max_tokens = config.max_tokens if config.max_tokens is not None else 1400

    if provider == "openrouter":
        api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("OPENROUTER_API_KEY is required for AutoGen research planning")
        base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").strip()
        return OpenAIChatCompletionClient(
            model=model_name,
            api_key=api_key,
            base_url=base_url,
            model_info=_build_model_info(model_name),
            temperature=temperature,
            max_tokens=max_tokens,
        )

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for AutoGen research planning")
        kwargs: dict[str, Any] = {
            "model": model_name,
            "api_key": api_key,
            "model_info": _build_model_info(model_name),
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        base_url = os.getenv("OPENAI_BASE_URL", "").strip()
        if base_url:
            kwargs["base_url"] = base_url
        return OpenAIChatCompletionClient(**kwargs)

    raise RuntimeError(f"Unsupported AutoGen provider: {provider or 'unknown'}")


def _task_payload_json(request: ResearchPlanRequest) -> str:
    payload = {
        "project_id": request.project_id,
        "turn_id": request.turn_id,
        "query": request.query,
        "priority_entities": request.priority_entities[: request.max_tasks],
        "priority_relationships": request.priority_relationships[: request.max_tasks],
        "triplets": [triplet.model_dump() for triplet in request.triplets[: request.max_tasks]],
        "gaps": [gap.model_dump() for gap in request.gaps[: request.max_tasks]],
        "open_questions": request.open_questions[: request.max_tasks],
        "draft_tasks": [task.model_dump() for task in request.draft_tasks[: request.max_tasks]],
        "max_tasks": max(1, min(int(request.max_tasks or 6), 10)),
    }
    return json.dumps(payload, indent=2)


def _extract_json_object(text: str) -> dict[str, Any] | None:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


def _normalize_task(raw: Any) -> SearchTaskOutput | None:
    if not isinstance(raw, dict):
        return None
    query = str(raw.get("query") or "").strip()
    if not query:
        return None
    intent = str(raw.get("intent") or "verify").strip().lower() or "verify"
    priority = str(raw.get("priority") or "high").strip().lower() or "high"
    triplet_raw = raw.get("triplet")
    triplet = None
    if isinstance(triplet_raw, dict):
        entity_a = str(triplet_raw.get("entityA") or "").strip()
        rel = str(triplet_raw.get("relationshipType") or "").strip()
        entity_b = str(triplet_raw.get("entityB") or "").strip()
        if entity_a and rel and entity_b:
            triplet = TripletInput(
                entityA=entity_a,
                relationshipType=rel,
                entityB=entity_b,
                confidence=None,
                source=str(triplet_raw.get("source") or "").strip() or None,
            )
    return SearchTaskOutput(query=query, intent=intent, priority=priority, triplet=triplet)


def _message_to_text(message: Any) -> str:
    content = getattr(message, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        try:
            return json.dumps(content, ensure_ascii=True)
        except TypeError:
            return str(content)
    to_text = getattr(message, "to_text", None)
    if callable(to_text):
        try:
            return str(to_text())
        except Exception:
            return str(message)
    return str(message)


async def plan_research_with_autogen(request: ResearchPlanRequest) -> ResearchPlanResponse:
    _assert_magentic_safe_model(request.agent)
    model_client = _build_model_client(request.agent)
    task_json = _task_payload_json(request)

    planner = AssistantAgent(
        name="Research_Planner",
        model_client=model_client,
        description="Designs graph-grounded web research tasks for the Assist loop.",
        system_message="\n\n".join(
            [
                request.agent.system_prompt.strip(),
                "You are the research planning specialist for the LiquidAIty Assist loop.",
                "Produce only a research task plan, not a final answer to the user.",
                "Keep the plan anchored to the provided triplets, evidence gaps, priority entities, and open questions.",
                "Favor specific web-searchable queries that verify, compare, explain, resolve conflict, or deepen evidence.",
                "Keep the plan compact and avoid duplicate or generic tasks.",
            ]
        ).strip(),
    )

    reviewer = AssistantAgent(
        name="Research_Reviewer",
        model_client=model_client,
        description="Reviews and tightens research tasks so they stay grounded and useful.",
        system_message="\n\n".join(
            [
                request.agent.system_prompt.strip(),
                "You review research plans for graph grounding, specificity, and duplication.",
                "Push the plan toward a machine-readable final task list.",
                "Do not answer the user's question directly.",
            ]
        ).strip(),
    )
    team = MagenticOneGroupChat(
        [planner, reviewer],
        model_client=model_client,
        max_turns=10,
        max_stalls=2,
        final_answer_prompt="\n".join(
            [
                "We are working on the following research planning task:",
                "{task}",
                "",
                "Based on the conversation above, return exactly one JSON object with a top-level \"searchTasks\" array.",
                "Each search task item must include: query, intent, priority.",
                "Include an optional triplet object with entityA, relationshipType, entityB when available.",
                "Return JSON only. Do not wrap it in markdown. Do not add commentary.",
            ]
        ),
    )

    try:
        result = await team.run(
            task="\n".join(
                [
                    "Build a web research search plan for the following Assist research request.",
                    "Stay grounded in the graph and evidence hints provided below.",
                    "Do not answer the user question directly.",
                    "Produce a machine-readable research plan when ready.",
                    "",
                    task_json,
                ]
            )
        )
        transcript = [_message_to_text(message) for message in result.messages]
        parsed: dict[str, Any] | None = None
        for text in reversed(transcript):
            parsed = _extract_json_object(text)
            if parsed:
                break
        if not parsed:
            raise RuntimeError("autogen_research_plan_missing_json")
        raw_tasks = parsed.get("searchTasks")
        if not isinstance(raw_tasks, list):
            raise RuntimeError("autogen_research_plan_missing_search_tasks")
        tasks = [task for task in (_normalize_task(item) for item in raw_tasks) if task is not None]
        if not tasks:
            raise RuntimeError("autogen_research_plan_empty_tasks")
        return ResearchPlanResponse(
            ok=True,
            planner="autogen_magentic_one",
            project_id=request.project_id,
            turn_id=request.turn_id,
            query=request.query,
            planned_task_count=len(tasks),
            search_tasks=tasks[: request.max_tasks],
            stop_reason=result.stop_reason,
            transcript=transcript[-10:],
        )
    finally:
        await model_client.close()
