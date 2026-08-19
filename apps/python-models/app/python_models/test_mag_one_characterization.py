"""Behavioral lock for the Microsoft AutoGen 0.7.5 Magentic-One state machine.

These tests use deterministic replay clients. They characterize orchestration
mechanics only and never claim provider/runtime proof.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from importlib.metadata import distribution
from pathlib import Path

import pytest
from autogen_agentchat.agents import BaseChatAgent
from autogen_agentchat.base import Response
from autogen_agentchat.messages import BaseChatMessage, TextMessage
from autogen_agentchat.teams import MagenticOneGroupChat
from autogen_core import CancellationToken
from autogen_ext.models.replay import ReplayChatCompletionClient

import autogen_agentchat
import autogen_core
import autogen_ext


def test_checked_in_autogen_fork_is_the_only_declared_runtime_source() -> None:
    requirements = (Path(__file__).parents[2] / "requirements.txt").read_text(encoding="utf-8")
    assert "-e ../../autogen-main/python/packages/autogen-core" in requirements
    assert "-e ../../autogen-main/python/packages/autogen-agentchat" in requirements
    assert "-e ../../autogen-main/python/packages/autogen-ext[magentic-one,openai]" in requirements
    assert "autogen-core==" not in requirements
    assert "autogen-agentchat==" not in requirements
    assert "autogen-ext[magentic-one,openai]==" not in requirements
    fork_root = Path(__file__).parents[4] / "autogen-main" / "python" / "packages"
    assert (fork_root / "autogen-core" / "pyproject.toml").is_file()
    assert (fork_root / "autogen-agentchat" / "pyproject.toml").is_file()
    assert (fork_root / "autogen-ext" / "pyproject.toml").is_file()


def test_autogen_imports_and_distributions_resolve_only_to_the_checked_in_fork() -> None:
    repository_root = Path(__file__).parents[4].resolve()
    fork_root = (repository_root / "autogen-main").resolve()
    for module in (autogen_core, autogen_agentchat, autogen_ext):
        assert Path(module.__file__).resolve().is_relative_to(fork_root)
    for name in ("autogen-core", "autogen-agentchat", "autogen-ext"):
        direct = json.loads(distribution(name).read_text("direct_url.json") or "{}")
        assert direct.get("dir_info", {}).get("editable") is True
        assert Path(direct["url"].removeprefix("file:///")).resolve().is_relative_to(fork_root)


def _progress(*, satisfied: bool, progress: bool, loop: bool, speaker: str, instruction: str) -> str:
    return json.dumps(
        {
            "is_request_satisfied": {"answer": satisfied, "reason": "characterized"},
            "is_progress_being_made": {"answer": progress, "reason": "characterized"},
            "is_in_loop": {"answer": loop, "reason": "characterized"},
            "instruction_or_question": {"answer": instruction, "reason": "characterized"},
            "next_speaker": {"answer": speaker, "reason": "characterized"},
        }
    )


class _RecordingAgent(BaseChatAgent):
    def __init__(self, name: str) -> None:
        super().__init__(name, f"{name} description")
        self.calls: list[str] = []

    @property
    def produced_message_types(self) -> Sequence[type[BaseChatMessage]]:
        return (TextMessage,)

    async def on_messages(
        self,
        messages: Sequence[BaseChatMessage],
        cancellation_token: CancellationToken,
    ) -> Response:
        text = messages[-1].to_text()
        self.calls.append(text)
        return Response(chat_message=TextMessage(content=f"{self.name} result", source=self.name))

    async def on_reset(self, cancellation_token: CancellationToken) -> None:
        return None


async def _case_initial_task_ledger_progress_selection_completion_and_state_roundtrip() -> None:
    researcher = _RecordingAgent("researcher")
    coder = _RecordingAgent("coder")
    client = ReplayChatCompletionClient(
        chat_completions=[
            "GIVEN FACTS\nASSUMPTIONS: network is unavailable",
            "PLAN: researcher inspects, coder remains idle",
            _progress(
                satisfied=False,
                progress=True,
                loop=False,
                speaker="researcher",
                instruction="Inspect the bounded evidence",
            ),
            _progress(
                satisfied=True,
                progress=True,
                loop=False,
                speaker="researcher",
                instruction="Finish",
            ),
            "final characterized answer",
        ]
    )
    team = MagenticOneGroupChat([researcher, coder], model_client=client)

    result = await team.run(task="characterize the ledger")
    state = await team.save_state()

    ledger_messages = [
        message.to_text()
        for message in result.messages
        if message.source == "MagenticOneOrchestrator"
        and "We are working to address" in message.to_text()
    ]
    assert len(ledger_messages) == 1
    assert "GIVEN FACTS" in ledger_messages[0]
    assert "ASSUMPTIONS: network is unavailable" in ledger_messages[0]
    assert "PLAN: researcher inspects, coder remains idle" in ledger_messages[0]
    assert researcher.calls == ["Inspect the bounded evidence"]
    assert coder.calls == []
    assert result.stop_reason == "characterized"
    assert result.messages[-1].to_text() == "final characterized answer"

    restored = MagenticOneGroupChat(
        [_RecordingAgent("researcher"), _RecordingAgent("coder")],
        model_client=ReplayChatCompletionClient(chat_completions=[]),
    )
    await restored.load_state(state)
    assert await restored.save_state() == state


async def _case_stall_count_replans_facts_and_plan_before_completion() -> None:
    researcher = _RecordingAgent("researcher")
    client = ReplayChatCompletionClient(
        chat_completions=[
            "facts v1",
            "plan v1",
            _progress(
                satisfied=False,
                progress=False,
                loop=True,
                speaker="researcher",
                instruction="stalled instruction",
            ),
            "facts v2",
            "plan v2",
            _progress(
                satisfied=True,
                progress=True,
                loop=False,
                speaker="researcher",
                instruction="complete",
            ),
            "replanned final answer",
        ]
    )
    team = MagenticOneGroupChat([researcher], model_client=client, max_stalls=1)

    result = await team.run(task="force one replan")

    assert researcher.calls == []
    ledger_messages = [
        message.to_text()
        for message in result.messages
        if message.source == "MagenticOneOrchestrator"
        and "We are working to address" in message.to_text()
    ]
    assert len(ledger_messages) == 2
    assert "facts v1" in ledger_messages[0] and "plan v1" in ledger_messages[0]
    assert "facts v2" in ledger_messages[1] and "plan v2" in ledger_messages[1]
    assert result.stop_reason == "characterized"


async def _case_invalid_progress_ledger_fails_instead_of_selecting_a_worker() -> None:
    researcher = _RecordingAgent("researcher")
    client = ReplayChatCompletionClient(
        chat_completions=["facts", "plan", *(["not-json"] * 10)]
    )
    team = MagenticOneGroupChat([researcher], model_client=client)

    with pytest.raises(ValueError, match="Failed to parse ledger information"):
        await team.run(task="fail visibly")
    assert researcher.calls == []


def test_initial_task_ledger_progress_selection_completion_and_state_roundtrip() -> None:
    asyncio.run(_case_initial_task_ledger_progress_selection_completion_and_state_roundtrip())


def test_stall_count_replans_facts_and_plan_before_completion() -> None:
    asyncio.run(_case_stall_count_replans_facts_and_plan_before_completion())


def test_invalid_progress_ledger_fails_instead_of_selecting_a_worker() -> None:
    asyncio.run(_case_invalid_progress_ledger_fails_instead_of_selecting_a_worker())
