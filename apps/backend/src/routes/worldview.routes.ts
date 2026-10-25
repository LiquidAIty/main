/**
 * Entity: WorldView
 * Relationship: WorldView exposes readiness and persisted Project capability controls.
 */

import { Router } from 'express';
import {
  createProjectWorldviewCapabilityStore,
  type ProjectWorldviewCapabilityStore,
} from './projectWorldviewCapabilities';
import {
  authorizeProject,
  patchProjectWorldviewCapabilityHandler,
  projectWorldviewCapabilitiesHandler,
  worldviewReadinessHandler,
  type ProjectAuthorizer,
} from './worldviewRouteHandlers';

export function createWorldviewRouter({
  fetcher = fetch,
  capabilityStore = createProjectWorldviewCapabilityStore(),
  projectAuthorizer = authorizeProject,
}: {
  fetcher?: typeof fetch;
  capabilityStore?: ProjectWorldviewCapabilityStore;
  projectAuthorizer?: ProjectAuthorizer;
} = {}) {
  const router = Router();

  router.get('/readiness', worldviewReadinessHandler(fetcher));
  router.get('/projects/:projectId/capabilities',
    projectWorldviewCapabilitiesHandler(projectAuthorizer, capabilityStore));
  router.patch('/projects/:projectId/capabilities/:capabilityId',
    patchProjectWorldviewCapabilityHandler(projectAuthorizer, capabilityStore));

  return router;
}

export default createWorldviewRouter();
