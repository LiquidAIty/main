// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: Application Startup
// Relationship: This file composes the backend API by mounting every public, process-secret, and authenticated feature router beneath its stable path exactly once.

import { Router } from 'express';
import health from './health.routes';
import auth from './auth.routes';
import { authMiddleware } from '../middleware/auth';
import cardTerminalRoutes from './cardTerminal.routes';
import builderIddRoutes from './builderIdd.routes';
import cardOptionsRoutes from './cardOptions.routes';
import knowGraphReadRoutes from './knowGraphRead.routes';
import knowGraphWriteRoutes from './knowGraphWrite.routes';
import thinkGraphRoutes from './thinkGraph.routes';
import projectsRoutes from './projects.routes';
import decksRoutes from './decks.routes';
import worldSignalsRoutes from './worldSignals.routes';
import tradingRoutes from './trading.routes';
import worldviewRoutes from './worldview.routes';
import jevGraphFocusRoutes from './jevGraphFocus.routes';
import mcpInternalRoutes from './mcpInternal.routes';
import codeGraphReadRoutes from './codeGraphRead.routes';
import nrgsimRoutes from './nrgsim.routes';
import mainSessionRoutes from './mainSession.routes';

const router = Router();

// Mount auth routes (no middleware needed for auth itself)
router.use('/auth', auth);
// Mount children exactly once. Preserve existing concrete paths.
router.use('/health', health);
// The official Python MCP host calls these process-secret endpoints. Mount the
// bridge before browser auth so it cannot be converted into a local-user session.
router.use('/cards', authMiddleware, cardOptionsRoutes);
router.use('/mcp', mcpInternalRoutes);
router.use('/idd', authMiddleware, builderIddRoutes);
router.use('/graph', authMiddleware, jevGraphFocusRoutes);
router.use('/codegraph', authMiddleware, codeGraphReadRoutes);
router.use('/knowgraph', authMiddleware, knowGraphReadRoutes, knowGraphWriteRoutes);
router.use('/thinkgraph', authMiddleware, thinkGraphRoutes);
router.use('/worldsignals', authMiddleware, worldSignalsRoutes);
router.use('/projects', authMiddleware, projectsRoutes);
router.use('/projects', authMiddleware, decksRoutes);
router.use('/trading', authMiddleware, tradingRoutes);
router.use('/worldview', authMiddleware, worldviewRoutes);
router.use('/nrgsim', authMiddleware, nrgsimRoutes);
router.use('/main/session', authMiddleware, mainSessionRoutes);
router.use('/card-terminals', authMiddleware, cardTerminalRoutes);

export default router;
