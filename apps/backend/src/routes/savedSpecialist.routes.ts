import { Router } from 'express';

import { savedSpecialistRun } from './savedSpecialistRun';

export function createSavedSpecialistRouter(): Router {
  const router = Router();
  router.post('/invoke', savedSpecialistRun);
  return router;
}

const savedSpecialistRoutes = createSavedSpecialistRouter();
export default savedSpecialistRoutes;
