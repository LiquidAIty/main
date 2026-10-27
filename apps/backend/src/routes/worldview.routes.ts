/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
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
