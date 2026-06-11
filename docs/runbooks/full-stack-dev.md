# Runbook: Full Stack Local Dev

## Purpose
Start and validate the local LiquidAIty runtime stack with AutoGen enabled.

## Canonical Start

From repo root:

```powershell
npm run dev
```

Expected services:
1. frontend (Vite)
2. backend (Express/Nx)
3. python-models sidecar (host-source FastAPI + AutoGen)

## Mandatory Health Checks

```powershell
Invoke-RestMethod http://127.0.0.1:4000/api/health
Invoke-RestMethod http://127.0.0.1:8003/health
Invoke-RestMethod http://127.0.0.1:8003/autogen/orchestrate -Method Post -ContentType "application/json" -Body "{}"
```

Expected:
- Backend health returns `status: ok`.
- Sidecar health returns `status: ok`.
- Orchestrate returns validation error for `{}` (route exists).

## Required Quality Gates

```powershell
npx tsc -p apps/backend/tsconfig.app.json --noEmit
npx tsc -p client/tsconfig.app.json --noEmit --pretty false
npx vitest run client/src/runtime/agentCardRegistryResolver.spec.ts
```

## Failure Policy
- AutoGen unavailable => hard diagnostic failure.
- No TypeScript fallback for real execution path.
- No fake success payloads.
- Lazy loading, loading states, error boundaries, retries, diagnostics, and honest unavailable or
  disabled states are acceptable when they report real runtime status.
- No fake substitute product behavior.
- A passing health check proves liveness only. The real AutoGen graph runtime remains unproven until
  the Spec 007 source-run smoke returns real non-empty output.
