import asyncio
import logging
import math
from typing import Any
from fastapi import APIRouter, Request, Response, Query, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from limiter import limiter
from auth import require_admin, require_local_operator, _scoped_view_authenticated
from services.data_fetcher import get_latest_data
from services.mesh.mesh_protocol import normalize_payload
from services.mesh.mesh_signed_events import (
    MeshWriteExemption,
    SignedWriteKind,
    get_prepared_signed_write,
    mesh_write_exempt,
    requires_signed_write,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _signed_body(request: Request) -> dict[str, Any]:
    prepared = get_prepared_signed_write(request)
    if prepared is None:
        return {}
    return dict(prepared.body)


def _safe_int(val, default=0):
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _safe_float(val, default=0.0):
    try:
        parsed = float(val)
        if not math.isfinite(parsed):
            return default
        return parsed
    except (TypeError, ValueError):
        return default


def _redact_public_oracle_profile(payload: dict, authenticated: bool) -> dict:
    redacted = dict(payload)
    if authenticated:
        return redacted
    redacted["active_stakes"] = []
    redacted["prediction_history"] = []
    return redacted


def _redact_public_oracle_predictions(predictions: list, authenticated: bool) -> dict:
    if authenticated:
        return {"predictions": list(predictions)}
    return {"predictions": [], "count": len(predictions)}


def _redact_public_oracle_stakes(payload: dict, authenticated: bool) -> dict:
    redacted = dict(payload)
    if authenticated:
        return redacted
    redacted["truth_stakers"] = []
    redacted["false_stakers"] = []
    return redacted


@router.post("/api/mesh/oracle/predict")
@limiter.limit("10/minute")
@requires_signed_write(kind=SignedWriteKind.ORACLE_PREDICT)
async def oracle_predict(request: Request):
    """Place a prediction on a market outcome."""
    from services.mesh.mesh_oracle import oracle_ledger
    body = _signed_body(request)
    node_id = body.get("node_id", "")
    market_title = body.get("market_title", "")
    side = body.get("side", "")
    stake_amount = _safe_float(body.get("stake_amount", 0))
    public_key = body.get("public_key", "")
    public_key_algo = body.get("public_key_algo", "")
    signature = body.get("signature", "")
    sequence = _safe_int(body.get("sequence", 0) or 0)
    protocol_version = body.get("protocol_version", "")
    if not node_id or not market_title or not side:
        return {"ok": False, "detail": "Missing node_id, market_title, or side"}
    prediction_payload = {"market_title": market_title, "side": side, "stake_amount": stake_amount}
    try:
        from services.mesh.mesh_reputation import reputation_ledger
        reputation_ledger.register_node(node_id, public_key, public_key_algo)
    except Exception:
        pass
    data = get_latest_data()
    markets = data.get("prediction_markets", [])
    matched = None
    for m in markets:
        if m.get("title", "").lower() == market_title.lower():
            matched = m
            break
    if not matched:
        return {"ok": False, "detail": f"Market '{market_title}' not found in active markets."}

    canonical_market_title = matched["title"]
    prediction_payload["market_title"] = canonical_market_title

    probability = 50.0
    side_lower = side.lower()
    outcomes = matched.get("outcomes", [])
    if outcomes:
        matched_outcome = None
        for o in outcomes:
            if o.get("name", "").lower() == side_lower:
                matched_outcome = o
                break
        if matched_outcome is None:
            return {
                "ok": False,
                "detail": f"Outcome '{side}' is not valid for market '{matched['title']}'.",
            }
        probability = float(matched_outcome.get("pct", 50))
    else:
        if side_lower not in {"yes", "no"}:
            return {"ok": False, "detail": "Binary market side must be 'yes' or 'no'."}
        consensus = matched.get("consensus_pct")
        if consensus is None:
            consensus = matched.get("polymarket_pct") or matched.get("kalshi_pct") or 50
        probability = float(consensus)
        if side_lower == "no":
            probability = 100.0 - probability
    if stake_amount > 0:
        ok, detail = oracle_ledger.place_market_stake(node_id, canonical_market_title, side, stake_amount, probability)
        mode = "staked"
    else:
        ok, detail = oracle_ledger.place_prediction(node_id, canonical_market_title, side, probability)
        mode = "free"
    audit_recorded = False
    audit_warning = None
    if ok:
        try:
            from services.mesh.mesh_hashchain import infonet
            normalized_payload = normalize_payload("prediction", prediction_payload)
            infonet.append(event_type="prediction", node_id=node_id, payload=normalized_payload,
                signature=signature, sequence=sequence, public_key=public_key,
                public_key_algo=public_key_algo, protocol_version=protocol_version)
            audit_recorded = True
        except Exception as exc:
            logger.warning("Oracle prediction recorded without Infonet audit event: %s", exc)
            audit_warning = "Prediction was recorded, but its Infonet audit event was unavailable."
    return {
        "ok": ok,
        "detail": detail,
        "probability": probability,
        "mode": mode,
        "market_title": canonical_market_title,
        "audit_recorded": audit_recorded,
        "warning": audit_warning,
    }


@router.get("/api/mesh/oracle/markets")
@limiter.limit("30/minute")
async def oracle_markets(request: Request):
    """List active prediction markets."""
    from collections import defaultdict
    from services.mesh.mesh_oracle import oracle_ledger
    data = get_latest_data()
    markets = data.get("prediction_markets", [])
    all_consensus = oracle_ledger.get_all_market_consensus()
    by_category = defaultdict(list)
    for m in markets:
        by_category[m.get("category", "NEWS")].append(m)
    _fields = ("title", "consensus_pct", "polymarket_pct", "kalshi_pct", "volume", "volume_24h",
               "end_date", "description", "category", "sources", "slug", "kalshi_ticker", "outcomes",
               "kalshi_volume")
    categories = {}
    cat_totals = {}
    for cat in ["POLITICS", "CONFLICT", "NEWS", "FINANCE", "CRYPTO", "SPORTS"]:
        all_cat = sorted(by_category.get(cat, []), key=lambda x: x.get("volume", 0) or 0, reverse=True)
        cat_totals[cat] = len(all_cat)
        cat_list = []
        for m in all_cat[:10]:
            entry = {k: m.get(k) for k in _fields}
            entry["consensus"] = all_consensus.get(m.get("title", ""), {})
            cat_list.append(entry)
        categories[cat] = cat_list
    return {"categories": categories, "total_count": len(markets), "cat_totals": cat_totals}


@router.get("/api/mesh/oracle/search", dependencies=[Depends(require_local_operator)])
@limiter.limit("20/minute")
async def oracle_search(request: Request, q: str = "", limit: int = 20, offset: int = 0):
    """Search prediction markets across Polymarket + Kalshi APIs."""
    q = str(q or "").strip()
    if not q or len(q) < 2:
        return {"results": [], "query": q, "count": 0, "offset": 0, "has_more": False}
    if len(q) > 200:
        return JSONResponse(
            status_code=422,
            content={
                "error": "query_too_long",
                "detail": "Prediction-market search queries are limited to 200 characters.",
                "results": [],
                "query": q[:200],
                "count": 0,
                "offset": 0,
                "has_more": False,
            },
        )

    from services.prediction_markets_settings import prediction_markets_fetch_enabled

    if not prediction_markets_fetch_enabled():
        return JSONResponse(
            status_code=409,
            content={
                "error": "prediction_markets_disabled",
                "detail": "Prediction-market provider access is disabled. Enable MKT explicitly before searching Polymarket or Kalshi.",
                "results": [],
                "query": q,
                "count": 0,
                "offset": 0,
                "has_more": False,
            },
        )

    from services.fetchers.prediction_markets import search_polymarket_direct, search_kalshi_direct

    limit = max(1, min(_safe_int(limit, 20), 100))
    offset = max(0, min(_safe_int(offset, 0), 1000))
    provider_limit = min(offset + limit + 25, 250)

    async def _provider_search(name: str, search_fn):
        try:
            rows = await asyncio.wait_for(
                asyncio.to_thread(search_fn, q, provider_limit, 0),
                timeout=20,
            )
            return list(rows or []), None
        except Exception as exc:
            logger.warning("Oracle provider search failed for %s: %s", name, exc)
            return [], name

    (poly_results, poly_error), (kalshi_results, kalshi_error) = await asyncio.gather(
        _provider_search("polymarket", search_polymarket_direct),
        _provider_search("kalshi", search_kalshi_direct),
    )
    provider_errors = [name for name in (poly_error, kalshi_error) if name]
    # Also check cached/merged markets
    data = get_latest_data()
    markets = data.get("prediction_markets", [])
    q_lower = q.lower()
    cached_matches = [m for m in markets if q_lower in m.get("title", "").lower()]
    seen_titles = set()
    combined = []
    # Cached first (already merged Poly+Kalshi with consensus)
    for m in cached_matches:
        seen_titles.add(m["title"].lower())
        combined.append(m)
    # Then Polymarket direct hits
    for m in poly_results:
        if m["title"].lower() not in seen_titles:
            seen_titles.add(m["title"].lower())
            combined.append(m)
    # Then Kalshi direct hits
    for m in kalshi_results:
        if m["title"].lower() not in seen_titles:
            seen_titles.add(m["title"].lower())
            combined.append(m)
    combined.sort(key=lambda x: x.get("volume", 0) or 0, reverse=True)
    _fields = ("title", "consensus_pct", "polymarket_pct", "kalshi_pct", "volume", "volume_24h",
               "end_date", "description", "category", "sources", "slug", "kalshi_ticker", "outcomes",
               "kalshi_volume")
    page = combined[offset : offset + limit]
    results = [{k: m.get(k) for k in _fields} for m in page]
    return {
        "results": results,
        "query": q,
        "count": len(results),
        "offset": offset,
        "has_more": len(combined) > offset + limit,
        "total_seen": len(combined),
        "provider_errors": provider_errors,
    }


@router.get("/api/mesh/oracle/markets/more")
@limiter.limit("30/minute")
async def oracle_markets_more(request: Request, category: str = "NEWS", offset: int = 0, limit: int = 10):
    """Load more markets for a specific category (paginated)."""
    category = (category or "NEWS").upper()
    offset = max(0, _safe_int(offset, 0))
    limit = max(1, min(_safe_int(limit, 10), 100))
    data = get_latest_data()
    markets = data.get("prediction_markets", [])
    cat_markets = sorted([m for m in markets if category == "ALL" or m.get("category") == category],
        key=lambda x: x.get("volume", 0) or 0, reverse=True)
    page = cat_markets[offset : offset + limit]
    _fields = ("title", "consensus_pct", "polymarket_pct", "kalshi_pct", "volume", "volume_24h",
               "end_date", "description", "category", "sources", "slug", "kalshi_ticker", "outcomes",
               "kalshi_volume")
    results = [{k: m.get(k) for k in _fields} for m in page]
    return {"markets": results, "category": category, "offset": offset,
            "has_more": offset + limit < len(cat_markets), "total": len(cat_markets)}


@router.post(
    "/api/mesh/oracle/resolve",
    dependencies=[Depends(require_admin)],
)
@limiter.limit("5/minute")
@mesh_write_exempt(MeshWriteExemption.ADMIN_CONTROL)
async def oracle_resolve(request: Request):
    """Resolve a prediction market.

    Issue #240 (tg12): requires admin authentication. The
    ``mesh_write_exempt`` decorator below is **metadata only** — it tags
    the route as not requiring a mesh signed-write envelope, it does
    NOT itself enforce caller authorization. The ``Depends(require_admin)``
    on the route decorator is what actually gates access.
    """
    from services.mesh.mesh_oracle import oracle_ledger
    body = await request.json()
    market_title = body.get("market_title", "")
    outcome = body.get("outcome", "")
    if not market_title or not outcome:
        return {"ok": False, "detail": "Need market_title and outcome"}
    winners, losers = oracle_ledger.resolve_market(market_title, outcome)
    stake_result = oracle_ledger.resolve_market_stakes(market_title, outcome)
    return {"ok": True,
            "detail": f"Resolved: {winners} free winners, {losers} free losers, "
                      f"{stake_result.get('winners', 0)} stake winners, {stake_result.get('losers', 0)} stake losers",
            "free": {"winners": winners, "losers": losers}, "stakes": stake_result}


@router.get("/api/mesh/oracle/consensus")
@limiter.limit("30/minute")
async def oracle_consensus(request: Request, market_title: str = ""):
    """Get network consensus for a market."""
    from services.mesh.mesh_oracle import oracle_ledger
    if not market_title:
        return {"error": "market_title required"}
    return oracle_ledger.get_market_consensus(market_title)


@router.post("/api/mesh/oracle/stake")
@limiter.limit("10/minute")
@requires_signed_write(kind=SignedWriteKind.ORACLE_STAKE)
async def oracle_stake(request: Request):
    """Stake oracle rep on a post's truthfulness."""
    from services.mesh.mesh_oracle import oracle_ledger
    body = _signed_body(request)
    staker_id = body.get("staker_id", "")
    message_id = body.get("message_id", "")
    poster_id = body.get("poster_id", "")
    side = body.get("side", "").lower()
    amount = _safe_float(body.get("amount", 0))
    duration_days = _safe_int(body.get("duration_days", 1), 1)
    public_key = body.get("public_key", "")
    public_key_algo = body.get("public_key_algo", "")
    signature = body.get("signature", "")
    sequence = _safe_int(body.get("sequence", 0) or 0)
    protocol_version = body.get("protocol_version", "")
    if not staker_id or not message_id or not side:
        return {"ok": False, "detail": "Missing staker_id, message_id, or side"}
    stake_payload = {"message_id": message_id, "poster_id": poster_id, "side": side,
                     "amount": amount, "duration_days": duration_days}
    try:
        from services.mesh.mesh_reputation import reputation_ledger
        reputation_ledger.register_node(staker_id, public_key, public_key_algo)
    except Exception:
        pass
    ok, detail = oracle_ledger.place_stake(staker_id, message_id, poster_id, side, amount, duration_days)
    if ok:
        try:
            from services.mesh.mesh_hashchain import infonet
            normalized_payload = normalize_payload("stake", stake_payload)
            infonet.append(event_type="stake", node_id=staker_id, payload=normalized_payload,
                signature=signature, sequence=sequence, public_key=public_key,
                public_key_algo=public_key_algo, protocol_version=protocol_version)
        except Exception:
            pass
    return {"ok": ok, "detail": detail}


@router.get("/api/mesh/oracle/stakes/{message_id}")
@limiter.limit("30/minute")
async def oracle_stakes_for_message(request: Request, message_id: str):
    """Get all oracle stakes on a message."""
    from services.mesh.mesh_oracle import oracle_ledger
    return _redact_public_oracle_stakes(
        oracle_ledger.get_stakes_for_message(message_id),
        authenticated=_scoped_view_authenticated(request, "mesh.audit"),
    )


@router.get("/api/mesh/oracle/profile")
@limiter.limit("30/minute")
async def oracle_profile(request: Request, node_id: str = ""):
    """Get full oracle profile."""
    from services.mesh.mesh_oracle import oracle_ledger
    if not node_id:
        return {"ok": False, "detail": "Provide ?node_id=xxx"}
    profile = oracle_ledger.get_oracle_profile(node_id)
    return _redact_public_oracle_profile(
        profile, authenticated=_scoped_view_authenticated(request, "mesh.audit"))


@router.get("/api/mesh/oracle/predictions")
@limiter.limit("30/minute")
async def oracle_predictions(request: Request, node_id: str = ""):
    """Get a node's active (unresolved) predictions."""
    from services.mesh.mesh_oracle import oracle_ledger
    if not node_id:
        return {"ok": False, "detail": "Provide ?node_id=xxx"}
    active_predictions = oracle_ledger.get_active_predictions(node_id)
    return _redact_public_oracle_predictions(
        active_predictions, authenticated=_scoped_view_authenticated(request, "mesh.audit"))


@router.post(
    "/api/mesh/oracle/resolve-stakes",
    dependencies=[Depends(require_admin)],
)
@limiter.limit("5/minute")
@mesh_write_exempt(MeshWriteExemption.ADMIN_CONTROL)
async def oracle_resolve_stakes(request: Request):
    """Resolve all expired stake contests.

    Issue #241 (tg12): requires admin authentication. See the note on
    ``oracle_resolve`` above — ``mesh_write_exempt`` is metadata only.
    """
    from services.mesh.mesh_oracle import oracle_ledger
    resolutions = oracle_ledger.resolve_expired_stakes()
    return {"ok": True, "resolutions": resolutions, "count": len(resolutions)}
