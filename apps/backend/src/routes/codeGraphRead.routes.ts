/**
 * Entity: CodeGraph
 * Relationship: This file transports one fixed projection, File expansion, or explicit Symbol source read and rejects every browser-authored provider override.
 * Entity: Authentication
 * Relationship: This file requires ownership of the exact Project and injects its canonical identity before any CodeGraph read.
 * Entity: Builder Card
 * Relationship: This file fixes browser CodeGraph authority to the persisted Builder Card and deck rather than accepting a caller-selected Card.
 */

import { Router } from 'express';

import { BUILDER_CARD_ID } from '../decks/deckDomainClient';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import {
  fetchCodeGraphRead,
  PythonRailsHttpError,
} from '../services/pythonRailsClient';
import { requireOwnedProject } from './projectAccess';

const router = Router();
const MODES = new Set(['projection', 'file', 'source']);
const FORBIDDEN_SCOPE_FIELDS = [
  'cardId', 'cbmProject', 'deckId', 'mcpUrl', 'operation', 'query', 'tool',
] as const;

function requestText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

router.post('/read', async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  if (FORBIDDEN_SCOPE_FIELDS.some(field => Object.prototype.hasOwnProperty.call(body, field))) {
    return res.status(400).json({ ok: false, error: 'codegraph_scope_override_forbidden' });
  }
  const requestedProjectId = requestText(body.projectId);
  const mode = requestText(body.mode);
  const filePath = requestText(body.filePath);
  const qualifiedName = requestText(body.qualifiedName);
  if (!requestedProjectId || !MODES.has(mode)) {
    return res.status(400).json({ ok: false, error: 'codegraph_read_scope_required' });
  }
  if (
    (mode === 'projection' && (filePath || qualifiedName))
    || (mode === 'file' && (!filePath || qualifiedName))
    || (mode === 'source' && (!qualifiedName || filePath))
  ) {
    return res.status(400).json({ ok: false, error: 'codegraph_read_selection_invalid' });
  }
  const owned = await requireOwnedProject(req, res, requestedProjectId);
  if (!owned) return undefined;
  try {
    return res.json(await fetchCodeGraphRead({
      projectId: owned.projectId,
      deckId: DEFAULT_PROJECT_DECK_ID,
      cardId: BUILDER_CARD_ID,
      mode: mode as 'projection' | 'file' | 'source',
      ...(filePath ? { filePath } : {}),
      ...(qualifiedName ? { qualifiedName } : {}),
    }));
  } catch (error) {
    const status = error instanceof PythonRailsHttpError
      && [400, 409].includes(error.status)
      ? error.status
      : 502;
    return res.status(status).json({
      ok: false,
      error: error instanceof Error ? error.message : 'codegraph_read_unavailable',
    });
  }
});

export default router;
