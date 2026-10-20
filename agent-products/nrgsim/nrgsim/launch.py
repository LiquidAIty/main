"""Launch the pinned upstream OpenStudio MCP package for one Project."""
# Entity: OpenStudio Connection
# Relationship: This adapter mounts only one Project's files into the unchanged upstream runtime.
from __future__ import annotations

import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import shutil
from uuid import uuid4

from mcp import StdioServerParameters

# Official v1.2.1 registry digest, not a mutable development image.
IMAGE = "nrel/openstudio-mcp@sha256:5c46c32bb4acc8e008c795d51fcc3ad26b51ef858631ba2688ce0a3f935c6601"
MOUNTS = ("inputs", "runs", "measures")


def server_parameters(root: Path) -> StdioServerParameters:
    docker = shutil.which("docker")
    if docker is None:
        raise RuntimeError("Docker Desktop is required for the installed OpenStudio MCP package")
    root = root.resolve()
    args = [
        "run", "--rm", "--init", "-i", "--pull", "never", "--platform", "linux/amd64",
        "--network", "none",
        "--cpus", "2", "--memory", "4g", "--pids-limit", "512",
        "--name", f"nrgsim-{root.name}-{uuid4().hex[:8]}",
    ]
    for directory in MOUNTS:
        path = root / directory
        path.mkdir(parents=True, exist_ok=True)
        if not path.resolve().is_relative_to(root):
            raise ValueError("Project mount must not escape its private directory")
        mount = f"type=bind,source={path.as_posix()},target=/{directory}"
        if directory == "inputs":
            mount += ",readonly"
        args += ["--mount", mount]
    args += ["-e", "OPENSTUDIO_MCP_MODE=prod", "-e", "OSMCP_RUN_RETENTION_DAYS=0",
             IMAGE, "openstudio-mcp"]
    # These configure the local Docker client only. No host credentials/environment
    # are passed through to the engineering container.
    env = {key: os.environ[key] for key in (
        "PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE",
        "APPDATA", "LOCALAPPDATA",
    ) if key in os.environ}
    return StdioServerParameters(command=docker, args=args, env=env)


def tool_arguments(root: Path, value):
    """Translate mounted host paths without changing native tool names or schemas."""
    if isinstance(value, dict):
        return {key: tool_arguments(root, item) for key, item in value.items()}
    if isinstance(value, list):
        return [tool_arguments(root, item) for item in value]
    if isinstance(value, str) and PureWindowsPath(value).is_absolute():
        path = Path(value).resolve()
        for directory in MOUNTS:
            mount = (root / directory).resolve()
            if path.is_relative_to(mount):
                return str(PurePosixPath("/", directory, *path.relative_to(mount).parts))
        raise ValueError("File must be inside this Project's inputs, runs, or measures directory")
    return value


def host_path(root: Path, value: str) -> Path:
    """Resolve a returned mounted artifact; reject traversal and unmapped runtime files."""
    path = PurePosixPath(value)
    if not path.is_absolute() or len(path.parts) < 2 or path.parts[1] not in MOUNTS or ".." in path.parts:
        raise ValueError("OpenStudio artifact is outside this Project's mounted directories")
    target = root.joinpath(*path.parts[1:]).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("OpenStudio artifact escapes this Project")
    return target
