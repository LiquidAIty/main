<!-- Entity: Building Modeling -->
<!-- Relationship: Records the verified shoebox checkpoint, current coverage and explicitly deferred work; it is not model or runtime authority. -->
# NRGSIM CoderReport — 21 October 2026

## Current outcome

The recovered shoebox is mounted in LiquidAIty's existing workspace and shared inspector. OpenStudio OSM files own engineering state. This is a functioning bounded shoebox edit/run/results path, not full OpenStudio Application parity, a real-equipment HVAC model, or a proven saved-Card modeling agent.

The latest owner direction is: simple on top and deep when needed; real bound inputs only; no user-facing documentation panels; baseline required; use two comparable cases by default; retain historical runs and the third glazing case; defer HVAC implementation to a separate discussion. Standards-based defaults are desired independently of Appendix G rotation/averaging. Ordinary studies must retain their actual orientation.

## Original references

Both read-only Desktop archives informed the work:

- `nrgsim-master/public/app/templates/sim.us` and `public/app/js/views/sim_page.js`: coherent Site/Geometry/Facade/Activity groups, sliders and exact input semantics.
- `nrgsimapp-master` equivalents: later wall/roof distinctions and expanded envelope direction. Empty HVAC markup and commented run controls were not treated as working features.
- The retained April 2026 `EnergyFacadeSurface.tsx` supplies the Three.js viewport. Its historical local preview inspector and synthetic estimates are not mounted.
- `BelgianPassivhausVillaWithAdvanced_bioPCM_Envelope.pdf`: text inspected on all 32 pages; pages 4, 13, 17 and 20 rendered, with 13/17/20 visually reviewed. It is a design/output exemplar, not validation of today's model. Its paired MAT/PPD heat maps and node/time plots guide the presentation.
- Official DView/WEX source remains the reference documented in README; no binary-to-source equivalence claim is made.

## Current-source and CBM evidence

Repository CLI project `C-Projects-LiquidAIty-main`, generation `2026-10-21T05:14:25Z`, returned `NrgsimWorkspace`, `GeometryTree`, the page mount variable, and the `workspace_operations` module. The workspace trace returned `OpenStudioBlockScene`, `GeometryTree`, `ResultComparison` and request helpers. It also returned unrelated same-name React setter matches; current imports, not those false edges, established the actual callers.

The six checked UI/service/page paths reported `no_recorded_issue` with `metadata_changed`. Direct source was read. `.local`, dependencies, Python caches and local configuration are excluded; Desktop upstream/reference code was direct-read, not claimed as indexed. No reindex, cache access or CBM lifecycle change occurred.

Owners: `client/src/pages/agentbuilder.tsx` mounts the workspace and one shared Inspector; `NrgsimWorkspace.tsx` owns selection and presentation; `workspace_operations.py` owns saved cases and transactions; `input_controls.py` owns bounded SDK bindings; `results.py` reads SQL; `routes.py` serializes Project operations; the existing authenticated backend route resolves Project ownership.

## Input coverage: present versus omitted

| Category / scope | Bound behavior now | Read / write contract | Not implemented in this pass |
|---|---|---|---|
| Site / Building | Orientation, latitude, longitude, time zone, elevation; weather-linked sun date/hour | Building/Site getters/setters; EPW calendar and NOAA astronomical display calculation | EPW import/selection workflow, climate-zone/standards wizard; solar display is not validated against EnergyPlus solar outputs |
| Geometry / Building or Space | Width/depth/height of the existing rectangular single Space | SDK vertices, `setVertices`; identity/assignment preservation | Polygon drawing, partitions, stories, general multi-zone edits, curves, map/PDF reconstruction |
| Openings / exterior wall | Actual glazing fraction, range and exact numeric entry | Upstream `set_window_to_wall_ratio`, SDK construction preservation, MCP save/reopen | Arbitrary multi-opening layout, frames and complex-window replacements; hosted shades must be cleared before WWR replacement |
| Shading / window | Overhang and left/right fin projection ratios | SDK `ShadingSurface` vertices and group/Space assignment; ratios derived from geometry | General shade drawing or visual comfort/daylighting prediction |
| Construction / selected face | Existing assembly selection; applicable opaque, massless, air-gap and SimpleGlazing properties | `setConstruction`, material setters; local Construction/Material copies and assignment | General layer editor, BCL browser, broad standards-template application, PCM material editor |
| Activity / Building or Space | People, electric equipment, hot-water internal gains, infiltration and outdoor-air specification | Existing load definitions/instances and SDK setters; no duplicate load instances | Other load families not present in this model; hot-water gains are not a DHW plant |
| Lighting / Building or Space | W/m² and schedule first; heat fractions under Details | Existing Lights instance/definition and schedule assignment | Daylighting controls, illuminance sensors and glare analysis |
| Schedules | Choose compatible-unit schedules already in the model | Actual schedule handles and owning object's SDK setter | Full schedule/ruleset editor, time-rule editing; no fake schedule choices |
| Comfort / People | Fanger enablement; constant work efficiency and air-speed bindings | PeopleDefinition Fanger type plus actual People schedules | Adaptive-comfort applicability workflow, legacy exterior-wall-only comfort view factors |
| Simulation / Building | Run period, year, timestep, sizing/run flags and real output requests | SDK RunPeriod/YearDescription/Timestep/SimulationControl/OutputVariable | General Measures editor, jEPlus/EA optimization, tariffs/bills workflow |
| HVAC / Thermal Zone | Existing Ideal Loads and thermostat model continue to run | Preserved OSM relationships | New HVAC inspector controls were removed/deferred at the owner's request; no system canvas or equipment replacement yet |

Every source/test file added in this pass has the Entity/Relationship header pair. Generated OSM/SQL files are not modified to add commentary.

## Persistence and actual run evidence

All paths below are under `.local/projects/38bd1429-e8e1-47ff-afef-d940aa8e8040/` unless specified.

| Case | Current frozen run | Input SHA-256 |
|---|---|---|
| Baseline, 40% glazing | `run_baseline_3abe8f76203b` | `04f1f5a1e7c6a83250a2a5db3bcb648a42756b67f1aea2bc759815ad16c52a15` |
| Comparison 1, 20% glazing | `run_case1_79c9f1c8c5b6` | `bef42ce055831b1af3d20afb554c109a39e325976d55c3ccf6bae94f7003f404` |
| Retained Comparison 2, 60% glazing | `run_case2_fdc04929aabe` | `5b5995359be1426b8d613d58a7f7bc90d6ff621500d7c714771e1409d3542213` |

The baseline and Comparison 1 have the same 26 hourly output requests and both record all 26 requested variable names. `.local/reusable-study-verification-2.json` passed 29 actual HTTP requests, including sequential real runs and 26 exact-channel comparisons. Each checked channel has 8,760 aligned hourly rows and zero missing observations in the pair. Surface outputs have additional object keys; the acceptance script checks one exact key per requested variable, not every surface/key combination.

Both current runs use SDK 3.11.0, EnergyPlus 25.2.0-cf7368216c and the same Chicago EPW. Native END/ERR show 9 warnings and zero severe errors. Warnings include unavailable natural-gas meters, duplicate meter reporting, monthly-report variables and unconfigured life-cycle energy costs. They are retained, not suppressed. The upstream numeric exit code is null; native successful completion is the positive evidence.

Current annual Ideal Loads energy, converted from recorded joules outside SQL:

| Quantity | Baseline | Comparison 1 |
|---|---:|---:|
| Cooling energy, kWh | 3076.7073 | 1950.3002 |
| Heating energy, kWh | 1130.9486 | 903.7168 |
| Mean Fanger PPD over all recorded hours, % | 26.2233 | 23.7370 |
| Occupied unmet heating hours | 0 | 0 |
| Occupied unmet cooling hours | 0 | 0 |

PPD above is an all-hours mean, not an occupied-weighted certification metric. Zero unmet hours with NoLimit Ideal Loads does not establish comfort or real-equipment sizing. Ideal Loads energy is real simulated thermal energy, not a claim about purchased equipment electricity.

Fanger uses the owner's approved zone-average MRT substitution. The archived Office assumptions retained are 0 work efficiency, 0.2 m/s air speed, 134 W/person activity and ASHRAE 55 dynamic clothing. The original exterior-wall AngleFactor=1.0 method was not silently reproduced or substituted without approval.

The earlier three-case 20/40/60 proof remains in `.local/acceptance-final-20-40-60.json`. The third case was not overwritten by the matched-output study and lacks its new comfort outputs. The UI defaults to the baseline/comparison pair and rejects comparisons when a selected run did not record the requested channel.

### Real human-edit demonstration

The loaded inspector changed Comparison 1 lighting from 9.15 to 7 W/m². Operation `1e3d414a-3059-4313-91d7-8dff087bc0af` saved/reopened and read back 7.0, with the original single Lights instance retained. UI-started run `run_case1_79c80feb5154` completed; annual cooling was 1867.8530 kWh versus 1950.3002 kWh previously. The original lighting was then restored through the inspector, saved/reopened, and rerun. These runs and their frozen input files remain available.

### Failed attempt, retained

Operation `cccf2f2e-3382-416b-a904-c48b2fdc91cb` failed during MCP initialization at the existing 180-second limit, before model load or EnergyPlus submission. It has no new native ERR. The unmodified provider imported successfully in a separate diagnostic (24.266 seconds); its stdio configuration was verified. One unchanged-timeout retry completed both runs. The precise cause of the first startup timeout was not established. Later operation receipts record the actual startup/load/edit/submission/simulation/readback stage for clearer errors.

## Verification tiers

- Source/contract: implemented bindings, scope checks, shared-resource copy semantics, revision checks and exact SQL identity.
- Deterministic: five real-SDK input tests passed, including every published current-model control's SDK write/save/reopen, 18 changed-value checks, resource isolation and Fanger idempotence. Six actual-SQL tests passed, including 8,760-hour alignment, NULL-key meters and daily/monthly energy conservation. The five backend transport tests passed; earlier affected workspace/rail tests also passed. Client/backend TypeScript checks passed at the recorded checkpoints; final source check remains part of handoff.
- Loaded: normal whole-app launcher used; Project routes and real UI edit/run/output-request paths executed. No new Docker container, dependency or alternate app runtime was added.
- Persistence: accepted candidate OSM readbacks, frozen execution inputs, run receipts and native artifacts retained. SQL is opened read-only; output hashes were checked against receipts.
- Visual: actual model, translucent geometry tree, scoped controls, historical-run lighting readback, hourly/profile/heat-map views and paired Fanger PPD heat maps were observed. Daily/monthly numerical aggregation is tested; final monthly-chart visual QA remains to be completed.
- Live saved modeling Card: NOT PROVEN. These are human/Codex-driven Project operations using transaction-scoped upstream MCP sessions, not proof of a persistent saved-Card agent controlling the same active document.
- Owner visual acceptance: separate; the owner supplied ongoing design corrections, not blanket acceptance of every control.

## Standards and next boundary

The downloaded OpenStudio Application 1.12.0-rc2 source includes real resource libraries `90_1_2004.osm`, `90_1_2007.osm`, `90_1_2010.osm`, `90_1_2013.osm`, `90_1_2016.osm`, `90_1_2019.osm`, `default/office_default.osm` and `default/hvac_library.osm`. They are not yet wired into the inspector. A guessed Ruby gem directory did not exist; installed `openstudio-standards` package/version must be verified before promising its efficiency/template API coverage.

The next recommended real-system proof is a supported packaged single-zone rooftop system, preserving the current Ideal Loads study. The installed MCP catalog/source contains PSZ-AC and PSZ-HP recipes. This does not establish their execution in this workspace, ASHRAE-compliant efficiencies or a formal Appendix G baseline.

Defer: multi-zone/full-building geometry, drawing/maps/PDF reconstruction, general HVAC canvas, VRF/VAV expansion, PCM/node-depth overlays, daylight/glare setup, jEPlus optimization, larger dashboards and separate meter/frequency filtering. Standards defaults should remain selectable independently of a separately requested compliance/LEED workflow. No automatic four-orientation averaging is authorized for ordinary comparisons.

## Changed boundary

Domain changes: `input_controls.py`, `output_controls.py`, `weather_view.py`, `workspace_operations.py`, `routes.py`, `results.py`, `openstudio_block.py`, input/result/study verification scripts, `ModelInputs.tsx`, `NrgsimWorkspace.tsx`, `ResultComparison.tsx`, `EnergyFacadeSurface.tsx`, `openStudioGeometry.ts`, and domain documentation. The only additional shared-code work in this continuation is the owned, sandboxed native-report GET route and its tests in the existing NRGSIM backend route files. Earlier shared mount/rail/router changes remain preserved. `.codebase-memory/artifact.json` is watcher-owned and was not edited by this task. No Git mutation occurred.
