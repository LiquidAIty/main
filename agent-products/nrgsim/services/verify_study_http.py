"""Prepare and verify the owner's reusable two-case shoebox output study."""
# Entity: Building Results
# Relationship: Exercises the loaded Project route, matching output requests and sequential real runs, retaining exact model/result evidence.

import argparse
import json
import urllib.request
import urllib.error
from pathlib import Path


OUTPUTS = [
    "Zone Mean Air Temperature", "Zone Mean Radiant Temperature", "Zone Operative Temperature", "Zone Air Relative Humidity",
    "Zone Thermal Comfort Fanger Model PMV", "Zone Thermal Comfort Fanger Model PPD", "Zone Thermal Comfort Clothing Surface Temperature",
    "Zone Thermal Comfort ASHRAE 55 Simple Model Summer or Winter Clothes Not Comfortable Time",
    "Zone Heating Setpoint Not Met Time", "Zone Cooling Setpoint Not Met Time",
    "Zone Heating Setpoint Not Met While Occupied Time", "Zone Cooling Setpoint Not Met While Occupied Time",
    "Zone Ideal Loads Supply Air Total Heating Energy", "Zone Ideal Loads Supply Air Total Cooling Energy",
    "Zone Ideal Loads Supply Air Total Heating Rate", "Zone Ideal Loads Supply Air Total Cooling Rate",
    "Zone Lights Electricity Energy", "Zone Electric Equipment Electricity Energy",
    "Surface Inside Face Temperature", "Surface Outside Face Temperature",
    "Surface Inside Face Conduction Heat Transfer Rate per Area", "Surface Window Transmitted Solar Radiation Rate",
    "Site Outdoor Air Drybulb Temperature", "Site Outdoor Air Relative Humidity",
    "Site Direct Solar Radiation Rate per Area", "Site Diffuse Solar Radiation Rate per Area",
]


def verify(url, output):
    evidence = {"status": "running", "requests": [], "channels": []}

    def publish():
        output.write_text(json.dumps(evidence, indent=2, allow_nan=False), encoding="utf-8")

    def request(payload):
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:5173"})
        try:
            with urllib.request.urlopen(req, timeout=940) as response:
                value = json.load(response)
        except urllib.error.HTTPError as error:
            evidence["requests"].append({"input": payload, "status": error.code, "error": error.read().decode("utf-8", errors="replace")})
            publish()
            raise
        evidence["requests"].append({"input": payload, "status": response.status})
        publish()
        print(json.dumps({"operation": payload["operation"], "case": payload.get("caseId"), "status": response.status}), flush=True)
        return value

    try:
        state = request({"operation": "state"})
        study = [item for item in state["cases"] if item["id"] in ("baseline", "case1")]
        evidence["before"] = [{"caseId": item["id"], "revision": item["revision"], "runId": item["run"]["runId"]} for item in study]
        outputs = [{"name": name, "key": "*", "frequency": "Hourly"} for name in OUTPUTS]
        ready = all(sorted(item["requestedOutputs"], key=lambda value: value["name"]) == sorted(outputs, key=lambda value: value["name"])
                    and any(control["field"] == "fanger" and control["value"] is True for control in item["controls"]) for item in study)
        if not ready:
            state = request({"operation": "study_outputs", "revisions": {item["id"]: item["revision"] for item in study}, "outputs": outputs, "fanger": True})
        for case_id in ("baseline", "case1"):
            case = next(item for item in state["cases"] if item["id"] == case_id)
            if not case["resultsCurrent"]:
                state = request({"operation": "run", "caseId": case_id, "revision": case["revision"]})
        study = [item for item in state["cases"] if item["id"] in ("baseline", "case1")]
        evidence["cases"] = [{"caseId": item["id"], "revision": item["revision"], "run": item["run"],
                              "wwr": next(wall["ratio"] for wall in item["walls"] if wall["editable"])} for item in study]
        for name in OUTPUTS:
            matching = [channel for channel in study[0]["run"]["channels"] if channel["name"] == name and channel["frequency"] == "Hourly"]
            if not matching:
                raise AssertionError("Requested output was not recorded: " + name)
            channel = matching[0]
            result = request({"operation": "compare", "cases": ["baseline", "case1"], "channel": channel["id"]})
            assert len(result["rows"]) == 8760 and all(item["missing"] == 0 for item in result["cases"]), name
            assert len(result["hourly"]["profile"]) == 24 and len(result["hourly"]["heatmap"]) == 8760
            evidence["channels"].append({"channel": channel, "rows": len(result["rows"]), "missing": [item["missing"] for item in result["cases"]],
                                         "first": result["rows"][0], "last": result["rows"][-1]})
            publish()
        evidence["status"] = "passed"
    except BaseException as error:
        evidence.update(status="failed", error=repr(error))
        raise
    finally:
        publish()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    verify(args.url, args.receipt)
