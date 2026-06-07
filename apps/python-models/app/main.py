from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uuid
import redis
import rq
import os

from app.python_models.autogen_research import (
    ResearchPlanRequest,
    plan_research_with_autogen,
)
from app.python_models.autogen_orchestrator import orchestrate_context_pack
from app.python_models.orchestration_contracts import ContextPack

app = FastAPI()
redis_conn = redis.Redis(host=os.getenv("REDIS_HOST","redis"), port=6379)
q = rq.Queue('models', connection=redis_conn)

class TrainRequest(BaseModel):
    code: str
    contextPath: str | None = None
    dataset: dict | None = None

@app.post("/train")
def train(req: TrainRequest):
    job_id = str(uuid.uuid4())
    job = q.enqueue('app.python_models.worker.train_job', args=(job_id, req.dict()))
    return {"jobId": job.id}

@app.get("/status/{job_id}")
def status(job_id: str):
    job = rq.job.Job.fetch(job_id, connection=redis_conn)
    return {"status": job.get_status(), "result": job.result}

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/autogen/research/plan")
async def autogen_research_plan(req: ResearchPlanRequest):
    # Legacy adapter-only planner route retained for older research ingestion callers.
    try:
        return await plan_research_with_autogen(req)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.post("/autogen/orchestrate")
async def autogen_orchestrate(req: ContextPack):
    try:
        return await orchestrate_context_pack(req)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
