# LiquidAIty Architecture

## Project Overview
LiquidAIty is an AI-native project workspace where chat, planning, agent execution, and canvas state stay connected.

## Core Execution Rail

```text
Project selected
-> Chat task entered
-> Plan Agent proposes plan
-> User approves a step
-> Runtime routes to executable agent
-> python_autogen sidecar executes
-> Result returns to backend
-> Canvas/workspace context updates
```

## Runtime Components
- `client/`: Agent Builder UI, chat/task triggers, workspace context.
- `apps/backend/`: API routes, deck/card runtime, routing, persistence.
- `apps/python-models/`: FastAPI sidecar for AutoGen orchestration.
- `docker-compose.yml`: Local multi-service runtime wiring.

## Environment Model
- Single runtime env source: `apps/backend/.env`.
- Backend loads this env via `apps/backend/src/config/env.ts`.
- Python sidecar loads this env via `apps/python-models/app/python_models/autogen_provider_env.py`.

## AutoGen Contract
- Real agent/deck execution uses AutoGen sidecar (`python_autogen` rail).
- If sidecar is unavailable, runtime must fail clearly.
- No silent TS fallback, no fake success payloads.
- Lazy loading, loading states, error boundaries, retries, diagnostics, and honest unavailable or
  disabled states are allowed when they expose real runtime status.
- No fake substitute product behavior.

## Key Health Endpoints
- Backend: `GET http://127.0.0.1:4000/api/health`
- Sidecar: `GET http://127.0.0.1:8003/health`
- Orchestrator route: `POST http://127.0.0.1:8003/autogen/orchestrate`
