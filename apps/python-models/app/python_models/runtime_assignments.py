"""Database-backed runtime assignments: profiles, skills, card bindings, run traces.

The database (the same Postgres the deck store uses) is the authoritative source
for runtime card assignments — never Markdown files, never a filesystem scan, and
never model choice. Explicit, versioned, validated records only:

  * runtime_profiles     — deterministic operating behavior per runtime binding
  * runtime_skills       — compact structured operational records (not documents)
  * card_skill_bindings  — exact card→skill@version assignment (project/deck/card scoped)
  * card_data_bindings   — bounded data scope assignments (no raw query injection)
  * card_run_traces      — pinned profile/skill/data versions per run

Pure validation lives in module-level functions (unit-testable without a DB).
DB functions fail honestly on connection/constraint errors — no fallback store.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from app.python_models.postgres import connect_postgres as _connect

SKILL_STATUSES = ("candidate", "promoted", "retired")

ALLOWED_DATA_BINDING_TYPES = (
    "conversation_source",
    "conversation_span_set",
    "thinkgraph_pointer_set",
    "thinkgraph_project_slice",
    "thinkgraph_graph_collection",
    "knowgraph_evidence_collection",
    "cbm_query_scope",
    "source_collection",
)

# Structural injection guard: a data binding is a bounded pointer/scope record,
# never an arbitrary query. Any of these keys is an honest rejection.
_FORBIDDEN_REF_KEYS = {"sql", "cypher", "query", "raw", "raw_query", "statement", "command", "script"}
_REF_MAX_KEYS = 16
_REF_MAX_LIST_ITEMS = 64
_REF_MAX_TEXT = 500


_DDL = """
CREATE TABLE IF NOT EXISTS runtime_profiles (
  profile_id text NOT NULL,
  version integer NOT NULL,
  runtime_binding text NOT NULL,
  execution_mode text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  pre_hooks jsonb NOT NULL DEFAULT '[]',
  allowed_tools jsonb NOT NULL DEFAULT '[]',
  terminal_contract text NOT NULL,
  post_hooks jsonb NOT NULL DEFAULT '[]',
  instruction_fragment text NOT NULL DEFAULT '',
  proof_refs jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, version)
);
CREATE TABLE IF NOT EXISTS runtime_skills (
  skill_id text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL,
  applies_to_binding text NOT NULL,
  guidance text NOT NULL DEFAULT '',
  required_tools jsonb NOT NULL DEFAULT '[]',
  required_data_binding_types jsonb NOT NULL DEFAULT '[]',
  proof_refs jsonb NOT NULL DEFAULT '[]',
  project_scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (skill_id, version)
);
CREATE TABLE IF NOT EXISTS card_skill_bindings (
  project_id text NOT NULL,
  deck_id text NOT NULL,
  card_id text NOT NULL,
  skill_id text NOT NULL,
  skill_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, deck_id, card_id, skill_id)
);
CREATE TABLE IF NOT EXISTS card_data_bindings (
  project_id text NOT NULL,
  deck_id text NOT NULL,
  card_id text NOT NULL,
  binding_type text NOT NULL,
  binding_ref jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, deck_id, card_id, binding_type)
);
CREATE TABLE IF NOT EXISTS card_run_traces (
  project_id text NOT NULL,
  correlation_id text NOT NULL,
  deck_id text NOT NULL DEFAULT '',
  card_id text NOT NULL,
  profile_id text,
  profile_version integer,
  skill_versions jsonb NOT NULL DEFAULT '[]',
  data_binding_refs jsonb NOT NULL DEFAULT '[]',
  outcome text NOT NULL,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, correlation_id)
);
"""


def ensure_tables(conn=None) -> None:
    own = conn is None
    conn = conn or _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(_DDL)
    finally:
        if own:
            conn.close()


# ---------------------------------------------------------------------------
# Typed records + pure validation (no DB required).
# ---------------------------------------------------------------------------


@dataclass
class RuntimeProfile:
    profile_id: str
    version: int
    runtime_binding: str
    execution_mode: str
    enabled: bool
    pre_hooks: list[str] = field(default_factory=list)
    allowed_tools: list[str] = field(default_factory=list)
    terminal_contract: str = ""
    post_hooks: list[str] = field(default_factory=list)
    instruction_fragment: str = ""
    proof_refs: list[str] = field(default_factory=list)


@dataclass
class RuntimeSkill:
    skill_id: str
    version: int
    status: str
    applies_to_binding: str
    guidance: str = ""
    required_tools: list[str] = field(default_factory=list)
    required_data_binding_types: list[str] = field(default_factory=list)
    proof_refs: list[str] = field(default_factory=list)
    project_scope: str | None = None


def validate_profile(profile: RuntimeProfile) -> str | None:
    if not str(profile.profile_id or "").strip():
        return "profile_id_required"
    if not isinstance(profile.version, int) or profile.version < 1:
        return "profile_version_invalid"
    if not str(profile.runtime_binding or "").strip():
        return "profile_runtime_binding_required"
    if not str(profile.execution_mode or "").strip():
        return "profile_execution_mode_required"
    # terminal_contract is OPTIONAL: a profile may assign none, in which case
    # the executor runs the agent once with no output grammar and no repair
    # loop. Only a NAMED contract must actually resolve (checked at prepare()
    # time against the registry, not here).
    return None


def validate_skill(skill: RuntimeSkill) -> str | None:
    if not str(skill.skill_id or "").strip():
        return "skill_id_required"
    if not isinstance(skill.version, int) or skill.version < 1:
        return "skill_version_invalid"
    if skill.status not in SKILL_STATUSES:
        return f"skill_status_invalid: {skill.status}"
    if not str(skill.applies_to_binding or "").strip():
        return "skill_applies_to_binding_required"
    # A promoted skill must carry at least one actual proof reference — no
    # auto-promotion of claimed successes.
    if skill.status == "promoted" and not [p for p in (skill.proof_refs or []) if str(p).strip()]:
        return "skill_promotion_requires_proof_ref"
    return None


def validate_data_binding_ref(binding_type: str, binding_ref: Any) -> str | None:
    """Bounded pointer/scope record only. No arbitrary SQL/Cypher/raw query."""
    if binding_type not in ALLOWED_DATA_BINDING_TYPES:
        return f"data_binding_type_unknown: {binding_type}"
    if not isinstance(binding_ref, dict) or not binding_ref:
        return "data_binding_ref_must_be_object"
    if len(binding_ref) > _REF_MAX_KEYS:
        return "data_binding_ref_too_many_keys"
    for key, value in binding_ref.items():
        cleaned = str(key or "").strip().lower()
        if not cleaned:
            return "data_binding_ref_key_empty"
        if cleaned in _FORBIDDEN_REF_KEYS:
            return f"data_binding_ref_query_injection_rejected: {cleaned}"
        if isinstance(value, str):
            if len(value) > _REF_MAX_TEXT:
                return f"data_binding_ref_value_too_long: {cleaned}"
        elif isinstance(value, bool) or isinstance(value, (int, float)):
            continue
        elif isinstance(value, list):
            if len(value) > _REF_MAX_LIST_ITEMS:
                return f"data_binding_ref_list_too_long: {cleaned}"
            for item in value:
                if not isinstance(item, str) or len(item) > _REF_MAX_TEXT:
                    return f"data_binding_ref_list_items_must_be_short_strings: {cleaned}"
        else:
            return f"data_binding_ref_value_type_rejected: {cleaned}"
    return None


def validate_skill_assignment(
    skill: RuntimeSkill | None,
    *,
    card_runtime_binding: str,
    project_id: str,
) -> str | None:
    """Assignment gate: promoted status, binding compatibility, project scope."""
    if skill is None:
        return "skill_not_found"
    if skill.status != "promoted":
        return f"skill_not_promoted: {skill.skill_id}@{skill.version} status={skill.status}"
    if skill.applies_to_binding != card_runtime_binding:
        return (
            f"skill_binding_incompatible: {skill.skill_id} applies_to={skill.applies_to_binding} "
            f"card={card_runtime_binding}"
        )
    if skill.project_scope and skill.project_scope != project_id:
        return f"skill_project_scope_mismatch: {skill.skill_id} scope={skill.project_scope}"
    return None


# ---------------------------------------------------------------------------
# DB operations. Every function fails honestly (raises) on DB errors.
# ---------------------------------------------------------------------------


def _rows(cur) -> list[dict[str, Any]]:
    columns = [d[0] for d in cur.description]
    return [dict(zip(columns, row)) for row in cur.fetchall()]


def _as_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


def upsert_profile(profile: RuntimeProfile, conn=None) -> None:
    err = validate_profile(profile)
    if err:
        raise ValueError(err)
    own = conn is None
    conn = conn or _connect()
    try:
        ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO runtime_profiles (profile_id, version, runtime_binding, execution_mode,
                  enabled, pre_hooks, allowed_tools, terminal_contract, post_hooks,
                  instruction_fragment, proof_refs)
                VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s::jsonb,%s,%s::jsonb)
                ON CONFLICT (profile_id, version) DO UPDATE SET
                  runtime_binding=EXCLUDED.runtime_binding, execution_mode=EXCLUDED.execution_mode,
                  enabled=EXCLUDED.enabled, pre_hooks=EXCLUDED.pre_hooks,
                  allowed_tools=EXCLUDED.allowed_tools, terminal_contract=EXCLUDED.terminal_contract,
                  post_hooks=EXCLUDED.post_hooks, instruction_fragment=EXCLUDED.instruction_fragment,
                  proof_refs=EXCLUDED.proof_refs, updated_at=now()
                """,
                (
                    profile.profile_id, profile.version, profile.runtime_binding,
                    profile.execution_mode, profile.enabled, json.dumps(profile.pre_hooks),
                    json.dumps(profile.allowed_tools), profile.terminal_contract,
                    json.dumps(profile.post_hooks), profile.instruction_fragment,
                    json.dumps(profile.proof_refs),
                ),
            )
    finally:
        if own:
            conn.close()


def find_profile(runtime_binding: str, conn=None) -> RuntimeProfile | None:
    """Deterministic optional profile lookup: None when the binding simply has no
    assigned profile (the card's declared unprofiled state). Ambiguity and DB
    failures still raise honestly — they are never treated as 'no profile'."""
    try:
        return resolve_profile(runtime_binding, conn)
    except LookupError as err:
        if str(err).startswith("runtime_profile_missing"):
            return None
        raise


def resolve_profile(runtime_binding: str, conn=None) -> RuntimeProfile:
    """Deterministic profile resolution from the persisted runtime binding.

    Exactly one enabled profile_id may serve a binding (highest version wins).
    Zero → honest missing; more than one profile_id → honest ambiguity. The model
    never chooses a profile.
    """
    binding = str(runtime_binding or "").strip()
    if not binding:
        raise ValueError("runtime_binding_required")
    own = conn is None
    conn = conn or _connect()
    try:
        ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT ON (profile_id) profile_id, version, runtime_binding,
                       execution_mode, enabled, pre_hooks, allowed_tools, terminal_contract,
                       post_hooks, instruction_fragment, proof_refs
                FROM runtime_profiles
                WHERE runtime_binding = %s AND enabled
                ORDER BY profile_id, version DESC
                """,
                (binding,),
            )
            rows = _rows(cur)
    finally:
        if own:
            conn.close()
    if not rows:
        raise LookupError(f"runtime_profile_missing: {binding}")
    if len(rows) > 1:
        raise LookupError(
            f"runtime_profile_ambiguous: {binding} -> {','.join(sorted(r['profile_id'] for r in rows))}"
        )
    row = rows[0]
    return RuntimeProfile(
        profile_id=row["profile_id"], version=row["version"],
        runtime_binding=row["runtime_binding"], execution_mode=row["execution_mode"],
        enabled=row["enabled"], pre_hooks=_as_list(row["pre_hooks"]),
        allowed_tools=_as_list(row["allowed_tools"]), terminal_contract=row["terminal_contract"],
        post_hooks=_as_list(row["post_hooks"]),
        instruction_fragment=row["instruction_fragment"] or "",
        proof_refs=_as_list(row["proof_refs"]),
    )


def upsert_skill(skill: RuntimeSkill, conn=None) -> None:
    err = validate_skill(skill)
    if err:
        raise ValueError(err)
    own = conn is None
    conn = conn or _connect()
    try:
        ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO runtime_skills (skill_id, version, status, applies_to_binding, guidance,
                  required_tools, required_data_binding_types, proof_refs, project_scope)
                VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb,%s)
                ON CONFLICT (skill_id, version) DO UPDATE SET
                  status=EXCLUDED.status, applies_to_binding=EXCLUDED.applies_to_binding,
                  guidance=EXCLUDED.guidance, required_tools=EXCLUDED.required_tools,
                  required_data_binding_types=EXCLUDED.required_data_binding_types,
                  proof_refs=EXCLUDED.proof_refs, project_scope=EXCLUDED.project_scope,
                  updated_at=now()
                """,
                (
                    skill.skill_id, skill.version, skill.status, skill.applies_to_binding,
                    skill.guidance, json.dumps(skill.required_tools),
                    json.dumps(skill.required_data_binding_types), json.dumps(skill.proof_refs),
                    skill.project_scope,
                ),
            )
    finally:
        if own:
            conn.close()


def get_skill(skill_id: str, version: int, conn=None) -> RuntimeSkill | None:
    own = conn is None
    conn = conn or _connect()
    try:
        ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT skill_id, version, status, applies_to_binding, guidance, required_tools,
                       required_data_binding_types, proof_refs, project_scope
                FROM runtime_skills WHERE skill_id=%s AND version=%s
                """,
                (str(skill_id or "").strip(), int(version)),
            )
            rows = _rows(cur)
    finally:
        if own:
            conn.close()
    if not rows:
        return None
    row = rows[0]
    return RuntimeSkill(
        skill_id=row["skill_id"], version=row["version"], status=row["status"],
        applies_to_binding=row["applies_to_binding"], guidance=row["guidance"] or "",
        required_tools=_as_list(row["required_tools"]),
        required_data_binding_types=_as_list(row["required_data_binding_types"]),
        proof_refs=_as_list(row["proof_refs"]), project_scope=row["project_scope"],
    )


def assign_skill(
    *, project_id: str, deck_id: str, card_id: str, skill_id: str, skill_version: int,
    card_runtime_binding: str, conn=None,
) -> None:
    """Pin one promoted, binding-compatible skill version to a persisted card."""
    for name, value in (("project_id", project_id), ("deck_id", deck_id), ("card_id", card_id)):
        if not str(value or "").strip():
            raise ValueError(f"skill_assignment_{name}_required")
    own = conn is None
    conn = conn or _connect()
    try:
        skill = get_skill(skill_id, skill_version, conn)
        err = validate_skill_assignment(
            skill, card_runtime_binding=str(card_runtime_binding or "").strip(), project_id=project_id
        )
        if err:
            raise ValueError(err)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO card_skill_bindings (project_id, deck_id, card_id, skill_id, skill_version)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (project_id, deck_id, card_id, skill_id)
                DO UPDATE SET skill_version=EXCLUDED.skill_version, created_at=now()
                """,
                (project_id, deck_id, card_id, skill_id, skill_version),
            )
    finally:
        if own:
            conn.close()


def remove_skill_assignment(*, project_id: str, deck_id: str, card_id: str, skill_id: str, conn=None) -> None:
    own = conn is None
    conn = conn or _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM card_skill_bindings WHERE project_id=%s AND deck_id=%s AND card_id=%s AND skill_id=%s",
                (project_id, deck_id, card_id, skill_id),
            )
    finally:
        if own:
            conn.close()


def assigned_skills(*, project_id: str, deck_id: str, card_id: str, conn=None) -> list[RuntimeSkill]:
    """The card's exact pinned skill assignments (whatever their current status —
    the run-time executor fails honestly on non-promoted rows)."""
    own = conn is None
    conn = conn or _connect()
    try:
        ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.skill_id, s.version, s.status, s.applies_to_binding, s.guidance,
                       s.required_tools, s.required_data_binding_types, s.proof_refs, s.project_scope
                FROM card_skill_bindings b
                JOIN runtime_skills s ON s.skill_id=b.skill_id AND s.version=b.skill_version
                WHERE b.project_id=%s AND b.deck_id=%s AND b.card_id=%s
                ORDER BY s.skill_id
                """,
                (project_id, deck_id, card_id),
            )
            rows = _rows(cur)
    finally:
        if own:
            conn.close()
    return [
        RuntimeSkill(
            skill_id=r["skill_id"], version=r["version"], status=r["status"],
            applies_to_binding=r["applies_to_binding"], guidance=r["guidance"] or "",
            required_tools=_as_list(r["required_tools"]),
            required_data_binding_types=_as_list(r["required_data_binding_types"]),
            proof_refs=_as_list(r["proof_refs"]), project_scope=r["project_scope"],
        )
        for r in rows
    ]


def assign_data_binding(
    *, project_id: str, deck_id: str, card_id: str, binding_type: str, binding_ref: dict, conn=None,
) -> None:
    for name, value in (("project_id", project_id), ("deck_id", deck_id), ("card_id", card_id)):
        if not str(value or "").strip():
            raise ValueError(f"data_binding_{name}_required")
    err = validate_data_binding_ref(binding_type, binding_ref)
    if err:
        raise ValueError(err)
    own = conn is None
    conn = conn or _connect()
    try:
        ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO card_data_bindings (project_id, deck_id, card_id, binding_type, binding_ref)
                VALUES (%s,%s,%s,%s,%s::jsonb)
                ON CONFLICT (project_id, deck_id, card_id, binding_type)
                DO UPDATE SET binding_ref=EXCLUDED.binding_ref, created_at=now()
                """,
                (project_id, deck_id, card_id, binding_type, json.dumps(binding_ref)),
            )
    finally:
        if own:
            conn.close()


def remove_data_binding(*, project_id: str, deck_id: str, card_id: str, binding_type: str, conn=None) -> None:
    own = conn is None
    conn = conn or _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM card_data_bindings WHERE project_id=%s AND deck_id=%s AND card_id=%s AND binding_type=%s",
                (project_id, deck_id, card_id, binding_type),
            )
    finally:
        if own:
            conn.close()


def assigned_data_bindings(*, project_id: str, deck_id: str, card_id: str, conn=None) -> list[dict[str, Any]]:
    own = conn is None
    conn = conn or _connect()
    try:
        ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT binding_type, binding_ref FROM card_data_bindings
                WHERE project_id=%s AND deck_id=%s AND card_id=%s ORDER BY binding_type
                """,
                (project_id, deck_id, card_id),
            )
            rows = _rows(cur)
    finally:
        if own:
            conn.close()
    out: list[dict[str, Any]] = []
    for r in rows:
        ref = r["binding_ref"]
        if isinstance(ref, str):
            try:
                ref = json.loads(ref)
            except json.JSONDecodeError:
                ref = {}
        out.append({"bindingType": r["binding_type"], "bindingRef": ref if isinstance(ref, dict) else {}})
    return out


def record_run_trace(
    *, project_id: str, correlation_id: str, deck_id: str, card_id: str,
    profile_id: str | None, profile_version: int | None,
    skill_versions: list[str], data_binding_refs: list[dict], outcome: str, detail: str = "",
    conn=None,
) -> None:
    """Pin the exact profile/skill/data versions used by one card run."""
    for name, value in (("project_id", project_id), ("correlation_id", correlation_id), ("card_id", card_id)):
        if not str(value or "").strip():
            raise ValueError(f"run_trace_{name}_required")
    own = conn is None
    conn = conn or _connect()
    try:
        ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO card_run_traces (project_id, correlation_id, deck_id, card_id, profile_id,
                  profile_version, skill_versions, data_binding_refs, outcome, detail)
                VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s)
                ON CONFLICT (project_id, correlation_id) DO UPDATE SET
                  outcome=EXCLUDED.outcome, detail=EXCLUDED.detail,
                  skill_versions=EXCLUDED.skill_versions, data_binding_refs=EXCLUDED.data_binding_refs
                """,
                (
                    project_id, correlation_id, deck_id or "", card_id, profile_id, profile_version,
                    json.dumps(skill_versions), json.dumps(data_binding_refs),
                    str(outcome or "").strip(), str(detail or "")[:4000],
                ),
            )
    finally:
        if own:
            conn.close()


def get_run_traces(*, project_id: str, card_id: str | None = None, limit: int = 10, conn=None) -> list[dict[str, Any]]:
    own = conn is None
    conn = conn or _connect()
    try:
        ensure_tables(conn)
        with conn.cursor() as cur:
            if card_id:
                cur.execute(
                    """
                    SELECT project_id, correlation_id, deck_id, card_id, profile_id, profile_version,
                           skill_versions, data_binding_refs, outcome, detail, created_at
                    FROM card_run_traces WHERE project_id=%s AND card_id=%s
                    ORDER BY created_at DESC LIMIT %s
                    """,
                    (project_id, card_id, max(1, min(int(limit), 50))),
                )
            else:
                cur.execute(
                    """
                    SELECT project_id, correlation_id, deck_id, card_id, profile_id, profile_version,
                           skill_versions, data_binding_refs, outcome, detail, created_at
                    FROM card_run_traces WHERE project_id=%s
                    ORDER BY created_at DESC LIMIT %s
                    """,
                    (project_id, max(1, min(int(limit), 50))),
                )
            rows = _rows(cur)
    finally:
        if own:
            conn.close()
    for r in rows:
        r["created_at"] = str(r["created_at"])
        r["skill_versions"] = _as_list(r["skill_versions"])
        r["data_binding_refs"] = _as_list(r["data_binding_refs"])
    return rows


def begin_agent_assignment(
    *,
    project_id: str,
    correlation_id: str,
    deck_id: str,
    card_id: str,
    conversation_id: str | None,
    sender_card_id: str | None = None,
    agent_context_id: str | None = None,
    parent_correlation_id: str | None = None,
    retry_of_correlation_id: str | None = None,
    conn=None,
) -> str:
    """Create the durable outer assignment on the existing canonical run row."""
    for name, value in (
        ("project_id", project_id),
        ("correlation_id", correlation_id),
        ("card_id", card_id),
    ):
        if not str(value or "").strip():
            raise ValueError(f"agent_assignment_{name}_required")
    assignment_id = f"assignment:{correlation_id}"
    own = conn is None
    conn = conn or _connect(autocommit=False)
    try:
        ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT assignment_id, state
                FROM ag_catalog.agent_assignments
                WHERE project_id=%s AND correlation_id=%s
                FOR UPDATE
                """,
                (project_id, correlation_id),
            )
            existing_assignment = cur.fetchone()
            if existing_assignment and existing_assignment[1] in {
                "completed",
                "failed",
                "cancelled",
            }:
                return str(existing_assignment[0])
            cur.execute(
                """
                INSERT INTO ag_catalog.card_run_traces
                  (project_id, correlation_id, deck_id, card_id, outcome,
                   conversation_id, runtime, state, started_at, updated_at)
                VALUES (%s,%s,%s,%s,'pending',%s,'autogen','running',now(),now())
                ON CONFLICT (project_id, correlation_id) DO UPDATE SET
                  deck_id=EXCLUDED.deck_id,
                  card_id=EXCLUDED.card_id,
                  conversation_id=COALESCE(EXCLUDED.conversation_id, card_run_traces.conversation_id),
                  runtime='autogen',
                  state='running',
                  started_at=COALESCE(card_run_traces.started_at, now()),
                  updated_at=now()
                """,
                (
                    project_id,
                    correlation_id,
                    deck_id or "",
                    card_id,
                    str(conversation_id or "").strip() or None,
                ),
            )
            parent_assignment_id = None
            if parent_correlation_id:
                cur.execute(
                    """
                    SELECT assignment_id
                    FROM ag_catalog.agent_assignments
                    WHERE project_id=%s AND correlation_id=%s
                    """,
                    (project_id, parent_correlation_id),
                )
                parent = cur.fetchone()
                parent_assignment_id = parent[0] if parent else None
            retry_of_assignment_id = None
            if retry_of_correlation_id:
                cur.execute(
                    """
                    SELECT assignment_id
                    FROM ag_catalog.agent_assignments
                    WHERE project_id=%s AND correlation_id=%s
                    """,
                    (project_id, retry_of_correlation_id),
                )
                retry = cur.fetchone()
                if retry is None:
                    raise LookupError(
                        f"agent_assignment_retry_target_not_found: {retry_of_correlation_id}"
                    )
                retry_of_assignment_id = retry[0]
            cur.execute(
                """
                INSERT INTO ag_catalog.agent_assignments
                  (assignment_id, project_id, correlation_id, deck_id, conversation_id,
                   sender_card_id, receiver_card_id, parent_assignment_id,
                   retry_of_assignment_id, state, started_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'running',now())
                ON CONFLICT (project_id, correlation_id) DO UPDATE SET
                  sender_card_id=COALESCE(EXCLUDED.sender_card_id, agent_assignments.sender_card_id),
                  parent_assignment_id=COALESCE(
                    EXCLUDED.parent_assignment_id, agent_assignments.parent_assignment_id
                  ),
                  retry_of_assignment_id=COALESCE(
                    EXCLUDED.retry_of_assignment_id, agent_assignments.retry_of_assignment_id
                  ),
                  state='running',
                  started_at=COALESCE(agent_assignments.started_at, now()),
                  updated_at=now()
                """,
                (
                    assignment_id,
                    project_id,
                    correlation_id,
                    deck_id or "",
                    str(conversation_id or "").strip() or None,
                    str(sender_card_id or "").strip() or None,
                    card_id,
                    parent_assignment_id,
                    retry_of_assignment_id,
                ),
            )
            if agent_context_id:
                cur.execute(
                    """
                    INSERT INTO ag_catalog.agent_context_references
                      (assignment_id, reference_id, reference_type, required)
                    VALUES (%s,%s,'agent_context',true)
                    ON CONFLICT DO NOTHING
                    """,
                    (assignment_id, agent_context_id),
                )
        if own:
            conn.commit()
        return assignment_id
    except Exception:
        if own:
            conn.rollback()
        raise
    finally:
        if own:
            conn.close()


def finish_agent_assignment(
    *,
    project_id: str,
    correlation_id: str,
    status: str,
    output: str | None = None,
    error_code: str | None = None,
    error_detail: str | None = None,
    artifacts: list[dict[str, str]] | None = None,
    conn=None,
) -> str:
    """Persist one terminal result/failure and artifact references idempotently."""
    terminal = str(status or "").strip().lower()
    if terminal not in {"completed", "failed", "cancelled"}:
        raise ValueError(f"agent_assignment_terminal_status_invalid: {terminal}")
    assignment_id = f"assignment:{correlation_id}"
    result_id = f"agentresult:{correlation_id}"
    own = conn is None
    conn = conn or _connect(autocommit=False)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT assignment_id, state
                FROM ag_catalog.agent_assignments
                WHERE assignment_id=%s AND project_id=%s AND correlation_id=%s
                FOR UPDATE
                """,
                (assignment_id, project_id, correlation_id),
            )
            assignment = cur.fetchone()
            if assignment is None:
                raise LookupError(f"agent_assignment_not_found: {assignment_id}")
            normalized_error_code = str(error_code or "").strip() or None
            normalized_error_detail = str(error_detail or "")[:8000] or None
            if assignment[1] in {"completed", "failed", "cancelled"}:
                cur.execute(
                    """
                    SELECT result_id, status, output, error_code, error_detail
                    FROM ag_catalog.agent_results
                    WHERE assignment_id=%s
                    """,
                    (assignment_id,),
                )
                existing_result = cur.fetchone()
                if existing_result == (
                    result_id,
                    terminal,
                    output,
                    normalized_error_code,
                    normalized_error_detail,
                ):
                    return result_id
                raise RuntimeError(
                    f"agent_assignment_already_terminal: {assignment_id}:{assignment[1]}"
                )
            cur.execute(
                """
                INSERT INTO ag_catalog.agent_results
                  (result_id, assignment_id, project_id, correlation_id, status,
                   output, error_code, error_detail)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (assignment_id) DO NOTHING
                """,
                (
                    result_id,
                    assignment_id,
                    project_id,
                    correlation_id,
                    terminal,
                    output,
                    normalized_error_code,
                    normalized_error_detail,
                ),
            )
            timestamp_column = "cancelled_at" if terminal == "cancelled" else "completed_at"
            cur.execute(
                f"""
                UPDATE ag_catalog.agent_assignments
                SET state=%s, {timestamp_column}=now(), updated_at=now()
                WHERE assignment_id=%s
                """,
                (terminal, assignment_id),
            )
            cur.execute(
                f"""
                UPDATE ag_catalog.card_run_traces
                SET outcome=%s, state=%s, detail=%s, error_code=%s,
                    {timestamp_column}=now(), updated_at=now()
                WHERE project_id=%s AND correlation_id=%s
                """,
                (
                    terminal,
                    terminal,
                    str(error_detail or "")[:4000],
                    normalized_error_code,
                    project_id,
                    correlation_id,
                ),
            )
            for artifact in artifacts or []:
                artifact_id = str(artifact.get("artifactId") or "").strip()
                artifact_type = str(artifact.get("artifactType") or "").strip()
                locator = str(artifact.get("locator") or "").strip()
                if not artifact_id or not artifact_type or not locator:
                    raise ValueError("agent_artifact_reference_invalid")
                cur.execute(
                    """
                    INSERT INTO ag_catalog.agent_artifact_references
                      (assignment_id, artifact_id, artifact_type, locator)
                    VALUES (%s,%s,%s,%s)
                    ON CONFLICT DO NOTHING
                    """,
                    (assignment_id, artifact_id, artifact_type, locator),
                )
        if own:
            conn.commit()
        return result_id
    except Exception:
        if own:
            conn.rollback()
        raise
    finally:
        if own:
            conn.close()
