# @graph entity: KnowGraph Research Workflow Fixture
# @graph role: selected-research-workflow-proof-fixture
# @graph relates_to: Mag One Tool Registry, KnowGraph Hybrid Retrieval
"""One bounded, deliberately-selected research-workflow fixture for proving that
Mag One can choose to use the attached ``retrieve_knowgraph_context`` tool.

This is a PROOF fixture, not a permanent rule: nothing here forces retrieval, no
text/regex routing decides tool use, and the workflow instructions are advisory.
Mag One (the model) decides whether to call the tool. The fixture reuses the
existing project and the existing RDW / SpaceX source-backed assertions.
"""

from __future__ import annotations

from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    CardRuntimeParticipant,
    ContextPack,
    ProjectSession,
)

PROJECT_ID = "20ac92da-01fd-4cf6-97cc-0672421e751a"

# Advisory workflow instructions placed on the selected research participant. They
# describe WHEN the tool helps; they never force a call and never match task text.
SELECTED_RESEARCH_WORKFLOW_INSTRUCTIONS = (
    "You are a source-backed research agent in a selected research workflow.\n"
    "KnowGraph Hybrid Retrieval (retrieve_knowgraph_context) is available to you. "
    "Use it deliberately when a selected task needs source-backed external evidence, "
    "evidence conflicts, uncertainty, or connected KnowGraph evidence. Do not use it "
    "for unrelated code-only work, and do not call it merely because it is attached.\n"
    "When you use returned evidence: keep supported / contradicted / uncertain outcomes "
    "distinct, retain the sourceRefs in your answer, and never turn an assertion into "
    "unconditional truth. Do not invent current prices, valuation figures, or public "
    "ticker claims that the evidence does not contain."
)

# The deliberately selected research task that explicitly requires source-backed evidence.
# The selected workflow names its own project_id so the tool is scoped correctly.
RESEARCH_TASK = (
    f"For the selected project (project_id {PROJECT_ID}), examine the existing source-backed "
    "KnowGraph evidence around Redwire / RDW and SpaceX. Use KnowGraph Hybrid Retrieval "
    f"(call it with project_id={PROJECT_ID} and anchors like 'Redwire Corporation', 'RDW', "
    "'SpaceX') when needed before answering. Return: the source-backed relationships found, "
    "contradictions, uncertainties, and the sourceRefs consulted, plus what remains "
    "unresolved. Do not invent current prices, valuation figures, or public ticker claims."
)

# A code-only control task that must NOT trigger KnowGraph retrieval just because the
# tool is attached.
CODE_ONLY_TASK = (
    "Rename the local variable `tmp` to `buffer` in a single Python helper and keep "
    "behavior identical. This is a code-only edit; no external research is needed."
)


def build_selected_research_context(
    *,
    provider: str,
    provider_model_id: str,
    tools: list[str],
    user_text: str = RESEARCH_TASK,
    participant_prompt: str = SELECTED_RESEARCH_WORKFLOW_INSTRUCTIONS,
    project_id: str = PROJECT_ID,
) -> ContextPack:
    """Build the selected research workflow ContextPack.

    ``tools`` is the research participant's selected-tool set (the existing card
    Tools path); pass ``["retrieve_knowgraph_context"]`` to attach, ``[]`` to detach.
    """
    card = CardRuntimeConfig(
        cardId="orch",
        title="Mag One",
        runtimeType="magentic_one",
        participants=[
            CardRuntimeParticipant(
                cardId="research",
                title="Research Agent",
                runtimeType="assistant_agent",
                role="research",
                tools=list(tools),
                prompt=participant_prompt,
                provider=provider,
                providerModelId=provider_model_id,
            ),
        ],
    )
    return ContextPack(
        session=ProjectSession(
            sessionId="selected-research-smoke",
            projectId=project_id,
            turnId="t1",
            route="deck_builder/run",
            modelProvider=provider,
            modelKey="gpt-5.1-chat",
            providerModelId=provider_model_id,
            startedAt="now",
        ),
        userText=user_text,
        cardRuntime=card,
    )
