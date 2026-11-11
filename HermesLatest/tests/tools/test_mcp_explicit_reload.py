"""Explicit reload refreshes an owned live server even when its transport did not change."""
import json
import sys

import pytest


@pytest.mark.no_isolate
def test_explicit_reload_updates_tool_filter_and_connection_policy(monkeypatch, tmp_path):
    from tools import mcp_tool_discovery as discovery, mcp_tool_loop
    from tools.mcp_tool_common import _core
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    from tools.registry import registry

    home = tmp_path / 'home'
    home.mkdir()
    server = tmp_path / 'server.py'
    server.write_text('''from mcp.server.mcpserver import MCPServer
app = MCPServer("reloadfixture")
@app.tool()
def one() -> str:
    return "first"
@app.tool()
def two() -> str:
    return "second"
app.run()
''', encoding='utf-8')
    monkeypatch.setenv('HERMES_HOME', str(home))
    config = {'command': sys.executable, 'args': [str(server)], 'tools': {'include': ['one']}}

    def save():
        (home / 'config.yaml').write_text(json.dumps({'mcp_servers': {'reloadfixture': config}}), encoding='utf-8')

    def names():
        return set(registry.get_tool_names_for_toolset('mcp-reloadfixture'))

    try:
        save()
        discovery.discover_mcp_tools()
        first = _core._servers['reloadfixture']
        assert 'mcp__reloadfixture__one' in names() and 'mcp__reloadfixture__two' not in names()
        utilities = names() - {'mcp__reloadfixture__one'}
        config['tools']['include'] = ['one', 'two']
        config['include_execution_context'] = True
        save()
        # Ordinary housekeeping and plugin settings keep a healthy transport intact.
        assert discovery.restart_mcp_servers_with_new_inputs({'reloadfixture'}) == []
        assert _core._servers['reloadfixture'] is first
        assert discovery.restart_mcp_servers_with_new_inputs({'reloadfixture'}, refresh=True) == ['reloadfixture']
        assert _core._servers['reloadfixture'] is first  # no teardown of in-flight calls
        assert names() == utilities | {'mcp__reloadfixture__one', 'mcp__reloadfixture__two'}
        assert _core._servers['reloadfixture']._config['include_execution_context'] is True
        entry = registry.get_entry('mcp__reloadfixture__two')
        assert 'second' in entry.handler({})
        for selected in [['two'], []]:
            config['tools']['include'] = selected
            save()
            discovery.restart_mcp_servers_with_new_inputs({'reloadfixture'}, refresh=True)
            assert names() == utilities | {f'mcp__reloadfixture__{name}' for name in selected}
    finally:
        shutdown_mcp_servers()
        mcp_tool_loop._stop_mcp_loop()
