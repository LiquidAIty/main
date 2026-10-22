"""Output requests from the real run's EnergyPlus variable dictionary."""
# Entity: Building Results
# Relationship: Separates requested variables from recorded SQL channels and retains dictionary provenance.

import json
import re
from pathlib import Path

import openstudio
from input_controls import has_fanger


def configured_outputs(model):
    # Verified in the installed 25.2 SetupOutputVariables.csv. These are requestable
    # after Fanger preparation; only the next run's SQL can establish recorded data.
    if model is None or not any(has_fanger(people) for people in model.getPeoples()):
        return []
    return [{"name": name, "units": units, "sourceRunId": None, "source": "Configured Fanger model; EnergyPlus 25.2 output definition"}
            for name, units in (("Zone Thermal Comfort Fanger Model PMV", ""), ("Zone Thermal Comfort Fanger Model PPD", "%"),
                                ("Zone Thermal Comfort Clothing Surface Temperature", "C"))]


def available_outputs(root: Path, case_id: str, model=None) -> list[dict]:
    receipt = root / (case_id + "-run.json")
    inherited = False
    if receipt.exists():
        run = json.loads(receipt.read_text())
    else:
        origin = model.getBuilding().additionalProperties().getFeatureAsString('output_dictionary_source') if model else None
        if origin is None or not origin.is_initialized(): return []
        reference = json.loads(origin.get())
        run = None
        for path in (root/'operations').glob('*/receipt.json'):
            record = json.loads(path.read_text())
            if record.get('operation')=='run' and record.get('status')=='success' and record.get('caseId')==reference.get('caseId') and record.get('runId')==reference.get('runId'):
                run=record; break
        if run is None: return []
        inherited = True
    rdd = Path(run["sql"]).with_name("eplusout.rdd")
    if not rdd.is_file():
        return []
    result = []
    for line in rdd.read_text().splitlines():
        match = re.match(r"Output:Variable,\*,([^,]+),[^;]+;\s*!-\s*(.*?)\s*\[(.*?)\]", line)
        if match:
            result.append({"name": match[1], "aggregation": match[2], "units": match[3], "sourceRunId": run["runId"],
                           "sourceCaseId": run['caseId'], "inheritedDictionary": inherited})
    combined = {item["name"]: item for item in [*configured_outputs(model), *result]}
    return list(combined.values())


def set_outputs(model, root: Path, case_id: str, requested: list[dict]) -> dict:
    known = {item["name"] for item in available_outputs(root, case_id, model)}
    if not isinstance(requested, list) or not requested or len(requested) > 100:
        raise ValueError("Select one to one hundred output requests")
    identities = []
    for item in requested:
        if set(item) != {"name", "key", "frequency"} or item["name"] not in known:
            raise ValueError("Choose a variable from the actual run dictionary")
        if item["frequency"] not in ("Hourly", "Timestep") or item["key"] != "*":
            raise ValueError("This control supports all-key Hourly or Timestep requests")
        identities.append((item["name"], item["key"], item["frequency"]))
    if len(set(identities)) != len(identities):
        raise ValueError("Duplicate output request")
    for variable in model.getOutputVariables():
        variable.remove()
    for item in requested:
        variable = openstudio.model.OutputVariable(item["name"], model)
        if not variable.setKeyValue(item["key"]) or not variable.setReportingFrequency(item["frequency"]):
            raise ValueError("OpenStudio rejected output request")
    return {"requestedOutputs": requested, "dictionary": "Latest completed case RDD; runtime availability is checked in the new SQL"}
