"""ThinkGraph runtime profile v1 — `thinkgraph.project_turn.v1`.

The first real database-backed runtime profile, assigned to the persisted card
with `runtimeBinding: 'thinkgraph_agent'`. This module DECLARES the profile and
registers its card-specific hook and terminal contract with the generic
execution host (runtime_profile_executor). Nothing here is a universal runtime
law: the pair-authority check, the two-tool allowance, and the PATCH/NO_PATCH
contract are behaviors this specific assigned profile declares. A future
profile (e.g. a cross-project synthesis skill) declares its own hooks and data
bindings instead — the executor stays unchanged.

Terminal contract (this profile's declared accepted outcomes):
  * PATCH    — an actual authorized apply_thinkgraph_patch call stored real records
  * NO_PATCH — a structured machine-readable result with a specific reason

Prose-only completion gets exactly ONE bounded repair instruction inside the same
authorized run (declared profile behavior, not semantic extraction); a second
invalid result is THINKGRAPH_INVALID_TERMINAL_RESULT with zero graph mutation.
No fallback extractor, model, card, or writer exists here.
"""

from __future__ import annotations

import json
import re

from app.python_models import runtime_assignments as ra
from app.python_models import runtime_profile_executor as rpe
from app.python_models.tool_registry import THINKGRAPH_PATCH_EVENTS

THINKGRAPH_RUNTIME_BINDING = "thinkgraph_agent"
THINKGRAPH_PROFILE_ID = "thinkgraph.project_turn"
THINKGRAPH_PROFILE_VERSION = 1
THINKGRAPH_ALLOWED_TOOLS = ["read_thinkgraph_scope", "apply_thinkgraph_patch"]
THINKGRAPH_TERMINAL_CONTRACT = "thinkgraph.patch_or_structured_no_patch"

INVALID_TERMINAL_ERROR = "THINKGRAPH_INVALID_TERMINAL_RESULT"

REPAIR_INSTRUCTION = (
    "Your prior result is not an accepted ThinkGraph terminal result. Return a valid "
    "PATCH through the authorized patch tool or a structured NO_PATCH with a specific "
    'reason, exactly as JSON: {"outcome": "no_patch", "reason": "<specific reason>"}. '
    "Do not provide ordinary prose."
)

# The canonical profile record (seeded into the runtime_profiles table by
# seed_thinkgraph_profile; resolved back deterministically at run time). The
# hook IDs below are the profile's ASSIGNED procedure — the executor runs them
# because they are assigned, never because Python assumes them.
PROFILE_V1 = ra.RuntimeProfile(
    profile_id=THINKGRAPH_PROFILE_ID,
    version=THINKGRAPH_PROFILE_VERSION,
    runtime_binding=THINKGRAPH_RUNTIME_BINDING,
    execution_mode="assistant_agent",
    enabled=True,
    pre_hooks=[
        "thinkgraph.verify_pair_authority",
        "runtime.load_assigned_skills",
        "runtime.load_assigned_data_bindings",
        "runtime.enforce_allowed_tools",
    ],
    allowed_tools=list(THINKGRAPH_ALLOWED_TOOLS),
    terminal_contract=THINKGRAPH_TERMINAL_CONTRACT,
    post_hooks=["runtime.record_run_trace"],
    instruction_fragment=(
        "TERMINAL CONTRACT: you must end with exactly one of two outcomes. "
        "(1) PATCH: make ONE apply_thinkgraph_patch call with a compact patch. "
        '(2) NO_PATCH: return exactly the JSON object {"outcome": "no_patch", '
        '"reason": "<specific reason>"} and nothing else. '
        "An ordinary prose paragraph is not a valid terminal result."
    ),
    proof_refs=["thinkgraph-mcp-card-runtime-tool-loop-proof-2026-06-30"],
)


# ---------------------------------------------------------------------------
# Profile-assigned pre-hook: trusted pair-source authority verification.
#
# This profile's v1 data assignment is the completed current chat exchange
# (conversation_source binding) carried by the server-authored runtimeScope.
# Requiring that authority here is THIS profile's declared behavior — a later
# profile with a different data assignment simply does not assign this hook.
# ---------------------------------------------------------------------------

_AUTHORITY_REQUIRED_KEYS = (
    "projectId",
    "cardId",
    "correlationId",
    "conversationId",
    "userMessageId",
    "assistantMessageId",
)


def validate_pair_authority(runtime_scope: object) -> str | None:
    if not isinstance(runtime_scope, dict):
        return "thinkgraph_pair_authority_missing"
    if runtime_scope.get("kind") != "thinkgraph_pair":
        return f"thinkgraph_pair_authority_kind_invalid: {runtime_scope.get('kind')}"
    for key in _AUTHORITY_REQUIRED_KEYS:
        if not str(runtime_scope.get(key) or "").strip():
            return f"thinkgraph_pair_authority_{key}_missing"
    if str(runtime_scope.get("userMessageId")).strip() == str(runtime_scope.get("assistantMessageId")).strip():
        return "thinkgraph_pair_authority_pair_identity_invalid"
    return None


def _hook_verify_pair_authority(state: rpe.HookState) -> None:
    error = validate_pair_authority(state.runtime_scope)
    if error:
        raise ValueError(error)


rpe.register_hook("thinkgraph.verify_pair_authority", _hook_verify_pair_authority)


# ---------------------------------------------------------------------------
# Profile-assigned terminal contract (pure evaluation + declared single repair).
# ---------------------------------------------------------------------------


def parse_structured_no_patch(text: str) -> str | None:
    """Return the specific reason when the text is a structured NO_PATCH result.

    Accepts the bare JSON object (optionally inside a code fence). Anything else —
    prose, partial JSON, missing/empty reason — is not a NO_PATCH result.
    """
    cleaned = str(text or "").strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    if not cleaned.startswith("{"):
        return None
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    if str(parsed.get("outcome") or "").strip().lower() != "no_patch":
        return None
    reason = str(parsed.get("reason") or "").strip()
    return reason or None


def evaluate_terminal_result(final_text: str) -> rpe.TerminalVerdict:
    """PATCH requires an actual authorized applied patch with stored references
    (recorded by the scoped tool during THIS run). NO_PATCH requires the structured
    machine-readable result. Everything else is invalid."""
    events = THINKGRAPH_PATCH_EVENTS.get() or []
    applied = [
        e for e in events
        if e.get("status") == "applied"
        and (e.get("storedResourceIds") or e.get("storedStatementIds") or e.get("relationCount"))
    ]
    if applied:
        return rpe.TerminalVerdict(
            outcome="accepted", record="patched", reason="authorized_patch_applied", stored_refs=applied
        )
    reason = parse_structured_no_patch(final_text)
    if reason:
        return rpe.TerminalVerdict(outcome="accepted", record="no_patch", reason=reason)
    return rpe.TerminalVerdict(
        outcome="invalid", record="invalid_terminal",
        reason="terminal_result_not_patch_or_structured_no_patch",
    )


rpe.register_terminal_contract(
    rpe.TerminalContract(
        contract_id=THINKGRAPH_TERMINAL_CONTRACT,
        evaluate=evaluate_terminal_result,
        repair_instruction=REPAIR_INSTRUCTION,
        invalid_error=INVALID_TERMINAL_ERROR,
    )
)
