# NRGSIM

The owner's existing Three.js modeling interface, recovered from the April 2026 platform source, with a contained Python/OpenStudio MCP single-zone geometry connection. It is not mounted in the running LiquidAIty application yet.

## Source

- Git commit: `01c4dc26dd809f82f184b9c812efee3134ae62ef`, 27 April 2026, “Add telescope and energy workspace pipeline”. This is the nearby checkpoint located so far; an exact April 23 snapshot has not been established.
- The energy UI and supporting files were subsequently deleted in `eeb1af587`, 8 July 2026, “remove non-core workbenches and fix validation environment”.
- The initial recovery matched all 15 historical Git blobs. The viewport now has a bounded OpenStudio geometry extension; the unused React Three Fiber smoke-test branch was removed. The remaining recovered feature files retain their original contents. None of this is the rejected October NRGSIM implementation.

## Contents

- `client/src/components/energy/EnergyFacadeSurface.tsx`: existing Three.js viewport, selection and engineering input interface.
- `client/src/features/energy/`: original solar calculations, parameters, validation and jEPlus run-preparation logic.
- `client/src/types/workspaceActions.ts`: original feature action and parameter contracts.
- `client/src/features/modelWizard/pascal/`: historical adapter source, preserved as part of the original snapshot; it does not install or require a Pascal editor for the Three.js viewport.
- `services/energyplus-runner/`: original joblist-preparation runner and its historical README.

## Current boundary

The recovered feature is not mounted in the current LiquidAIty workspace. Host callbacks, authenticated Project ownership and workspace integration still need an approved shared-file change. This folder is a contained feature package, not a second standalone app. Three.js and its types are pinned locally; the platform package/lock, services and saved Cards are unchanged. No shared application build or reload was performed.

The owner confirms that development stopped before the EnergyPlus connection. Recovery acceptance therefore starts with the existing modeling UI and its real controls, not a claim of completed simulations.

## Implemented single-zone boundary

- `services/openstudio_block.py`: creates a new empty current-version OSM, invokes the existing MCP floorprint and Thermal Zone tools, saves it, and reads authoritative vertices/handles through the SDK. It accepts an existing MCP ClientSession; it creates no MCP host, aliases, registry or agent runtime.
- `services/test_openstudio_block.py`: exercises the real installed stdio MCP server in isolated input/run directories. It proves floor area/volume, six surfaces, a real glazing edit, save/reopen, unchanged surface handles, rejection behavior and triangle areas with a window hole.
- `client/src/features/energy/openStudioGeometry.ts`: builds Three.js meshes from the accepted Python projection. An empty model remains empty; there is no example-building substitution.
- `OpenStudioBlockScene`, exported by `EnergyFacadeSurface.tsx`: reuses the recovered viewport/camera interaction with actual OSM geometry and exact handle selection. It adds no inspector or chat. The recovered default component's historical preview panels are not used by this export and are not simulation evidence.

This model is a geometry/control proof, not a simulation-ready building: constructions, loads, schedules, HVAC, weather and EnergyPlus execution are not supplied by this step. No jEPlus or JESS job was submitted.

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

The host must pass `geometry`, `selectedHandle` and a real selection callback to `OpenStudioBlockScene`. Geometry refresh follows accepted OSM snapshots, not optimistic slider deformation. Loaded browser/inspector/saved-Card acceptance remains separate.

## Current direction

Bring this interface back first, with the owner's existing workspace and inspector. Retain Three.js. Pascal is no longer a prerequisite; Fabric.js and Text2CAD are not new dependencies. DesignBuilder remains an interaction reference, not a source-conversion target.

After UI recovery is accepted, connect the actual engineering operations and EnergyPlus/jEPlus workflow, then extend from one zone to multiple zones and real comparative results. Do not silently change the previously selected OpenStudio engineering authority or invent results while reconnecting it.

Historical READMEs and incomplete adapter code in this snapshot describe that old revision, not new implementation authority. Reconnection is a separate bounded change; do not restore the historical whole-platform shell over the current application.
