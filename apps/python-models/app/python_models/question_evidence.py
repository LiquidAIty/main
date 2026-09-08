"""Native Question/evidence pointers shared by the two existing graph adapters.

Graphiti owns the episode and its backlink. Engraphis owns the Question.
Only model-supplied outcomes are transferred; extraction success is not an answer.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict

from .thinkgraph import GraphReference


class QuestionEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    questionRef: GraphReference
    outcome: Literal["answered", "partially_answered", "contested"]
    relation: Literal["answers", "supports", "contradicts", "context"]


def validate_question_evidence(value: Any, project_id: str, request: Any) -> dict:
    if isinstance(value, dict) and isinstance(value.get("questionRef"), dict):
        value = {**value, "questionRef": {"projectId": project_id, **value["questionRef"]}}
    link = QuestionEvidence.model_validate(value)
    ref = link.questionRef
    if ref.authority != "thinkgraph" or ref.projectId != project_id:
        raise ValueError("question_reference_scope_mismatch")
    native = request("inspect", project_id, {"nativeId": ref.nativeId, "maxDepth": 0})
    cognition = ((native.get("memory") or {}).get("metadata") or {}).get("cognition") or {}
    if cognition.get("memoryCategory") != "question" or cognition.get("projectScope") != project_id:
        raise ValueError("native_thinkgraph_question_required")
    return link.model_dump()


async def link_question_evidence(driver: Any, link: dict, episode_id: str, group_id: str, request: Any) -> dict:
    """Idempotent native backlink, followed by the Question owner's pointer update.

An interrupted second write leaves the sourced episode intact. The same native
episode and link can be submitted again without another extraction/model call.
"""
    ref = link["questionRef"]
    encoded = json.dumps(link, sort_keys=True, separators=(",", ":"))
    result = await driver.execute_query(
        """MATCH (episode:Episodic {uuid: $episode_id, group_id: $group_id})
        SET episode.question_links = CASE WHEN $link IN coalesce(episode.question_links, [])
            THEN episode.question_links ELSE coalesce(episode.question_links, []) + $link END
        RETURN episode.uuid AS uuid""",
        episode_id=episode_id, group_id=group_id, link=encoded,
    )
    rows = getattr(result, "records", result[0] if isinstance(result, tuple) else [])
    if not rows or rows[0].get("uuid") != episode_id:
        raise ValueError("question_evidence_episode_not_found_in_project")
    evidence = {"authority": "knowgraph", "nativeId": episode_id, "projectId": ref["projectId"]}
    await asyncio.to_thread(
        request, "attach_answer", ref["projectId"],
        {"nativeId": ref["nativeId"], "evidence": evidence, "status": link["outcome"]},
    )
    return {"questionRef": ref, "evidenceRef": evidence, "outcome": link["outcome"]}
