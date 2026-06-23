"""Test bootstrap for the services/knowgraph Python tests.

This is TEST setup only — NOT request-path or service-path code. It guarantees the real
``app`` package (``apps/python-models/app``, now a regular package) is importable and resolved
BEFORE pytest's per-module path prepends run, by adding ``apps/python-models`` to ``sys.path`` and
importing the ``app.python_models`` package once at collection start. Caching the package here (with
its correct ``__path__``) means the production importer
(``issuer_case_loop.import_app_python_models_module``) is a plain ``importlib.import_module`` with
NO sys.path mutation and NO sys.modules purge — it simply returns the already-resolved package.

Without this, pytest (import-mode=prepend) inserts ``services/knowgraph`` at ``sys.path[0]`` for
each test module, and the sibling ``services/knowgraph/app.py`` would shadow the real ``app``.
"""
import sys
from pathlib import Path

_PYTHON_MODELS_ROOT = Path(__file__).resolve().parents[2] / "apps" / "python-models"
if _PYTHON_MODELS_ROOT.is_dir() and str(_PYTHON_MODELS_ROOT) not in sys.path:
    # Insert ahead of the collection-time prepend so `app` binds to the real regular package.
    sys.path.insert(0, str(_PYTHON_MODELS_ROOT))

# Resolve + cache the real package now (lightweight: only the package __init__ files run). After
# this, app.python_models.* resolves via the cached package __path__, immune to later sys.path order.
import app.python_models  # noqa: E402,F401
