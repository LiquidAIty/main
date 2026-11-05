/**
 * Entity: WorldView
 * Relationship: Serves Project capability state and bounded readiness for the one Earth surface.
 */

import type { Request, Response } from 'express';
import {
  type ProjectWorldviewCapabilityStore,
} from './projectWorldviewCapabilities';
import { requireOwnedProject } from './projectAccess';

const DEFAULT_GLOBE_URL = 'http://127.0.0.1:4174';
const CAPABILITY_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

export type ProjectAuthorizer = (
  req: Request,
  res: Response,
  projectId: string,
) => Promise<boolean>;

export async function authorizeProject(
  req: Request,
  res: Response,
  projectId: string,
): Promise<boolean> {
  return Boolean(await requireOwnedProject(req, res, projectId));
}

export function resolveWorldviewGlobeUrl(
  value = process.env.WORLDVIEW_GLOBE_URL || DEFAULT_GLOBE_URL,
): URL {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('worldview_globe_url_must_be_loopback_http');
  }
  return url;
}

export function worldviewReadinessHandler(fetcher: typeof fetch) {
  return async (_req: Request, res: Response) => {
    let globeUrl: URL;
    try {
      globeUrl = resolveWorldviewGlobeUrl();
    } catch (error) {
      return res.status(503).json({
        status: 'offline',
        diagnostics: error instanceof Error ? error.message : 'worldview_globe_url_invalid',
      });
    }
    try {
      const response = await fetcher(globeUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(2_500),
      });
      if (!response.ok) throw new Error(`worldview_globe_http_${response.status}`);
      return res.json({
        status: 'ready',
        lifecycle: {
          ownership: 'supervised-upstream',
          automaticStart: false,
        },
        diagnostics: null,
      });
    } catch (error) {
      return res.status(503).json({
        status: 'offline',
        lifecycle: { ownership: 'supervised-upstream', automaticStart: false },
        diagnostics: error instanceof Error ? error.message : 'worldview_globe_unavailable',
      });
    }
  };
}

export function projectWorldviewCapabilitiesHandler(
  projectAuthorizer: ProjectAuthorizer,
  capabilityStore: ProjectWorldviewCapabilityStore,
) {
  return async (req: Request, res: Response) => {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ ok: false, error: 'project_id_required' });
    try {
      if (!await projectAuthorizer(req, res, projectId)) return;
      return res.json({
        ok: true,
        projectId,
        defaultEnabled: true,
        capabilities: await capabilityStore.list(projectId),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'project_worldview_read_failed',
      });
    }
  };
}

export function patchProjectWorldviewCapabilityHandler(
  projectAuthorizer: ProjectAuthorizer,
  capabilityStore: ProjectWorldviewCapabilityStore,
) {
  return async (req: Request, res: Response) => {
    const projectId = String(req.params.projectId || '').trim();
    const capabilityId = String(req.params.capabilityId || '').trim();
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : null;
    if (!projectId) return res.status(400).json({ ok: false, error: 'project_id_required' });
    if (!CAPABILITY_ID.test(capabilityId)) {
      return res.status(400).json({ ok: false, error: 'worldview_capability_id_invalid' });
    }
    if (!body || Object.keys(body).some((key) => key !== 'enabled')
      || typeof body.enabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'worldview_capability_patch_invalid' });
    }
    try {
      if (!await projectAuthorizer(req, res, projectId)) return;
      const capability = await capabilityStore.set(
        projectId,
        capabilityId,
        'user',
        body.enabled,
      );
      return res.json({ ok: true, projectId, capability });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'project_worldview_write_failed',
      });
    }
  };
}
