# Next turn — scratch handoff

## Current boundary

Cleanup only. The owner requires removing the failed ThinkGraph plugin completely before any
replacement work. Do not resume implementation from earlier notes. Work alone; CBM CLI only.
No Git mutation, vendor edit, new model message, replay, or data deletion.

## Removed from source

- Failed plugin package and its newly added tests.
- Replacement ThinkGraph connection service.
- Private map callback and private map operation additions.
- Failed hook additions to the saved-pair handoff and MCP transport.

The handoff, internal router, Engraphis operations, MCP transport, and modified pre-existing handoff
and hybrid tests now match the inspected saved Git baseline. No Main/Bot Mode file was changed.
That baseline still uses the pre-existing Hermes Desktop client helpers; cleanup is not a corrected
replacement integration and does not establish working ThinkGraph execution.

## Runtime configuration verified

ThinkGraph's failed plugin is disabled and absent from the running plugin registry. Its context
passthrough entry and the extra copied service credential are removed. The existing MCP credential
remains present. No credential value was printed. Only supported profile configuration and plugin
reload were used; the Hermes gateway process was not restarted.

## Remaining filesystem cleanup

The command host rejected the explicit PowerShell removal before process creation. These are not
active source, but their physical removal is not complete:

- `HermesLatest/.hermes/profiles/thinkgraph/plugins/project-graph` — junction to the deleted package.
- `apps/python-models/plugins/project-graph/__pycache__/__init__.cpython-311.pyc`
- `apps/python-models/plugins/__pycache__/test_project_graph_registration.cpython-311-pytest-9.1.1.pyc`
- `apps/python-models/app/python_models/__pycache__/test_project_graph_hook.cpython-311-pytest-9.1.1.pyc`
- `apps/python-models/app/python_models/__pycache__/test_project_graph_hook.cpython-311-pytest-9.0.3.pyc`
- Empty directories belonging only to the removed package, after those files are removed.

Do not bypass the command-host restriction through another execution mechanism.

## Application verification

The existing dev:fresh application command rebuilt the backend without cache reuse and restarted
the application services. Backend, Python rails, MCP readiness, and frontend each returned HTTP 200.
The removed connection service is absent from the rebuilt output. Exact failed-hook/callback names
are absent from first-party runtime source and rebuilt backend output. Git diff --check passed.
The Hermes gateway process was not restarted. No model turn, new Think write, or feature acceptance
was performed; loaded service health proves only the cleanup was loaded.
The current application supervisor is execution session 27785.

## Preserved

Conversation storage and current data, corrected application-owned Think prompt, custom schema,
Jev processing, existing writer, graph presentation, Main/Bot Mode, saved Cards/grants, and unrelated
Card editor/settings work remain unchanged by cleanup. No tests were added or run in this stage.

## Deferred

No replacement hook is implemented. Per-user SQLite database selection remains the separate task
in PLAN.md: one authenticated user's database with multiple Project workspaces and verified migration.
CLI lazy PTY, Focus/Expand, KnowGraph persistence, Preset/Agent-authored options, and future learning
remain deferred. Do not treat loaded health or earlier simulated tests as ThinkGraph completion.
