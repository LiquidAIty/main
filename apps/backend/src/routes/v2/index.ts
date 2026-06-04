import { Router } from 'express';
import devRoutes from './dev.routes';
import worldsignalRoutes from './worldsignal.routes';

const router = Router();

router.use('/dev', devRoutes);
router.use('/worldsignal', worldsignalRoutes);

export default router;
