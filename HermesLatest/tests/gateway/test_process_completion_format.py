"""Completion formatting uses the existing process allowance without losing a reply."""

import json

from gateway.run_notifications import GatewayNotificationsMixin
from tools.bot_mode_dm import REPLY_COMPLETION_CHARS
from tools.process_registry import ProcessSession


def test_bot_completion_preserves_its_whole_reply_and_routing():
    raw = json.dumps({"reply": "A sourced finding. " * 300}) + "\n"
    process = ProcessSession(
        id="format-test", command="bot reply", output_buffer=raw, exited=True,
        exit_code=0, completion_output_chars=REPLY_COMPLETION_CHARS,
        parent_session_id="parent-session",
    )
    result = GatewayNotificationsMixin._build_process_completion_event(
        {"chat_id": "recipient", "message_id": "origin-message"}, process, process.id,
    )
    assert result["output"] == raw
    assert result["message_id"] == "origin-message"
    assert result["parent_session_id"] == "parent-session"
    assert result["session_id"] == process.id
    assert result["type"] == "completion"


def test_ordinary_process_retains_two_thousand_character_default():
    raw = "ordinary output " * 300
    process = ProcessSession(id="format-test", command="build", output_buffer=raw, exit_code=0)
    result = GatewayNotificationsMixin._build_process_completion_event({}, process, process.id)
    assert result["output"] == "[… output truncated — showing last 2000 chars]\n" + raw[-2000:]


def test_trailing_newline_does_not_erase_a_nonempty_tail():
    for ending in ("", "\n", "\r\n", "\n\n", "\n  \t"):
        raw = json.dumps({"reply": "A sourced finding. " * 300}) + ending
        process = ProcessSession(id="format-test", command="build", output_buffer=raw, exit_code=0)
        result = GatewayNotificationsMixin._build_process_completion_event({}, process, process.id)
        assert result["output"] == "[… output truncated — showing last 2000 chars]\n" + raw[-2000:]


def test_multiline_tail_still_prefers_a_complete_nonempty_line():
    raw = "x" * 3000 + "\nResult complete.\n"
    process = ProcessSession(id="format-test", command="build", output_buffer=raw, exit_code=0)
    result = GatewayNotificationsMixin._build_process_completion_event({}, process, process.id)
    assert result["output"] == "[… output truncated — showing last 17 chars]\nResult complete.\n"


def test_gateway_redacts_before_a_cut_can_remove_the_secret_prefix():
    import os
    import subprocess
    import sys

    code = '''
from gateway.run_notifications import GatewayNotificationsMixin
from tools.process_registry import ProcessSession
from agent.redact import _redact_enabled
assert not _redact_enabled()
raw = 'Bearer ' + 'X' * 3000 + '\\n'
process = ProcessSession(id='format-test', command='output', output_buffer=raw, exit_code=0)
result = GatewayNotificationsMixin._build_process_completion_event({}, process, process.id)
assert 'X' * 100 not in result['output']
assert '[redacted]' in result['output']
assert process.output_buffer == raw
'''
    result = subprocess.run(
        [sys.executable, "-c", code],
        env={**os.environ, "HERMES_REDACT_SECRETS": "false"},
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr
