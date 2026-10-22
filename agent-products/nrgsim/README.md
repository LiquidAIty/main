<!-- Entity: Building Modeling -->
<!-- Relationship: Describes the current contained modeling integration and distinguishes implemented behavior from references and deferred work. -->
# NRGSIM

The owner's recovered Three.js viewport, connected to the shared LiquidAIty inspector and an OpenStudio edit/run/comparison workflow. Contextual category tabs expose supported existing shoebox inputs; the geometry tree floats over the viewport. This is not full OpenStudio Application parity or a full-building editor.

## Source

- Git commit: `01c4dc26dd809f82f184b9c812efee3134ae62ef`, 27 April 2026, “Add telescope and energy workspace pipeline”. This is the nearby checkpoint located so far; an exact April 23 snapshot has not been established.
- The energy UI and supporting files were subsequently deleted in `eeb1af587`, 8 July 2026, “remove non-core workbenches and fix validation environment”.
- The initial recovery matched all 15 historical Git blobs. The viewport now has a bounded OpenStudio geometry extension; the unused React Three Fiber smoke-test branch was removed. The remaining recovered feature files retain their original contents. None of this is the rejected October NRGSIM implementation.
- The read-only Desktop `nrgsim-master` and `nrgsimapp-master` archives both inform the inspector. The earlier Site/Geometry/Facade/Activity template supplies coherent controls; the later archive contributes the separate wall/roof direction. Its empty HVAC panel and commented run markup are not restored as functionality. Existing Compact schedule numeric entries and Constant values are editable; arbitrary calendar/time-clause authoring is deferred. The owner's GitHub references are [nrgsim](https://github.com/nrgsim/nrgsim) and [nrgsimapp](https://github.com/nrgsim/nrgsimapp).

## Contents

- `client/src/components/energy/EnergyFacadeSurface.tsx`: existing Three.js viewport, selection and engineering input interface.
- `client/src/features/energy/`: original solar calculations, parameters, validation and jEPlus run-preparation logic.
- `client/src/types/workspaceActions.ts`: original feature action and parameter contracts.
- `client/src/features/modelWizard/pascal/`: historical adapter source, preserved as part of the original snapshot; it does not install or require a Pascal editor for the Three.js viewport.
- `services/energyplus-runner/`: original joblist-preparation runner and its historical README.

## Current boundary

`NrgsimWorkspace` mounts in the existing Project companion and portals its controls into the one shared Inspector. It adds no chat or standalone server. The backend requires Project ownership before forwarding to Python rails. The local installation configuration deliberately enables one Project only; changing a URL cannot read another Project's models.

Python rails serializes writes per Project. Each operation uses the already installed OpenStudio environment and unchanged upstream MCP. Saved OSM bytes are engineering authority; cached geometry is derived and hash-checked. These are transaction-scoped upstream MCP sessions. The saved Modeler now has two authorized application operations, `building_model.read_case` and `building_model.edit_inputs`, forwarding to this same HTTP owner rather than importing its lock into the MCP host. Only Modeler's obsolete contract/grants were migrated; other saved Cards and topology remain unchanged. Actual agent acceptance is recorded separately in `CoderReport.md`.

`workspace.local.json` (ignored) selects the existing installation, source OSM, weather and Project. Generated files are retained under `.local/projects/<project-id>/` (ignored). Baseline, Comparison 1 and Comparison 2 retain their separate OSM files; additional named cases use exclusive `case_<id>.osm` files. Frozen simulation inputs are not discovered as editable cases. Each simulation receives its own frozen OSM and records version, weather hash, native diagnostics and output hashes. SQL files are opened read-only.

The baseline is preserved; one selected performance case is editable. Other cases/history remain available in its selector. Building, Story and Space scopes expose categorized assembly assignments; individual surfaces expose local layers. Sliders have exact numeric entries; categorical choices refer to actual model resources. Details disclosures contain secondary properties, not separate model state. Completed runs are read-only, with an explicit **Edit current model** action. Each edit stages a candidate, saves/reopens through the unchanged MCP, checks authoritative readback and rechecks the source revision before publication. Stale revisions and invalid values are refused.

`constructionLibrary` and `constructionSet` in the ignored local configuration select the installed Application's native library. The current explicit selection is `90_1_2019.osm`, set `90.1-2019 - Office - ASHRAE 169-2013-5A`, SHA-256 `31a744bd1c684b7b5f9a6655d5563445e098d496cdf0e9274081920f30560ece`. OpenStudio's IDF reader extracts that set's reference closure before native model construction; only a user-selected assembly is cloned into an existing case. Category matching prevents offering interior partitions as exterior-wall replacements. Rsi, R-IP and conductance are calculated from actual layers, excluding films and bridges. Selecting the actual insulation-adjustment layer enables an SDK-backed R slider. PCM-bearing assemblies do not expose that scalar adjustment. These are library assumptions, not whole-building standards/compliance claims.

Local material edits copy the selected Construction and Material and reassign the selected face. Local load-definition edits do not add load instances. Schedule selectors assign compatible-unit schedules already in the model, with SDK validation. Numeric schedule edits clone the schedule at the selected owner and preserve every existing Through/For/Until/Interpolate directive. Known full-year AllDays thermostat pairs receive a combined-change-point heating/cooling check; this is not a general schedule evaluator. Hosted overhang/fin ratios produce actual ShadingSurfaces; saved host references identify the generated shade, while geometry remains authoritative. The WWR operation refuses replacement of a window with hosted shades until those projections are cleared.

Geometry cases retain the existing Ideal Loads conditioning. Their thermostat schedules, supply temperature/humidity limits, availability, demand-controlled ventilation, economizer and supported recovery settings now use the same input boundary. Unset capacities are not shown as zero or invented. The separate single-zone packaged DX test has actual fan/coil/economizer/schedule/sizing/supply-limit controls. Its recipe needs an explicit SDK component-order correction; its diagnostic runs are not automatically accepted as valid equipment performance. VAV, VRF, plants and a general HVAC canvas remain deferred.

The packaged HVAC inspector now exposes central heating airflow ratio and central/active zone design supply temperatures with native units, scope and saved readback. New constant-volume System 3 creation uses a heating airflow ratio of 1.0, recirculating sizing and the source zone's heating design temperature; it does not rewrite existing-system overrides. Plant sizing is off for this no-plant recipe. The corrected design-day case has 0 occupied heating-unmet hours and 221.833 cooling-unmet hours, technically passing the owner's stated 300-hour checkpoint. Remaining coil warnings and equipment-selection observations are retained in the CoderReport, not suppressed or presented as zero. No further system families are being added for this checkpoint.

## Explicit floors

`floor_geometry.py` creates one core/perimeter floor on an explicitly named shoebox copy and adds an aligned upper story on another copy. Stories, Spaces, Thermal Zones and adjacency are native OSM objects. The initial five-Space layout is a recipe, not a five-zone data schema: assignments can merge Spaces into existing zones or separate a Space into a newly conditioned zone. Empty source-zone equipment is removed during a deliberate merge; loads stay on their Spaces.

Story height/elevation and aligned footprint/core dimensions edit existing vertices rather than recreating the floor. A lower-height change translates the upper floor to preserve contact; changing the upper elevation changes the shared boundary. Aligned XY dimensions intentionally apply to both stories and are grouped as “Aligned floors.” Independent footprints and setbacks remain unsupported. Existing face/opening handles and assignments survive these edits. Copied upper faces receive explicit source-handle provenance; hosted shades are rebound to the copied openings. Interior assembly edits keep opposite layers reversed on the paired face.

Validation checks enclosed positive volumes, actual footprint overlap, floor-area accounting, reciprocal coincident/opposed boundaries, ground/top-roof exposure and explicit unmultiplied conditioning. New floor creation retains the shoebox's exterior-wall assembly and internal partitions but replaces its formerly adiabatic ceiling/floor with the configured library roof and ground slab. Adding an upper floor retains the roof on the upper copy and deliberately reconciles the new interstory boundary with the library interior ceiling and its reversed pair. This is neither a whole-building standards transformation nor a calibrated building.

The floating tree is Building → Story → Space → Surface → opening. Scope and highlight share exact OSM handles. New cases and completed runs remain distinct; comparison selection displays the selected run's frozen inputs and geometry. Pending numeric/glazing edits block conflicting navigation. An asynchronous clean-started refresh cannot overwrite a later human draft; stale saves retain the draft until explicit discard/reload.

Shared connections include the existing workspace/inspector mount, Project route and Python router, the two operation definitions in the existing MCP catalog, and a completion callback for model readback. The Node NRGSIM caller alone selects the long-request dispatcher; other routes retain their transport. Application reload uses the existing root launcher. No new Docker container or runtime is installed.

## Implemented single-zone boundary

- `services/openstudio_block.py`: creates a new empty current-version OSM, invokes the existing MCP floorprint and Thermal Zone tools, saves it, and reads authoritative vertices/handles through the SDK. It accepts an existing MCP ClientSession; it creates no MCP host, aliases, registry or agent runtime.
- `services/test_openstudio_block.py`: exercises the real installed stdio MCP server in isolated input/run directories. It proves floor area/volume, six surfaces, a real glazing edit, save/reopen, unchanged surface handles, rejection behavior and triangle areas with a window hole.
- `client/src/features/energy/openStudioGeometry.ts`: builds Three.js meshes from the accepted Python projection. An empty model remains empty; there is no example-building substitution.
- `OpenStudioBlockScene`, exported by `EnergyFacadeSurface.tsx`: reuses the recovered viewport/camera interaction with actual OSM geometry and exact handle selection. It adds no inspector or chat. The recovered default component's historical preview panels are not used by this export and are not simulation evidence.

`openstudio_block.py` by itself creates geometry only. The separate `solar_shoebox.py` and `run_solar_shoebox.py` retain the user's Office/No-PCM recipe and its proven annual EnergyPlus path. The current workspace opens that explicitly configured saved model; it does not invent a building or import a template silently. No jEPlus or JESS job is submitted by this first workspace.

## Results

`services/results.py` discovers exact SQL channel identities (including NULL-key facility meters) and separates weather environments, frequency and units. Comparisons use recorded local-standard interval-end time, retain nulls, and refuse mismatched engine/weather identities. The viewer displays **baseline plus one selected performance case** on shared scales: full-period hourly time series, average daily profiles, and day/hour heat maps, with a chosen time window and building/results split. Historical run selection reads its frozen geometry and inputs, not the current edited model. Output requests come from an actual prior RDD and remain distinct from channels recorded in SQL. An output absent in another case remains missing.

`weather_view.py` reads the selected OSM's EPW and simulation calendar, returning dates and hourly astronomical directions from NOAA's published solar equations. This is a derived display calculation, not EnergyPlus output. No arbitrary weather values or simulated data are substituted. It is not yet a validated match to EnergyPlus's solar-position calculation.

The comparison baseline can be any completed saved case, with its exact run pinned. One performance case is shown beside it; all other files/history remain available. Output choices are the intersection of the two selected runs' actual channels, including historical snapshots. Output-request edits now affect only the active editable performance file, never an implicit original-baseline pair. Earlier completed SQL stays immutable; adding a request cannot create that channel in an old run. Fanger preparation remains separate and owner-approved. The current scope and exact evidence are in `CoderReport.md`.

The Simulation tab can include the selected EPW's actual SummerExtreme and WinterExtreme periods while retaining design days. SDK 3.11 saves these OSM objects but omits them from forward translation. `weather_sizing_measure.py` is an explicit owned EnergyPlus measure which transfers their exact native fields after translation through the existing MCP `run_osw` operation. The final IDF is checked for exact period equality. Future workflow packages contain only their frozen seed, weather and hash-identified measure with relative paths. The first successful Windows proof preceded that packaging correction; the corrected package has SDK/file tests, not another annual-run claim.

Daily/monthly energy stacks derive from matching recorded heating/cooling or lighting/equipment channels, never by adding delivered HVAC thermal energy to equipment electricity. Supported building-energy totals explicitly sum actual SQL keys at matched intervals; the response retains those source keys. Missing components remain missing. Period totals, floor area and kWh/m² are calculated outside SQL. The ordinary baseline-change percentage is suppressed for differing floor areas; unknown totals and zero-baseline percentages remain undefined. Different People/zone/surface identities are not silently matched or averaged for comfort comparisons. Full schedule editing and general HVAC authoring remain deferred.

DView reference: official WEX v1.2.0, commit `c9aae9176a5bc630beab9da376b1e43778846ce9`, especially `src/dview/dvfilereader.cpp`. The source archive is retained in Desktop `NRGSIM/dview-reference`; its SHA-256 is `d1cadfd18098147cf27dd5024bd7ca5f942c8732c66e02dcb15512e1f4f12d02`. All 1,480 extracted regular files matched the archive. The web chart is a bounded implementation using that source/interaction reference, not an embedded or fully ported wxWidgets DView application. Binary-to-source build equivalence has not been established.

This does not implement PCM node/depth matching, surface heatmaps, general drawing, arbitrary floor plans/setbacks, map reconstruction, parametrics or optimization. A changed model can retain an older run; the inspector marks that result as an earlier saved version rather than claiming the old SQL belongs to the current geometry.

## Focused verification

Run the Python check using the existing OpenStudio MCP Python environment:

```powershell
& <configured-openstudio-python> services/test_openstudio_block.py --reference-root <existing-openstudio-reference> --output-root <evidence-directory>
```

The test launches the unchanged upstream MCP module with the installed launcher's configuration and isolated run/input roots. It writes actual OSM snapshots, before/after geometry and a receipt in the selected evidence directory. It does not connect to the shared LiquidAIty Python rails process.

Then test the derived geometry using the actual exported file:

```powershell
$env:OPENSTUDIO_GEOMETRY = '<acceptance-output>/geometry.json'
npm run test:geometry
```

The workspace passes `geometry`, `selectedHandle` and selection callbacks to `OpenStudioBlockScene`. Geometry refresh follows accepted OSM snapshots, not optimistic slider deformation. `verify_workspace_http.py` exercises the loaded Project route and records actual edit, refusal, save/reopen, run and comparison evidence. `test_results.py` requires `ENERGYPLUS_TEST_SQL` pointing to a real annual SQL file. Loaded browser interaction and saved-Card acceptance remain separate from these checks.

## Current direction

Bring this interface back first, with the owner's existing workspace and inspector. Retain Three.js. Pascal is no longer a prerequisite; Fabric.js and Text2CAD are not new dependencies. DesignBuilder remains an interaction reference, not a source-conversion target.

The current construction/floor runs, migrated control coverage, saved-agent session evidence and transport proof are in `CoderReport.md`. Do not represent catalog presence, direct SDK/MCP execution, or human editing as live saved-agent proof. Further geometry and jEPlus work follows those explicit boundaries.

Historical READMEs and incomplete adapter code in this snapshot describe that old revision, not new implementation authority. Reconnection is a separate bounded change; do not restore the historical whole-platform shell over the current application.
