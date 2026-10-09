import type { Request, Response } from 'express';
import { pool } from '../db/pool';
import { isLoopbackSocketRequest } from '../security/requestAccess';
import { internalMcpProcessSecretAuthorized } from '../services/mcp/internalMcpAuth';
import {
  type ProjectWorldviewCapability,
  type ProjectWorldviewCapabilityStore,
} from './projectWorldviewCapabilities';
import { requireOwnedProject } from './projectAccess';
import type { WorldviewAction, WorldviewActionChannel } from './worldviewActionChannel';

const DEFAULT_GLOBE_URL = 'http://127.0.0.1:4174';
const CAPABILITY_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SPATIAL_ACTIONS = new Set([
  'get_current_view_state',
  'get_entity_context',
  'zoom_to_globe',
  'track_entity',
  'stop_tracking',
  'focus_satellites',
  'set_layer_visibility',
]);
const MAX_ACTION_BYTES = 128 * 1024;

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

export async function authorizeWorldviewSurface(projectId: string, cardId: string): Promise<boolean> {
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

export async function authorizeWorldviewRun(action: WorldviewAction): Promise<boolean> {
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

export function resolveWorldviewGlobeUrl(
  value = process.env.WORLDVIEW_GLOBE_URL || DEFAULT_GLOBE_URL,
): URL {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('worldview_globe_url_must_be_loopback_http');
  }
  return url;
}

export function worldviewActionStreamHandler(
  projectAuthorizer: ProjectAuthorizer,
  surfaceAuthorizer: typeof authorizeWorldviewSurface,
  channel: WorldviewActionChannel,
) {
  return async (req: Request, res: Response) => {
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
  };
}

export function worldviewActionResultHandler(
  projectAuthorizer: ProjectAuthorizer,
  capabilityStore: ProjectWorldviewCapabilityStore,
  channel: WorldviewActionChannel,
) {
  return async (req: Request, res: Response) => {
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
  };
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
        adapter: {
          kind: 'python',
          contractVersion: 'card-subsystem.v1',
          presentationOrigin: globeUrl.origin,
        },
        lifecycle: {
          ownership: 'supervised-upstream',
          automaticStart: false,
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

export function worldviewInternalActionHandler(
  capabilityStore: ProjectWorldviewCapabilityStore,
  channel: WorldviewActionChannel,
  runAuthorizer: typeof authorizeWorldviewRun,
) {
  return async (req: Request, res: Response) => {
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
  };
}
