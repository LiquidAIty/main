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

const router = Router();

// Mount children exactly once. Preserve existing concrete paths.
router.use('/health', health);
router.use('/sol', sol);
router.use('/mcp', mcp);
// mcpCatalog defines routes starting with '/catalog', so mount at '/mcp'
router.use('/mcp', mcpCatalog);
router.use('/mcp', mcpTools);
// dispatch routes define '/dispatch' endpoints
router.use('/dispatch', dispatch);
// tools routes define '/:name' and '/try/:name'; mount at '/tools' to avoid duplication
router.use('/tools', tools);
router.use('/artifacts', artifacts);
router.use('/webhook', webhook);

export default router;
