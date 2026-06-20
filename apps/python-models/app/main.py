from fastapi import FastAPI, HTTPException

from app.python_models.autogen_orchestrator import orchestrate_context_pack
from app.python_models.orchestration_contracts import ContextPack
from app.python_models.tool_registry import tool_manifest

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/tools/manifest")
def tools_manifest():
    """Read-only capability manifest from the real Mag One tool registry.

    The registry is the single source of truth; the frontend renders this to
    surface available Mag One capabilities on the existing card Tools surface.
    """
    return {"tools": tool_manifest()}


@app.post("/autogen/orchestrate")
async def autogen_orchestrate(req: ContextPack):
    try:
        return await orchestrate_context_pack(req)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
