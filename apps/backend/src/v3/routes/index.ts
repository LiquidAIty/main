import { Router } from 'express';
import knowledgeSeedRoutes from './knowledgeSeed.routes';
import mediaVideoRoutes from './mediaVideo.routes';

const v3Routes = Router();

v3Routes.use('/projects', knowledgeSeedRoutes);
v3Routes.use('/projects', mediaVideoRoutes);

export default v3Routes;
