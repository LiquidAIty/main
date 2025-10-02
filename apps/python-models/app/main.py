from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
import uuid, redis, rq, os, json

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
    job = q.enqueue('python_models.worker.train_job', args=(job_id, req.dict()))
    return {"jobId": job.id}

@app.get("/status/{job_id}")
def status(job_id: str):
    job = rq.job.Job.fetch(job_id, connection=redis_conn)
    return {"status": job.get_status(), "result": job.result}

@app.get("/health")
def health():
    return {"status": "ok"}
