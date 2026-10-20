"""Explicit real-MCP development probe, not saved-Card or browser acceptance."""
# Entity: Modeling Verification
# Relationship: This probe checks the real upstream creation and projection path without claiming UI or saved-Card acceptance.
import asyncio
import json
from datetime import datetime, timezone
from nrgsim.session import ProjectSession, checked, payload


async def main():
    project = ProjectSession("4316df04-67de-43b4-94f2-b84fcd789801")
    try:
        await project.start()
        print(json.dumps({"tools": len(project.tools)}), flush=True)
        await project.human("new", {"label": "Development probe office"}, project.state["revision"])
        empty = await project.view()
        assert empty["projection"]["selectableHandles"] == []
        assert not any(obj["type"] == "Space" for obj in empty["projection"]["objects"].values())
        print("Empty-model initialization and read-only projection verified.", flush=True)
        print("Explicit upstream SDK starter recipe; not an Appendix G baseline.", flush=True)
        checked(await project.call("create_baseline_osm", {
            "name": "NRGSIM Office", "num_floors": 1,
            "ashrae_sys_num": "03", "wwr": 0.3,
        }, actor="development-probe"))
        view = await project.view()
        print(json.dumps({"revision": view["revision"], "projection": {
            "objects": len(view["projection"]["objects"]),
            "selectable": len(view["projection"]["selectableHandles"]),
            "building": view["projection"]["building"],
        }}), flush=True)
        target = next(obj for obj in view["projection"]["objects"].values() if obj["type"] == "LightsDefinition")
        lights = checked(await project.call("get_object_fields", {
            "object_type": "LightsDefinition", "object_handle": target["handle"],
        }, actor="development-probe"))
        print(json.dumps({"lights": lights["name"], "wattsperSpaceFloorArea": lights["properties"].get("wattsperSpaceFloorArea")}), flush=True)
        await project.human("select", {"handle": target["handle"]}, project.state["revision"])
        readback = await project.human("edit", {
            "object_type": "LightsDefinition", "object_handle": target["handle"],
            "property_name": "wattsperSpaceFloorArea", "value": 8.0,
        }, project.state["revision"])
        assert readback["readback"]["properties"]["wattsperSpaceFloorArea"]["value"] == 8.0
        checked(await project.call("set_object_property", {
            "object_type": "LightsDefinition", "object_handle": target["handle"],
            "property_name": "wattsperSpaceFloorArea", "value": 7.5,
        }, actor="development-probe"))
        saved = await project.human("save", {"label": "Development probe office"}, project.state["revision"])
        await project.human("reopen", {"modelId": saved["id"]}, project.state["revision"])
        reopened = checked(await project.call("get_object_fields", {
            "object_type": "LightsDefinition", "object_handle": target["handle"],
        }, actor="development-probe"))
        assert reopened["properties"]["wattsperSpaceFloorArea"]["value"] == 7.5
        refreshed = await project.view()
        relationship_fields = ("type", "space", "surface", "thermalZone", "buildingStory", "construction", "layers")
        relationships = lambda projection: {
            handle: {key: obj.get(key) for key in relationship_fields}
            for handle, obj in projection["objects"].items()
        }
        assert relationships(view["projection"]) == relationships(refreshed["projection"])
        proof = {
            "at": datetime.now(timezone.utc).isoformat(),
            "proofTier": "direct MCP and inspector-handler test; not saved-Card or browser acceptance",
            "emptyModelVerified": True,
            "sdkVersion": refreshed["projection"]["sdkVersion"],
            "summary": refreshed["projection"].get("summary"),
            "selectableHandles": len(refreshed["projection"]["selectableHandles"]),
            "relationshipsPreserved": True,
            "lightingPowerDensityWm2": 7.5,
            "savedOSM": saved,
            "osmPath": str(project.working.parent / f'{saved["id"]}.osm'),
            "simulationRun": False,
        }
        (project.root / "proof.json").write_text(json.dumps(proof, indent=2), encoding="utf-8")
        print(json.dumps({"persistence": "verified", "wattsPerSquareMetre": 7.5, "savedOSM": saved}), flush=True)
    finally:
        await project.close()


asyncio.run(main())
