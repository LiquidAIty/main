"""Read actual EnergyPlus SQL channels without conflating environments or gaps."""
# Entity: Building Results
# Relationship: Projects saved case outputs into aligned, unit-preserving comparisons for the modeling workspace.

from __future__ import annotations

import json
import math
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path

BUILDING_ENERGY = {
    "Zone Ideal Loads Supply Air Total Heating Energy", "Zone Ideal Loads Supply Air Total Cooling Energy",
    "Zone Lights Electricity Energy", "Zone Electric Equipment Electricity Energy",
}


def connect(path: Path):
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def channels(path: Path) -> list[dict]:
    with closing(connect(path)) as db:
        rows = db.execute("""
            SELECT DISTINCT d.Name, d.KeyValue, d.ReportingFrequency, d.Units
            FROM ReportDataDictionary d JOIN ReportData r USING(ReportDataDictionaryIndex)
            JOIN Time t USING(TimeIndex) JOIN EnvironmentPeriods e USING(EnvironmentPeriodIndex)
            WHERE e.EnvironmentType = 3 AND t.WarmupFlag = 0
              AND d.ReportingFrequency IN ('Hourly', 'Zone Timestep', 'HVAC System Timestep')
            ORDER BY d.Name, d.KeyValue, d.ReportingFrequency
        """).fetchall()
    result = [dict(id=json.dumps(list(row), separators=(",", ":")), name=row["Name"],
                 key=row["KeyValue"], frequency=row["ReportingFrequency"], units=row["Units"])
            for row in rows]
    aggregates = {(row['Name'],row['ReportingFrequency']) for row in rows if row['Name'] in BUILDING_ENERGY and row['Units']=='J'}
    result.extend(dict(id=json.dumps([name,'building-total',frequency,'J'],separators=(',',':')),
                       name=name,key='Building total',frequency=frequency,units='J',scope='building') for name,frequency in sorted(aggregates))
    return result


def series(path: Path, channel: dict) -> dict:
    """Timestamps denote interval ends in EnergyPlus local-standard calendar time.

    DView's public dvfilereader.cpp is the reference for dictionary/key/environment
    selection. This reader uses the current ReportData schema, orders explicitly,
    and retains missing values rather than adopting its implicit sample spacing.
    """
    if channel.get('scope') == 'building':
        if channel['name'] not in BUILDING_ENERGY or channel['units'] != 'J':
            raise ValueError('Only supported additive energy channels can be summed across the building')
        keys=[item for item in channels(path) if not item.get('scope') and all(item[field]==channel[field] for field in ('name','units','frequency'))]
        parts=[series(path,item) for item in keys]
        if not parts:
            return dict(points={},environment=None,aggregation=None)
        if any(item['aggregation']!='Sum' for item in parts) or len({item['environment'] for item in parts})!=1:
            raise ValueError('Building energy components differ in aggregation or environment')
        joined={}
        for time in sorted(set().union(*(item['points'] for item in parts))):
            samples=[item['points'].get(time) for item in parts]
            intervals={sample['intervalMinutes'] for sample in samples if sample}
            if len(intervals)!=1:
                raise ValueError('Building energy components have different intervals')
            joined[time]=dict(value=sum(sample['value'] for sample in samples) if all(sample and sample['value'] is not None for sample in samples) else None,
                              intervalMinutes=next(iter(intervals)),dst=next(sample['dst'] for sample in samples if sample))
        return dict(points=joined,environment=parts[0]['environment'],aggregation='Sum',sourceKeys=[item['key'] for item in keys])
    with closing(connect(path)) as db:
        dictionaries = db.execute("""SELECT ReportDataDictionaryIndex, Type FROM ReportDataDictionary
            WHERE Name=? AND KeyValue IS ? AND ReportingFrequency=? AND Units IS ?""",
            (channel["name"], channel["key"], channel["frequency"], channel["units"])).fetchall()
        if not dictionaries:
            return {"points": {}, "environment": None, "aggregation": None}
        if len(dictionaries) != 1:
            raise ValueError("Output channel is ambiguous")
        rows = db.execute("""SELECT r.Value, t.Year, t.Month, t.Day, t.Hour, t.Minute,
                    t.Interval, t.DST, e.EnvironmentName, e.EnvironmentPeriodIndex
            FROM ReportData r JOIN Time t USING(TimeIndex)
            JOIN EnvironmentPeriods e USING(EnvironmentPeriodIndex)
            WHERE r.ReportDataDictionaryIndex=? AND e.EnvironmentType=3 AND t.WarmupFlag=0
            ORDER BY t.TimeIndex""", (dictionaries[0][0],)).fetchall()
    environments = {(row["EnvironmentPeriodIndex"], row["EnvironmentName"]) for row in rows}
    if len(environments) > 1:
        raise ValueError("Select a single weather run environment before comparing")
    points = {}
    for row in rows:
        # Verified 25.2 SQL uses Hour=1/Minute=0 for the first hourly interval end;
        # subhourly samples use Hour=0/Minute=10,20,... . Hour=24 rolls into the next day.
        year = row["Year"]
        if not year or year < 1:
            raise ValueError("SQL does not establish a calendar year")
        end = datetime(year, row["Month"], row["Day"]) + timedelta(
            hours=row["Hour"], minutes=row["Minute"])
        interval = row["Interval"]
        if not interval or interval <= 0:
            raise ValueError("Missing or invalid output interval")
        key = end.isoformat(timespec="minutes")
        if key in points:
            raise ValueError("Duplicate output timestamp; no silent aggregation")
        value = row["Value"]
        points[key] = {"value": value if value is not None and math.isfinite(value) else None,
                       "intervalMinutes": interval, "dst": row["DST"]}
    return {"points": points, "environment": next(iter(environments))[1] if environments else None,
            "aggregation": dictionaries[0]["Type"]}


def energy_breakdown(cases, channel, rows):
    groups = (
        ("Ideal Loads heating + cooling energy", ["Heating", "Cooling"],
         ["Zone Ideal Loads Supply Air Total Heating Energy", "Zone Ideal Loads Supply Air Total Cooling Energy"]),
        ("Lighting + equipment electricity", ["Lighting", "Equipment"],
         ["Zone Lights Electricity Energy", "Zone Electric Equipment Electricity Energy"]),
    )
    group = next((item for item in groups if channel["name"] in item[2]), None)
    if not group or channel["units"] != "J" or not rows:
        return None
    data = [[series(Path(case["sql"]), {**channel, "name": name}) for name in group[2]] for case in cases]
    if any(not item["points"] or item["aggregation"] != "Sum" for pair in data for item in pair):
        return None
    buckets = {"daily": {}, "monthly": {}}
    for row in rows:
        moment = datetime.fromisoformat(row["time"]) - timedelta(minutes=row["intervalMinutes"])
        values = [[item["points"].get(row["time"], {}).get("value") for item in pair] for pair in data]
        for grouping, period in (("daily", moment.date().isoformat()), ("monthly", moment.strftime("%Y-%m"))):
            totals = buckets[grouping].setdefault(period, [[0.0, 0.0] for _ in cases])
            for case_index, pair in enumerate(values):
                for component, value in enumerate(pair):
                    if value is None:
                        totals[case_index][component] = None
                    elif totals[case_index][component] is not None:
                        totals[case_index][component] += value / 3600000
    totals=[sum(pair[index][component] for pair in buckets['daily'].values() for component in range(2))
            if all(pair[index][component] is not None for pair in buckets['daily'].values() for component in range(2)) else None for index in range(len(cases))]
    return {"title": group[0], "components": group[1], "units": "kWh", "totalValues": totals,
            "normalizedByFloorArea": channel.get('scope')=='building',
            "perArea": [total/case['floorArea'] if channel.get('scope')=='building' and total is not None and (case.get('floorArea') or 0)>0 else None for total,case in zip(totals,cases)],
            **{key: [{"period": period, "values": values} for period, values in periods.items()] for key, periods in buckets.items()}}


def compare(cases: list[dict], channel: dict, start: str | None = None, end: str | None = None, *, baseline_case_id: str = 'baseline') -> dict:
    if not 1 <= len(cases) <= 3:
        raise ValueError("Select one to three completed cases")
    for field in ("engine", "weatherSha256"):
        if len({case[field] for case in cases}) != 1:
            raise ValueError(f"Cases have different {field}; an explicit comparison policy is required")
    data = [series(Path(case["sql"]), channel) for case in cases]
    times = sorted(set().union(*(item["points"] for item in data)))
    if start and end and start > end:
        raise ValueError("Comparison start is after its end")
    if times and channel["frequency"] == "Hourly":
        first, last = datetime.fromisoformat(times[0]), datetime.fromisoformat(times[-1])
        times = [(first + timedelta(hours=index)).isoformat(timespec="minutes")
                 for index in range(int((last - first).total_seconds() // 3600) + 1)]
    times = [time for time in times if (not start or time >= start) and (not end or time <= end)]
    rows = []
    for time in times:
        points = [item["points"].get(time) for item in data]
        intervals = {point["intervalMinutes"] for point in points if point}
        if len(intervals) > 1:
            raise ValueError("Cases have mismatched reporting intervals")
        rows.append({"time": time, "intervalMinutes": next(iter(intervals)) if intervals else 60,
                     "values": [point["value"] if point else None for point in points]})
    hourly = None
    if channel["frequency"] == "Hourly":
        totals = [[0.0] * len(cases) for _ in range(24)]
        counts = [[0] * len(cases) for _ in range(24)]
        cells = []
        for row in rows:
            interval_start = datetime.fromisoformat(row["time"]) - timedelta(minutes=row["intervalMinutes"])
            hour = interval_start.hour
            cells.append({"date": interval_start.date().isoformat(), "hour": hour, "values": row["values"]})
            for index, value in enumerate(row["values"]):
                if value is not None:
                    totals[hour][index] += value
                    counts[hour][index] += 1
        hourly = {"profile": [{"hour": hour, "values": [totals[hour][index] / counts[hour][index] if counts[hour][index] else None for index in range(len(cases))],
                                "sampleCounts": counts[hour]} for hour in range(24)],
                  "heatmap": cells, "profileMeaning": "Mean of available hourly samples at each local-standard hour; not a sum across days"}
    summary = None
    if rows and all(item["aggregation"] == "Sum" for item in data):
        divisor = 3600000 if channel["units"] == "J" else 1
        totals = [sum(row["values"][index] for row in rows) / divisor
                  if all(row["values"][index] is not None for row in rows) else None for index in range(len(cases))]
        baseline_index = next((index for index, case in enumerate(cases) if case["caseId"] == baseline_case_id), None)
        baseline = totals[baseline_index] if baseline_index is not None else None
        summary = {"units": "kWh" if channel["units"] == "J" else channel["units"], "values": totals,
                   "changePercent": [(value - baseline) / abs(baseline) * 100 if baseline not in (None, 0) and value is not None else None for value in totals]}
        areas=[case.get('floorArea') for case in cases]
        baseline_area=areas[baseline_index] if baseline_index is not None else None
        if baseline_area is not None:
            summary['changePercent']=[value if area is not None and math.isclose(area,baseline_area,rel_tol=1e-6) else None for value,area in zip(summary['changePercent'],areas)]
        if channel.get('scope')=='building' or (channel['units']=='J' and channel['key'] is None):
            summary['perArea']=[value/area if value is not None and area and area>0 else None for value,area in zip(totals,areas)]
            summary['perAreaUnits']=summary['units']+'/m²'
    return {"baselineCaseId":baseline_case_id,"channel": channel, "timeBasis": "interval-end/local-standard-time", "rows": rows, "hourly": hourly, "summary": summary,
            "energy": energy_breakdown(cases, channel, rows),
            "cases": [{**{key: case[key] for key in ("caseId", "runId", "revision", "engine", "weatherSha256")},
                       "environment": item["environment"], "aggregation": item["aggregation"],
                       "floorArea": case.get('floorArea'), "name": case.get('caseName'), "sourceKeys": item.get('sourceKeys',[channel['key']]),
                       "missing": sum(row["values"][index] is None for row in rows)}
                      for index, (case, item) in enumerate(zip(cases, data))]}
