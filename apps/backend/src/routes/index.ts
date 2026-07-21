import { Router } from 'express';
import health from './health.routes';
import auth from './auth.routes';
import { authMiddleware } from '../middleware/auth';
import coder from './coder.routes';
import knowgraphRoutes from './knowgraph.routes';
import thinkgraphRoutes from './thinkgraph.routes';
import codegraphRoutes from './codegraph.routes';
import projectsRoutes from './projects.routes';
import decksRoutes from './decks.routes';
import worldsignalRoutes from './worldsignal.routes';
import unifiedRoutes from './unified.routes';

const router = Router();

// Mount auth routes (no middleware needed for auth itself)
router.use('/auth', auth);

// Mount children exactly once. Preserve existing concrete paths.
router.use('/health', health);
router.use('/coder', authMiddleware, coder);
router.use('/knowgraph', authMiddleware, knowgraphRoutes);
router.use('/thinkgraph', authMiddleware, thinkgraphRoutes);
router.use('/codegraph', authMiddleware, codegraphRoutes);
router.use('/unified', authMiddleware, unifiedRoutes);
router.use('/worldsignal', authMiddleware, worldsignalRoutes);
router.use('/projects', authMiddleware, projectsRoutes);
router.use('/projects', authMiddleware, decksRoutes);

export default router;
