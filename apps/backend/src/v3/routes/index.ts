import { Router } from 'express';
import cardsRoutes from './cards.routes';
import decksRoutes from './decks.routes';
import knowledgeSeedRoutes from './knowledgeSeed.routes';

const v3Routes = Router();

v3Routes.use('/projects', cardsRoutes);
v3Routes.use('/projects', decksRoutes);
v3Routes.use('/projects', knowledgeSeedRoutes);

export default v3Routes;
