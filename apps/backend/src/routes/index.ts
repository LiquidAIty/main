import { Router } from 'express';
import health from './health.routes';
import auth from './auth.routes';
import { authMiddleware } from '../middleware/auth';
import cardRuntime, {
  internalMainMcpRoutes,
  mainRoutes,
} from './cardRuntime.routes';
import cardEditor, { iddRoutes } from './cardEditor.routes';
import codegraph from './codegraph.routes';
import knowgraphRoutes from './knowgraph.routes';
import thinkgraphRoutes from './thinkgraph.routes';
import projectsRoutes from './projects.routes';
import decksRoutes from './decks.routes';
import worldsignalRoutes from './worldsignal.routes';
import config from './config.routes';
import hermesProfileRoutes from './hermesProfile.routes';
import tradingRoutes from './trading.routes';
import worldviewRoutes from './worldview.routes';
import agentTerminalRoutes from './agentTerminal.routes';
import hermesCardToolsRoutes from './hermesCardTools.routes';
import graphRoutes from './graph.routes';

const router = Router();

// Mount auth routes (no middleware needed for auth itself)
router.use('/auth', auth);
// Native Card terminals require an existing authenticated session; never create guests.
router.use('/agent-terminals', agentTerminalRoutes);

// Mount children exactly once. Preserve existing concrete paths.
router.use('/health', health);
// The official Python MCP host calls these process-secret endpoints. Mount the
// bridge before browser auth so it cannot be converted into an anonymous user.
router.use('/main', internalMainMcpRoutes);
router.use('/hermes-card-tools', hermesCardToolsRoutes);
router.use('/config', authMiddleware, config);
router.use('/cards', authMiddleware, cardEditor, cardRuntime);
router.use('/main', authMiddleware, mainRoutes);
router.use('/idd', authMiddleware, iddRoutes);
router.use('/graph', authMiddleware, graphRoutes);
router.use('/codegraph', authMiddleware, codegraph);
router.use('/knowgraph', authMiddleware, knowgraphRoutes);
router.use('/thinkgraph', authMiddleware, thinkgraphRoutes);
router.use('/worldsignal', authMiddleware, worldsignalRoutes);
router.use('/projects', authMiddleware, projectsRoutes);
router.use('/projects', authMiddleware, decksRoutes);
router.use('/hermes-profile', authMiddleware, hermesProfileRoutes);
router.use('/trading', authMiddleware, tradingRoutes);
router.use('/worldview', authMiddleware, worldviewRoutes);

export default router;
