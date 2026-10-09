import json
import sys

from tools.code_kernel import execute_in_session_kernel


def test_saved_card_recipe_runs_in_real_child_and_dispatches_only_its_canonical_alias(tmp_path):
    calls = []

    def dispatch(name, arguments):
        calls.append((name, arguments))
        return json.dumps({"nativeId": "node-1"})

    source = '''from hermes_tools import SCRIPT, input, output, tools
tools.cbm.search_graph = SCRIPT
result = tools.call("cbm.search_graph", query=input.query)
output.emit({"result": result})
'''
    result = json.loads(execute_in_session_kernel(
        source,
        task_id="card-session",
        mode="strict",
        child_python=sys.executable,
        child_cwd=str(tmp_path),
        sandbox_tools=frozenset({"cbm.search_graph"}),
        timeout=15,
        max_tool_calls=2,
        reset=True,
        is_interrupted=lambda: False,
        tool_module_options={
            "tool_aliases": {"cbm.search_graph": "safe-callback-name"},
            "script_input": {"query": "launch"},
            "tool_states": {"cbm.search_graph": 1},
        },
        dispatch=dispatch,
        kernel_namespace="card-script:test",
        dispose_after=True,
    ))

    assert result["status"] == "success"
    assert calls == [("cbm.search_graph", {"query": "launch"})]
    emitted = next(
        line for line in result["output"].splitlines()
        if line.startswith("HERMES_CARD_SCRIPT_OUTPUT:")
    )
    assert json.loads(emitted.split(":", 1)[1]) == {"result": {"nativeId": "node-1"}}
