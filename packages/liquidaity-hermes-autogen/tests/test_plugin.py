from __future__ import annotations

import json

from liquidaity_hermes_autogen import register
from liquidaity_hermes_autogen.tools import autogen_task


class FakeContext:
    def __init__(self, response: object = '{"ok":true,"test":true}'):
        self.calls = []
        self.registrations = []
        self.response = response

    def dispatch_tool(self, name, args):
        self.calls.append((name, args))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response

    def register_tool(self, **registration):
        self.registrations.append(registration)


def test_registration_creates_autogen_task():
    ctx = FakeContext()

    register(ctx)

    assert len(ctx.registrations) == 1
    assert ctx.registrations[0]["name"] == "autogen_task"
    assert ctx.registrations[0]["toolset"] == "liquidaity-autogen"
    assert callable(ctx.registrations[0]["handler"])


def test_single_routes_to_saved_card_tool():
    ctx = FakeContext()

    result = autogen_task(ctx, {
        "mode": "single",
        "targetCardId": "card_test_autogen",
        "goal": "Inspect the supplied test input.",
    })

    assert result == '{"ok":true,"test":true}'
    assert ctx.calls == [(
        "card.run_assistant_agent",
        {
            "cardId": "card_test_autogen",
            "input": "Inspect the supplied test input.",
        },
    )]


def test_magentic_one_routes_to_existing_team_tool():
    ctx = FakeContext()

    result = autogen_task(ctx, {
        "mode": "magentic_one",
        "goal": "Evaluate this test mission as a team.",
    })

    assert result == '{"ok":true,"test":true}'
    assert ctx.calls == [(
        "run_mag_one",
        {
            "input": "Evaluate this test mission as a team.",
            "dataAnchors": [],
        },
    )]


def test_single_requires_target_card_before_dispatch():
    ctx = FakeContext()

    result = json.loads(autogen_task(ctx, {
        "mode": "single",
        "goal": "Inspect the supplied test input.",
    }))

    assert result == {"ok": False, "error": "autogen_task_targetCardId_required"}
    assert ctx.calls == []


def test_malformed_anchor_fails_before_dispatch():
    ctx = FakeContext()

    result = json.loads(autogen_task(ctx, {
        "mode": "magentic_one",
        "goal": "Evaluate the anchor.",
        "dataAnchors": [{
            "authority": "UnknownGraph",
            "nativeId": "node-1",
            "reason": "test",
        }],
    }))

    assert result == {
        "ok": False,
        "error": "autogen_task_failed",
        "exceptionClass": "ValueError",
    }
    assert ctx.calls == []


def test_graph_anchors_normalize_for_the_existing_card_path():
    ctx = FakeContext()

    autogen_task(ctx, {
        "mode": "single",
        "targetCardId": "card_test_autogen",
        "goal": "Inspect the supplied test input.",
        "dataAnchors": [{
            "authority": " CodeGraph ",
            "nativeId": " pkg.symbol ",
            "reason": " inspect this symbol ",
            "priority": 4,
            "boundedExpansion": 2,
            "resultLimit": 8,
            "required": False,
        }],
    })

    assert ctx.calls == [(
        "card.run_assistant_agent",
        {
            "cardId": "card_test_autogen",
            "input": "Inspect the supplied test input.",
            "dataAnchors": [{
                "authority": "CodeGraph",
                "nativeId": "pkg.symbol",
                "reason": "inspect this symbol",
                "priority": 4,
                "boundedExpansion": 2,
                "resultLimit": 8,
                "required": False,
            }],
        },
    )]


def test_downstream_response_is_returned_unchanged():
    downstream = '{"ok":true,"runId":"run-existing"}'
    ctx = FakeContext(response=downstream)

    result = autogen_task(ctx, {
        "mode": "magentic_one",
        "goal": "Evaluate this test mission as a team.",
    })

    assert result is downstream


def test_dispatch_exception_returns_bounded_error_json():
    ctx = FakeContext(response=RuntimeError("secret downstream detail"))

    result = json.loads(autogen_task(ctx, {
        "mode": "magentic_one",
        "goal": "Evaluate this test mission as a team.",
    }))

    assert result == {
        "ok": False,
        "error": "autogen_task_failed",
        "exceptionClass": "RuntimeError",
    }
    assert "secret downstream detail" not in json.dumps(result)
