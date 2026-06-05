# AgentBuilder Route Contract

## Canonical Route Family

The active AgentBuilder project/deck route family is:

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId
DELETE /api/projects/:projectId
GET    /api/projects/:projectId/decks
POST   /api/projects/:projectId/decks
GET    /api/projects/:projectId/decks/:deckId
PUT    /api/projects/:projectId/decks/:deckId
DELETE /api/projects/:projectId/decks/:deckId
POST   /api/projects/:projectId/decks/:deckId/run
```

## Source of Truth

- backend mount: `apps/backend/src/routes/index.ts`
- project routes: `apps/backend/src/routes/projects.routes.ts`
- deck routes: `apps/backend/src/routes/decks.routes.ts`

## Rules

- AgentBuilder must use `/api/projects` only for project/deck behavior
- do not use `/api/v2/projects`
- do not use `/api/v3/projects`
- do not add new route versions for AgentBuilder
- if a route is missing, repair the canonical route instead of creating `v4`
- project-backed deck persistence must remain on this route family

## Deprecated Route Debt

Older route history still exists in the repo in places such as `apps/backend/src/routes/v2/*` and `apps/backend/src/v3/*`, but that history is deprecated route debt, not future direction for AgentBuilder project/deck behavior.

Future agents must not treat those old route names as the active contract.

## Frontend Contract

The active frontend constant is:

- `PROJECTS_API = '/api/projects'` in `client/src/pages/agentbuilder.tsx`

Current known frontend usage includes:

- project listing and creation
- project selection
- deck load
- deck save
- deck run
- project KG endpoints under `/api/projects/:projectId/kg/*`

## Persistence Contract

- saved project-backed deck state is authoritative
- canonical deck id for AgentBuilder baseline is `deck_builder`
- route fixes must preserve revision-aware save behavior and deck integrity handling

## Future-Agent Warning

- Do not infer the active route contract from old route folders
- Do not create route-version sprawl
- Do not patch frontend around backend breakage with local-only fallback board behavior
- Preserve `/api/projects` as the single AgentBuilder route family
