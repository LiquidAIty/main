"""Exercise the real installed MCP/SDK from an empty scratch model, never a template."""
# Entity: Building Authoring Verification
# Relationship: This development proof checks actual native geometry and edit readback without claiming browser or saved-Card acceptance.
import asyncio
import json
from uuid import uuid4

from nrgsim.session import ProjectSession, checked


async def main():
    project = ProjectSession(str(uuid4()))
    evidence = {"projectId": project.project_id, "kind": "real-mcp-development-proof", "steps": []}

    async def apply(arguments):
        reply = await project.human("author", arguments, project.state["revision"])
        view = await project.view()
        evidence["steps"].append({"arguments": arguments, "result": reply,
                                  "summary": view["projection"]["summary"]})
        print(json.dumps({"operation": arguments["operation"], "outcome": reply["outcome"]}), flush=True)
        return reply, view

    try:
        await project.human("new", {"label": "Drawn geometry proof"}, 0)
        initial = await project.view()
        assert initial["projection"]["summary"]["spaces"] == 0
        story, _ = await apply({"operation": "create_story", "name": "Ground Floor", "elevation": 0, "height": 3})
        story_id = story["outcome"]["handle"]
        first, view = await apply({
            "operation": "draw_space", "name": "Office East", "story": story_id,
            "points": [[0, 0], [10, 0], [10, 8], [0, 8]], "height": 3,
            "createThermalZone": True,
        })
        first_id = first["outcome"]["handle"]
        assert view["projection"]["objects"][first_id]["floorArea"] == 80
        assert view["projection"]["objects"][first_id]["buildingStory"] == story_id
        assert view["projection"]["objects"][first_id]["thermalZone"]
        _, view = await apply({
            "operation": "draw_space", "name": "Office West", "story": story_id,
            "points": [[-10, 0], [0, 0], [0, 8], [-10, 8]], "height": 3,
            "createThermalZone": True,
        })
        assert view["projection"]["summary"]["spaces"] == 2
        assert sum(obj.get("outsideBoundaryCondition") == "Surface"
                   for obj in view["projection"]["objects"].values()) == 2
        upper, _ = await apply({"operation": "create_story", "name": "Upper Floor", "elevation": 3, "height": 3})
        upper_space, view = await apply({
            "operation": "draw_space", "name": "Upper Office", "story": upper["outcome"]["handle"],
            "points": [[0, 0], [10, 0], [10, 8], [0, 8]], "height": 3,
            "createThermalZone": True,
        })
        assert view["projection"]["summary"]["spaces"] == 3
        assert view["projection"]["summary"]["thermalZones"] == 3
        assert sum(obj.get("outsideBoundaryCondition") == "Surface"
                   for obj in view["projection"]["objects"].values()) == 4
        upper_id = upper_space["outcome"]["handle"]
        _, view = await apply({
            "operation": "rename", "type": "Space", "handle": upper_id, "name": "Upper Studio",
        })
        assert view["projection"]["objects"][upper_id]["name"] == "Upper Studio"
        saved = await project.human("save", {"label": "Drawn two-story office"}, project.state["revision"])
        # Close the actual MCP process, then reread the saved authoritative OSM
        # through a new process; an in-memory echo cannot satisfy this assertion.
        await project.close()
        project = ProjectSession(project.project_id)
        reopened = await project.view()
        assert reopened["projection"]["objects"][upper_id]["name"] == "Upper Studio"
        assert reopened["projection"]["summary"]["spaces"] == 3
        readback = checked(await project.call("get_space_details", {
            "space_name": "Upper Studio",
        }, actor="development-proof"))
        assert readback["space"]["name"] == "Upper Studio"
        assert readback["space"]["handle"].strip("{}") == upper_id
        await project.human("reopen", {"modelId": saved["id"]}, project.state["revision"])
        evidence.update(saved=saved, projection=view["projection"])
        evidence["persistedAcrossSessionRestart"] = True
        destination = project.root / "authoring-proof.json"
        destination.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        print(json.dumps({"ok": True, "evidence": str(destination), "saved": saved}), flush=True)
    except Exception as error:
        evidence["error"] = str(error)
        (project.root / "authoring-proof.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        print(json.dumps({"ok": False, "project": str(project.root), "error": str(error)}), flush=True)
        raise
    finally:
        await project.close()


if __name__ == "__main__":
    asyncio.run(main())
