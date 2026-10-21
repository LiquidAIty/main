# Pascal Adapter Target

This folder is the bridge target for adapting Pascal building-editor data into
LiquidAIty's Model Wizard object hierarchy.

No Pascal runtime is imported here. The adapter accepts Pascal-like plain data so
the client can prepare for Pascal geometry without embedding a second app.

Mapping direction:

- Pascal scene/root nodes -> Model Wizard Project / Site
- Pascal building -> Building
- Pascal level -> Shell / Block / Level
- Pascal zone -> Zone
- Pascal wall/slab/roof -> Surface
- Pascal window/door -> Opening
- Pascal dimensions -> measured/current editable values
- Pascal parentId/children -> Model Wizard tree relationships
- Pascal vertices/polygons -> future EnergyPlus-compatible geometry surfaces

The current Solar Shoebox remains the first Shell / Block primitive. Future
Pascal imports should map into the same tree, inspector, measured-value sliders,
and EnergyPlus/jEPlus prep manifest flow.
