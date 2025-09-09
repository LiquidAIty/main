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
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Mount auth routes (no middleware needed for auth itself)
router.use('/auth', auth);

// Mount children exactly once. Preserve existing concrete paths.
router.use('/health', health);

// Apply auth middleware to protected routes
router.use('/sol', authMiddleware, sol);
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

export default router;
