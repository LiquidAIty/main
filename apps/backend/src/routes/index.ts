import { Router } from 'express';
import health from './health.routes';
import sol from './sol.routes';
import mcp from './mcp.routes';
import mcpCatalog from './mcp.catalog.routes';
import mcpTools from './mcp-tools.routes';
import dispatch from './dispatch.routes';
import tools from './tools.routes';
import artifacts from './artifacts.routes';
import { webhookRouter as webhook } from './webhook.routes';
import auth from './auth.routes';
import { agentRoutes } from './agent.routes';
import models from './models.routes';
import ragSearch from './ragsearch.routes';
import kg from '../api/kg/agent-kg';
import graph from './graph.routes';
import { authMiddleware } from '../middleware/auth';
import projects from './projects.routes';
import projectAgents from './projectAgents.routes';
import { diagnosticRoutes } from './diagnostic.routes';
import receipts from './receipts.routes';
import config from './config.routes';
import v2Routes from './v2';
import knowgraphRoutes from './knowgraph.routes';
import { v3Routes } from '../v3';

/**
 * LEGACY ROUTE NOTICE
 * /api/sol/run remains mounted for older Sol/LangGraph-era clients.
 * It is not the active architecture source of truth for current orchestration work.
 */
const SOL_AUTH_DISABLED =
  process.env.SOL_AUTH_DISABLED === '1' ||
  (process.env.NODE_ENV || '').toLowerCase() === 'development';

const router = Router();

// Mount auth routes (no middleware needed for auth itself)
router.use('/auth', auth);

// Mount children exactly once. Preserve existing concrete paths.
router.use('/health', health);
router.use('/diagnostic', diagnosticRoutes);

// Legacy /sol route: keep mounted for continuity only.
if (SOL_AUTH_DISABLED) {
  router.use('/sol', sol);
} else {
  router.use('/sol', authMiddleware, sol);
}
router.use('/mcp', authMiddleware, mcp);
// mcpCatalog defines routes starting with '/catalog', so mount at '/mcp'
router.use('/mcp', authMiddleware, mcpCatalog);
router.use('/mcp', authMiddleware, mcpTools);
// dispatch routes define '/dispatch' endpoints
router.use('/dispatch', authMiddleware, dispatch);
// tools routes define '/:name' and '/try/:name'; mount at '/tools' to avoid duplication
router.use('/tools', authMiddleware, tools);
router.use('/artifacts', authMiddleware, artifacts);
router.use('/webhook', authMiddleware, webhook);
router.use('/agents', authMiddleware, agentRoutes);
router.use('/graph', authMiddleware, graph);
// /projects continues to host project CRUD plus quarantined legacy/manual KG routes.
// The current active Assist surfaces are /api/agents/boss + /api/v2/projects/:projectId/kg/*.
router.use('/projects', authMiddleware, projects);
// /projects/:projectId/agents remains for config CRUD; the old agent runner path is legacy-only.
router.use('/projects', authMiddleware, projectAgents);
router.use('/models', authMiddleware, models);
router.use('/rag', authMiddleware, ragSearch);
router.use('/kg', authMiddleware, kg);
router.use('/receipts', authMiddleware, receipts);
router.use('/config', authMiddleware, config);
router.use('/knowgraph', authMiddleware, knowgraphRoutes);
router.use('/v2', authMiddleware, v2Routes);
router.use('/v3', authMiddleware, v3Routes);

export default router;
