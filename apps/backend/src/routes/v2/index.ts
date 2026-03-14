import { Router } from 'express';
import configRoutes from './config.routes';
import agentBuilderRoutes from './agentBuilder.routes';
import kgRoutes from './kg.routes';
import projectRoutes from './projects.routes';
import devRoutes from './dev.routes';

const router = Router();

router.use('/projects', projectRoutes);
router.use('/projects', configRoutes);
router.use('/projects', agentBuilderRoutes);
router.use('/projects/:projectId/kg', kgRoutes);
router.use('/dev', devRoutes);

export default router;
