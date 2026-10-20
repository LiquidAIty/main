# Entity: Modeling Verification
# Relationship: These isolated unit tests check session coordination and refusals; probe.py separately exercises the real upstream.
import asyncio
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nrgsim import session as module
from mcp.types import CallToolResult, TextContent, Tool


def result(value):
    return CallToolResult(content=[TextContent(type="text", text=json.dumps(value))], structuredContent=value)


class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root_patch = patch.object(module, "DATA_ROOT", Path(self.directory.name))
        self.root_patch.start()
        self.session = module.ProjectSession("4316df04-67de-43b4-94f2-b84fcd789801")
        self.session.start = AsyncMock()

    async def asyncTearDown(self):
        self.root_patch.stop()
        self.directory.cleanup()

    async def test_calls_are_serialized_for_one_project(self):
        self.session.tools["get_model_summary"] = Tool(name="get_model_summary", inputSchema={"type": "object", "properties": {}})
        active = 0
        maximum = 0

        async def raw(*args):
            nonlocal active, maximum
            active += 1
            maximum = max(maximum, active)
            await asyncio.sleep(0.01)
            active -= 1
            return result({"ok": True})

        self.session.raw = raw
        await asyncio.gather(*(self.session.call("get_model_summary", {}, actor="test") for _ in range(4)))
        self.assertEqual(maximum, 1)

    async def test_stale_human_edit_refused_before_upstream_write(self):
        self.session.state["revision"] = 3
        self.session.raw = AsyncMock()
        with self.assertRaisesRegex(ValueError, "model_changed"):
            await self.session.human("edit", {}, 2)
        self.session.raw.assert_not_called()

    async def test_cancelled_caller_does_not_unlock_active_upstream_call(self):
        self.session.tools["get_model_summary"] = Tool(name="get_model_summary", inputSchema={"type": "object", "properties": {}})
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def raw(*args):
            calls.append(args)
            entered.set()
            await release.wait()
            return result({"ok": True})

        self.session.raw = raw
        first = asyncio.create_task(self.session.call("get_model_summary", {}, actor="test"))
        await entered.wait()
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        second = asyncio.create_task(self.session.call("get_model_summary", {}, actor="test"))
        await asyncio.sleep(0)
        self.assertEqual(len(calls), 1)
        release.set()
        await second
        self.assertEqual(len(calls), 2)

    async def test_wrong_selection_refused(self):
        self.session.state["selection"] = "current"
        self.session.raw = AsyncMock()
        with self.assertRaisesRegex(ValueError, "selection_changed"):
            await self.session.human("edit", {
                "object_type": "ThermalZone", "property_name": "multiplier", "object_handle": "stale", "value": 2,
            }, 0)
        self.session.raw.assert_not_called()

    async def test_cancelled_human_caller_keeps_edit_serialized_until_readback(self):
        self.session.state["selection"] = "zone"
        self.session._checkpoint = AsyncMock()
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def raw(name, arguments):
            calls.append(name)
            entered.set()
            await release.wait()
            return result({"ok": True, "properties": {"multiplier": {"value": 2}}})

        self.session.raw = raw
        arguments = {"object_type": "ThermalZone", "property_name": "multiplier", "object_handle": "zone", "value": 2}
        first = asyncio.create_task(self.session.human("edit", arguments, 0))
        await entered.wait()
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        second = asyncio.create_task(self.session.human("edit", arguments, 0))
        await asyncio.sleep(0)
        self.assertEqual(calls, ["set_object_property"])
        release.set()
        await second
        self.assertEqual(calls, ["set_object_property", "get_object_fields", "set_object_property", "get_object_fields"])

    async def test_shared_material_edit_not_exposed_as_local_exception(self):
        self.session.raw = AsyncMock()
        with self.assertRaisesRegex(ValueError, "property_not_supported"):
            await self.session.human("edit", {
                "object_type": "StandardOpaqueMaterial", "object_handle": "material",
                "property_name": "conductivity", "value": 0.1,
            }, 0)
        self.session.raw.assert_not_called()

    async def test_name_cannot_redirect_selected_handle_edit(self):
        self.session.raw = AsyncMock()
        with self.assertRaisesRegex(ValueError, "arguments_invalid"):
            await self.session.human("edit", {
                "object_type": "LightsDefinition", "object_handle": "selected",
                "property_name": "wattsperSpaceFloorArea", "value": 8,
                "object_name": "a different shared definition",
            }, 0)
        self.session.raw.assert_not_called()

    async def test_human_edit_has_authoritative_readback(self):
        self.session.state["selection"] = "zone"
        self.session.raw = AsyncMock(side_effect=[
            result({"ok": True}),
            result({"ok": True, "properties": {"multiplier": {"value": 2}}}),
        ])
        self.session._checkpoint = AsyncMock()
        output = await self.session.human("edit", {
            "object_type": "ThermalZone", "property_name": "multiplier", "object_handle": "zone", "value": 2,
        }, 0)
        self.assertEqual(output["readback"]["properties"]["multiplier"]["value"], 2)
        self.assertEqual(self.session.raw.call_args_list[1].args[0], "get_object_fields")

    async def test_native_failed_result_is_not_success(self):
        with self.assertRaisesRegex(RuntimeError, "actual engineering failure"):
            module.checked(result({"ok": False, "error": "actual engineering failure"}))

    async def test_unsafe_upstream_space_introspection_is_refused_without_mutation(self):
        self.session.tools["get_object_fields"] = Tool(
            name="get_object_fields", inputSchema={"type": "object", "properties": {}})
        self.session.raw = AsyncMock()
        for kind in ("Space", "OS:Space", "OS_Space"):
            with self.assertRaisesRegex(ValueError, "mutates Space"):
                await self.session.call("get_object_fields", {
                    "object_type": kind, "object_handle": "selected",
                }, actor="development-proof")
        self.session.raw.assert_not_called()

    async def test_project_path_is_not_caller_filesystem_path(self):
        with self.assertRaises(ValueError):
            module.ProjectSession("../../another-project")
        self.assertTrue(self.session.working.is_relative_to(Path(self.directory.name)))

    async def test_saved_model_reference_must_belong_to_project(self):
        self.session.raw = AsyncMock()
        with self.assertRaisesRegex(ValueError, "unknown_saved_model"):
            await self.session.human("reopen", {"modelId": "../other"}, 0)
        self.session.raw.assert_not_called()


if __name__ == "__main__":
    unittest.main()
