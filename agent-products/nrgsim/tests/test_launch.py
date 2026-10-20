# Entity: OpenStudio Connection Verification
# Relationship: These tests enforce narrow Project mounts and native-path translation without starting a runtime.
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from nrgsim.launch import IMAGE, host_path, server_parameters, tool_arguments


class LaunchTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()

    def test_only_three_project_mounts_and_no_ports_or_security_bypass(self):
        with patch("nrgsim.launch.shutil.which", return_value="docker"):
            params = server_parameters(self.root)
        mounts = [params.args[index + 1] for index, value in enumerate(params.args) if value == "--mount"]
        self.assertEqual(len(mounts), 3)
        self.assertIn(f"source={(self.root / 'inputs').as_posix()},target=/inputs,readonly", mounts[0])
        self.assertIn(IMAGE, params.args)
        self.assertIn("never", params.args)
        self.assertIn("none", params.args)
        self.assertNotIn("--privileged", params.args)
        self.assertNotIn("--security-opt", params.args)
        self.assertNotIn("-p", params.args)
        self.assertNotIn("OSMCP_SANDBOX=off", params.args)

    def test_host_model_path_translates_and_native_tool_values_do_not(self):
        model = self.root / "runs/models/office.osm"
        args = {"osm_path": str(model), "arguments": {"name": "Office", "height": 3},
                "other": "/opt/common-measures/measure"}
        translated = tool_arguments(self.root, args)
        self.assertEqual(translated["osm_path"], "/runs/models/office.osm")
        self.assertEqual(translated["arguments"], args["arguments"])
        self.assertEqual(translated["other"], args["other"])
        self.assertEqual(host_path(self.root, translated["osm_path"]), model)

    def test_other_project_and_home_paths_are_not_mounted(self):
        for path in (self.root.parent / "other/working.osm", Path.home() / "private.osm"):
            with self.assertRaisesRegex(ValueError, "inside this Project"):
                tool_arguments(self.root, {"osm_path": str(path)})

    def test_returned_artifact_cannot_escape_mounts(self):
        for value in ("/runs/../../private", "/etc/passwd", "relative.osm", ""):
            with self.assertRaises(ValueError):
                host_path(self.root, value)

    def test_missing_docker_fails_without_native_fallback(self):
        with patch("nrgsim.launch.shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "Docker Desktop"):
                server_parameters(self.root)


if __name__ == "__main__":
    unittest.main()
