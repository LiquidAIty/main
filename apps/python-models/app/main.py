from fastapi import FastAPI, HTTPException

from app.python_models.autogen_orchestrator import orchestrate_context_pack
from app.python_models.orchestration_contracts import ContextPack

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/autogen/orchestrate")
async def autogen_orchestrate(req: ContextPack):
    try:
        return await orchestrate_context_pack(req)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
