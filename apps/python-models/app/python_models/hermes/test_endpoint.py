"""Rails /hermes/review endpoint: pure review over HTTP shape (function-level,
no server, no network — the endpoint function is called directly)."""

import pytest
from fastapi import HTTPException

from app.main import hermes_review
from app.python_models.hermes.test_review import full_report


class TestHermesReviewEndpoint:
    def test_reviews_a_real_report_and_returns_patch(self):
        result = hermes_review(
            {"coderReport": full_report(), "featureId": "test.feature.hermes-review"}
        )
        assert result["ok"] is True
        assert result["review"]["verdict"] == "honest"
        assert set(result["thinkgraphPatch"]) == {"resources", "statements"}
        # Honest report → RunRecord only, no Blocker/Pattern.
        kinds = [r["kind"] for r in result["thinkgraphPatch"]["resources"]]
        assert kinds == ["RunRecord"]

    def test_blocked_report_plans_blocker_and_pattern(self):
        result = hermes_review(
            {
                "coderReport": full_report(
                    status="blocked", blockers=["graph readback returned 0 nodes"]
                ),
                "featureId": "test.feature.hermes-review",
            }
        )
        assert result["review"]["verdict"] == "blocked"
        kinds = sorted({r["kind"] for r in result["thinkgraphPatch"]["resources"]})
        assert kinds == ["Blocker", "Pattern", "RunRecord"]

    def test_non_object_body_is_rejected_honestly(self):
        with pytest.raises(HTTPException) as err:
            hermes_review("not an object")  # type: ignore[arg-type]
        assert err.value.status_code == 400
