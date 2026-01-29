import { Router } from 'express';
import configRoutes from './config.routes';
import kgRoutes from './kg.routes';

const router = Router();

router.use('/projects', configRoutes);
router.use('/projects/:projectId/kg', kgRoutes);

export default router;
