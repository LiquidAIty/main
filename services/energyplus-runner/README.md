# Legacy NRGSIM Runner Preservation

This folder preserves the legacy NRGSIM Python runner that mapped UI parameters
into a jEPlus `joblist.csv`.

It expects an old jEPlus Box/Facade project template when running a real
simulation. Those EnergyPlus/jEPlus files may be missing in this repository.
The current goal is preservation of parameter mapping and dry-run joblist
generation, not wiring EnergyPlus execution into the UI.

Dry-run smoke command from the repo root:

```bash
python services/energyplus-runner/legacy_nrgsim_runner.py --sample --dry-run --write-joblist --simulations-dir artifacts/energyplus-runner-smoke
```

Dry-run does not call Java, JESS, jEPlus, or EnergyPlus.
