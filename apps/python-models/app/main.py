"""Python rails FastAPI lifespan and application composition root."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Application Startup
# Relationship: This file composes the Python-rails FastAPI application, loads validated configuration, mounts the established domain routers, and exposes process health.
# Entity: ThinkGraph
# Relationship: This file closes the account-scoped Engraphis services at shutdown; database selection waits for an authorized Project request.

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.python_models.provider_config import ensure_env_loaded

ensure_env_loaded()

from app.card_domain_routes import router as card_domain_router
from app.graph_routes import graph_read_router, graph_settlement_router
from app.trading_routes import router as trading_router

# NRGSIM keeps domain source in its product folder; this is only route composition.
import importlib.util
from pathlib import Path
_modeling_routes_path = Path(__file__).resolve().parents[3] / "agent-products" / "nrgsim" / "services" / "routes.py"
_modeling_spec = importlib.util.spec_from_file_location("nrgsim_routes", _modeling_routes_path)
_modeling_routes = importlib.util.module_from_spec(_modeling_spec)
_modeling_spec.loader.exec_module(_modeling_routes)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from app.python_models.engraphis import close_engine
    try:
        yield
    finally:
        await asyncio.to_thread(close_engine)


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(graph_settlement_router)
app.include_router(trading_router)
app.include_router(card_domain_router)
app.include_router(graph_read_router)
app.include_router(_modeling_routes.router)
