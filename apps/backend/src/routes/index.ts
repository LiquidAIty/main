import { Router } from 'express';
import health from './health.routes';
import auth from './auth.routes';
import { authMiddleware } from '../middleware/auth';
import coder from './coder.routes';
import knowgraphRoutes from './knowgraph.routes';
import thinkgraphRoutes from './thinkgraph.routes';
import projectsRoutes from './projects.routes';
import decksRoutes from './decks.routes';
import worldsignalRoutes from './worldsignal.routes';
import config from './config.routes';
import hermesKanbanRoutes from './hermesKanban.routes';
import internalHermesKanbanRoutes from './internalHermesKanban.routes';
import hermesProfileRoutes from './hermesProfile.routes';

const router = Router();

// Mount auth routes (no middleware needed for auth itself)
router.use('/auth', auth);

// Mount children exactly once. Preserve existing concrete paths.
router.use('/health', health);
// Native Hermes workers call this strict socket-loopback seam before spawn.
// It is intentionally outside user/Auth0 middleware and never mounted by the
// public MCP/ngrok service.
router.use('/internal/hermes-kanban', internalHermesKanbanRoutes);
router.use('/config', authMiddleware, config);
router.use('/coder', authMiddleware, coder);
router.use('/knowgraph', authMiddleware, knowgraphRoutes);
router.use('/thinkgraph', authMiddleware, thinkgraphRoutes);
router.use('/worldsignal', authMiddleware, worldsignalRoutes);
router.use('/projects', authMiddleware, projectsRoutes);
router.use('/projects', authMiddleware, decksRoutes);
router.use('/hermes-kanban', authMiddleware, hermesKanbanRoutes);
router.use('/hermes-profile', authMiddleware, hermesProfileRoutes);

export default router;
