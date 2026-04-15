# AGENTS.md

Guidance for autonomous coding agents working in this repository.

## Repository Overview

- Monorepo managed with **Nx** and **npm workspaces**.
- Main applications:
  - `apps/backend` – Node/TypeScript backend
  - `client` – React + Vite frontend
  - `apps/volt-svc` – companion service used by backend dependencies
- Additional services/scripts live in `services/`, `scripts/`, and `prisma/`.

## Setup

1. Install dependencies:
   - `npm ci`
2. Create environment file:
   - `cp .env.example .env`
3. Generate Prisma client (when schema changes or first setup):
   - `npm run prisma:generate`

## Common Commands

Run from repository root unless noted.

- Start SimStudio:
  - `npm run sim`
- Run backend (Nx):
  - `npx nx serve backend`
- Run frontend (Nx):
  - `npx nx serve client`
- Run frontend (workspace script alternative):
  - `npm run dev --workspace=client`
- Build backend:
  - `npx nx build backend`
- Build frontend:
  - `npx nx build client`
- Run tests:
  - `npm test`
- Run backend e2e tests:
  - `npx nx e2e backend-e2e`

## Database / Prisma

- Schema path used by scripts: `libs/prisma/schema.prisma`.
- Helpful commands:
  - `npm run prisma:migrate`
  - `npm run prisma:seed`
  - `npm run prisma:studio`

## Agent Workflow Expectations

1. Keep changes focused and minimal.
2. Prefer project-local fixes over broad refactors.
3. Update docs/tests when behavior changes.
4. Before finalizing, run relevant validation for touched areas:
   - targeted build(s),
   - targeted test(s), and
   - full `npm test` for cross-cutting changes.
5. If a command cannot be run locally (missing service/secrets), document exactly what was skipped and why.

## Editing Conventions

- Prefer TypeScript for application logic.
- Follow existing file/module style in each folder.
- Avoid introducing new dependencies unless necessary.
- Keep secrets out of source files and commits.
