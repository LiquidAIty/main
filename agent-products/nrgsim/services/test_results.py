"""SQL-reader contracts exercised against a real saved EnergyPlus run."""
# Entity: Building Results
# Relationship: Verifies observed timestamps, exact channel identity, aligned comparison and missing-channel treatment without fabricating simulation values.

import os
import unittest
from pathlib import Path

from results import channels, compare, series, connect
from contextlib import closing


class ResultsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = Path(os.environ["ENERGYPLUS_TEST_SQL"])
        cls.channel = next(item for item in channels(cls.sql)
                           if item["name"] == "Zone Mean Air Temperature" and item["frequency"] == "Hourly")

    def test_calendar_and_environment(self):
        result = series(self.sql, self.channel)
        self.assertEqual(len(result["points"]), 8760)
        self.assertEqual(next(iter(result["points"])), "2025-01-01T01:00")
        self.assertIn("2026-01-01T00:00", result["points"])
        self.assertEqual(result["environment"], "RUN PERIOD 1")
        self.assertTrue(all(point["intervalMinutes"] == 60 for point in result["points"].values()))

    def test_exact_identity_does_not_fuzzy_match(self):
        self.assertFalse(series(self.sql, {**self.channel, "key": "missing zone"})["points"])

    def test_actual_facility_meter_has_null_key(self):
        meter = next(item for item in channels(self.sql) if item["name"] == "Electricity:Facility")
        self.assertIsNone(meter["key"])
        self.assertGreater(len(series(self.sql, meter)["points"]), 0)

    def test_three_actual_cases_keep_full_hourly_resolution(self):
        import json
        root = self.sql.parents[3]
        cases = [json.loads((root / (case + "-run.json")).read_text()) for case in ("baseline", "case1", "case2")]
        result = compare(cases, self.channel)
        self.assertEqual(len(result["rows"]), 8760)
        self.assertEqual(len(result["hourly"]["heatmap"]), 8760)
        self.assertEqual(len(result["hourly"]["profile"]), 24)
        self.assertTrue(all(len(row["values"]) == 3 for row in result["rows"]))
        self.assertTrue(all(row["sampleCounts"] == [365, 365, 365] for row in result["hourly"]["profile"]))

    def test_energy_buckets_conserve_recorded_energy(self):
        import json
        root = self.sql.parents[3]
        cases = [json.loads((root / (case + "-run.json")).read_text()) for case in ("baseline", "case1")]
        channel = next(item for item in channels(Path(cases[0]["sql"])) if item["name"] == "Zone Ideal Loads Supply Air Total Cooling Energy")
        result = compare(cases, channel)
        self.assertFalse(result['energy']['normalizedByFloorArea'])
        self.assertEqual(len(result["energy"]["daily"]), 365)
        self.assertEqual(len(result["energy"]["monthly"]), 12)
        for index in range(2):
            expected = sum(row["values"][index] for row in result["rows"]) / 3600000
            self.assertAlmostEqual(result["summary"]["values"][index], expected)
            self.assertAlmostEqual(sum(period["values"][index][1] for period in result["energy"]["monthly"]), expected)
            self.assertAlmostEqual(sum(period["values"][index][1] for period in result["energy"]["daily"]), expected)
            self.assertAlmostEqual(result['energy']['totalValues'][index],sum(sum(period['values'][index]) for period in result['energy']['monthly']))

    def test_same_run_aligns_without_changing_values(self):
        case = dict(caseId="baseline", runId="reader-test", revision="same-input", engine="25.2", weatherSha256="same-weather", sql=str(self.sql))
        result = compare([case, {**case, "caseId": "case1"}], self.channel,
                         "2025-01-02T00:00", "2025-01-03T00:00")
        self.assertEqual(len(result["rows"]), 25)
        self.assertTrue(all(row["values"][0] == row["values"][1] for row in result["rows"]))
        self.assertEqual([case["missing"] for case in result["cases"]], [0, 0])
        with self.assertRaisesRegex(ValueError, "different weather"):
            compare([case, {**case, "weatherSha256": "different"}], self.channel)
        with self.assertRaisesRegex(ValueError, "start is after"):
            compare([case], self.channel, "2025-02-01T00:00", "2025-01-01T00:00")

    def test_building_energy_sum_matches_independent_sql_total(self):
        channel=next(item for item in channels(self.sql) if item.get('scope')=='building' and item['name']=='Zone Ideal Loads Supply Air Total Cooling Energy')
        actual=series(self.sql,channel)
        with closing(connect(self.sql)) as db:
            expected=db.execute('''SELECT SUM(r.Value) FROM ReportData r
                JOIN ReportDataDictionary d USING(ReportDataDictionaryIndex)
                JOIN Time t USING(TimeIndex) JOIN EnvironmentPeriods e USING(EnvironmentPeriodIndex)
                WHERE d.Name=? AND d.Units='J' AND d.ReportingFrequency='Hourly'
                AND e.EnvironmentType=3 AND t.WarmupFlag=0''',(channel['name'],)).fetchone()[0]
        self.assertAlmostEqual(sum(point['value'] for point in actual['points'].values())/3600000,expected/3600000)
        self.assertTrue(actual['sourceKeys'])
        with self.assertRaisesRegex(ValueError,'Only supported additive energy'):
            series(self.sql,{**self.channel,'scope':'building'})

    def test_area_difference_is_not_a_total_energy_saving(self):
        channel=next(item for item in channels(self.sql) if item.get('scope')=='building')
        case=dict(caseId='baseline',runId='reader-test',revision='same-input',engine='25.2',weatherSha256='same-weather',sql=str(self.sql),floorArea=20)
        result=compare([case,{**case,'caseId':'area-test','floorArea':40}],channel)
        self.assertIsNone(result['summary']['changePercent'][1])
        self.assertAlmostEqual(result['summary']['perArea'][0],2*result['summary']['perArea'][1])
        self.assertTrue(result['energy']['normalizedByFloorArea'])
        self.assertAlmostEqual(result['energy']['perArea'][0],2*result['energy']['perArea'][1])

    def test_named_baseline_second_in_list_uses_its_real_sql_total(self):
        import json
        root=self.sql.parents[3]
        actual=[json.loads((root/(name+'-run.json')).read_text()) for name in ('case1','baseline')]
        named=[{**actual[0],'caseId':'performance','floorArea':20},{**actual[1],'caseId':'case_123456789abc','floorArea':20}]
        channel=next(item for item in channels(Path(named[1]['sql'])) if item['name']=='Zone Ideal Loads Supply Air Total Cooling Energy' and item['frequency']=='Hourly' and not item.get('scope'))
        result=compare(named,channel,baseline_case_id='case_123456789abc')
        values=result['summary']['values']
        self.assertEqual(result['baselineCaseId'],'case_123456789abc')
        self.assertEqual(result['summary']['changePercent'][1],0)
        self.assertAlmostEqual(result['summary']['changePercent'][0],(values[0]-values[1])/abs(values[1])*100)
        result=compare([{**named[0],'floorArea':40},named[1]],channel,baseline_case_id='case_123456789abc')
        self.assertIsNone(result['summary']['changePercent'][0])


if __name__ == "__main__":
    unittest.main()
