import { Router } from 'express';
import {
  createProjectWorldviewCapabilityStore,
  type ProjectWorldviewCapabilityStore,
} from './projectWorldviewCapabilities';
import {
  createWorldviewActionChannel,
  type WorldviewActionChannel,
} from './worldviewActionChannel';
import {
  authorizeProject,
  authorizeWorldviewRun,
  authorizeWorldviewSurface,
  patchProjectWorldviewCapabilityHandler,
  projectWorldviewCapabilitiesHandler,
  worldviewActionResultHandler,
  worldviewActionStreamHandler,
  worldviewInternalActionHandler,
  worldviewReadinessHandler,
  type ProjectAuthorizer,
} from './worldviewRouteHandlers';

const actionChannel = createWorldviewActionChannel();

export function createWorldviewRouter({
  fetcher = fetch,
  capabilityStore = createProjectWorldviewCapabilityStore(),
  projectAuthorizer = authorizeProject,
  surfaceAuthorizer = authorizeWorldviewSurface,
  channel = actionChannel,
}: {
  fetcher?: typeof fetch;
  capabilityStore?: ProjectWorldviewCapabilityStore;
  projectAuthorizer?: ProjectAuthorizer;
  surfaceAuthorizer?: typeof authorizeWorldviewSurface;
  channel?: WorldviewActionChannel;
} = {}) {
  const router = Router();

  router.get('/projects/:projectId/actions/stream',
    worldviewActionStreamHandler(projectAuthorizer, surfaceAuthorizer, channel));
  router.post('/projects/:projectId/actions/result',
    worldviewActionResultHandler(projectAuthorizer, capabilityStore, channel));
  router.get('/readiness', worldviewReadinessHandler(fetcher));
  router.get('/projects/:projectId/capabilities',
    projectWorldviewCapabilitiesHandler(projectAuthorizer, capabilityStore));
  router.patch('/projects/:projectId/capabilities/:capabilityId',
    patchProjectWorldviewCapabilityHandler(projectAuthorizer, capabilityStore));

  return router;
}

export function createWorldviewInternalRouter({
  channel = actionChannel,
  capabilityStore = createProjectWorldviewCapabilityStore(),
  runAuthorizer = authorizeWorldviewRun,
}: {
  channel?: WorldviewActionChannel;
  capabilityStore?: ProjectWorldviewCapabilityStore;
  runAuthorizer?: typeof authorizeWorldviewRun;
} = {}) {
  const router = Router();
  router.post('/internal/actions',
    worldviewInternalActionHandler(capabilityStore, channel, runAuthorizer));
  return router;
}

export const worldviewInternalRoutes = createWorldviewInternalRouter();

export default createWorldviewRouter();
