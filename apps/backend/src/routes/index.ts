import { Router } from 'express';
import health from './health.routes';
import artifacts from './artifacts.routes';
import auth from './auth.routes';
import ragSearch from './ragsearch.routes';
import kg from '../api/kg/agent-kg';
import graph from './graph.routes';
import { authMiddleware } from '../middleware/auth';
import { diagnosticRoutes } from './diagnostic.routes';
import receipts from './receipts.routes';
import config from './config.routes';
import coder from './coder.routes';
import knowgraphRoutes from './knowgraph.routes';
import thinkgraphRoutes from './thinkgraph.routes';
import codegraphRoutes from './codegraph.routes';
import projectsRoutes from './projects.routes';
import decksRoutes from './decks.routes';
import kgRoutes from './kg.routes';
import devRoutes from './dev.routes';
import worldsignalRoutes from './worldsignal.routes';
import knowledgeSeedRoutes from './knowledgeSeed.routes';
import unifiedRoutes from './unified.routes';

const router = Router();

// Mount auth routes (no middleware needed for auth itself)
router.use('/auth', auth);

// Mount children exactly once. Preserve existing concrete paths.
router.use('/health', health);
router.use('/diagnostic', diagnosticRoutes);

router.use('/artifacts', authMiddleware, artifacts);
router.use('/graph', authMiddleware, graph);
router.use('/rag', authMiddleware, ragSearch);
router.use('/kg', authMiddleware, kg);
router.use('/receipts', authMiddleware, receipts);
router.use('/config', authMiddleware, config);
router.use('/coder', authMiddleware, coder);
router.use('/knowgraph', authMiddleware, knowgraphRoutes);
router.use('/thinkgraph', authMiddleware, thinkgraphRoutes);
router.use('/codegraph', authMiddleware, codegraphRoutes);
router.use('/unified', authMiddleware, unifiedRoutes);
router.use('/dev', authMiddleware, devRoutes);
router.use('/worldsignal', authMiddleware, worldsignalRoutes);
router.use('/projects', authMiddleware, projectsRoutes);
router.use('/projects', authMiddleware, decksRoutes);
router.use('/projects/:projectId/kg', authMiddleware, kgRoutes);
router.use('/projects', authMiddleware, knowledgeSeedRoutes);

export default router;
