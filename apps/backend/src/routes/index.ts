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
import { authMiddleware } from '../middleware/auth';

/**
 * /api/sol/run is the primary Sol chat endpoint. It can run with or without auth
 * depending on SOL_AUTH_DISABLED or NODE_ENV=development, so dev stays frictionless.
 */
const SOL_AUTH_DISABLED =
  process.env.SOL_AUTH_DISABLED === '1' ||
  (process.env.NODE_ENV || '').toLowerCase() === 'development';

const router = Router();

// Mount auth routes (no middleware needed for auth itself)
router.use('/auth', auth);

// Mount children exactly once. Preserve existing concrete paths.
router.use('/health', health);

// /sol route: auth in prod, automatic bypass in dev (toggle via SOL_AUTH_DISABLED)
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
// TODO: Restore auth middleware for /agents after testing
router.use('/agents', agentRoutes);
router.use('/models', authMiddleware, models);
router.use('/rag', authMiddleware, ragSearch);
router.use('/kg', authMiddleware, kg);

export default router;
