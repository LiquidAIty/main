<!-- Entity: Building Modeling -->
<!-- Relationship: Reports real construction/control migration, comparison fixes, the weather-sizing run, and distinct agent/visual/physics gaps. -->
# NRGSIM CoderReport — 21 October 2026

## Status: technically passing single-zone checkpoint; other proof tiers remain explicit

Construction, schedule and sizing controls are implemented. Baseline-versus-one-performance comparison follows exact selected runs. The latest corrected design-day case has **0 occupied heating-unmet hours, 221.833 occupied cooling-unmet hours and zero severe errors**. The owner accepts this as technically passing/good enough for the current checkpoint. Remaining frost warnings and nominal-capacity interpretation are bounded diagnostic observations, not a reason to keep expanding or silently altering the accepted case. Full OpenStudio parity, multizone HVAC, latest visual acceptance and live saved-Modeler editing are not claimed.

Latest owner steering: preserve old cases, stop rerunning unchanged cases, use one selected baseline and one performance file, add real HVAC and then multizone. Design-day and peak-weather sizing are both permitted. New simulations must be deliberate new feature cases.

### Latest bounded checkpoint

- New case: **Office — PSZ corrected design-day sizing**, case_ec4bc9048a4d.
- Revision: 93ad9c1afd79d092857a59d7ba7573fd20299e7707b73ffea5b7b37a2e841c61.
- Run: run_case_ec4bc9048a4d_59fb12d62a3c; operation 3d0f0397-b71a-410a-8b24-a36635689696.
- Native END: completed successfully, **393 warnings, 0 severe, 36.40 seconds**. Sizing has zero warnings; 384 recurring frost-warning occurrences remain in annual operation.
- OSM/readback and actual IDF prove central heating airflow ratio1.0, central heating design supply40°C, original zone heating design40°C, recirculating OA sizing, plant sizing off, design-day and annual simulations on, and zero WeatherFileConditionType objects.
- The exact Chicago 99.6% heating and 0.4% cooling design days and existing thermostat/load schedules remain. SQL contains two separate design-day environments and one annual environment; annual graphs filter to the latter.
- Heating coil nominal capacity5495.160W; system heating design capacity2556.792W; actual heating-design-day peak2743.175W and annual peak2574.941W. No heating saturation or occupied heating unmet remains. Nominal capacity is not interchangeable with an observed peak; interpreting the difference requires the sizing airflow/temperature calculation.
- Cooling airflow0.175933m³/s and DX gross capacity3574.013W remain the retained design-day baseline values. Cooling unmet221.833h and recurring frost warnings remain; this was a heating-sizing correction, not a demonstrated cooling-control repair.
- .local/design-day-verification.json retains requests, all five input readbacks/scopes/units, native environments/sizing/unmet results and preservation hashes. Every pre-existing OSM/SQL in its preservation set remained byte-identical. .local/design-day-comparison.json has8760 aligned annual temperature rows with no missing samples.
- Current source changes: input_controls.py publishes the five real sizing fields; packaged_rooftop.py corrects new System3 defaults and returns JSON-safe optional readback; test_packaged_rooftop.py verifies both fuels, boundaries, save/reopen and existing-override preservation; verify_design_day_http.py exercises the actual Project route. README and this report describe the checkpoint.
- The first new readback check exposed an OptionalDouble serialization error before any case creation; it was fixed, its failed receipt retained, then the probe succeeded. No failed mutation was blindly replayed.
- Final focused native check: three tests passed (packaged gas/electric topology/controls plus weather-sizing/package preservation), with the expected retained SDK translation/deprecation diagnostics. Browser inspection was attempted once without navigation/reload, timed out at20seconds, and was not repeatedly retried. No shared runtime source, application reload, Git state, other workspace, container or REA boundary was changed in this checkpoint.
- The owner's EnergyPlus modeling skill was updated and validated separately at C:/Users/jerem/.codex/skills/energyplus-modeling. It now routes HVAC work to explicit sizing/translation/annual-verification guidance and no longer directs agents toward the rejected Pascal prototype.
- Another chat may work elsewhere in the repository. Leave agent-products/nrgsim owned by this task while it closes; shared startup/Modeler work needs coordination before any edit or whole-app reload.

The sections below retain earlier-stage source and evidence details. Earlier failed-threshold runs remain historical comparisons, not the latest checkpoint result.

### Bounded follow-up interpretation — no further model edits or simulations

The 5495.160W heating nominal capacity is consistent with component sizing at0.206877kg/s, entering13.57°C and design leaving40°C. The simple mass-flow × specific-heat × temperature-rise calculation reproduces approximately5494W using rounded reported values. The actual heating-design-day peak uses the same airflow but requests approximately26.421°C leaving the coil, delivers2743.175W and runs at0.499198 fraction. Thus low utilization alone does not demonstrate erroneous oversizing; the earlier concern was premature. The system-level2556.792W result and gross component capacity are different calculations. EnergyPlus25.2 HeatingCapacitySizing.cc confirms the main-duct flow-ratio, mixed-air and leaving-temperature calculation.

At the first frost-warning interval (March10,10:20–10:30), actual SQL gives cooling-coil inlet13.900°C, timestep-average outlet13.334°C, OA fraction1.0, supply/OA mass flow0.206877kg/s, economizer status1.0, cooling runtime0.038766 and average cooling rate137.064W. The warning's full-load outlet−3.22°C is not the timestep-average outlet. EnergyPlus25.2 DXCoils.cc checks the modeled full-load/on-cycle temperature before continuous-fan cycling averaging. This explains the apparent discrepancy without declaring the warning fictitious or changing compressor/manufacturer limits. Cooling control remains a later refinement; the owner accepts the technical checkpoint.

References: https://github.com/NatLabRockies/EnergyPlus/blob/v25.2.0/src/EnergyPlus/Autosizing/HeatingCapacitySizing.cc and https://github.com/NatLabRockies/EnergyPlus/blob/v25.2.0/src/EnergyPlus/DXCoils.cc. Local evidence is the corrected run's CoilSizingDetails, hourly/timestep SQL and eplusout.err.

## Authority and preservation

- Saved OSM files remain engineering authority. Python rails owns Project serialization, validation, revision checks and publication; TypeScript transports/renders.
- Original shoebox, glazing cases and historical inputs/SQL remain retained. No Git mutation, new container, REA action, upstream-original/source change, recycling change or unrelated-workspace feature edit occurred.
- Only the approved Modeler contract/grants were migrated. Six other Cards and topology were hash-equal before/after; model/provider and identity were preserved.
- The normal whole-app launcher was used. No alternate service/runtime was created.
- Watcher-owned .codebase-memory/artifact.json is not an implementation edit.
- Root turn.md remains excluded by the owner's instruction; this is the domain handoff.

## Current-source and CBM references

Canonical CBM project: C-Projects-LiquidAIty-main. The Primary CLI mapped input_controls.bindings/apply_edits/projection/verify_edits, NrgsimWorkspace, ModelInputs and existing shared consumers. Generation: 2026-10-21T08:00:19Z. Final coverage: sizing_controls.py not_tracked; results.py, NrgsimWorkspace.tsx and shared mainSession.routes.ts metadata_changed. These were direct-read. No reindex/lifecycle mutation occurred. Development CLI worked while the application's optional CBM provider was unavailable after startup.

Paths below are relative to agent-products/nrgsim unless qualified:

| Boundary | Current owner |
|---|---|
| Project authorization/transport | apps/backend/src/routes/nrgsim.routes.ts and services/pythonRailsClient.ts |
| Single Project lock/cache | services/routes.py::execute, cached_state |
| Revisions, operations, frozen runs | services/workspace_operations.py::operation |
| Engineering bindings/readback | services/input_controls.py |
| Native construction references | services/construction_library.py |
| EPW periods/FT extension | services/sizing_controls.py, weather_sizing_measure.py |
| Inspector/case/run selection | client/src/components/energy/NrgsimWorkspace.tsx, ModelInputs.tsx |
| Read-only SQL/graphs | services/results.py, ResultComparison.tsx |
| Modeler tools | services/modeling_tools.py plus existing application MCP catalog/dispatcher |

Actual run versions: OpenStudio SDK/Python 3.11.0, unchanged OpenStudio MCP 1.2.1, EnergyPlus 25.2.0-cf7368216c.

## Implemented controls

### Constructions

Exterior walls were already SteelFramed - No PCM, not partitions. The real envelope defect was an exposed roof using Project internal Ceiling and the ground floor retaining the shoebox's internal-floor assembly.

Building/Story/Space controls group actual surfaces by category and boundary. Choices retain current assignments and offer compatible model/library assemblies. Local material/layer edits clone shared resources; matched boundaries reverse the opposite layers. Actual layer Rsi, R-IP and conductance exclude films and thermal bridges. Selecting the SDK insulation-adjustment layer enables assembly-R editing. For StandardOpaqueMaterial the SDK changes thickness; this is not operational whole-wall R. PCM-bearing assemblies do not offer this scalar adjustment.

Configured native library: installed 90_1_2019.osm, set 90.1-2019 - Office - ASHRAE 169-2013-5A, SHA-256 31a744bd1c684b7b5f9a6655d5563445e098d496cdf0e9274081920f30560ece. A native IDF reference closure avoids loading every unrelated library set. This is an explicit template assumption, not whole-building 90.1/Appendix G compliance.

Actual saved floor assemblies:

- Exterior wall unchanged: Rsi 2.263830045.
- Typical IEAD Roof R-31.25 179: Rsi 5.366077297.
- Typical Insulated Carpeted 8in Slab Floor: Rsi 0.304445355. Actual concrete/carpet layers govern, not the name.
- Partitions unchanged. Existing interstory pairs remain internal; new upper-floor creation deliberately assigns the library interior ceiling and reversed paired floor.

Native tests exercise scope, resource isolation, invalid partition selection, R save/reopen and adjacency. Real route evidence .local/construction-http-verification.json records 35 historical OSM/SQL artifacts byte-identical.

### Schedules, Ideal Loads and weather sizing

Compatible schedule selection remains. Supported constants and Compact numeric entries can be edited while retaining all Through/For/Until/Interpolate clauses and isolating the selected owner's schedule. Known full-year AllDays thermostat pairs receive a combined-time heating/cooling check; arbitrary calendar authoring is not implemented.

Ideal Loads thermostat schedules, supply temperature/humidity limits, availability, demand control, economizer and supported recovery fields use actual SDK bindings. Unset capacities are not invented as zero. The packaged test retains actual fan/coil/economizer/thermostat/sizing controls.

The Simulation tab can include actual EPW SummerExtreme/WinterExtreme weeks while retaining design days. Chicago's header supplies July 13–19 and January 27–February 2. Native OSM objects save/reopen, but SDK 3.11 ForwardTranslator omits this class. The owned EnergyPlus measure transfers the five saved fields after translation through public run_osw. The actual executed IDF proves these periods reached EnergyPlus.

Future OSW preparation now stages only the frozen seed, weather and hash-identified measure with relative paths. The first successful Windows run preceded this packaging fix and bundled all files from the former inputs directory; that evidence remains retained. Corrected packaging and exact-period/extra-period rejection have SDK/file tests, not another annual-run claim. Run metadata now derives from a frozen model reloaded after its digest matches the requested revision.

## Comparison/UI bug fixes

- Exactly two visible roles: chosen Baseline and Performance. Other files/history remain available.
- A completed named HVAC case can be baseline without replacing the original shoebox.
- Returning to an older performance run restores its matching inspector snapshot rather than showing current inputs while comparing old SQL.
- Output choices are the intersection of the exact two selected run catalogs, including historical snapshots.
- Percentages use the chosen baseline ID, even when second in the response. Different floor areas suppress ordinary total-energy-saving percentages.
- Output requests now edit only the active editable performance file. The UI no longer silently writes literal baseline/case1 when a different reference is selected.
- Failed run-selection reads retain the consistent previous selection. Pending drafts survive focus/completion refresh and stale-revision refusal.
- Queued state reads recheck cache inside the existing lock; source/config/library changes invalidate derived state.
- NRGSIM alone uses a long-request Undici dispatcher with aligned headers/body/abort budgets. A real edit returned after 501.563 seconds. Other routes retain defaults.

Latest visual proof is NOT PROVEN: browser frame/focus attachment repeatedly failed, including a tool timeout, and retries were stopped. Previous-turn visual acceptance is not this-turn acceptance.

## Actual saved models and runs

Project artifacts: .local/projects/38bd1429-e8e1-47ff-afef-d940aa8e8040/.

Envelope-repair simulations completed BEFORE the instruction to stop old-case reruns:

| Case | Saved revision | Run | Native result |
|---|---|---|---|
| case_df12ce1f214e | 6180df61b34926609ad02d391fbcbf798edec9855958e3cfb9a485ca10eacf9a | run_case_df12ce1f214e_411f6e1f1abc | 10 warnings, 0 severe, 44.47 s |
| case_533019990494 | 8d900545451000686c89d42c4ec884d7c169a1e6c46fc95f49c4b1aa840c69be | run_case_533019990494_3a0e36a0946c | 10 warnings, 0 severe, 122.67 s |

No unchanged old case was simulated after that steering. The subsequent HVAC case is new:

- Office — PSZ weather-extreme sizing, case_25171184f646.
- Saved/frozen revision 1749de75c966c0bcbeed301cc8731967704525a1f4f7b3f540d37a32d9986e88.
- Operation 722dcac1-0961-4dcc-958f-da20ac5c4e9d.
- Run run_case_25171184f646_7841692d62f1.
- Native END: successful, 20 warnings, 0 severe, 27.04 s. Branches, air paths and nodes pass native integrity tests.
- IDF SHA-256 6df71a65c134530d1e2526b7a77d3afa28ac569624355d64d45a28b9cd74d9ba.
- SQL SHA-256 10b66bb424fab908cd43ed016fd69a8af1aa02faf21656c4eb3cc75798f1882c.
- ERR SHA-256 dfb73321f6d83987f79d42b351411f401d3c29138d3f34a303bbcb8b4482252a.

Compared without rerunning retained case_378bae5d0090 / run_case_378bae5d0090_e35695b40944. Same weather identity and 20.8849 m² area. Source OSM and both SQL files unchanged.

| Observed metric | Retained HVAC baseline | EPW-extreme feature case |
|---|---:|---:|
| Occupied heating unmet | 237.000 h | 325.833 h |
| Occupied cooling unmet | 218.500 h | 1.333 h |
| Combined occupied unmet | 455.500 h | 327.167 h |
| Recurring frost warnings | 384 | 10 |
| Gas coil nominal capacity | 1,253.617 W | 1,106.324 W |
| DX gross rated capacity | 3,574.013 W | 4,574.674 W |
| Design supply flow | 0.175933 m³/s | 0.276356 m³/s |
| Electricity | 2,707.081 kWh | 2,970.965 kWh (+9.748%) |
| Natural gas | 3,198.747 kWh | 2,954.506 kWh (−7.636%) |

This is NOT a successful comfort/savings outcome. Heating worsens, combined unmet remains above the owner's 300-hour criterion, and frost remains. Heating reaches the new 1,106.324 W limit. 309.5 of 325.833 occupied heating-unmet hours coincide with hours containing runtime fraction ≥0.999. Capacity/control saturation is the strongest supported explanation, not complete causal proof. Fan energy tracks increased airflow. The zone-cooling design peak is genuinely governed by WinterExtreme at January 27 13:00; system sensible sizing and coil gross rated capacity are different quantities.

All nine requested node/coil/OA diagnostics exist at Zone Timestep frequency. Economizer status is nonzero in 88.44% of samples and OA fraction reaches 1.0; these controls require review. Other retained warnings include plant sizing without plant, default zone air-distribution effectiveness, unavailable DistrictCooling meter, and tariff/report warnings. None was suppressed.

### Real comparison evidence

The real Project results endpoint returned:

- .local/weather-sizing-compare-Electricity.json: 52,560 aligned Zone Timestep rows, actual J converted to kWh totals.
- .local/weather-sizing-compare-NaturalGas.json: 52,560 aligned Zone Timestep rows.
- .local/weather-sizing-compare-Zone Mean Air Temperature.json: 8,760 hourly rows, daily profile and day/hour heat map.
- Exact run/revision/weather identities, zero missing samples, chosen baseline ID, unchanged SQL in all three.
- .local/weather-sizing-verification.json: preparation/run/comparison requests, source preservation/hashes and failed-readiness attempt. An earlier output-write timeout was reconciled against its successful native receipt/readback; it was not blindly replayed.

## Saved Modeler: migrated, not live-accepted

Card card_9c43e17bb2b64ff2, profile nrgsim, revision 30a7b223-4fb0-4ba7-9106-ddd0f0254203 now grants exactly building_model.read_case and building_model.edit_inputs. They forward authenticated Project/deck/Card/Run context to the existing Python rails HTTP owner, not a second model/lock. Evidence: .local/modeler-migration.json and its before snapshot.

Actual Main → Modeler attempts were retained: req_7ba3941909094954, req_fb816543f0cf4e35 and req_0e0dabd05f4b45ec. None successfully read/edited the model through these tools. An explicit-empty toolset pin defect was fixed/tested in the existing profile materializer, but that alone did not solve discovery.

A distinct startup issue remains: mainSession.routes.ts::resumeProjectCardSession uses eager_build:true. Native _resume_eager directly builds the agent without starting per-profile MCP discovery. Subsequent activate sees an existing agent and bypasses _start_agent_build, which starts secondary-profile discovery. The existing connection-test action now separates its temporary remote probe from cached runtime status. A successful probe is not session tool registration; configured/connected:false/tools:0 is expected cold state before a turn.

The owner was asked before changing this shared resume/activate sequence. **That correction is not implemented or authorized by silence.** No vendor patch, cache deletion, alias, grant widening or credential workaround was made. A real saved Modeler read/edit/readback remains required after the correction.

## Verification tiers

- SOURCE: exact current owners and public SDK/MCP contracts checked, with CBM gaps explicit.
- PRIOR-STAGE DETERMINISTIC: 107 focused tests passed: 20 actual SDK control/floor/construction/packaged-HVAC/sizing tests, 9 UI tests, 18 backend profile/route/transport tests, 50 MCP catalog/dispatch/authority tests, 9 actual-SQL reader tests and 1 lock/cache test. This is not a whole-repository suite or a repeat of all tests after the latest five sizing fields. The latest bounded packaged tests and real design-day/annual probe are recorded above.
- TYPECHECK: client and backend passed; final diff whitespace check separately recorded.
- LOADED: normal launcher; MCP ready/sourceCurrent=true, optional application CBM unavailable. Real Project edit/run/compare requests succeeded.
- PERSISTENCE: actual OSM save/reopen/readback, source and frozen SQL hashes retained.
- LIVE AGENT: UNPROVEN; actual attempts failed to expose modeling tools.
- VISUAL: latest UI not inspected because browser attachment failed.
- PHYSICS: the earlier weather-extreme run failed the stated unmet-hours criterion; the latest corrected design-day case passes it at221.833h. The owner accepts that technical checkpoint while retaining known coil warnings for investigation.

## Changed files

Domain implementation: services/input_controls.py, construction_library.py, floor_geometry.py, output_controls.py, sizing_controls.py, weather_sizing_measure.py, workspace_operations.py, routes.py, results.py, modeling_tools.py; client/src/components/energy/ModelInputs.tsx, NrgsimWorkspace.tsx, ResultComparison.tsx.

Tests/probes: services/test_construction_controls.py, test_floor_geometry.py, test_input_controls.py, test_sizing_controls.py, test_routes_cache.py, test_results.py, test_modeling_tools.py, verify_construction_http.py, verify_modeler_http.py, verify_weather_sizing_http.py; tests/WorkspaceDrafts.spec.tsx and ResultComparison.spec.tsx. Existing packaged-HVAC tests were exercised. Earlier viewport/floor changes already in the dirty tree remain preserved; this list does not attribute every current Git diff to this continuation.

Approved shared seams: backend package.json and root lock (explicit already-installed Undici 7.30.1); pythonRailsClient.ts/spec, nrgsim.routes.ts/spec, profileMaterialization.ts/spec, hermesProfile.routes.ts; Python application_operation_catalog.py, mcp_request_dispatch.py, mcp_observability.py; client/src/pages/agentbuilder.tsx (existing completion callback/draft preservation). Exact NRGSIM README/PLAN/ARCHITECTURE sections and this report were reconciled. Ignored local config selects the existing construction library.

## Next bounded work

1. Current checkpoint: retain the technically passing corrected design-day case and complete only bounded read-only interpretation of coil sizing/frost. Do not automatically rerun or tune it further.
2. Coordinate the shared runtime window before correcting cold Modeler resume/discovery and proving real saved-agent edit/readback. Do not interfere with the other platform chat.
3. Later, when resumed: genuine central multizone System5, with one VAV air loop, hot-water loop, real reheat terminals and per-zone proof. This remains source-audited only; it is not part of the done-for-now checkpoint.

Unsupported: arbitrary polygon/independent-story/setback geometry, general HVAC canvas/VRF/plants, arbitrary schedule-time authoring, complete OpenStudio inputs, map reconstruction, parametric/optimization execution, PCM depth-node matching and surface heat-map animation. None is represented by a fake input.
