import { Router } from 'express';
import health from './health.routes';
import auth from './auth.routes';
import { authMiddleware } from '../middleware/auth';
import builderIddRoutes from './builderIdd.routes';
import cardOptionsRoutes from './cardOptions.routes';
import cardRunReadRoutes from './cardRunRead.routes';
import cardScriptRoutes from './cardScript.routes';
import knowGraphReadRoutes from './knowGraphRead.routes';
import knowGraphWriteRoutes from './knowGraphWrite.routes';
import thinkGraphRoutes from './thinkGraph.routes';
import projectsRoutes from './projects.routes';
import decksRoutes from './decks.routes';
import worldSignalsRoutes from './worldSignals.routes';
import tradingRoutes from './trading.routes';
import worldviewRoutes, { worldviewInternalRoutes } from './worldview.routes';
import jevGraphFocusRoutes from './jevGraphFocus.routes';
import savedSpecialistRoutes from './savedSpecialist.routes';
import sharedChatRoutes from './sharedChat.routes';
import thinkGraphRevisionRoutes from './thinkGraphRevision.routes';
import cardTerminalRoutes from './cardTerminal.routes';
import externalMainContextRoutes from './externalMainContext.routes';
import hermesProfileRoutes from './hermesProfile.routes';

const router = Router();

// Mount auth routes (no middleware needed for auth itself)
router.use('/auth', auth);
// Mount children exactly once. Preserve existing concrete paths.
router.use('/health', health);
// The official Python MCP host calls these process-secret endpoints. Mount the
// bridge before browser auth so it cannot be converted into a local-user session.
router.use('/worldview', worldviewInternalRoutes);
router.use('/saved-specialists', savedSpecialistRoutes);
router.use('/cards', authMiddleware, cardOptionsRoutes, cardRunReadRoutes, cardScriptRoutes);
router.use('/thinkgraph', authMiddleware, thinkGraphRevisionRoutes);
router.use('/shared-chat', authMiddleware, sharedChatRoutes);
router.use('/card-terminals', authMiddleware, cardTerminalRoutes);
router.use('/hermes-profile', authMiddleware, hermesProfileRoutes);
router.use('/main', externalMainContextRoutes);
router.use('/idd', authMiddleware, builderIddRoutes);
router.use('/graph', authMiddleware, jevGraphFocusRoutes);
router.use('/knowgraph', authMiddleware, knowGraphReadRoutes, knowGraphWriteRoutes);
router.use('/thinkgraph', authMiddleware, thinkGraphRoutes);
router.use('/worldsignals', authMiddleware, worldSignalsRoutes);
router.use('/projects', authMiddleware, projectsRoutes);
router.use('/projects', authMiddleware, decksRoutes);
router.use('/trading', authMiddleware, tradingRoutes);
router.use('/worldview', authMiddleware, worldviewRoutes);

export default router;
