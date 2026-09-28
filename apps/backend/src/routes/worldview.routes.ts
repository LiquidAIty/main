import { Router } from 'express';
import type { Request, Response } from 'express';
import { pool } from '../db/pool';
import { requireOwnedProject } from './projectAccess';

const DEFAULT_GLOBE_URL = 'http://127.0.0.1:4174';

type FetchLike = typeof fetch;

const CAPABILITY_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

export type ProjectWorldviewCapability = {
  capabilityId: string;
  enabled: boolean;
  controlledBy: 'user' | 'main';
  mainReason: string | null;
  updatedAt: string | null;
};

type QueryResult = { rows: any[] };
type QueryLike = (sql: string, values?: unknown[]) => Promise<QueryResult>;

export type ProjectWorldviewCapabilityStore = {
  list(projectId: string): Promise<ProjectWorldviewCapability[]>;
  set(
    projectId: string,
    capabilityId: string,
    actor: 'user' | 'main',
    enabled: boolean,
    reason?: string | null,
  ): Promise<ProjectWorldviewCapability>;
};

function projectCapability(row: any): ProjectWorldviewCapability {
  const userEnabled = typeof row.user_enabled === 'boolean' ? row.user_enabled : null;
  const mainEnabled = typeof row.main_enabled === 'boolean' ? row.main_enabled : null;
  if (userEnabled === null && mainEnabled === null) {
    throw new Error('project_worldview_capability_state_invalid');
  }
  return {
    capabilityId: String(row.capability_id),
    enabled: userEnabled ?? mainEnabled ?? true,
    controlledBy: userEnabled !== null ? 'user' : 'main',
    mainReason: row.main_reason == null ? null : String(row.main_reason),
    updatedAt: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : (row.updated_at == null ? null : String(row.updated_at)),
  };
}

export function createProjectWorldviewCapabilityStore(
  query: QueryLike = pool.query.bind(pool),
): ProjectWorldviewCapabilityStore {
  return {
    async list(projectId) {
      const result = await query(
        `SELECT capability_id, main_enabled, main_reason, user_enabled, updated_at
         FROM ag_catalog.project_worldview_capabilities
         WHERE project_id=$1
         ORDER BY capability_id`,
        [projectId],
      );
      return result.rows.map(projectCapability);
    },
    async set(projectId, capabilityId, actor, enabled, reason = null) {
      const userEnabled = actor === 'user' ? enabled : null;
      const mainEnabled = actor === 'main' ? enabled : null;
      const mainReason = actor === 'main' && reason ? reason.slice(0, 1000) : null;
      const result = await query(
        `INSERT INTO ag_catalog.project_worldview_capabilities
           (project_id, capability_id, main_enabled, main_reason, user_enabled, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (project_id, capability_id) DO UPDATE SET
           main_enabled=CASE
             WHEN $6='main' THEN EXCLUDED.main_enabled
             ELSE ag_catalog.project_worldview_capabilities.main_enabled
           END,
           main_reason=CASE
             WHEN $6='main' THEN EXCLUDED.main_reason
             ELSE ag_catalog.project_worldview_capabilities.main_reason
           END,
           user_enabled=CASE
             WHEN $6='user' THEN EXCLUDED.user_enabled
             ELSE ag_catalog.project_worldview_capabilities.user_enabled
           END,
           updated_at=NOW()
         RETURNING capability_id, main_enabled, main_reason, user_enabled, updated_at`,
        [projectId, capabilityId, mainEnabled, mainReason, userEnabled, actor],
      );
      if (result.rows.length !== 1) {
        throw new Error('project_worldview_capability_write_failed');
      }
      return projectCapability(result.rows[0]);
    },
  };
}

type ProjectAuthorizer = (
  req: Request,
  res: Response,
  projectId: string,
) => Promise<boolean>;

async function authorizeProject(
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

export function createWorldviewRouter({
  fetcher = fetch,
  capabilityStore = createProjectWorldviewCapabilityStore(),
  projectAuthorizer = authorizeProject,
}: {
  fetcher?: FetchLike;
  capabilityStore?: ProjectWorldviewCapabilityStore;
  projectAuthorizer?: ProjectAuthorizer;
} = {}) {
  const router = Router();

  router.get('/readiness', async (_req, res) => {
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
        adapter: {
          kind: 'python',
          contractVersion: 'card-subsystem.v1',
          presentationOrigin: globeUrl.origin,
        },
        lifecycle: {
          ownership: 'supervised-upstream',
          automaticStart: false,
        },
        nativeAgents: {
          realtimeVoice: {
            policy: 'user-initiated',
            active: null,
            runtimeState: 'ui-handshake-required',
          },
        },
        diagnostics: null,
      });
    } catch (error) {
      return res.status(503).json({
        status: 'offline',
        adapter: {
          kind: 'python',
          contractVersion: 'card-subsystem.v1',
          presentationOrigin: globeUrl.origin,
        },
        lifecycle: { ownership: 'supervised-upstream', automaticStart: false },
        nativeAgents: {
          realtimeVoice: { policy: 'user-initiated', active: null },
        },
        diagnostics: error instanceof Error ? error.message : 'worldview_globe_unavailable',
      });
    }
  });

  router.get('/projects/:projectId/capabilities', async (req, res) => {
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
  });

  router.patch('/projects/:projectId/capabilities/:capabilityId', async (req, res) => {
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
  });

  return router;
}

export default createWorldviewRouter();
