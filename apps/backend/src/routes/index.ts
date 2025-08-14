import { Router } from 'express';
import { solRouter } from './sol.routes';
import { healthRouter } from './health.routes';

export const appRouter = Router();

appRouter.use('/agents/sol', solRouter);
appRouter.use('/health', healthRouter);
