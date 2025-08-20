import { Router } from 'express';
import health from './health.routes';
import sol from './sol.routes';
import mcp from './mcp.routes';
import mcpCatalog from './mcp.catalog.routes';
import tools from './tools.routes';
import { webhookRouter as webhook } from './webhook.routes';

const router = Router();

// Mount children exactly once. Preserve existing concrete paths.
router.use('/health', health);
router.use('/sol', sol);
router.use('/mcp', mcp);
// mcpCatalog defines routes starting with '/catalog', so mount at '/mcp'
router.use('/mcp', mcpCatalog);
// tools.routes defines '/tools/:name' and '/try/:name'; mount at root to avoid duplication
router.use('/', tools);
router.use('/webhook', webhook);

export default router;
