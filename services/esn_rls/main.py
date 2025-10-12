"""
ESN-RLS Microservice
Minimal Echo State Network with Recursive Least Squares for time-series forecasting
Stateless, no GPU required, <200 LOC
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Tuple, Optional, Dict
import numpy as np
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="ESN-RLS Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class FitPredictRequest(BaseModel):
    series: List[Tuple[float, float]]  # [[t, y], ...]
    horizon: int
    rls_lambda: Optional[float] = 0.99
    leak_rate: Optional[float] = 0.3

class FitPredictResponse(BaseModel):
    forecast: List[Dict[str, float]]  # [{"t": ..., "v": ...}, ...]
    feature_importance: Optional[Dict[str, float]] = None
    metrics: Optional[Dict[str, float]] = None

def create_esn_reservoir(n_reservoir=100, spectral_radius=0.9, sparsity=0.1, leak_rate=0.3):
    """Create ESN reservoir matrix"""
    W = np.random.randn(n_reservoir, n_reservoir)
    W[np.random.rand(*W.shape) > sparsity] = 0
    radius = np.max(np.abs(np.linalg.eigvals(W)))
    W = W * (spectral_radius / radius)
    return W, leak_rate

def esn_fit_rls(X, y, n_reservoir=100, rls_lambda=0.99, leak_rate=0.3):
    """Fit ESN with RLS"""
    W_res, alpha = create_esn_reservoir(n_reservoir, leak_rate=leak_rate)
    W_in = np.random.randn(n_reservoir, 1) * 0.1
    
    # Collect reservoir states
    states = []
    r = np.zeros((n_reservoir, 1))
    for x_t in X:
        r = (1 - alpha) * r + alpha * np.tanh(W_res @ r + W_in * x_t)
        states.append(r.flatten())
    
    states = np.array(states)
    
    # RLS: P = (lambda * I)^-1, w = 0
    P = np.eye(n_reservoir) / rls_lambda
    w = np.zeros(n_reservoir)
    
    for i, (s, target) in enumerate(zip(states, y)):
        # RLS update
        k = P @ s / (rls_lambda + s.T @ P @ s)
        w = w + k * (target - w @ s)
        P = (P - np.outer(k, s.T @ P)) / rls_lambda
    
    return W_res, W_in, w, alpha

def esn_predict(W_res, W_in, w_out, alpha, last_state, horizon):
    """Predict next `horizon` steps"""
    preds = []
    r = last_state
    for _ in range(horizon):
        y_pred = w_out @ r.flatten()
        preds.append(y_pred)
        r = (1 - alpha) * r + alpha * np.tanh(W_res @ r + W_in * y_pred)
    return preds

@app.post("/fit_predict", response_model=FitPredictResponse)
async def fit_predict(req: FitPredictRequest):
    try:
        if len(req.series) < 10:
            raise HTTPException(status_code=400, detail="Need at least 10 points")
        
        # Extract values
        times = np.array([p[0] for p in req.series])
        values = np.array([p[1] for p in req.series])
        
        # Normalize
        mean_v, std_v = values.mean(), values.std()
        if std_v == 0:
            std_v = 1
        values_norm = (values - mean_v) / std_v
        
        # Fit ESN-RLS
        X_train = values_norm[:-1]
        y_train = values_norm[1:]
        
        W_res, W_in, w_out, alpha = esn_fit_rls(
            X_train, y_train,
            n_reservoir=50,
            rls_lambda=req.rls_lambda,
            leak_rate=req.leak_rate
        )
        
        # Last state
        r_last = np.zeros((50, 1))
        for x_t in X_train:
            r_last = (1 - alpha) * r_last + alpha * np.tanh(W_res @ r_last + W_in * x_t)
        
        # Predict
        preds_norm = esn_predict(W_res, W_in, w_out, alpha, r_last, req.horizon)
        preds = [p * std_v + mean_v for p in preds_norm]
        
        # Generate future timestamps (assume uniform spacing)
        dt = np.median(np.diff(times)) if len(times) > 1 else 1
        future_times = [times[-1] + dt * (i + 1) for i in range(req.horizon)]
        
        forecast = [{"t": t, "v": float(v)} for t, v in zip(future_times, preds)]
        
        # Simple MSE on training
        train_pred = []
        r = np.zeros((50, 1))
        for x_t in X_train[:-1]:
            r = (1 - alpha) * r + alpha * np.tanh(W_res @ r + W_in * x_t)
            train_pred.append(w_out @ r.flatten())
        
        mse = float(np.mean((np.array(train_pred) - y_train[1:len(train_pred)+1])**2)) if len(train_pred) > 0 else 0
        
        return FitPredictResponse(
            forecast=forecast,
            metrics={"mse": mse, "mae": float(np.abs(np.array(train_pred) - y_train[1:len(train_pred)+1]).mean()) if len(train_pred) > 0 else 0}
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5055)
