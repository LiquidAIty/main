// Entity: Building Modeling
// Relationship: This router verifies Project ownership and transports UI requests to the Python-owned OpenStudio session.
import { Router } from 'express';
import { requireOwnedProject } from './projectAccess';
import { resolveInternalMcpUrl } from '../services/mcp/internalMcpAuth';

const router = Router();
const actions = new Set(['state', 'display', 'properties', 'new', 'select', 'edit', 'save', 'reopen']);

router.all('/:projectId/:action', async (req, res) => {
  const action = String(req.params.action);
  if (!actions.has(action) || !['GET', 'POST'].includes(req.method)) {
    return res.status(404).json({ ok: false, error: 'modeling_action_not_found' });
  }
  const owned = await requireOwnedProject(req, res, String(req.params.projectId));
  if (!owned) return undefined;
  try {
    const secret = String(process.env.LIQUIDAITY_INTERNAL_MCP_SECRET || '').trim();
    if (secret.length < 32) throw new Error('internal_mcp_secret_missing');
    const endpoint = new URL(
      `/_internal/nrgsim/${encodeURIComponent(owned.projectId)}/${action}`,
      resolveInternalMcpUrl(),
    );
    const upstream = await fetch(endpoint, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'x-liquidaity-internal-mcp-secret': secret,
      },
      ...(req.method === 'POST' ? { body: JSON.stringify(req.body) } : {}),
      signal: AbortSignal.timeout(600_000),
    });
    res.status(upstream.status);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'openstudio_unavailable' });
  }
});

export default router;
