"""Focused coverage for the real AutoGen 0.7.5 Magentic-One adapter.

These tests exercise the structured pipeline without any network/model calls:
card compilation -> participant metadata, real facts/plan -> structured
TaskLedger, and a captured progress ledger -> structured ProgressLedger.
"""
from app.python_models import magentic_agentchat as mac
from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    CardRuntimeGraph,
    CardRuntimeParticipant,
    ContextPack,
    GraphEdgeInput,
    GraphNodeInput,
    ProjectSession,
    TaskLedger,
)

MODEL = "openai/gpt-5.1-chat"


def test_autogen_0_7_5_imports_load():
    import autogen_agentchat
    import autogen_core
    import autogen_ext

    assert autogen_core.__version__.startswith("0.7")
    assert autogen_agentchat.__version__.startswith("0.7")
    assert autogen_ext.__version__.startswith("0.7")


def _context_pack(run_approved: bool = False) -> ContextPack:
    graph = CardRuntimeGraph(
        nodes=[
            GraphNodeInput(cardId="orch", title="Orchestrator", runtimeType="magentic_one",
                           provider="openrouter", providerModelId=MODEL),
            GraphNodeInput(cardId="researcher", title="Research Agent", runtimeType="assistant_agent",
                           role="research", tools=[], prompt="You research things.",
                           provider="openrouter", providerModelId=MODEL),
        ],
        edges=[GraphEdgeInput(id="e1", source="orch", target="researcher", edgeType="magentic_option")],
    )
    card = CardRuntimeConfig(
        cardId="orch",
        title="Mag One",
        runtimeType="magentic_one",
        graph=graph,
        participants=[
            CardRuntimeParticipant(
                cardId="researcher", title="Research Agent", runtimeType="assistant_agent",
                role="research", provider="openrouter", providerModelId=MODEL,
            )
        ],
    )
    return ContextPack(
        session=ProjectSession(
            sessionId="s", projectId="p", turnId="t", route="r",
            modelProvider="openrouter", modelKey="gpt-5.1-chat", providerModelId=MODEL,
            startedAt="now",
        ),
        userText="Audit this repo safely without editing code.",
        cardRuntime=card,
        runApproved=run_approved,
    )


def test_connected_cards_compile_into_participant_metadata():
    specs = mac.compile_connected_agents(_context_pack())
    assert len(specs) == 1
    spec = specs[0]
    assert spec["id"] == "researcher"
    assert spec["name"] == "Research_Agent"  # sanitized, identifier-safe
    assert spec["role"] == "research"
    assert spec["provider"] == "openrouter"
    assert spec["provider_model_id"] == MODEL


def test_parse_facts_sheet_routes_real_sections_into_buckets():
    facts = (
        "1. GIVEN OR VERIFIED FACTS\n- repo path is C:/Projects/main\n"
        "2. FACTS TO LOOK UP\n- the test runner config\n"
        "3. FACTS TO DERIVE\n- module dependency order\n"
        "4. EDUCATED GUESSES\n- it is a monorepo\n"
    )
    buckets = mac.parse_facts_sheet(facts)
    assert buckets["known_facts"] == ["repo path is C:/Projects/main"]
    assert buckets["unknowns_to_lookup"] == ["the test runner config"]
    assert buckets["facts_to_derive"] == ["module dependency order"]
    assert buckets["assumptions_or_guesses"] == ["it is a monorepo"]


def test_parse_plan_steps_assigns_named_agent():
    steps = mac.parse_plan_steps(
        "- Ask Research_Agent to scan the repo\n- Summarize findings",
        ["Research_Agent"],
    )
    assert len(steps) == 2
    assert steps[0].assigned_agent == "Research_Agent"
    assert steps[0].execution_allowed_now is False
    assert steps[0].approval_required is True
    # Unnamed step falls back to the first agent, never invented.
    assert steps[1].assigned_agent == "Research_Agent"


def test_build_task_ledger_is_structured_not_raw_text():
    specs = mac.compile_connected_agents(_context_pack())
    ledger = mac.build_task_ledger(
        user_goal="Audit this repo",
        facts="1. GIVEN OR VERIFIED FACTS\n- a fact\n4. EDUCATED GUESSES\n- a guess",
        plan="- Research_Agent inspects code",
        agent_specs=specs,
    )
    assert isinstance(ledger, TaskLedger)
    assert ledger.user_goal == "Audit this repo"
    assert ledger.known_facts == ["a fact"]
    assert ledger.assumptions_or_guesses == ["a guess"]
    assert ledger.connected_agents[0].name == "Research_Agent"
    assert ledger.connected_agents[0].execution_allowed_now is False
    assert ledger.plan_steps[0].assigned_agent == "Research_Agent"


def test_build_progress_ledger_from_captured_ledger_entry():
    progress_data = {
        "is_request_satisfied": {"reason": "not yet", "answer": False},
        "is_in_loop": {"reason": "no", "answer": False},
        "is_progress_being_made": {"reason": "yes", "answer": True},
        "next_speaker": {"reason": "best fit", "answer": "Research_Agent"},
        "instruction_or_question": {"reason": "scan", "answer": "Scan the repo read-only."},
    }
    pl = mac.build_progress_ledger(progress_data, events=[], agent_result="scanned", n_rounds=1)
    assert pl.progress_state == "running"
    assert pl.selected_agent == "Research_Agent"
    assert pl.instruction == "Scan the repo read-only."
    assert pl.agent_result == "scanned"


def test_progress_ledger_completed_and_blocked_states():
    completed = mac.build_progress_ledger(
        {"is_request_satisfied": {"reason": "done", "answer": True}}, [], "", 2
    )
    assert completed.progress_state == "completed"
    blocked = mac.build_progress_ledger(
        {
            "is_request_satisfied": {"reason": "no", "answer": False},
            "is_in_loop": {"reason": "no", "answer": False},
            "is_progress_being_made": {"reason": "cannot read file", "answer": False},
        },
        [],
        "",
        3,
    )
    assert blocked.progress_state == "blocked"
    assert blocked.blocker == "cannot read file"


def test_context_pack_run_approved_is_structured_flag():
    assert _context_pack(run_approved=False).runApproved is False
    assert _context_pack(run_approved=True).runApproved is True
