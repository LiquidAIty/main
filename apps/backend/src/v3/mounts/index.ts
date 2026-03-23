import type { Router } from 'express';
import v3Routes from '../routes';

export function mountV3(apiRouter: Router) {
  apiRouter.use('/v3', v3Routes);
}
