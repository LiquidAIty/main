"""Python rails FastAPI lifespan and application composition root."""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.python_models.provider_config import ensure_env_loaded

ensure_env_loaded()

from app.card_domain_routes import router as card_domain_router
from app.graph_routes import graph_read_router, graph_settlement_router
from app.trading_routes import router as trading_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    import logging
    from app.python_models.engraphis import get_service

    async def warm():
        try:
            await asyncio.to_thread(get_service)
        except Exception:
            logging.getLogger(__name__).exception("ThinkGraph initialization failed")

    warmup = asyncio.create_task(warm())
    app.state.thinkgraph_warmup = warmup
    try:
        yield
    finally:
        if not warmup.done():
            warmup.cancel()
            try:
                await warmup
            except asyncio.CancelledError:
                pass


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(graph_settlement_router)
app.include_router(trading_router)
app.include_router(card_domain_router)
app.include_router(graph_read_router)
