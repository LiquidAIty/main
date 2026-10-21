<!-- Entity: Building Modeling -->
<!-- Relationship: Describes the current contained modeling integration and distinguishes implemented behavior from references and deferred work. -->
# NRGSIM

The owner's recovered Three.js viewport, connected to the shared LiquidAIty inspector and an OpenStudio edit/run/comparison workflow. Contextual category tabs expose supported existing shoebox inputs; the geometry tree floats over the viewport. This is not full OpenStudio Application parity or a full-building editor.

## Source

- Git commit: `01c4dc26dd809f82f184b9c812efee3134ae62ef`, 27 April 2026, “Add telescope and energy workspace pipeline”. This is the nearby checkpoint located so far; an exact April 23 snapshot has not been established.
- The energy UI and supporting files were subsequently deleted in `eeb1af587`, 8 July 2026, “remove non-core workbenches and fix validation environment”.
- The initial recovery matched all 15 historical Git blobs. The viewport now has a bounded OpenStudio geometry extension; the unused React Three Fiber smoke-test branch was removed. The remaining recovered feature files retain their original contents. None of this is the rejected October NRGSIM implementation.
- The read-only Desktop `nrgsim-master` and `nrgsimapp-master` archives both inform the inspector. The earlier Site/Geometry/Facade/Activity template supplies coherent controls; the later archive contributes the separate wall/roof direction. Its empty HVAC panel and commented run markup are not restored as functionality. Schedule selection is retained; a schedule editor is deferred. The owner's GitHub references are [nrgsim](https://github.com/nrgsim/nrgsim) and [nrgsimapp](https://github.com/nrgsim/nrgsimapp).

## Contents

- `client/src/components/energy/EnergyFacadeSurface.tsx`: existing Three.js viewport, selection and engineering input interface.
- `client/src/features/energy/`: original solar calculations, parameters, validation and jEPlus run-preparation logic.
- `client/src/types/workspaceActions.ts`: original feature action and parameter contracts.
- `client/src/features/modelWizard/pascal/`: historical adapter source, preserved as part of the original snapshot; it does not install or require a Pascal editor for the Three.js viewport.
- `services/energyplus-runner/`: original joblist-preparation runner and its historical README.

## Current boundary

`NrgsimWorkspace` mounts in the existing Project companion and portals its controls into the one shared Inspector. It adds no chat or standalone server. The backend requires Project ownership before forwarding to Python rails. The local installation configuration deliberately enables one Project only; changing a URL cannot read another Project's models.

Python rails serializes writes per Project. Each operation uses the already installed OpenStudio environment and unchanged upstream MCP. Saved OSM bytes are engineering authority; cached geometry is derived and hash-checked. These are transaction-scoped MCP sessions, not a newly granted persistent Modeling Card session. Saved Cards, prompts and grants are unchanged.

`workspace.local.json` (ignored) selects the existing installation, source OSM, weather and Project. Generated files are retained under `.local/projects/<project-id>/` (ignored). Baseline, Comparison 1 and Comparison 2 have separate OSM files. Each simulation receives its own frozen OSM and records version, weather hash, native diagnostics and output hashes. SQL files are opened read-only.

The baseline is preserved; comparison slots are editable. Select the Building/Space for dimensions, activity, lighting and simulation, or a Surface/SubSurface for its assembly, material properties and openings. Sliders have exact numeric entries; categorical choices refer to actual model resources. Details disclosures contain secondary properties, not separate model state. Each edit stages a candidate, saves/reopens through the unchanged MCP, checks authoritative readback and rechecks the source revision before publication. Stale revisions and invalid values are refused.

Local material edits copy the selected Construction and Material and reassign the selected face. Local load-definition edits do not add load instances. Schedule selectors assign compatible-unit schedules already in the model, with SDK validation. Hosted overhang/fin ratios produce actual ShadingSurfaces; saved host references identify the generated shade, while geometry remains authoritative. The WWR operation refuses replacement of a window with hosted shades until those projections are cleared.

HVAC inspector work is explicitly deferred to a separate owner discussion. Existing Ideal Loads, thermostat schedules and zone assignments remain in the OSM and continue to run; no new HVAC control is presented in this pass.

Shared connections are limited to the Agent Builder composition/rail, client TypeScript inclusion, authenticated backend route registration and Python router registration. Application reload uses the existing root launcher. No new Docker container or runtime is installed.

## Implemented single-zone boundary

- `services/openstudio_block.py`: creates a new empty current-version OSM, invokes the existing MCP floorprint and Thermal Zone tools, saves it, and reads authoritative vertices/handles through the SDK. It accepts an existing MCP ClientSession; it creates no MCP host, aliases, registry or agent runtime.
- `services/test_openstudio_block.py`: exercises the real installed stdio MCP server in isolated input/run directories. It proves floor area/volume, six surfaces, a real glazing edit, save/reopen, unchanged surface handles, rejection behavior and triangle areas with a window hole.
- `client/src/features/energy/openStudioGeometry.ts`: builds Three.js meshes from the accepted Python projection. An empty model remains empty; there is no example-building substitution.
- `OpenStudioBlockScene`, exported by `EnergyFacadeSurface.tsx`: reuses the recovered viewport/camera interaction with actual OSM geometry and exact handle selection. It adds no inspector or chat. The recovered default component's historical preview panels are not used by this export and are not simulation evidence.

`openstudio_block.py` by itself creates geometry only. The separate `solar_shoebox.py` and `run_solar_shoebox.py` retain the user's Office/No-PCM recipe and its proven annual EnergyPlus path. The current workspace opens that explicitly configured saved model; it does not invent a building or import a template silently. No jEPlus or JESS job is submitted by this first workspace.

## Results

`services/results.py` discovers exact SQL channel identities (including NULL-key facility meters) and separates weather environments, frequency and units. Comparisons use recorded local-standard interval-end time, retain nulls, and refuse mismatched engine/weather identities. The viewer displays one selected quantity for up to three cases on shared scales: full-period hourly time series, average daily profiles, and day/hour heat maps, with a chosen time window and building/results split. Historical run selection reads its frozen geometry and inputs, not the current edited model. Output requests come from an actual prior RDD and remain distinct from channels recorded in SQL. An output absent in another case remains missing.

`weather_view.py` reads the selected OSM's EPW and simulation calendar, returning dates and hourly astronomical directions from NOAA's published solar equations. This is a derived display calculation, not EnergyPlus output. No arbitrary weather values or simulated data are substituted. It is not yet a validated match to EnergyPlus's solar-position calculation.

The current demo defaults to a pinned baseline and one comparison with a common 26-variable hourly output set, including Fanger PMV/PPD. The third historical glazing case remains available for channels it actually recorded. Study output changes apply to the pair with explicit revisions and saved readback; no engineering value is silently changed by selecting outputs. Fanger preparation is separate and explicitly owner-approved. The current scope and exact evidence are in `CoderReport.md`.

Daily/monthly energy stacks derive from matching recorded heating/cooling or lighting/equipment channels, never by adding delivered HVAC thermal energy to equipment electricity. Period totals and baseline-relative changes are calculated outside SQL; unknown totals and zero-baseline percentages remain undefined. Full schedule editing and HVAC authoring are deferred; there are no placeholder controls for them.

DView reference: official WEX v1.2.0, commit `c9aae9176a5bc630beab9da376b1e43778846ce9`, especially `src/dview/dvfilereader.cpp`. The source archive is retained in Desktop `NRGSIM/dview-reference`; its SHA-256 is `d1cadfd18098147cf27dd5024bd7ca5f942c8732c66e02dcb15512e1f4f12d02`. All 1,480 extracted regular files matched the archive. The web chart is a bounded implementation using that source/interaction reference, not an embedded or fully ported wxWidgets DView application. Binary-to-source build equivalence has not been established.

This does not implement PCM node/depth matching, surface heatmaps, general drawing, full-building editing, map reconstruction, parametrics or optimization. A changed model can retain an older run; the inspector marks that result as an earlier saved version rather than claiming the old SQL belongs to the current geometry.

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

First complete the visible edit/run/compare loop. Then pair the remaining original controls with supported OpenStudio operations, followed by jEPlus study controls and general-building geometry. Do not silently change the selected OpenStudio authority or represent unimplemented controls as working.

Historical READMEs and incomplete adapter code in this snapshot describe that old revision, not new implementation authority. Reconnection is a separate bounded change; do not restore the historical whole-platform shell over the current application.
