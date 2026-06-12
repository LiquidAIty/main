# @graph entity: KnowGraph Skill Ingest
# @graph role: deterministic-skill-import
# @graph relates_to: KnowGraph API, KnowGraph Ingest
# @graph depends_on: Neo4j
# @graph feeds_to: KnowGraph
"""Deterministic importer: graphable Markdown skills (skills/*.md) -> KnowGraph / Neo4j.

Two-lane design:

* Canonical lane (this module): ``@``-prefixed graphable lines are parsed
  deterministically into stable Skill / SkillAttempt / FailedAttempt /
  Guardrail / Decision / QueryPattern / Spec / ProofClaim / Validation /
  CodeGraphReference nodes and relationships. No LLM is involved and the
  parser never invents IDs, labels, or defaults.
* Semantic retrieval lane (integration point only): prose sections are
  captured as SkillSection nodes linked to the canonical Skill, and
  ``build_semantic_documents`` returns payloads shaped for
  ``services/knowgraph/ingest.ingest_text_document`` (the existing Neo4j
  GraphRAG pipeline). This CLI does not invoke that pipeline: it requires
  LLM/embedding configuration and must never become the authority for
  canonical skill metadata.

CLI:

    python services/knowgraph/skill_ingest.py ingest --repo-root .
    python services/knowgraph/skill_ingest.py list --skill-id codebasedmemory
"""

from __future__ import annotations

import argparse
import hashlib
import re
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

IMPORT_KIND = "skill_markdown"
SOURCE = "repo"

# Graphable line keys that open a new record context.
RECORD_OPENERS = {"skill", "attempt", "failed_attempt", "decision", "attempt_result"}

# Graphable attribute keys understood by this narrow grammar.
ATTRIBUTE_KEYS = {
    "type",
    "status",
    "requires",
    "applies_to",
    "related_to",
    "source_spec",
    "source_prompt",
    "requires_fresh_cbm",
    "because",
    "rejected",
    "use_instead",
    "proved_by",
    "proved",
    "guardrail",
    "query",
    "failed_because",
    "retry_with",
    "validated_by",
    "touches_code",
    "cbm_after",
}

# Known graphable lines outside this importer's scope. They are reported as
# explicit warnings instead of failing, because other tooling owns them.
WARN_IGNORED_KEYS = {
    "node",
    "edge",
    "edge_pattern",
    "stores",
    "imports_to",
    "source_task",
    "example",
    "graph",
}

_AT_LINE_RE = re.compile(r"^@([a-z_]+)\b\s*(.*)$")
_KV_RE = re.compile(r'(\w+)=(?:"([^"]*)"|(\S+))')
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


class SkillParseError(Exception):
    """Raised when a skill Markdown file contains invalid graphable records."""


class SkillIngestError(Exception):
    """Raised for ingestion-level failures that are not Neo4j driver errors."""


def _sha8(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:8]


def _kv(rest: str) -> dict[str, str]:
    return {
        m.group(1): m.group(2) if m.group(2) is not None else m.group(3)
        for m in _KV_RE.finditer(rest)
    }


def _strip_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return value[1:-1]
    return value


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.strip().lower()).strip("-")
    return slug or "section"


def _is_placeholder(value: str) -> bool:
    """Detect unfilled template values such as ``succeeded|failed|blocked``
    or ``nodes=<count>`` so closeout templates do not become graph data."""
    return "|" in value or "<" in value or ">" in value


@dataclass
class _Record:
    kind: str
    rid: str
    line: int
    props: dict[str, Any] = field(default_factory=dict)
    specs: list[str] = field(default_factory=list)
    related: list[str] = field(default_factory=list)
    requires: list[str] = field(default_factory=list)
    rejected: list[str] = field(default_factory=list)
    proofs: list[str] = field(default_factory=list)
    validations: list[str] = field(default_factory=list)
    code_refs: list[str] = field(default_factory=list)
    guardrail_ids: list[str] = field(default_factory=list)
    placeholder: bool = False


@dataclass
class _Section:
    section_id: str
    heading: str
    order: int
    text: str


@dataclass
class ParsedSkill:
    source_path: str
    skill: _Record
    attempts: dict[str, _Record] = field(default_factory=dict)
    failed_attempts: dict[str, _Record] = field(default_factory=dict)
    decisions: dict[str, _Record] = field(default_factory=dict)
    guardrails: dict[str, dict[str, Any]] = field(default_factory=dict)
    queries: dict[str, dict[str, Any]] = field(default_factory=dict)
    sections: list[_Section] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def skill_id(self) -> str:
        return self.skill.rid


def _parse_frontmatter(lines: list[str], errors: list[str]) -> tuple[dict[str, str], int]:
    if not lines or lines[0].strip() != "---":
        return {}, 0
    frontmatter: dict[str, str] = {}
    for index in range(1, len(lines)):
        stripped = lines[index].strip()
        if stripped == "---":
            return frontmatter, index + 1
        key, sep, value = stripped.partition(":")
        if sep and key.strip() and value.strip():
            frontmatter[key.strip()] = value.strip()
    errors.append("frontmatter: opening '---' without closing '---'")
    return frontmatter, len(lines)


def parse_skill_markdown(text: str, source_path: str) -> ParsedSkill:
    """Parse one graphable Markdown skill file deterministically.

    Raises SkillParseError listing every problem found; never invents IDs or
    silently drops malformed important graphable lines.
    """
    errors: list[str] = []
    warnings: list[str] = []
    lines = text.splitlines()
    frontmatter, body_start = _parse_frontmatter(lines, errors)

    skill: _Record | None = None
    attempts: dict[str, _Record] = {}
    failed_attempts: dict[str, _Record] = {}
    decisions: dict[str, _Record] = {}
    guardrails: dict[str, dict[str, Any]] = {}
    queries: dict[str, dict[str, Any]] = {}
    sections: list[_Section] = []
    pending_results: list[_Record] = []
    seen_record_ids: set[str] = set()

    current: _Record | None = None
    current_heading = ""
    section_buf: list[str] = []
    in_fence = False

    def flush_section() -> None:
        nonlocal section_buf
        body = "\n".join(section_buf).strip()
        if current_heading and body:
            sections.append(
                _Section(section_id="", heading=current_heading, order=len(sections), text=body)
            )
        section_buf = []

    def open_record(kind: str, rest: str, lineno: int) -> _Record | None:
        kv = _kv(rest)
        rid = kv.get("id", "").strip()
        if not rid:
            errors.append(f"line {lineno}: @{kind} requires id=<stable-id>")
            return None
        if kind != "attempt_result" and rid in seen_record_ids:
            errors.append(f"line {lineno}: duplicate record id '{rid}'")
            return None
        seen_record_ids.add(rid)
        return _Record(kind=kind, rid=rid, line=lineno)

    def close_current() -> None:
        nonlocal current
        if current is not None and current.kind == "attempt_result":
            pending_results.append(current)
        current = None

    for offset, raw in enumerate(lines[body_start:]):
        lineno = body_start + offset + 1
        stripped = raw.strip()

        if stripped.startswith("```"):
            in_fence = not in_fence
            section_buf.append(raw)
            continue
        if in_fence:
            section_buf.append(raw)
            continue

        heading_match = _HEADING_RE.match(stripped)
        if heading_match:
            flush_section()
            current_heading = heading_match.group(2).strip()
            close_current()
            current = skill
            continue

        at_match = _AT_LINE_RE.match(stripped)
        if not at_match:
            section_buf.append(raw)
            continue

        key, rest = at_match.group(1), at_match.group(2).strip()

        if key in WARN_IGNORED_KEYS:
            warnings.append(f"line {lineno}: @{key} is outside the skill-import grammar; ignored")
            continue

        if key == "skill":
            if skill is not None:
                errors.append(f"line {lineno}: duplicate @skill record")
                continue
            record = open_record("skill", rest, lineno)
            if record is not None:
                skill = record
                close_current()
                current = skill
            continue

        if key in RECORD_OPENERS:
            if skill is None:
                errors.append(f"line {lineno}: @{key} before @skill")
                continue
            record = open_record(key, rest, lineno)
            if record is None:
                continue
            close_current()
            if key == "attempt":
                attempts[record.rid] = record
            elif key == "failed_attempt":
                failed_attempts[record.rid] = record
            elif key == "decision":
                decisions[record.rid] = record
            elif key == "attempt_result":
                seen_record_ids.discard(record.rid)
                if record.rid not in attempts:
                    errors.append(
                        f"line {lineno}: @attempt_result id='{record.rid}' has no matching @attempt"
                    )
                    continue
            current = record
            continue

        if key not in ATTRIBUTE_KEYS:
            errors.append(f"line {lineno}: unsupported graphable line @{key}")
            continue

        # Guardrails and queries always belong to the skill; they may also be
        # linked from the current decision / failed attempt context.
        if key == "guardrail":
            if skill is None:
                errors.append(f"line {lineno}: @guardrail before @skill")
                continue
            kv = _kv(rest)
            if kv.get("id"):
                gid = kv["id"].strip()
                gtext = re.sub(r'\bid=(?:"[^"]*"|\S+)', "", rest).strip()
            elif current is not None and current.kind in ("decision", "failed_attempt") and rest:
                gid = f"{current.rid}.guardrail.{_sha8(rest)}"
                gtext = rest
            else:
                errors.append(
                    f"line {lineno}: @guardrail needs id=<id>, or free text inside a "
                    "@decision/@failed_attempt block"
                )
                continue
            guardrails.setdefault(gid, {"text": gtext})
            if current is not None and current.kind in ("decision", "failed_attempt"):
                current.guardrail_ids.append(gid)
            continue

        if key == "query":
            if skill is None:
                errors.append(f"line {lineno}: @query before @skill")
                continue
            kv = _kv(rest)
            if kv.get("id"):
                qid = kv["id"].strip()
                remainder = re.sub(r'\bid=(?:"[^"]*"|\S+)', "", rest, count=1).strip()
            else:
                qid, _, remainder = rest.partition(" ")
                qid = qid.strip()
            qtext = _strip_quotes(remainder)
            if not qid or not qtext:
                errors.append(f"line {lineno}: @query requires an id/name and a quoted query text")
                continue
            queries.setdefault(qid, {"text": qtext})
            continue

        if current is None:
            errors.append(f"line {lineno}: @{key} outside any @skill/@attempt/@decision record")
            continue

        if key == "status":
            value = rest
            if current.kind == "attempt_result" and _is_placeholder(value):
                current.placeholder = True
                warnings.append(
                    f"line {lineno}: @attempt_result status '{value}' is an unfilled template "
                    "placeholder; attempt result skipped"
                )
            else:
                current.props["status"] = value
        elif key == "type":
            current.props["type"] = rest
        elif key == "requires":
            current.requires.append(rest)
        elif key in ("applies_to", "source_spec"):
            current.specs.append(_strip_quotes(rest))
        elif key == "related_to":
            current.related.append(_strip_quotes(rest))
        elif key == "source_prompt":
            current.props["source_prompt"] = _strip_quotes(rest)
        elif key == "requires_fresh_cbm":
            current.props["requires_fresh_cbm"] = rest.strip().lower() in ("true", "1", "yes")
        elif key == "because":
            current.props["because"] = rest
        elif key == "use_instead":
            current.props["use_instead"] = rest
        elif key == "rejected":
            current.rejected.append(rest)
        elif key == "proved_by":
            if current.kind in ("attempt", "attempt_result", "failed_attempt"):
                current.proofs.append(_strip_quotes(rest))
            else:
                current.props["proved_by"] = rest
        elif key == "proved":
            current.proofs.append(_strip_quotes(rest))
        elif key == "validated_by":
            current.validations.append(_strip_quotes(rest))
        elif key == "touches_code":
            current.code_refs.append(_strip_quotes(rest))
        elif key == "failed_because":
            current.props["failed_because"] = rest
        elif key == "retry_with":
            current.props["retry_with"] = rest
        elif key == "cbm_after":
            kv = _kv(rest)
            raw_nodes = kv.get("nodes", "")
            raw_edges = kv.get("edges", "")
            if _is_placeholder(raw_nodes) or _is_placeholder(raw_edges):
                current.placeholder = True
                warnings.append(
                    f"line {lineno}: @cbm_after has unfilled template placeholders; "
                    "attempt result skipped"
                )
            else:
                try:
                    current.props["cbm_after_nodes"] = int(raw_nodes)
                    current.props["cbm_after_edges"] = int(raw_edges)
                except ValueError:
                    errors.append(
                        f"line {lineno}: @cbm_after requires integer nodes=/edges= values"
                    )

    flush_section()
    close_current()

    if skill is None:
        errors.append("missing required @skill id=<id> line")
    if errors:
        raise SkillParseError(f"{source_path}: " + "; ".join(errors))
    assert skill is not None

    # Merge non-placeholder attempt results into their attempts.
    for result in pending_results:
        if result.placeholder:
            continue
        attempt = attempts[result.rid]
        if "status" in result.props:
            attempt.props["result_status"] = result.props["status"]
        for prop in ("cbm_after_nodes", "cbm_after_edges", "failed_because", "retry_with"):
            if prop in result.props:
                attempt.props[prop] = result.props[prop]
        attempt.proofs.extend(result.proofs)
        attempt.validations.extend(result.validations)
        attempt.code_refs.extend(result.code_refs)
        attempt.specs.extend(result.specs)

    for prop_key, value in frontmatter.items():
        skill.props.setdefault(f"fm_{prop_key}", value)

    parsed = ParsedSkill(
        source_path=source_path,
        skill=skill,
        attempts=attempts,
        failed_attempts=failed_attempts,
        decisions=decisions,
        guardrails=guardrails,
        queries=queries,
        warnings=warnings,
    )

    seen_slugs: dict[str, int] = {}
    for section in sections:
        slug = _slug(section.heading)
        count = seen_slugs.get(slug, 0)
        seen_slugs[slug] = count + 1
        if count:
            slug = f"{slug}-{count + 1}"
        section.section_id = f"{parsed.skill_id}.section.{slug}"
    parsed.sections = sections
    return parsed


# ---------------------------------------------------------------------------
# Upsert plan
# ---------------------------------------------------------------------------

Statement = tuple[str, dict[str, Any]]


def _base_props(parsed: ParsedSkill) -> dict[str, Any]:
    return {
        "source": SOURCE,
        "source_path": parsed.source_path,
        "skill_id": parsed.skill_id,
        "import_kind": IMPORT_KIND,
    }


def _node_stmt(label: str, node_id: str, props: dict[str, Any], parsed: ParsedSkill) -> Statement:
    merged = _base_props(parsed)
    merged.update({k: v for k, v in props.items() if v not in (None, [], "")})
    merged["id"] = node_id
    return (f"MERGE (n:{label} {{id: $id}}) SET n += $props", {"id": node_id, "props": merged})


def _edge_stmt(from_label: str, from_id: str, rel: str, to_label: str, to_id: str) -> Statement:
    return (
        f"MATCH (a:{from_label} {{id: $from_id}}) "
        f"MATCH (b:{to_label} {{id: $to_id}}) "
        f"MERGE (a)-[:{rel}]->(b)",
        {"from_id": from_id, "to_id": to_id},
    )


def build_upsert_statements(parsed: ParsedSkill) -> tuple[list[Statement], list[Statement]]:
    """Build deterministic (node_statements, edge_statements) for one skill."""
    nodes: list[Statement] = []
    edges: list[Statement] = []
    skill_id = parsed.skill_id

    skill_props = dict(parsed.skill.props)
    skill_props["name"] = skill_id
    if parsed.skill.requires:
        skill_props["requires"] = parsed.skill.requires
    if parsed.skill.related:
        skill_props["related_to"] = parsed.skill.related
    nodes.append(_node_stmt("Skill", skill_id, skill_props, parsed))

    spec_ids = sorted({*parsed.skill.specs, *(s for a in parsed.attempts.values() for s in a.specs)})
    for spec_id in spec_ids:
        nodes.append(_node_stmt("Spec", spec_id, {"path": spec_id}, parsed))
    for spec_id in sorted(set(parsed.skill.specs)):
        edges.append(_edge_stmt("Skill", skill_id, "APPLIES_TO", "Spec", spec_id))

    for related_id in sorted(set(parsed.skill.related)):
        edges.append(_edge_stmt("Skill", skill_id, "RELATED_TO", "Skill", related_id))

    def attach_evidence(owner_label: str, owner: _Record) -> None:
        for proof in owner.proofs:
            pid = f"{owner.rid}.proof.{_sha8(proof)}"
            nodes.append(_node_stmt("ProofClaim", pid, {"text": proof}, parsed))
            edges.append(_edge_stmt(owner_label, owner.rid, "PROVED", "ProofClaim", pid))
        for validation in owner.validations:
            vid = f"{owner.rid}.validation.{_sha8(validation)}"
            nodes.append(_node_stmt("Validation", vid, {"text": validation}, parsed))
            edges.append(_edge_stmt(owner_label, owner.rid, "VALIDATED_BY", "Validation", vid))
        for code_ref in owner.code_refs:
            nodes.append(_node_stmt("CodeGraphReference", code_ref, {"ref": code_ref}, parsed))
            edges.append(
                _edge_stmt(owner_label, owner.rid, "TOUCHED_CODE", "CodeGraphReference", code_ref)
            )

    for attempt in sorted(parsed.attempts.values(), key=lambda r: r.rid):
        nodes.append(_node_stmt("SkillAttempt", attempt.rid, attempt.props, parsed))
        edges.append(_edge_stmt("Skill", skill_id, "HAS_ATTEMPT", "SkillAttempt", attempt.rid))
        for spec_id in sorted(set(attempt.specs)):
            edges.append(_edge_stmt("SkillAttempt", attempt.rid, "USED_SPEC", "Spec", spec_id))
        attach_evidence("SkillAttempt", attempt)

    for failed in sorted(parsed.failed_attempts.values(), key=lambda r: r.rid):
        nodes.append(_node_stmt("FailedAttempt", failed.rid, failed.props, parsed))
        edges.append(_edge_stmt("Skill", skill_id, "HAS_FAILED_ATTEMPT", "FailedAttempt", failed.rid))
        for gid in failed.guardrail_ids:
            edges.append(_edge_stmt("FailedAttempt", failed.rid, "CREATED_GUARDRAIL", "Guardrail", gid))
        attach_evidence("FailedAttempt", failed)

    for decision in sorted(parsed.decisions.values(), key=lambda r: r.rid):
        props = dict(decision.props)
        if decision.rejected:
            props["rejected"] = decision.rejected
        nodes.append(_node_stmt("Decision", decision.rid, props, parsed))
        edges.append(_edge_stmt("Skill", skill_id, "HAS_DECISION", "Decision", decision.rid))
        for gid in decision.guardrail_ids:
            edges.append(_edge_stmt("Decision", decision.rid, "CREATED_GUARDRAIL", "Guardrail", gid))

    for gid in sorted(parsed.guardrails):
        nodes.append(_node_stmt("Guardrail", gid, parsed.guardrails[gid], parsed))
        edges.append(_edge_stmt("Skill", skill_id, "HAS_GUARDRAIL", "Guardrail", gid))

    for qid in sorted(parsed.queries):
        nodes.append(_node_stmt("QueryPattern", qid, parsed.queries[qid], parsed))
        edges.append(_edge_stmt("Skill", skill_id, "HAS_QUERY", "QueryPattern", qid))

    for section in parsed.sections:
        nodes.append(
            _node_stmt(
                "SkillSection",
                section.section_id,
                {"heading": section.heading, "order": section.order, "text": section.text},
                parsed,
            )
        )
        edges.append(_edge_stmt("Skill", skill_id, "HAS_SECTION", "SkillSection", section.section_id))

    return nodes, edges


def build_semantic_documents(parsed: ParsedSkill, project_id: str = "repo-skills") -> list[dict[str, Any]]:
    """Integration point for the existing LLM GraphRAG lane.

    Returns payloads shaped for ``services/knowgraph/ingest.ingest_text_document``.
    Deliberately NOT invoked by this CLI: the GraphRAG lane needs LLM/embedding
    configuration and is never the authority for canonical skill metadata.
    """
    documents: list[dict[str, Any]] = []
    for section in parsed.sections:
        documents.append(
            {
                "project_id": project_id,
                "document_id": f"skill:{section.section_id}",
                "text": section.text,
                "title": f"{parsed.skill_id} - {section.heading}",
                "source_url": f"file://{parsed.source_path}",
                "metadata": {
                    "skill_id": parsed.skill_id,
                    "section": section.heading,
                    "import_kind": "skill_markdown_prose",
                },
                "source_type": "skill_prose",
            }
        )
    return documents


# ---------------------------------------------------------------------------
# Neo4j execution
# ---------------------------------------------------------------------------


def _read_env_file(path: Path) -> dict[str, str] | None:
    if not path.is_file():
        return None
    env: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        key, sep, value = line.partition("=")
        if not sep:
            continue
        env[key.strip()] = _strip_quotes(value.strip())
    return env


def load_neo4j_config(repo_root: Path) -> dict[str, Any]:
    """Resolve Neo4j connection settings: process env first, then known repo
    .env files (read-only fallback)."""
    candidates: list[tuple[str, dict[str, str] | None]] = [
        ("process environment", dict(os.environ)),
        ("services/knowgraph/.env", _read_env_file(repo_root / "services" / "knowgraph" / ".env")),
        ("apps/backend/.env", _read_env_file(repo_root / "apps" / "backend" / ".env")),
    ]
    for source, env in candidates:
        if not env:
            continue
        uri = (env.get("NEO4J_URI") or "").strip()
        user = (env.get("NEO4J_USER") or "").strip()
        password = (env.get("NEO4J_PASSWORD") or "").strip()
        if uri and user and password:
            return {
                "uri": uri,
                "user": user,
                "password": password,
                "database": (env.get("NEO4J_DATABASE") or "").strip() or None,
                "config_source": source,
            }
    raise SkillIngestError(
        "Neo4j configuration not found: set NEO4J_URI/NEO4J_USER/NEO4J_PASSWORD in the "
        "environment, services/knowgraph/.env, or apps/backend/.env"
    )


def _connect(config: dict[str, Any]):
    """Open a Neo4j driver and fail loudly if unavailable or unauthorized."""
    from neo4j import GraphDatabase  # lazy: unit tests must not require the driver

    driver = GraphDatabase.driver(config["uri"], auth=(config["user"], config["password"]))
    driver.verify_connectivity()
    return driver


def _execute_statements(driver, database: str | None, statements: list[Statement]) -> dict[str, int]:
    """Run statements sequentially and aggregate honest write counters."""
    totals = {"nodes_created": 0, "relationships_created": 0, "properties_set": 0}
    for cypher, params in statements:
        result = driver.execute_query(cypher, parameters_=params, database_=database)
        counters = result.summary.counters
        totals["nodes_created"] += getattr(counters, "nodes_created", 0)
        totals["relationships_created"] += getattr(counters, "relationships_created", 0)
        totals["properties_set"] += getattr(counters, "properties_set", 0)
    return totals


def discover_skill_files(repo_root: Path, skills_dir: str = "skills") -> list[Path]:
    directory = repo_root / skills_dir
    if not directory.is_dir():
        raise SkillIngestError(f"skills directory not found: {directory}")
    return sorted(directory.glob("*.md"))


def parse_skill_files(files: list[Path], repo_root: Path) -> list[ParsedSkill]:
    parsed_list: list[ParsedSkill] = []
    errors: list[str] = []
    for path in files:
        source_path = path.relative_to(repo_root).as_posix()
        try:
            parsed_list.append(
                parse_skill_markdown(path.read_text(encoding="utf-8"), source_path)
            )
        except SkillParseError as exc:
            errors.append(str(exc))
    if errors:
        raise SkillParseError("; ".join(errors))
    return parsed_list


# ---------------------------------------------------------------------------
# CLI commands
# ---------------------------------------------------------------------------


def ingest_command(args: argparse.Namespace) -> int:
    repo_root = Path(args.repo_root).resolve()
    files = discover_skill_files(repo_root, args.skills_dir)
    if not files:
        raise SkillIngestError(f"no skill markdown files found under {repo_root / args.skills_dir}")

    parsed_list = parse_skill_files(files, repo_root)

    all_nodes: list[Statement] = []
    all_edges: list[Statement] = []
    for parsed in parsed_list:
        nodes, edges = build_upsert_statements(parsed)
        all_nodes.extend(nodes)
        all_edges.extend(edges)
        for warning in parsed.warnings:
            print(f"WARN {parsed.source_path}: {warning}")
        print(
            f"PLAN skill={parsed.skill_id} file={parsed.source_path} "
            f"nodes={len(nodes)} edges={len(edges)} warnings={len(parsed.warnings)}"
        )

    statements = all_nodes + all_edges
    if args.dry_run:
        print(f"DRY_RUN total_statements={len(statements)} (nothing written to Neo4j)")
        return 0

    config = load_neo4j_config(repo_root)
    print(f"NEO4J config_source={config['config_source']} uri={config['uri']}")
    driver = _connect(config)
    try:
        totals = _execute_statements(driver, config["database"], statements)
    finally:
        driver.close()
    print(
        f"RESULT skills={len(parsed_list)} nodes_created={totals['nodes_created']} "
        f"relationships_created={totals['relationships_created']} "
        f"properties_set={totals['properties_set']}"
    )
    return 0


def list_command(args: argparse.Namespace) -> int:
    repo_root = Path(args.repo_root).resolve()
    config = load_neo4j_config(repo_root)
    driver = _connect(config)
    try:
        if args.skill_id:
            result = driver.execute_query(
                """
                MATCH (s:Skill {id: $skill_id})
                OPTIONAL MATCH (s)-[r]->(x)
                RETURN s.id AS skill_id, s.status AS status, s.type AS type,
                       s.source_path AS source_path,
                       type(r) AS rel, head(labels(x)) AS label, x.id AS target_id
                ORDER BY rel, label, target_id
                """,
                parameters_={"skill_id": args.skill_id},
                database_=config["database"],
            )
            records = result.records
            if not records:
                print(f"NOT_FOUND skill_id={args.skill_id}")
                return 1
            first = records[0]
            print(
                f"SKILL {first['skill_id']} status={first['status']} type={first['type']} "
                f"source_path={first['source_path']}"
            )
            for record in records:
                if record["rel"]:
                    print(f"  {record['rel']} {record['label']} {record['target_id']}")
            return 0

        where = ["s.import_kind = $import_kind"]
        params: dict[str, Any] = {"import_kind": IMPORT_KIND}
        if args.spec:
            where.append("EXISTS { MATCH (s)-[:APPLIES_TO]->(sp:Spec) WHERE sp.id CONTAINS $spec }")
            params["spec"] = args.spec
        if args.text:
            where.append(
                "(s.id CONTAINS $text OR coalesce(s.status,'') CONTAINS $text "
                "OR coalesce(s.type,'') CONTAINS $text)"
            )
            params["text"] = args.text
        result = driver.execute_query(
            "MATCH (s:Skill) WHERE "
            + " AND ".join(where)
            + " RETURN s.id AS id, s.status AS status, s.type AS type, "
            "s.source_path AS source_path ORDER BY s.id",
            parameters_=params,
            database_=config["database"],
        )
        records = result.records
        if not records:
            print("NO_SKILLS_FOUND")
            return 1
        for record in records:
            print(
                f"SKILL {record['id']} status={record['status']} type={record['type']} "
                f"source_path={record['source_path']}"
            )
        return 0
    finally:
        driver.close()


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Deterministic skills/*.md -> KnowGraph/Neo4j importer"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="parse skills/*.md and upsert into Neo4j")
    ingest.add_argument("--repo-root", required=True)
    ingest.add_argument("--skills-dir", default="skills")
    ingest.add_argument("--dry-run", action="store_true", help="parse and plan only; write nothing")
    ingest.set_defaults(func=ingest_command)

    lister = sub.add_parser("list", help="list indexed skills from Neo4j")
    lister.add_argument("--repo-root", default=".")
    lister.add_argument("--skill-id")
    lister.add_argument("--spec", help="filter by spec path substring")
    lister.add_argument("--text", help="filter by id/status/type substring")
    lister.set_defaults(func=list_command)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        return args.func(args)
    except SkillParseError as exc:
        print(f"SKILL_PARSE_FAILURE: {exc}", file=sys.stderr)
        return 1
    except SkillIngestError as exc:
        print(f"SKILL_INGEST_FAILURE: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # Neo4j unavailable/unauthorized and anything unexpected
        print(f"NEO4J_FAILURE: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
