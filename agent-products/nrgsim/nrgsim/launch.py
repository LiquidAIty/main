"""Configure the installed, unchanged OpenStudio MCP for one Project."""
# Entity: OpenStudio Connection
# Relationship: This launcher supplies isolated Project paths to the unchanged installed upstream entry point.
from __future__ import annotations

import importlib.util
import os
from pathlib import Path


def main() -> None:
    installation = Path(os.environ["NRGSIM_OPENSTUDIO_ROOT"]).resolve()
    workspace = Path(os.environ["NRGSIM_PROJECT_ROOT"]).resolve()
    spec = importlib.util.spec_from_file_location("installed_configuration", installation / "launch_mcp.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("openstudio_configuration_unavailable")
    configuration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(configuration)
    os.environ.update(configuration.environment())
    for name, directory in (
        ("OPENSTUDIO_MCP_RUN_ROOT", "runs"),
        ("OPENSTUDIO_MCP_INPUT_ROOT", "inputs"),
        ("OPENSTUDIO_MCP_MEASURES_DIR", "measures"),
    ):
        path = workspace / directory
        path.mkdir(parents=True, exist_ok=True)
        os.environ[name] = str(path)
    # This is the upstream entry point, not an imported/reimplemented tool server.
    from mcp_server.server import main as upstream_main
    upstream_main()


if __name__ == "__main__":
    main()
