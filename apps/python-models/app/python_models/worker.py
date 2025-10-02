import time, json, os
from datetime import datetime

def train_job(job_id, payload):
    """
    Minimal example: pretend to train and write logs.
    Replace with your real training loop (PyTorch/TF).
    """
    log_path = f"/tmp/training_logs/{job_id}.log"
    os.makedirs("/tmp/training_logs", exist_ok=True)
    with open(log_path, 'w') as f:
        f.write(f"START {datetime.utcnow().isoformat()}\n")
        f.write(json.dumps(payload) + "\n")
        # example "training"
        for i in range(5):
            f.write(f"epoch {i} loss={0.1*(5-i)}\n")
            f.flush()
            time.sleep(1)
        f.write("DONE\n")
    return {"log": log_path}
