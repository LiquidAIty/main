# @graph entity: Seed Atlas Source (read-only supplemental context)
# @graph role: source-preserving-seed-context-reader
# @graph depends_on: one explicitly-configured local atlas workbook (SEED_ATLAS_PATH, outside the repo)
# @graph feeds_to: Catalyst Research Case persistent_context
"""Read-only, source-preserving seed-atlas reader for SUPPLEMENTAL context only.

The Follow-the-Money / ownership / founder / brand atlas is an operator spreadsheet that lives
OUTSIDE the repository and is referenced by ONE explicit configuration value, ``SEED_ATLAS_PATH``
(or an explicit ``path`` arg). There is NO Downloads scanning, NO bulk import, NO copy into the
repository, and NO shadow seed database. When the variable is absent, or points at a missing file,
the source reports an honest unavailable status with the exact reason — it never fabricates rows.

Every surfaced row is marked ``unverified_seed`` and preserves full provenance:

    source_id · configured locator (non-sensitive) · workbook · worksheet · row index ·
    workbook_modified_at · workbook_fingerprint (SHA-256) · raw source values · source_as_of ·
    imported_at

Crossover resolution uses the issuer's own ticker / CIK / name only and never mass-invents issuer
mappings. The source remains supplemental context — it is never promoted to a verified fact.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Sequence

VERIFICATION_UNVERIFIED_SEED = "unverified_seed"

# seed lookup outcomes (mirror the issuer-case seed vocabulary)
SEED_FOUND = "seed_context_found"
SEED_NOT_FOUND = "seed_context_not_found"
SEED_UNAVAILABLE = "seed_context_unavailable"

# explicit, exact unavailable reason codes (requirement 4)
REASON_NOT_CONFIGURED = "seed_atlas_path_not_configured"
REASON_MISSING_FILE = "seed_atlas_path_missing_file"
REASON_OPENPYXL = "openpyxl_unavailable"
REASON_OPEN_FAILED = "workbook_open_failed"

SEED_ATLAS_PATH_ENV = "SEED_ATLAS_PATH"

# Sheet-name keyword → relationship-kind distinction. Order matters.
_RELATIONSHIP_KINDS = (
    ("institution", "reported_institutional_position"),
    ("manager", "reported_institutional_position"),
    ("founder", "founder_or_family_context"),
    ("family", "founder_or_family_context"),
    ("sponsor", "pe_or_sponsor_context"),
    ("private equity", "pe_or_sponsor_context"),
    (" pe ", "pe_or_sponsor_context"),
    ("owner", "owner_or_parent_relationship"),
    ("parent", "owner_or_parent_relationship"),
    ("brand", "brand_or_product_relationship"),
    ("product", "brand_or_product_relationship"),
    ("consumer", "brand_or_product_relationship"),
)

_AS_OF_HEADER_HINTS = ("as of", "as_of", "updated", "date", "asserted", "confidence", "verification", "source")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _s(value: Any) -> str:
    return "" if value is None else str(value)


def _relationship_kind(sheet_title: str) -> str:
    low = f" {sheet_title.lower()} "
    for needle, kind in _RELATIONSHIP_KINDS:
        if needle in low:
            return kind
    return "seed_atlas_context"


def _non_sensitive_locator(path: Path) -> str:
    """A reproducible locator that does NOT leak an absolute user-home path in normal output:
    home-relative (~/...) when under the user's home, else just the workbook file name."""
    try:
        rel = path.expanduser().resolve().relative_to(Path.home().resolve())
        return f"~/{rel.as_posix()}"
    except (ValueError, RuntimeError, OSError):
        return path.name


def _fingerprint(path: Path) -> str:
    """Deterministic whole-file SHA-256 content fingerprint of the workbook."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class SeedRow:
    """One raw, source-preserved seed row that crossed over with the resolved issuer."""

    source_id: str
    configured_locator: str         # non-sensitive (home-relative or file name) — never a raw home path
    workbook: str
    worksheet: str
    row_index: int
    workbook_modified_at: str
    workbook_fingerprint: str
    relationship_kind: str
    matched_on: str                 # e.g. "ticker:RDW@col4" — what tied this row to the issuer
    raw: dict[str, Any]             # header-resolved raw source values when a header was found
    raw_cells: list[str]            # every raw cell value, verbatim order (header-independent)
    source_as_of: str               # operator-provided as-of/updated/asserted value, if any
    imported_at: str                # when THIS read happened (never a source event time)
    verification_state: str = VERIFICATION_UNVERIFIED_SEED

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _ticker_tokens(cell: str) -> set[str]:
    raw = cell.replace(";", ",").replace("/", ",").replace("|", ",")
    parts = [t.strip().upper() for chunk in raw.split(",") for t in chunk.split()]
    return {t for t in parts if t}


class SeedAtlasSource:
    """Read-only handle over ONE explicitly-configured atlas workbook."""

    def __init__(self, path: Optional[Path], *, diagnostics: str = "", reason_code: str = "",
                 configured_locator: str = ""):
        self.path = path
        self.available = path is not None and not diagnostics
        self.diagnostics = diagnostics
        self.reason_code = reason_code
        self.workbook_name = path.name if path else ""
        self.configured_locator = configured_locator or (_non_sensitive_locator(path) if path else "")
        self.workbook_fingerprint = _fingerprint(path) if path else ""
        self.source_id = (f"seed_atlas::{self.workbook_name}::{self.workbook_fingerprint[:12]}"
                          if path else "")
        self._modified_at = (
            datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat() if path else "")

    def _unavailable(self) -> dict[str, Any]:
        return {"status": SEED_UNAVAILABLE, "items": [], "reason": self.diagnostics,
                "reason_code": self.reason_code, "workbook": self.workbook_name,
                "configured_locator": self.configured_locator}

    # -- crossover lookup ---------------------------------------------------------------
    def lookup(self, ticker: str = "", cik: str = "", names: Optional[Sequence[str]] = None,
               *, max_rows: int = 40) -> dict[str, Any]:
        """Return seed rows that cross over with THIS issuer's own ticker / CIK / name only.

        Honest: unconfigured/missing/unreadable source → SEED_UNAVAILABLE with an exact reason;
        configured + readable but no crossover → SEED_NOT_FOUND. Never fabricates rows.
        """
        if not self.available or self.path is None:
            return self._unavailable()
        try:
            import openpyxl  # type: ignore
        except Exception as exc:  # noqa: BLE001
            return {"status": SEED_UNAVAILABLE, "items": [], "reason": f"{REASON_OPENPYXL}:{exc}",
                    "reason_code": REASON_OPENPYXL, "workbook": self.workbook_name,
                    "configured_locator": self.configured_locator}

        ticker_u = _s(ticker).strip().upper()
        cik_digits = _s(cik).lstrip("0").strip()
        name_needles = [n.strip().lower() for n in (names or []) if _s(n).strip()]
        imported_at = _now_iso()
        items: list[SeedRow] = []
        try:
            wb = openpyxl.load_workbook(self.path, read_only=True, data_only=True)
        except Exception as exc:  # noqa: BLE001
            return {"status": SEED_UNAVAILABLE, "items": [],
                    "reason": f"{REASON_OPEN_FAILED}:{type(exc).__name__}", "reason_code": REASON_OPEN_FAILED,
                    "workbook": self.workbook_name, "configured_locator": self.configured_locator}
        try:
            for ws in wb.worksheets:
                header: list[str] = []
                as_of_cols: list[int] = []
                for r_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
                    cells = [_s(c) for c in row]
                    if not any(c.strip() for c in cells):
                        continue
                    if not header and sum(1 for c in cells if c.strip()) >= 3:
                        header = [c.strip() for c in cells]
                        as_of_cols = [i for i, h in enumerate(header)
                                      if any(hint in h.lower() for hint in _AS_OF_HEADER_HINTS)]
                        continue
                    matched = self._match(cells, ticker_u, cik_digits, name_needles)
                    if not matched:
                        continue
                    raw = ({header[i]: cells[i] for i in range(min(len(header), len(cells))) if header[i]}
                           if header else {f"col{i}": c for i, c in enumerate(cells) if c.strip()})
                    source_as_of = next((cells[i] for i in as_of_cols if i < len(cells) and cells[i].strip()), "")
                    items.append(SeedRow(
                        source_id=self.source_id, configured_locator=self.configured_locator,
                        workbook=self.workbook_name, worksheet=ws.title, row_index=r_idx,
                        workbook_modified_at=self._modified_at, workbook_fingerprint=self.workbook_fingerprint,
                        relationship_kind=_relationship_kind(ws.title), matched_on=matched,
                        raw=raw, raw_cells=[c for c in cells if c.strip()],
                        source_as_of=source_as_of, imported_at=imported_at))
                    if len(items) >= max_rows:
                        break
                if len(items) >= max_rows:
                    break
        finally:
            wb.close()
        common = {"workbook": self.workbook_name, "source_id": self.source_id,
                  "workbook_fingerprint": self.workbook_fingerprint, "workbook_modified_at": self._modified_at,
                  "configured_locator": self.configured_locator}
        if not items:
            return {"status": SEED_NOT_FOUND, "items": [], **common}
        return {"status": SEED_FOUND, "items": [i.to_dict() for i in items], **common}

    @staticmethod
    def _match(cells: list[str], ticker_u: str, cik_digits: str, name_needles: list[str]) -> str:
        for i, c in enumerate(cells):
            cv = c.strip()
            if not cv:
                continue
            if ticker_u and (cv.upper() == ticker_u or ticker_u in _ticker_tokens(cv)):
                return f"ticker:{ticker_u}@col{i}"
            if cik_digits and cv.lstrip("0").strip() == cik_digits and cv.strip("0").isdigit():
                return f"cik:{cik_digits}@col{i}"
            low = cv.lower()
            for nn in name_needles:
                if nn and nn in low:
                    return f"name:{nn}@col{i}"
        return ""


def _configured_path(path: Optional[str]) -> str:
    """The single explicit configuration source: explicit arg → SEED_ATLAS_PATH env. No scanning."""
    if path:
        return path
    return os.environ.get(SEED_ATLAS_PATH_ENV, "").strip()


def load_seed_atlas(path: Optional[str] = None) -> SeedAtlasSource:
    """Open the ONE explicitly-configured seed atlas read-only. No Downloads/candidate scanning.

    SEED_ATLAS_PATH absent → unavailable (not configured); present but missing file → unavailable
    (missing file). Both carry an exact reason and a non-sensitive locator.
    """
    configured = _configured_path(path)
    if not configured:
        return SeedAtlasSource(
            None, reason_code=REASON_NOT_CONFIGURED,
            diagnostics=f"{SEED_ATLAS_PATH_ENV} is not configured; set it to one local atlas workbook path")
    p = Path(configured).expanduser()
    locator = _non_sensitive_locator(p)
    if not p.is_file():
        return SeedAtlasSource(
            None, reason_code=REASON_MISSING_FILE, configured_locator=locator,
            diagnostics=f"{SEED_ATLAS_PATH_ENV} points to a missing file: {locator}")
    return SeedAtlasSource(p)
