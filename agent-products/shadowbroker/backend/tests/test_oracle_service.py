from services.oracle_service import compute_global_threat_level, unavailable_threat_level


def test_missing_news_is_unavailable_not_green():
    result = compute_global_threat_level([])

    assert result["available"] is False
    assert result["status"] == "no_data"
    assert result["score"] is None
    assert result["level"] == "UNAVAILABLE"


def test_computed_threat_is_explicitly_available():
    result = compute_global_threat_level(
        [{"sentiment": -0.4, "risk_score": 8, "oracle_score": 6}],
        markets=[],
    )

    assert result["available"] is True
    assert result["status"] == "available"
    assert isinstance(result["score"], int)
    assert result["level"] != "UNAVAILABLE"


def test_error_state_never_looks_like_a_safe_score():
    result = unavailable_threat_level("error", "calculation failed")

    assert result == {
        "available": False,
        "status": "error",
        "score": None,
        "level": "UNAVAILABLE",
        "color": "#6b7280",
        "drivers": [],
        "detail": "calculation failed",
    }
