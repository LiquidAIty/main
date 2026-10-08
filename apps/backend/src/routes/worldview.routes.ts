import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool';
import { requireOwnedProject } from './projectAccess';
import { isLoopbackSocketRequest } from '../security/requestAccess';
import { internalMcpProcessSecretAuthorized } from '../services/mcp/internalMcpAuth';

const DEFAULT_GLOBE_URL = 'http://127.0.0.1:4174';

type FetchLike = typeof fetch;

const CAPABILITY_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

export type ProjectWorldviewCapability = {
  capabilityId: string;
  enabled: boolean;
  controlledBy: 'user' | 'main';
  lastOrigin: 'user' | 'main' | 'worldview_card';
  mainReason: string | null;
  updatedAt: string | null;
};

type QueryResult = { rows: any[] };
type QueryLike = (sql: string, values?: unknown[]) => Promise<QueryResult>;

type WorldviewAction = {
  projectId: string;
  deckId: string;
  cardId: string;
  parentRunId: string;
  name: string;
  arguments: Record<string, unknown>;
};

type ActionListener = {
  cardId: string;
  response: Response;
  pending: Set<string>;
};

type PendingAction = {
  projectId: string;
  cardId: string;
  name: string;
  listener: ActionListener;
  finish: (result: Record<string, unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
};

const SPATIAL_ACTIONS = new Set([
  'get_current_view_state',
  'get_entity_context',
  'zoom_to_globe',
  'track_entity',
  'stop_tracking',
  'focus_satellites',
  'set_layer_visibility',
]);
const ACTION_TIMEOUT_MS = 30_000;
const MAX_ACTION_BYTES = 128 * 1024;

/** One short-lived command lane to the existing direct mount, not a second globe. */
export function createWorldviewActionChannel() {
  const listeners = new Map<string, ActionListener>();
  const pending = new Map<string, PendingAction>();
  return {
    listen(projectId: string, cardId: string, response: Response): boolean {
      if (listeners.has(projectId)) return false;
      const listener: ActionListener = { cardId, response, pending: new Set() };
      listeners.set(projectId, listener);
      response.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      response.flushHeaders();
      response.write(': WorldView connected\n\n');
      response.on('close', () => {
        if (listeners.get(projectId) !== listener) return;
        listeners.delete(projectId);
        for (const requestId of listener.pending) {
          pending.get(requestId)?.finish({ ok: false, error: 'worldview_mount_disconnected' });
        }
      });
      return true;
    },
    async dispatch(
      action: WorldviewAction,
      disabledLayerIds: string[],
    ): Promise<Record<string, unknown>> {
      const listener = listeners.get(action.projectId);
      if (!listener || listener.cardId !== action.cardId || listener.response.destroyed) {
        return { ok: false, error: 'worldview_mount_unavailable' };
      }
      if (listener.pending.size > 0) return { ok: false, error: 'worldview_action_busy' };
      const requestId = randomUUID();
      const result = new Promise<Record<string, unknown>>((resolve) => {
        const finish = (value: Record<string, unknown>) => {
          const current = pending.get(requestId);
          if (!current) return;
          clearTimeout(current.timer);
          pending.delete(requestId);
          current.listener.pending.delete(requestId);
          resolve(value);
        };
        const timer = setTimeout(
          () => finish({ ok: false, error: 'worldview_action_timeout' }),
          ACTION_TIMEOUT_MS,
        );
        pending.set(requestId, {
          projectId: action.projectId, cardId: action.cardId,
          name: action.name, listener, finish, timer,
        });
        listener.pending.add(requestId);
      });
      try {
        listener.response.write(`event: action\ndata: ${JSON.stringify({
          requestId,
          name: action.name,
          arguments: action.arguments,
          disabledLayerIds,
        })}\n\n`);
      } catch {
        pending.get(requestId)?.finish({ ok: false, error: 'worldview_mount_disconnected' });
      }
      return result;
    },
    pendingAction(projectId: string, cardId: string, requestId: string): PendingAction | null {
      const command = pending.get(requestId);
      return command && command.projectId === projectId && command.cardId === cardId
        && listeners.get(projectId) === command.listener ? command : null;
    },
    settle(projectId: string, cardId: string, requestId: string, result: Record<string, unknown>): boolean {
      const command = pending.get(requestId);
      if (!command || command.projectId !== projectId || command.cardId !== cardId
        || listeners.get(projectId) !== command.listener) return false;
      command.finish(result);
      return true;
    },
  };
}

type WorldviewActionChannel = ReturnType<typeof createWorldviewActionChannel>;
const actionChannel = createWorldviewActionChannel();

async function authorizeWorldviewSurface(projectId: string, cardId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM ag_catalog.agent_cards AS card
     JOIN ag_catalog.agent_card_revisions AS revision
       ON revision.revision_id=card.current_revision_id
     WHERE card.project_id=$1 AND card.card_id=$2
       AND revision.runtime_kind='hermes'
       AND revision.runtime_mode='delegate'
       AND revision.runtime_profile='worldview'
       AND revision.enabled=true
     LIMIT 1`,
    [projectId, cardId],
  );
  return result.rows.length === 1;
}

async function authorizeWorldviewRun(action: WorldviewAction): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM ag_catalog.agent_runs AS run
     JOIN ag_catalog.agent_card_revisions AS revision
       ON revision.revision_id=run.target_card_revision_id
     JOIN ag_catalog.agent_cards AS card
       ON card.project_id=run.project_id
      AND card.deck_id=run.deck_id
      AND card.card_id=revision.card_id
     WHERE run.run_id=$1 AND run.project_id=$2 AND run.deck_id=$3
       AND revision.card_id=$4 AND run.state='running'
       AND card.current_revision_id=run.target_card_revision_id
       AND revision.runtime_kind='hermes'
       AND revision.runtime_mode='delegate'
       AND revision.runtime_profile='worldview'
       AND revision.enabled=true
     LIMIT 1`,
    [action.parentRunId, action.projectId, action.deckId, action.cardId],
  );
  return result.rows.length === 1;
}

function actionRequest(value: unknown): WorldviewAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).sort().join('\0') !== [
    'arguments', 'cardId', 'deckId', 'name', 'parentRunId', 'projectId',
  ].join('\0')) return null;
  const identity = ['projectId', 'deckId', 'cardId', 'parentRunId'] as const;
  if (identity.some((field) => typeof body[field] !== 'string'
    || !String(body[field]).trim() || String(body[field]).length > 200)) return null;
  if (typeof body.name !== 'string' || !SPATIAL_ACTIONS.has(body.name)) return null;
  if (!body.arguments || typeof body.arguments !== 'object' || Array.isArray(body.arguments)) {
    return null;
  }
  if (body.name === 'set_layer_visibility') {
    const args = body.arguments as Record<string, unknown>;
    if (Object.keys(args).sort().join('\0') !== 'enabled\0layerId'
      || typeof args.layerId !== 'string' || !args.layerId.trim()
      || args.layerId.length > 128 || typeof args.enabled !== 'boolean') return null;
  }
  if (body.name === 'focus_satellites') {
    const args = body.arguments as Record<string, unknown>;
    if (Object.keys(args).length !== 1 || !Object.hasOwn(args, 'noradIds')
      || !Array.isArray(args.noradIds) || args.noradIds.length > 50
      || args.noradIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null;
  }
  if (Buffer.byteLength(JSON.stringify(body.arguments)) > MAX_ACTION_BYTES) return null;
  return body as WorldviewAction;
}

export type ProjectWorldviewCapabilityStore = {
  list(projectId: string): Promise<ProjectWorldviewCapability[]>;
  set(
    projectId: string,
    capabilityId: string,
    actor: 'user' | 'main' | 'worldview_card',
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
  if (!['user', 'main', 'worldview_card'].includes(row.last_origin)) {
    throw new Error('project_worldview_capability_origin_invalid');
  }
  return {
    capabilityId: String(row.capability_id),
    enabled: userEnabled ?? mainEnabled ?? true,
    controlledBy: userEnabled !== null ? 'user' : 'main',
    lastOrigin: row.last_origin,
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
        `SELECT capability_id, main_enabled, main_reason, user_enabled, last_origin, updated_at
         FROM ag_catalog.project_worldview_capabilities
         WHERE project_id=$1
         ORDER BY capability_id`,
        [projectId],
      );
      return result.rows.map(projectCapability);
    },
    async set(projectId, capabilityId, actor, enabled, reason = null) {
      const userEnabled = actor === 'user' || actor === 'worldview_card' ? enabled : null;
      const mainEnabled = actor === 'main' ? enabled : null;
      const mainReason = actor === 'main' && reason ? reason.slice(0, 1000) : null;
      const result = await query(
        `INSERT INTO ag_catalog.project_worldview_capabilities
           (project_id, capability_id, main_enabled, main_reason, user_enabled, last_origin, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
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
             WHEN $6 IN ('user','worldview_card') THEN EXCLUDED.user_enabled
             ELSE ag_catalog.project_worldview_capabilities.user_enabled
           END,
           last_origin=EXCLUDED.last_origin,
           updated_at=NOW()
         RETURNING capability_id, main_enabled, main_reason, user_enabled, last_origin, updated_at`,
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
  surfaceAuthorizer = authorizeWorldviewSurface,
  channel = actionChannel,
}: {
  fetcher?: FetchLike;
  capabilityStore?: ProjectWorldviewCapabilityStore;
  projectAuthorizer?: ProjectAuthorizer;
  surfaceAuthorizer?: typeof authorizeWorldviewSurface;
  channel?: WorldviewActionChannel;
} = {}) {
  const router = Router();

  router.get('/projects/:projectId/actions/stream', async (req, res) => {
    const projectId = String(req.params.projectId || '').trim();
    const cardId = typeof req.query.cardId === 'string' ? req.query.cardId.trim() : '';
    if (!projectId || !cardId || cardId.length > 200) {
      return res.status(400).json({ ok: false, error: 'worldview_surface_scope_invalid' });
    }
    try {
      if (!await projectAuthorizer(req, res, projectId)) return;
      if (!await surfaceAuthorizer(projectId, cardId)) {
        return res.status(403).json({ ok: false, error: 'worldview_card_unavailable' });
      }
      if (!channel.listen(projectId, cardId, res)) {
        return res.status(409).json({ ok: false, error: 'worldview_mount_ambiguous' });
      }
      return;
    } catch {
      return res.status(503).json({ ok: false, error: 'worldview_action_stream_unavailable' });
    }
  });

  router.post('/projects/:projectId/actions/result', async (req, res) => {
    const projectId = String(req.params.projectId || '').trim();
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown> : null;
    const cardId = typeof body?.cardId === 'string' ? body.cardId.trim() : '';
    const requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : '';
    const result = body?.result && typeof body.result === 'object' && !Array.isArray(body.result)
      ? body.result as Record<string, unknown> : null;
    if (!projectId || !cardId || !/^[0-9a-f-]{36}$/.test(requestId)
      || !result || typeof result.ok !== 'boolean'
      || Object.keys(body || {}).sort().join('\0') !== 'cardId\0requestId\0result'
      || Buffer.byteLength(JSON.stringify(result)) > MAX_ACTION_BYTES) {
      return res.status(400).json({ ok: false, error: 'worldview_action_result_invalid' });
    }
    try {
      if (!await projectAuthorizer(req, res, projectId)) return;
      const command = channel.pendingAction(projectId, cardId, requestId);
      if (!command) {
        return res.status(409).json({ ok: false, error: 'worldview_action_result_stale' });
      }
      let capability: ProjectWorldviewCapability | null = null;
      if (command.name === 'set_layer_visibility' && result.ok === true) {
        if (result.action !== 'set_layer_visibility'
          || typeof result.layerId !== 'string' || !CAPABILITY_ID.test(result.layerId)
          || typeof result.enabled !== 'boolean') {
          channel.settle(projectId, cardId, requestId, {
            ok: false, error: 'worldview_layer_readback_invalid',
          });
          return res.status(400).json({ ok: false, error: 'worldview_layer_readback_invalid' });
        }
        capability = await capabilityStore.set(
          projectId, result.layerId, 'worldview_card', result.enabled,
        );
      }
      const settled = capability ? { ...result, projectCapability: capability } : result;
      if (!channel.settle(projectId, cardId, requestId, settled)) {
        return res.status(409).json({ ok: false, error: 'worldview_action_result_stale' });
      }
      return res.json({ ok: true, capability });
    } catch {
      channel.settle(projectId, cardId, requestId, {
        ok: false, error: 'project_worldview_write_failed',
      });
      return res.status(503).json({ ok: false, error: 'worldview_action_result_unavailable' });
    }
  });

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
        subsystemAgents: {
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
        subsystemAgents: {
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
  router.post('/internal/actions', async (req, res) => {
    if (!isLoopbackSocketRequest(req)
      || !internalMcpProcessSecretAuthorized(req.headers['x-liquidaity-internal-mcp-secret'])) {
      return res.status(403).json({ ok: false, error: 'worldview_action_authorization_required' });
    }
    const action = actionRequest(req.body);
    if (!action) return res.status(400).json({ ok: false, error: 'worldview_action_request_invalid' });
    try {
      if (!await runAuthorizer(action)) {
        return res.status(403).json({ ok: false, error: 'worldview_card_run_unavailable' });
      }
      const capabilities = await capabilityStore.list(action.projectId);
      const disabledLayerIds = capabilities.filter((row) => !row.enabled)
        .map((row) => row.capabilityId);
      const result = await channel.dispatch(action, disabledLayerIds);
      return res.json({ ok: true, result });
    } catch {
      return res.status(503).json({ ok: false, error: 'worldview_action_execution_unavailable' });
    }
  });
  return router;
}

export const worldviewInternalRoutes = createWorldviewInternalRouter();

export default createWorldviewRouter();
