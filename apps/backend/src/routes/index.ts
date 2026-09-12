import { Router } from 'express';
import health from './health.routes';
import auth from './auth.routes';
import { authMiddleware } from '../middleware/auth';
import cardRuntime, { mainRoutes, hermesRoutes } from './cardRuntime.routes';
import cardEditor, { iddRoutes } from './cardEditor.routes';
import codegraph from './codegraph.routes';
import knowgraphRoutes from './knowgraph.routes';
import thinkgraphRoutes from './thinkgraph.routes';
import projectsRoutes from './projects.routes';
import decksRoutes from './decks.routes';
import worldsignalRoutes from './worldsignal.routes';
import config from './config.routes';
import internalMainCliRoutes, { builderCliRoutes } from './internalMainCli.routes';
import internalHermesKanbanRoutes from './internalHermesKanban.routes';
import hermesProfileRoutes from './hermesProfile.routes';
import tradingRoutes from './trading.routes';
import worldviewRoutes from './worldview.routes';
import agentTerminalRoutes from './agentTerminal.routes';

const router = Router();

// Mount auth routes (no middleware needed for auth itself)
router.use('/auth', auth);
// Native Card terminals require an existing authenticated session; never create guests.
router.use('/agent-terminals', agentTerminalRoutes);

// Mount children exactly once. Preserve existing concrete paths.
router.use('/health', health);
// Native Hermes workers call this strict socket-loopback seam before spawn.
// It is intentionally outside user/Auth0 middleware and never mounted by the
// public MCP/ngrok service.
router.use('/internal/hermes-kanban', internalHermesKanbanRoutes);
router.use('/internal/main-cli', internalMainCliRoutes);
router.use('/internal/builder-cli/:sessionId', builderCliRoutes);
router.use('/config', authMiddleware, config);
router.use('/cards', authMiddleware, cardEditor, cardRuntime);
router.use('/main', authMiddleware, mainRoutes);
router.use('/hermes', authMiddleware, hermesRoutes);
router.use('/idd', authMiddleware, iddRoutes);
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
