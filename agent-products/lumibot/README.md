# LumiBot MCP SDK 2 compatibility build

This directory contains an exact, reproducible patch—not a second installed LumiBot,
agent runtime, broker service, or Python environment. Windows development and the
Oracle image consume the same `4.6.48+mcp2.1` wheel through the canonical Python-rails
requirements file.

Upstream: Lumiwealth/LumiBot 4.6.48, tag commit
`d4a3ebb2494fee16013b1b928a426a55d01b51db`. The build verifies the official PyPI wheel
against SHA-256 `e37f805b03c3b706d987020051545ce25e0c7677eab8b84cf91705e7cececd27`.
Upstream license files and unchanged package contents are retained.

## Changed contract

`mcp2.patch.json` changes the MCP client to the SDK 2 `Client(mode="auto")` transport
owner, uses HTTPX2 for HTTP, and serializes tool schemas/results with their original
wire aliases. SDK negotiation handles supported older-protocol peers; there is no
second Python MCP SDK or locally implemented protocol fallback.

Metadata requires `mcp>=2,<3` and HTTPX2. Core Google ADK remains; its broad optional
`extensions` extra is not requested, so it does not pull CrewAI/LangGraph into the
Hermes-owned Card system. The patch does not change trading strategy rules or grant
broker execution permission.

## Build and install

From the repository root, using the existing Python rails interpreter:

```text
python agent-products/lumibot/build.py
python -m pip install -r apps/python-models/requirements.txt
python -m pip check
```

The builder optionally accepts `--upstream PATH` for an already downloaded wheel;
the same checksum is mandatory. It fails on changed or non-unique patch contexts,
rebuilds wheel RECORD, and prints the resulting artifact SHA-256. It does not install
anything or modify the upstream input. Docker runs this same builder before install.
Upstream ZIP platform metadata is retained explicitly so Windows and Linux produce
the same artifact, verified SHA-256
`3638aeb502545ab3c15d7d3464fb9fea8538efe8c44036edb9b018fe6915500c`.

On the current Windows host, rebuilding the pre-existing Graphiti editable metadata
can fail in setuptools' distutils shim. The verified packaging workaround is the
temporary process setting `SETUPTOOLS_USE_DISTUTILS=stdlib` with pip's
`--no-build-isolation`; dependency resolution remains enabled. This is not a TLS
bypass, global configuration change, or second environment.

## Acceptance

```text
python -m pytest agent-products/lumibot/tests/test_mcp2.py -q
```

The interoperability peers are disposable real SDK servers: Python SDK 2 and the
repository's existing JavaScript SDK 1. They exercise stdio, authenticated HTTP,
negotiation, discovery, tool results, validation failures and tool errors. They do
not touch product graph data, invoke models, or place trades.

Dependency resolution, protocol tests, actual strategy backtests, affected graph
contracts, loaded tool execution, and saved-Card model/tool acceptance are separate
gates. A built wheel alone is not a verified port. Do not remove paper-only execution
restrictions to satisfy any of these checks.
