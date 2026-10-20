# Entity: Construction Editing
# Relationship: This operates on staged OpenStudio objects and copies a Surface's assembly without changing shared source resources.
"""Explicit, read-only inspection and local edits for opaque Construction layers.

Execute edits inside an OpenStudio ModelMeasure: the upstream runner owns the
candidate model and publishes it only on successful measure completion. Nothing
in this module stores an alternative engineering model or registers MCP tools.
"""
from __future__ import annotations

import math
from typing import Any


# A bounded editor contract, not introspection of arbitrary SDK methods.
# Bounds and units match EnergyPlus 25.2 Material/NoMass/AirGap definitions.
_ABSORPTANCE = {
    "thermalAbsorptance": ("setThermalAbsorptance", "", 0.0, False, 0.99999),
    "solarAbsorptance": ("setSolarAbsorptance", "", 0.0, True, 1.0),
    "visibleAbsorptance": ("setVisibleAbsorptance", "", 0.0, True, 1.0),
}
_FIELDS = {
    "StandardOpaqueMaterial": {
        "thickness": ("setThickness", "m", 0.0, False, None),
        "conductivity": ("setConductivity", "W/(m·K)", 0.0, False, None),
        "density": ("setDensity", "kg/m³", 0.0, False, None),
        "specificHeat": ("setSpecificHeat", "J/(kg·K)", 100.0, True, None),
        **_ABSORPTANCE,
    },
    "MasslessOpaqueMaterial": {
        "thermalResistance": ("setThermalResistance", "m²·K/W", 0.001, True, None),
        **_ABSORPTANCE,
    },
    "AirGap": {
        "thermalResistance": ("setThermalResistance", "m²·K/W", 0.0, False, None),
    },
}


def _handle(obj) -> str:
    return str(obj.handle()).strip("{}")


def _surface_and_construction(model, surface_handle: str):
    import openstudio

    found = model.getSurface(openstudio.toUUID(surface_handle))
    if not found.is_initialized():
        raise ValueError("Surface is not present in this OpenStudio model")
    surface = found.get()
    effective = surface.construction()
    if not effective.is_initialized():
        raise ValueError("Surface has no effective Construction")
    construction = effective.get().to_Construction()
    if not construction.is_initialized():
        raise ValueError("This editor requires an ordinary layered Construction")
    return surface, construction.get()


def _material_type(material):
    for kind in _FIELDS:
        found = getattr(material, f"to_{kind}")()
        if found.is_initialized():
            return kind, found.get()
    return material.iddObjectType().valueName(), material


def _name(value: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 160:
        raise ValueError(f"{label} requires a name of 1–160 characters")
    if any(ord(character) < 32 for character in value):
        raise ValueError(f"{label} cannot contain control characters")
    return value.strip()


def _validate_value(kind: str, field: str, value: Any, material):
    if field == "roughness" and kind != "AirGap" and kind in _FIELDS:
        if value not in list(material.roughnessValues()):
            raise ValueError("Roughness must be an OpenStudio roughness choice")
        return "setRoughness", value
    contract = _FIELDS.get(kind, {}).get(field)
    if contract is None:
        raise ValueError(f"{field} is not a supported input for {kind}")
    setter, unit, minimum, inclusive, maximum = contract
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{field} requires a finite number in {unit or 'dimensionless units'}")
    if value < minimum or (not inclusive and value == minimum):
        relation = "at least" if inclusive else "greater than"
        raise ValueError(f"{field} must be {relation} {minimum} {unit}".strip())
    if maximum is not None and value > maximum:
        raise ValueError(f"{field} must not exceed {maximum}")
    return setter, float(value)


def _value(value):
    # Some MasslessOpaqueMaterial getters return OptionalDouble. Preserve unset;
    # do not substitute zero or a guessed default.
    if hasattr(value, "is_initialized"):
        return value.get() if value.is_initialized() else None
    return value


def inspect_surface_construction(model, surface_handle: str) -> dict:
    """Read only named SDK getters; no no-argument method enumeration."""
    surface, construction = _surface_and_construction(model, surface_handle)
    layers = []
    resistances = []
    for index, material in enumerate(construction.layers()):
        kind, typed = _material_type(material)
        properties = {}
        for field, (_, unit, minimum, inclusive, maximum) in _FIELDS.get(kind, {}).items():
            properties[field] = {
                "value": _value(getattr(typed, field)()), "unit": unit,
                "minimum": minimum, "minimumInclusive": inclusive, "maximum": maximum,
            }
            if field in _ABSORPTANCE:
                properties[field]["isDefaulted"] = getattr(
                    typed, f"is{field[0].upper()}{field[1:]}Defaulted")()
        if kind in _FIELDS and kind != "AirGap":
            properties["roughness"] = {"value": typed.roughness(), "choices": list(typed.roughnessValues())}
        resistance = _value(typed.thermalResistance()) if kind in _FIELDS else None
        resistances.append(resistance)
        layers.append({
            "index": index, "handle": _handle(material), "name": material.nameString(),
            "type": kind, "properties": properties, "thermalResistance": resistance,
            "editable": kind in _FIELDS and not any(
                obj.iddObject().type().valueName().startswith("OS_MaterialProperty_")
                for obj in material.sources()),
        })
    return {
        "surface": {"handle": _handle(surface), "name": surface.nameString()},
        "construction": {"handle": _handle(construction), "name": construction.nameString()},
        "isConstructionDefaulted": surface.isConstructionDefaulted(),
        "editable": construction.isOpaque() and surface.outsideBoundaryCondition() != "Surface"
                    and not surface.adjacentSurface().is_initialized(),
        "layerOrder": "outside-to-inside", "layers": layers,
        # This is the material-layer resistance only, not an assembly U-factor
        # including surface films and not a simulation result.
        "layerResistance": sum(resistances) if all(value is not None for value in resistances) else None,
        "layerResistanceUnit": "m²·K/W",
    }


def edit_surface_construction(
    model,
    surface_handle: str,
    expected_construction_handle: str,
    layer_edits: list[dict],
    construction_name: str,
) -> dict:
    """Apply a local exception to a staged Model using SDK clone/setLayers/assignment.

    Each edit names an existing zero-based layer index, its expected material
    handle, a new material name, and explicit supported properties in SI units.
    Unknown material classes remain untouched; they cannot be edited here.
    """
    import openstudio

    surface, original = _surface_and_construction(model, surface_handle)
    if not isinstance(expected_construction_handle, str) or _handle(original) != expected_construction_handle.strip("{}"):
        raise ValueError("Construction changed since the inputs were read")
    if surface.outsideBoundaryCondition() == "Surface" or surface.adjacentSurface().is_initialized():
        raise ValueError("Interzone construction editing requires a coordinated edit of both Surface sides")
    if not original.isOpaque():
        raise ValueError("This operation edits opaque Construction layers only")
    new_name = _name(construction_name, "Construction")
    original_layers = list(original.layers())
    if not isinstance(layer_edits, list) or not layer_edits:
        raise ValueError("At least one material-layer edit is required")
    checked_edits = []
    seen = set()
    for edit in layer_edits:
        if not isinstance(edit, dict) or set(edit) != {"index", "material_handle", "name", "properties"}:
            raise ValueError("Each layer edit requires index, material_handle, name, and properties")
        index = edit["index"]
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(original_layers):
            raise ValueError("Layer index is outside the current Construction")
        if index in seen:
            raise ValueError("A material layer cannot be edited twice in one operation")
        seen.add(index)
        source = original_layers[index]
        if not isinstance(edit["material_handle"], str) or _handle(source) != edit["material_handle"].strip("{}"):
            raise ValueError("Material layer changed since the inputs were read")
        kind, typed = _material_type(source)
        if kind not in _FIELDS:
            raise ValueError(f"Editing {kind} is not supported")
        # Associated PCM/moisture/etc. objects need their own verified copy
        # semantics. Do not silently drop them while cloning a basic material.
        if any(obj.iddObject().type().valueName().startswith("OS_MaterialProperty_") for obj in source.sources()):
            raise ValueError("Material has associated MaterialProperty objects; local copying is not supported")
        properties = edit["properties"]
        if not isinstance(properties, dict) or not properties:
            raise ValueError("A layer edit must change at least one supported input")
        setters = [(field, *_validate_value(kind, field, value, typed)) for field, value in properties.items()]
        checked_edits.append((index, source, kind, _name(edit["name"], "Material"), setters))

    before = inspect_surface_construction(model, surface_handle)
    original_objects = {
        _handle(obj): str(obj.toIdfObject())
        for obj in model.getModelObjects() if _handle(obj) != _handle(surface)
    }
    copied = original.clone(model).to_Construction()
    if not copied.is_initialized():
        raise RuntimeError("OpenStudio did not copy the Construction")
    replacement = copied.get()
    if not replacement.setName(new_name).is_initialized():
        raise ValueError("OpenStudio rejected the Construction name")
    layers = openstudio.model.MaterialVector()
    for material in original_layers:
        layers.append(material)
    changed_materials = []
    for index, source, kind, material_name, setters in checked_edits:
        copied_material = getattr(source.clone(model), f"to_{kind}")()
        if not copied_material.is_initialized():
            raise RuntimeError(f"OpenStudio did not copy {kind}")
        material = copied_material.get()
        if not material.setName(material_name).is_initialized():
            raise ValueError("OpenStudio rejected the Material name")
        for field, setter, value in setters:
            if getattr(material, setter)(value) is False:
                raise ValueError(f"OpenStudio rejected {field}")
        layers[index] = material
        changed_materials.append({
            "index": index, "source": _handle(source), "copy": _handle(material),
        })
    if not replacement.layersAreValid(layers):
        raise ValueError("The resulting material order is not a valid OpenStudio Construction")
    if not replacement.setLayers(layers):
        raise ValueError("OpenStudio rejected the copied Construction's layers")
    if not surface.setConstruction(replacement):
        raise ValueError("OpenStudio rejected the Surface construction assignment")

    after_objects = {_handle(obj): str(obj.toIdfObject()) for obj in model.getModelObjects()}
    if any(after_objects.get(handle) != value for handle, value in original_objects.items()):
        raise RuntimeError("Local editing unexpectedly changed an original shared object")
    after = inspect_surface_construction(model, surface_handle)
    return {
        "surface": after["surface"], "before": before, "after": after,
        "copiedMaterials": changed_materials, "originalObjectsUnchanged": True,
    }
