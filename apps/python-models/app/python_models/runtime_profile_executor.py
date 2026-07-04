"""Generic runtime-profile / hook / terminal-contract execution host.

Python is an execution host here — it owns NO card-specific policy. The saved
card's persisted runtime binding deterministically selects its assigned database
profile; the profile declares which hook IDs run, which tools are allowed, and
which terminal contract applies. Python executes exactly what is assigned:

  saved card → persisted runtime binding → assigned profile → assigned skills
  → assigned data bindings → assigned pre-hooks → configured AssistantAgent
  → semantic model run → assigned terminal contract → assigned post-hooks
  → run trace/provenance.

Hooks are executable operations registered by ID. A profile referencing an
unknown hook or contract fails honestly. Card-specific behavior (e.g. the
ThinkGraph pair-authority check) lives in a hook module that registers itself —
never as a conditional in this executor or in the card runner. No filesystem or
Markdown is read at runtime; assignments come from the database only.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable

from app.python_models import runtime_assignments as ra


# ---------------------------------------------------------------------------
# Hook state: the mutable bundle assigned hooks read and fill.
# ---------------------------------------------------------------------------


@dataclass
class HookState:
    project_id: str
    deck_id: str
    card_id: str
    correlation_id: str
    runtime_binding: str
    selected_tools: list[str]
    runtime_scope: dict[str, Any] | None
    profile: ra.RuntimeProfile
    skills: list[ra.RuntimeSkill] = field(default_factory=list)
    data_bindings: list[dict[str, Any]] = field(default_factory=list)


HookFn = Callable[[HookState], None]  # raises on failure — never degrades silently


@dataclass
class TerminalVerdict:
    outcome: str  # 'accepted' | 'invalid' — plus a contract-specific record
    record: str = ""  # machine-readable trace outcome label (e.g. patched/no_patch)
    reason: str = ""
    stored_refs: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class TerminalContract:
    """Assigned terminal-result handling. `evaluate` inspects the final text plus
    whatever run signals the contract's own tools recorded; `repair_instruction`
    (when declared) allows exactly one bounded repair turn inside the same run."""

    contract_id: str
    evaluate: Callable[[str], TerminalVerdict]
    repair_instruction: str | None = None
    invalid_error: str = "RUNTIME_INVALID_TERMINAL_RESULT"


HOOK_REGISTRY: dict[str, HookFn] = {}
TERMINAL_CONTRACTS: dict[str, TerminalContract] = {}


def register_hook(hook_id: str, fn: HookFn) -> None:
    if hook_id in HOOK_REGISTRY:
        raise RuntimeError(f"runtime_hook_already_registered: {hook_id}")
    HOOK_REGISTRY[hook_id] = fn


def register_terminal_contract(contract: TerminalContract) -> None:
    if contract.contract_id in TERMINAL_CONTRACTS:
        raise RuntimeError(f"terminal_contract_already_registered: {contract.contract_id}")
    TERMINAL_CONTRACTS[contract.contract_id] = contract


# ---------------------------------------------------------------------------
# Generic assignment hooks (mechanics only — no semantic or scope policy).
# ---------------------------------------------------------------------------


def _hook_load_assigned_skills(state: HookState) -> None:
    """Load the card's exact pinned skill assignments; a non-promoted or
    incompatible assignment fails honestly — never silently excluded."""
    if not state.project_id or not state.deck_id or not state.card_id:
        raise ValueError("runtime_assignment_identity_missing")
    state.skills = ra.assigned_skills(
        project_id=state.project_id, deck_id=state.deck_id, card_id=state.card_id
    )
    for skill in state.skills:
        gate = ra.validate_skill_assignment(
            skill, card_runtime_binding=state.runtime_binding, project_id=state.project_id
        )
        if gate:
            raise ValueError(f"assigned_skill_invalid: {gate}")


def _hook_load_assigned_data_bindings(state: HookState) -> None:
    """Load the card's persisted data bindings. Availability comes from assignment —
    the executor imposes no project/conversation/graph scope of its own."""
    if not state.project_id or not state.deck_id or not state.card_id:
        raise ValueError("runtime_assignment_identity_missing")
    state.data_bindings = ra.assigned_data_bindings(
        project_id=state.project_id, deck_id=state.deck_id, card_id=state.card_id
    )


def _hook_enforce_allowed_tools(state: HookState) -> None:
    """The card's saved tool selection must be exactly the profile's allowance."""
    selected = sorted({str(t).strip() for t in (state.selected_tools or []) if str(t).strip()})
    allowed = sorted(set(state.profile.allowed_tools))
    if selected != allowed:
        raise ValueError(
            f"profile_tools_invalid: expected [{','.join(allowed)}], got [{','.join(selected)}]"
        )


register_hook("runtime.load_assigned_skills", _hook_load_assigned_skills)
register_hook("runtime.load_assigned_data_bindings", _hook_load_assigned_data_bindings)
register_hook("runtime.enforce_allowed_tools", _hook_enforce_allowed_tools)


# ---------------------------------------------------------------------------
# Profiled run plan.
# ---------------------------------------------------------------------------


@dataclass
class ProfiledRunPlan:
    profile: ra.RuntimeProfile
    state: HookState
    packet: str
    pinned_skill_versions: list[str]


def build_runtime_packet(
    profile: ra.RuntimeProfile,
    skills: list[ra.RuntimeSkill],
    data_bindings: list[dict[str, Any]],
) -> str:
    """The compact packet a card receives: ONLY its assigned records — no global
    skill dump, no folder scan, no model-side profile choice."""
    lines = [
        f"RUNTIME PROFILE: {profile.profile_id}.v{profile.version} (binding={profile.runtime_binding})",
    ]
    if skills:
        lines.append("ASSIGNED RUNTIME SKILLS (pinned versions):")
        for skill in skills:
            guidance = re.sub(r"\s+", " ", skill.guidance or "").strip()
            lines.append(f"- {skill.skill_id}@v{skill.version}: {guidance}")
    else:
        lines.append("ASSIGNED RUNTIME SKILLS: none")
    if data_bindings:
        lines.append("ASSIGNED DATA BINDINGS:")
        for binding in data_bindings:
            lines.append(
                f"- {binding['bindingType']}: {json.dumps(binding.get('bindingRef') or {}, sort_keys=True)}"
            )
    else:
        lines.append("ASSIGNED DATA BINDINGS: none")
    if profile.instruction_fragment:
        lines.append(profile.instruction_fragment)
    return "\n".join(lines)


def prepare(
    *,
    runtime_binding: str | None,
    project_id: str,
    deck_id: str,
    card_id: str,
    correlation_id: str,
    selected_tools: list[str],
    runtime_scope: dict[str, Any] | None,
) -> ProfiledRunPlan | None:
    """Deterministic pre-run resolution. Returns None when the persisted binding has
    no assigned profile (the card's declared unprofiled state — not a fallback).
    Ambiguity, unknown hooks, or hook failures raise honestly."""
    binding = str(runtime_binding or "").strip()
    if not binding:
        return None
    profile = ra.find_profile(binding)
    if profile is None:
        return None
    # A terminal contract is optional: a profile with none simply runs once and
    # returns whatever the model said, with no forced output grammar and no
    # repair loop. Only a NAMED-but-unregistered contract is an honest error.
    if profile.terminal_contract and str(profile.terminal_contract) not in TERMINAL_CONTRACTS:
        raise ValueError(f"terminal_contract_unknown: {profile.terminal_contract}")

    state = HookState(
        project_id=str(project_id or "").strip(),
        deck_id=str(deck_id or "").strip(),
        card_id=str(card_id or "").strip(),
        correlation_id=str(correlation_id or "").strip(),
        runtime_binding=binding,
        selected_tools=list(selected_tools or []),
        runtime_scope=runtime_scope if isinstance(runtime_scope, dict) else None,
        profile=profile,
    )
    for hook_id in profile.pre_hooks:
        hook = HOOK_REGISTRY.get(str(hook_id))
        if hook is None:
            raise ValueError(f"runtime_hook_unknown: {hook_id}")
        hook(state)

    return ProfiledRunPlan(
        profile=profile,
        state=state,
        packet=build_runtime_packet(profile, state.skills, state.data_bindings),
        pinned_skill_versions=[f"{s.skill_id}@v{s.version}" for s in state.skills],
    )


def terminal_contract_for(plan: ProfiledRunPlan) -> TerminalContract:
    return TERMINAL_CONTRACTS[str(plan.profile.terminal_contract)]


# ---------------------------------------------------------------------------
# Assigned post-hooks. `finalize` executes the profile's declared post-hook IDs.
# ---------------------------------------------------------------------------

_POST_HOOKS: dict[str, Callable[[ProfiledRunPlan, str, str], None]] = {}


def register_post_hook(hook_id: str, fn: Callable[[ProfiledRunPlan, str, str], None]) -> None:
    if hook_id in _POST_HOOKS:
        raise RuntimeError(f"runtime_post_hook_already_registered: {hook_id}")
    _POST_HOOKS[hook_id] = fn


def _post_hook_record_run_trace(plan: ProfiledRunPlan, outcome: str, detail: str) -> None:
    ra.record_run_trace(
        project_id=plan.state.project_id,
        correlation_id=plan.state.correlation_id,
        deck_id=plan.state.deck_id,
        card_id=plan.state.card_id,
        profile_id=plan.profile.profile_id,
        profile_version=plan.profile.version,
        skill_versions=plan.pinned_skill_versions,
        data_binding_refs=plan.state.data_bindings,
        outcome=outcome,
        detail=detail,
    )


register_post_hook("runtime.record_run_trace", _post_hook_record_run_trace)


def finalize(plan: ProfiledRunPlan, *, outcome: str, detail: str) -> None:
    for hook_id in plan.profile.post_hooks:
        hook = _POST_HOOKS.get(str(hook_id))
        if hook is None:
            raise ValueError(f"runtime_post_hook_unknown: {hook_id}")
        hook(plan, outcome, detail)
