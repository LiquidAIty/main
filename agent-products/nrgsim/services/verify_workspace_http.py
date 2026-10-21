"""Exercise the loaded, Project-authorized edit and simulation path."""
# Entity: Building Modeling
# Relationship: Records real HTTP/MCP/OSM/SQL acceptance without editing simulator outputs or impersonating a saved Card.

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path


def verify(url: str, destination: Path, case_id="case1", ratio=.2):
    receipt = {"status": "running", "requests": []}
    destination.parent.mkdir(parents=True, exist_ok=True)

    def publish():
        destination.write_text(json.dumps(receipt, indent=2), encoding="utf-8")

    def request(payload: dict, expected=200):
        data = json.dumps(payload).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:5173"})
        try:
            response = urllib.request.urlopen(req, timeout=940)
            status, value = response.status, json.load(response)
        except urllib.error.HTTPError as error:
            status, value = error.code, json.load(error)
        receipt["requests"].append({"input": payload, "httpStatus": status, "result": value})
        publish()
        print(json.dumps({"operation": payload["operation"], "httpStatus": status}), flush=True)
        assert status == expected, value
        return value

    try:
        state = request({"operation": "state"})
        if not state["cases"]:
            state = request({"operation": "initialize"})
        baseline = next(case for case in state["cases"] if case["id"] == "baseline")
        receipt["baselineRevision"] = baseline["revision"]
        if not any(case["id"] == case_id for case in state["cases"]):
            state = request({"operation": "clone", "caseId": case_id, "revision": baseline["revision"]})
        candidate = next(case for case in state["cases"] if case["id"] == case_id)
        wall = next(wall for wall in candidate["walls"] if wall["editable"])
        payload = {"operation": "glazing", "caseId": case_id, "surfaceHandle": wall["handle"], "revision": candidate["revision"], "ratio": ratio}
        request({**payload, "ratio": 1.2}, 409)
        request({**payload, "revision": "stale-revision"}, 409)
        unchanged = request({"operation": "state"})
        assert next(case for case in unchanged["cases"] if case["id"] == case_id)["revision"] == candidate["revision"]
        state = request(payload)
        assert next(case for case in state["cases"] if case["id"] == "baseline")["revision"] == baseline["revision"]
        candidate = next(case for case in state["cases"] if case["id"] == case_id)
        assert abs(next(wall for wall in candidate["walls"] if wall["handle"] == payload["surfaceHandle"])["ratio"] - ratio) < 1e-6
        selected = ["baseline", "case1", "case2"] if case_id == "case2" else ["baseline", "case1"]
        for selected_id in selected:
            case = next(case for case in state["cases"] if case["id"] == selected_id)
            if not case["resultsCurrent"]:
                state = request({"operation": "run", "caseId": selected_id, "revision": case["revision"]})
        channel = next(channel for channel in state["cases"][0]["run"]["channels"]
                       if channel["name"] == "Zone Ideal Loads Supply Air Total Cooling Energy" and channel["frequency"] == "Hourly")
        comparison = request({"operation": "compare", "cases": selected, "channel": channel["id"]})
        assert len(comparison["rows"]) == 8760
        assert all(case["missing"] == 0 for case in comparison["cases"])
        totals = [sum(row["values"][index] for row in comparison["rows"]) for index in range(len(selected))]
        assert totals[0] != totals[1]
        receipt.update(status="passed", totals_J=totals, samples=8760, baselinePreserved=True,
                       comparisonChannel=channel, savedCases=[{key: case["run"][key] for key in ("caseId", "runId", "model", "revision", "sql", "html", "nativeEnd")} for case in state["cases"]])
    except BaseException as error:
        receipt.update(status="failed", error=repr(error))
        raise
    finally:
        publish()
        print(json.dumps({"status": receipt["status"], "receipt": str(destination)}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--case-id", choices=("case1", "case2"), default="case1")
    parser.add_argument("--ratio", type=float, default=.2)
    args = parser.parse_args()
    verify(args.url, args.receipt, args.case_id, args.ratio)
