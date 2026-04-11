# LiquidAIty Launch Readiness

**Generated:** April 11, 2026  
**Status:** Pre-launch hardening phase  
**Target:** First real users on production infrastructure

---

## Executive Summary

### Are We Close to Launch?

**Planning estimate: 2-3 weeks of hardening work before safe first launch.**

**What's working:**
- Visible Magentic-One orchestration ✅
- Deck runtime execution ✅
- Plan Wiki operational surface ✅
- Canvas interaction fixed ✅
- Legacy cleanup complete ✅

**What's blocking:**
- Users can access each other's projects 🔴
- Sessions don't survive restarts 🔴
- No rate limiting on expensive operations 🔴
- Deploy path will break auth in production 🔴
- Sensitive diagnostic routes exposed 🔴

---

## Current State Assessment

### ✅ What's Working
- **Deck runtime** - v3 execution path is operational with revision conflict handling
- **Visible orchestration** - React Flow canvas with Magentic-One routing
- **Plan Wiki** - Real operational surface with backend persistence
- **Canvas click bug** - Fixed with regression coverage
- **Legacy cleanup** - `/api/agents/boss` chain deleted, dead code trimmed

### ⚠️ What's Blocking Launch
- **Auth/user isolation** - Not production-ready
- **Project ownership** - Effectively absent
- **Sensitive routes** - Exposed without auth
- **Cost/abuse guardrails** - Missing on expensive paths
- **Deploy path** - Not fail-fast or HTTPS-safe

---

## Must-Fix Before First Users

### 1. **Auth & User Isolation** 🔴 BLOCKER

**Current State:**
- `client/src/pages/login.tsx:13` and `client/src/components/UploadAttachment.tsx:84` call `/api/auth/start`
- `apps/backend/src/routes/auth.routes.ts:17` only allows bootstrap when `apps/backend/src/security/requestAccess.ts:80` accepts local loopback or `AUTH_BOOTSTRAP_TOKEN`
- Client does not send bootstrap token
- Sessions are local JSON files in `apps/backend/src/auth/sessionStore.ts:12`
- Identity is not durable across container replacement

**Why it matters:** Users will be logged out on every deploy.

**Required Fix:**
- Make user identity stable in production (persist sessions to DB or Redis)
- Implement proper login flow that doesn't require bootstrap token for real users
- Add session validation middleware to all protected routes
- Ensure sessions survive container restarts

**Files to Modify:**
- `apps/backend/src/auth/sessionStore.ts` - Move from JSON files to durable storage
- `apps/backend/src/routes/auth.routes.ts` - Add production-safe login flow
- `apps/backend/src/middleware/auth.ts` - Strengthen session validation
- `client/src/pages/login.tsx` - Implement proper auth flow

**Planning estimate:** 2-3 days

---

### 2. **Project Ownership & Isolation** 🔴 BLOCKER

**Current State:**
- `apps/backend/src/routes/v2/projects.routes.ts:23` lists projects with `listAgentCards(null, ...)`
- `apps/backend/src/routes/v2/projects.routes.ts:38` creates projects without `req.userId`
- `apps/backend/src/services/agentBuilderStore.ts:268` assigns ownership from env fallback, not active user
- `apps/backend/src/v3/routes/decks.routes.ts:12` and `apps/backend/src/v3/decks/store.ts:381` trust raw `projectId`
- `apps/backend/src/routes/knowgraph.routes.ts:412` accepts `projectId` from query/body with no ownership check
- **One user can access another user's projects if they know the ID**

**Why it matters:** This is a data breach waiting to happen.

**Required Fix:**
- Stop creating/listing projects without `req.userId`
- Stop assigning owner from env fallback
- Add ownership check middleware: `ensureProjectOwnership(req, res, next)`
- Apply to ALL project-scoped routes:
  - v2 projects routes
  - v2 config routes
  - v2 KG routes
  - v3 decks routes
  - v3 cards routes
  - KnowGraph routes

**Files to Modify:**
- `apps/backend/src/middleware/projectOwnership.ts` - **CREATE NEW** - Ownership check middleware
- `apps/backend/src/routes/v2/projects.routes.ts` - Add ownership enforcement
- `apps/backend/src/routes/v2/config.routes.ts` - Add ownership enforcement
- `apps/backend/src/routes/v2/kg.routes.ts` - Add ownership enforcement
- `apps/backend/src/v3/routes/decks.routes.ts` - Add ownership enforcement
- `apps/backend/src/v3/routes/cards.routes.ts` - Add ownership enforcement
- `apps/backend/src/routes/knowgraph.routes.ts` - Add ownership enforcement
- `apps/backend/src/services/agentBuilderStore.ts` - Use `req.userId` for ownership

**Planning estimate:** 2-3 days

---

### 3. **Close Sensitive Internal Routes** 🔴 BLOCKER

**Current State:**
- `apps/backend/src/routes/index.ts:30` mounts `/api/diagnostic` without auth
- `apps/backend/src/routes/diagnostic.routes.ts:6` returns DB/schema details
- Exposes internal topology to unauthenticated users

**Why it matters:** Leaks internal topology to attackers.

**Required Fix:**
- Remove `/api/diagnostic` mount OR
- Add auth middleware to diagnostic routes

**Files to Modify:**
- `apps/backend/src/routes/index.ts` - Remove or protect diagnostic mount

**Planning estimate:** 5 minutes

---

### 4. **Cost/Abuse Guardrails** 🔴 BLOCKER

**Current State:**
- `express-rate-limit` is installed in `apps/backend/package.json:38` but not wired
- Deck run, KnowGraph ingest/research/query, and auth bootstrap are unthrottled
- No concurrency limits on expensive LLM calls

**Why it matters:** Open to abuse and cost explosion.

**Required Fix:**
- Add rate limiting to:
  - `/api/auth/start` - Prevent brute force
  - `/api/v3/projects/:id/decks/run` - Limit concurrent deck executions
  - `/api/v2/projects/:id/kg/ingest_chat_turn` - Limit KG ingestion
  - `/api/v2/projects/:id/kg/research` - Limit research calls
  - `/api/v2/projects/:id/kg/query` - Limit graph queries
- Add per-user concurrency limits for LLM-heavy operations

**Files to Modify:**
- `apps/backend/src/middleware/rateLimiting.ts` - **CREATE NEW** - Rate limit configs
- `apps/backend/src/routes/auth.routes.ts` - Apply rate limiting
- `apps/backend/src/v3/routes/decks.routes.ts` - Apply rate limiting
- `apps/backend/src/routes/v2/kg.routes.ts` - Apply rate limiting

**Planning estimate:** 1-2 days

---

### 5. **Production Deploy Path** 🔴 BLOCKER

**Current State:**
- `apps/backend/Dockerfile:9` and `apps/backend/Dockerfile:12` mask failures with `|| true`
- `docker-compose.yml:25` depends on local `apps/backend/.env`
- `docker-compose.yml:54` depends on host-built `client/dist`
- `nginx.conf:2` is plain HTTP on `:80`
- `apps/backend/src/auth/sessionStore.ts:121` sets secure cookies in production
- **HTTPS/cookie mismatch will break auth**

**Why it matters:** Auth will silently fail in production.

**Required Fix:**
- Remove `|| true` from Dockerfile - fail fast on build errors
- Create production `.env.example` with required vars documented
- Build client inside Docker, not on host
- Add HTTPS termination (nginx SSL or reverse proxy config)
- Add startup health checks for Postgres + required provider config
- Create single deterministic launch path

**Files to Modify:**
- `apps/backend/Dockerfile` - Remove `|| true`, add health checks
- `client/Dockerfile` - **CREATE NEW** - Build client in container
- `docker-compose.yml` - Remove host dependencies, add HTTPS
- `nginx.conf` - Add SSL termination or document reverse proxy requirement
- `.env.example` - **CREATE NEW** - Document required production vars

**Planning estimate:** 1-2 days

---

### 6. **Minimal Launch Observability** 🟡 HIGH PRIORITY

**Current State:**
- No structured request logging
- No run-level tracking with `requestId`, `userId`, `projectId`
- No provider/model/status logging for LLM calls

**Required Fix:**
- Add minimal request logging middleware
- Log: `requestId`, `userId`, `projectId`, `route`, `method`, `status`, `duration`
- Log LLM calls: `provider`, `model`, `tokens`, `cost`, `status`, `error`
- Add startup/readiness checks

**Files to Modify:**
- `apps/backend/src/middleware/requestLogging.ts` - **CREATE NEW** - Request logger
- `apps/backend/src/llm/client.ts` - Add LLM call logging
- `apps/backend/src/main.ts` - Wire logging middleware, add health checks

**Planning estimate:** 1 day

---

### 7. **Deck Save/Load/Run Reliability** 🟢 ALREADY GOOD

**Current State:**
- v3 deck path has revision conflict handling in `client/src/hooks/useBuilderDeckRuntimeActions.ts:148`
- Backend has conflict detection in `apps/backend/src/v3/decks/store.ts:418`
- Backend typecheck passes

**Required Fix:**
- Add one narrow smoke test: login → create project → save deck → load deck → run deck
- Ensure test doesn't depend on broken `vendor/sim` workspace

**Files to Modify:**
- `apps/backend/src/__tests__/smoke.spec.ts` - **CREATE NEW** - Smoke test

**Planning estimate:** 1-2 days

---

## Should-Fix Soon After Launch

### 1. **Provider Failure Handling** 🟡
- Add graceful degradation when OpenAI/OpenRouter fails
- Show user-friendly error messages instead of raw API errors
- Add retry logic with exponential backoff

### 2. **Improved Observability** 🟡
- Add structured logging (JSON format)
- Add metrics collection (request counts, latencies, errors)
- Add error tracking (Sentry or similar)

### 3. **Better Test Coverage** 🟡
- Fix repo-wide Vitest workspace to not pull in `vendor/sim`
- Add integration tests for critical paths
- Add E2E tests for main user flows

### 4. **Performance Monitoring** 🟡
- Add slow query logging
- Add LLM call duration tracking
- Add deck execution performance metrics

### 5. **User Feedback Mechanisms** 🟡
- Add error reporting UI
- Add feedback collection
- Add usage analytics (privacy-respecting)

---

## Safe to Defer

### 1. **More Dead-Code Archaeology** ⚪
- Current cleanup is sufficient for launch
- Further cleanup can happen post-launch

### 2. **Refactoring `agentbuilder.tsx`** ⚪
- 5,183-line file is large but functional
- Splitting it is a nice-to-have, not a blocker

### 3. **Deck Runtime Redesign** ⚪
- Current v3 deck spine is good enough
- Perimeter hardening is the real work

### 4. **Fancy Provider Fallback Strategy** ⚪
- Current error handling is serviceable
- Advanced fallback can come later

### 5. **Full Observability Stack** ⚪
- Minimal logging is enough for first users
- Full APM/tracing can come later

### 6. **Graph Explore Mode Maturity** ⚪
- Current Graph View is functional
- Deep exploration features can evolve post-launch

### 7. **Pretext Integration** ⚪
- Package is installed (`@chenglou/pretext` in `client/package.json:18`)
- Plan Wiki rendering is acceptable now
- Better typography can come later
- Best future use: graph-linked narrative cards, explorer explanation blocks

---

## First Patch to Implement Now

### **Task: Implement Stable Per-User Project Access Enforcement**

This is first because everything else is secondary if users can see or mutate each other's projects.

#### Step 1: Create Ownership Middleware
```typescript
// apps/backend/src/middleware/projectOwnership.ts
import type { Request, Response, NextFunction } from 'express';
import { getProjectOwner } from '../services/agentBuilderStore';

export async function ensureProjectOwnership(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const projectId = req.params.projectId || req.body.projectId || req.query.projectId;
  const userId = req.userId; // Set by auth middleware

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!projectId) {
    return res.status(400).json({ error: 'Project ID required' });
  }

  try {
    const owner = await getProjectOwner(projectId);
    
    if (!owner) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (owner !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    next();
  } catch (error) {
    console.error('Ownership check failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

#### Step 2: Update agentBuilderStore
```typescript
// apps/backend/src/services/agentBuilderStore.ts

// Add function to get project owner
export async function getProjectOwner(projectId: string): Promise<string | null> {
  const project = await getAgentCard(projectId);
  return project?.owner || null;
}

// Update createAgentCard to require userId
export async function createAgentCard(
  userId: string, // Make required, remove env fallback
  type: string,
  ...
) {
  // Use userId directly, no fallback
  const owner = userId;
  // ...
}

// Update listAgentCards to filter by userId
export async function listAgentCards(
  userId: string, // Make required, not nullable
  type?: string
) {
  // Filter by userId, not null
  // ...
}
```

#### Step 3: Apply Middleware to Routes
```typescript
// apps/backend/src/routes/v2/projects.routes.ts
import { ensureProjectOwnership } from '../../middleware/projectOwnership';

// Apply to all project-scoped routes
router.get('/:projectId/state', ensureProjectOwnership, async (req, res) => { ... });
router.put('/:projectId/state', ensureProjectOwnership, async (req, res) => { ... });
router.delete('/:projectId', ensureProjectOwnership, async (req, res) => { ... });

// Update list to use req.userId
router.get('/', async (req, res) => {
  const projects = await listAgentCards(req.userId, ...);
  // ...
});

// Update create to use req.userId
router.post('/', async (req, res) => {
  const project = await createAgentCard(req.userId, ...);
  // ...
});
```

#### Step 4: Apply to All Project-Scoped Routes
- `apps/backend/src/routes/v2/config.routes.ts`
- `apps/backend/src/routes/v2/kg.routes.ts`
- `apps/backend/src/routes/v2/agentBuilder.routes.ts`
- `apps/backend/src/v3/routes/decks.routes.ts`
- `apps/backend/src/v3/routes/cards.routes.ts`
- `apps/backend/src/routes/knowgraph.routes.ts`

#### Step 5: Close Diagnostic Route
```typescript
// apps/backend/src/routes/index.ts
// Remove or protect:
// router.use('/diagnostic', diagnosticRoutes);

// If keeping, add auth:
router.use('/diagnostic', authMiddleware, diagnosticRoutes);
```

#### Step 6: Make Identity Durable
If keeping cookie sessions for first launch:
```typescript
// apps/backend/src/auth/sessionStore.ts
// Move from JSON files to Postgres or Redis
// Ensure sessions survive container restarts
```

#### Verification Commands
```bash
# Typecheck
npx tsc -p apps/backend/tsconfig.app.json --noEmit

# Test ownership enforcement
# (Create test that verifies user A cannot access user B's project)

# Test that diagnostic is protected
curl http://localhost:4000/api/diagnostic/schema-check
# Should return 401 or 404, not schema details
```

---

## Planning Estimate Timeline

**Note:** These are planning estimates only, not commitments.

### Week 1: Security Hardening
1. **Day 1-2:** Implement project ownership enforcement
2. **Day 3:** Close sensitive routes, add auth to diagnostic
3. **Day 4-5:** Make user identity durable (move sessions to DB/Redis)

### Week 2: Guardrails & Deploy
4. **Day 1-2:** Add rate limiting to expensive endpoints
5. **Day 3-4:** Fix Docker build path (remove `|| true`, add HTTPS)
6. **Day 5:** Add minimal request/LLM logging

### Week 3: Testing & Launch Prep
7. **Day 1-2:** Add smoke test (login → project → deck → run)
8. **Day 3:** Create production `.env.example` with docs
9. **Day 4:** Add startup health checks
10. **Day 5:** Final security review & launch

---

## Launch Checklist

### Pre-Launch Verification
- [ ] User A cannot access User B's projects
- [ ] User A cannot modify User B's decks
- [ ] Unauthenticated users cannot access protected routes
- [ ] `/api/diagnostic` is protected or removed
- [ ] Rate limiting works on auth, deck run, KG operations
- [ ] Sessions survive container restart
- [ ] HTTPS works with secure cookies
- [ ] Docker build fails fast on errors
- [ ] Health check endpoint returns 200 when ready
- [ ] Smoke test passes: login → project → deck → run

### Launch Day
- [ ] Deploy to production environment
- [ ] Verify HTTPS certificate
- [ ] Verify auth flow works
- [ ] Create test user account
- [ ] Run full smoke test in production
- [ ] Monitor logs for errors
- [ ] Set up alerting for critical errors

### Post-Launch Week 1
- [ ] Monitor user signups
- [ ] Monitor error rates
- [ ] Monitor LLM costs
- [ ] Collect user feedback
- [ ] Fix critical bugs immediately
- [ ] Plan Week 2 improvements from "Should-Fix" section

---

## Risk Assessment

### 🔴 Critical Risks (Must Fix Before Launch)
1. **Project isolation** - Users can access each other's data
2. **Auth durability** - Sessions lost on restart
3. **HTTPS/cookie mismatch** - Auth will break in production
4. **No rate limiting** - Open to abuse and cost explosion
5. **Diagnostic route exposed** - Leaks DB schema

### 🟡 High Risks (Fix Soon After Launch)
1. **Limited observability** - Hard to debug production issues
2. **No error tracking** - User errors go unnoticed
3. **Provider failures** - Poor UX when APIs fail

### 🟢 Low Risks (Can Defer)
1. **Large coordinator files** - Functional but hard to maintain
2. **Test coverage** - Core paths work, but fragile
3. **Graph UX maturity** - Functional but not polished

---

## Open Questions / Uncertain Items

### 1. **messages.routes.ts Disposition**
- **File:** `apps/backend/src/v3/routes/messages.routes.ts`
- **Status:** Currently unmounted, not part of live path
- **Possible future use:** Team-message stream surface
- **Decision needed:** Keep for future use or delete as dead code?
- **Current recommendation:** Mark as dormant, revisit after launch

### 2. **Assist vs Builder Integration**
- **Current state:** Conceptually distinct surfaces/roles in the same system
- **Integration level:** Growing integration, not fully separate or fully merged
- **Uncertainty:** Optimal long-term boundary between modes
- **Current recommendation:** Keep current integration level, evolve post-launch

### 3. **Session Storage Strategy**
- **Options:** Postgres, Redis, or keep JSON with durable volume
- **Trade-offs:** Complexity vs reliability vs operational overhead
- **Decision needed:** Which durable storage for production sessions?
- **Current recommendation:** Postgres for simplicity (already required)

### 4. **HTTPS Termination Strategy**
- **Options:** nginx SSL, reverse proxy (Cloudflare/ALB), or both
- **Uncertainty:** Production deployment environment not yet chosen
- **Decision needed:** Where does HTTPS termination happen?
- **Current recommendation:** Document reverse proxy requirement, defer nginx SSL

### 5. **Rate Limiting Thresholds**
- **Uncertainty:** Appropriate limits for auth, deck run, KG operations
- **Needs:** Real usage data to set reasonable limits
- **Current recommendation:** Start conservative, adjust based on monitoring

---

**End of Launch Readiness Document**
