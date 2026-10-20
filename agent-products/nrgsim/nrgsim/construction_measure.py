# Entity: Construction Editing
# Relationship: This explicitly packages the construction operation through OpenStudio MCP's existing ModelMeasure authoring API.
"""Project-local measure installation; never invoked by application startup."""
from __future__ import annotations

import hashlib
from pathlib import Path
import shutil

from .launch import host_path
from .session import checked


_RUN_BODY = """        import importlib.util
        import json
        from pathlib import Path
        source = Path(__file__).parent / "resources" / "constructions.py"
        spec = importlib.util.spec_from_file_location("construction_edit_resource", source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        try:
            outcome = module.edit_surface_construction(
                model, surface_handle, expected_construction_handle,
                json.loads(layer_edits_json), construction_name)
        except (ValueError, RuntimeError) as error:
            runner.registerError(str(error))
            return False
        # Native MCP bounds this message. Return identities only; detailed
        # values must be reread from the accepted OSM, not parsed from a log.
        runner.registerFinalCondition(json.dumps({
            "surface": outcome["surface"]["handle"],
            "construction": outcome["after"]["construction"]["handle"],
            "copiedMaterials": len(outcome["copiedMaterials"]),
        }, separators=(",", ":")))
        return True"""


def definition() -> dict:
    """Return arguments for native create_measure, not a new MCP tool definition."""
    source = Path(__file__).with_name("constructions.py")
    digest = hashlib.sha256(source.read_bytes() + _RUN_BODY.encode("utf-8")).hexdigest()
    descriptions = {
        "surface_handle": "The selected Surface's handle in the active OpenStudio Model.",
        "expected_construction_handle": "The effective Construction handle when the inputs were read.",
        "layer_edits_json": (
            "JSON list of existing layer indices, expected material_handle, new name and properties. "
            "Lengths use m; conductivity W/(m K); density kg/m3; specific heat J/(kg K); resistance m2 K/W."
        ),
        "construction_name": "Name of the copied Construction assigned only to the selected Surface.",
    }
    return {
        "name": f"construction_layers_{digest[:16]}",
        "description": "Apply a local opaque Construction layer exception without changing shared originals.",
        "modeler_description": "Explicit SDK cloning and assignment. Unsupported material properties and interzone edits are refused.",
        "language": "Python", "measure_type": "ModelMeasure",
        "run_body": _RUN_BODY,
        "arguments": [
            {"name": name, "display_name": name.replace("_", " ").capitalize(),
             "description": description, "type": "String", "required": True}
            for name, description in descriptions.items()
        ],
    }


async def install(session) -> str:
    """Install one content-addressed measure into an explicitly supplied Project session."""
    await session.start()
    request = definition()
    directory = session.root / "measures" / "local" / "custom" / request["name"]
    source = Path(__file__).with_name("constructions.py")
    if directory.exists():
        # Never let native create_measure's overwrite behavior replace edited or
        # user-authored content. This is an explicit one-time installation.
        raise ValueError(f"Measure destination already exists: {directory.name}")
    result = checked(await session.raw("create_measure", request))
    installed = host_path(session.root, result["measure_dir"])
    if installed != directory.resolve():
        raise RuntimeError("OpenStudio returned an unexpected measure installation path")
    resources = installed / "resources"
    resources.mkdir(exist_ok=True)
    shutil.copyfile(source, resources / "constructions.py")
    if (resources / "constructions.py").read_bytes() != source.read_bytes():
        raise RuntimeError("Construction measure resource copy did not match its source")
    return result["measure_dir"]
