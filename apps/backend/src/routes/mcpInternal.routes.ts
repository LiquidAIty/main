/**
 * Entity: External MCP
 * Relationship: Resolves a verified external identity to one owned Project, persisted Card profile, active Run, and exact saved tool-grant ceiling.
 *
 * Entity: Card Editor
 * Relationship: Returns the canonical editor projection for one exact Project, deck, and Card only to the supervised internal MCP process.
 */

import { Router, type Request } from 'express';

import { resolveExternalIdentityProjectGrant } from '../auth/externalIdentityGrantStore';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { getDeckDocument } from '../decks/deckDomainClient';
import { readCardRun } from '../services/cardRunLifecycle';
import { internalMcpProcessSecretAuthorized } from '../services/mcp/internalMcpAuth';
import { getOwnedProjectByReference } from '../services/projectStore';
import { materializeCardEditor } from './builderIdd.routes';
import { exactStrings, objectRecord } from '../services/projectCardAuthority';

const mcpInternalRoutes = Router();

function processAuthorized(req: Request): boolean {
  return internalMcpProcessSecretAuthorized(req.headers['x-liquidaity-internal-mcp-secret']);
}

mcpInternalRoutes.post('/context', async (req, res) => {
  if (!processAuthorized(req)) {
    return res.status(403).json({ ok: false, error: 'internal_mcp_authorization_required' });
  }
  const issuer = String(req.body?.issuer || '').trim();
  const subject = String(req.body?.subject || '').trim();
  const requestedProjectId = String(req.body?.projectId || '').trim();
  const profile = String(req.body?.profile || '').trim();
  const requestedRunId = String(req.body?.runId || '').trim();
  if (!issuer || !subject) {
    return res.status(400).json({ ok: false, error: 'verified_issuer_and_subject_required' });
  }
  try {
    const grant = await resolveExternalIdentityProjectGrant(issuer, subject);
    if (!grant) {
      return res.status(403).json({ ok: false, error: 'external_identity_grant_required' });
    }
    const project = requestedProjectId
      ? await getOwnedProjectByReference(requestedProjectId, grant.userId)
      : await getOwnedProjectByReference(grant.projectId, grant.userId);
    if (!project) {
      return res.status(403).json({ ok: false, error: 'external_identity_project_access_denied' });
    }
    const { deck } = await getDeckDocument(project.id, DEFAULT_PROJECT_DECK_ID);
    const matchingCards = (deck?.nodes || []).filter((card) => (
      card.runtime.kind === 'hermes'
      && card.enabled !== false
      && (
        profile
          ? card.runtime.profile.toLowerCase() === profile.toLowerCase()
          : card.runtime.mode === 'main'
      )
    ));
    if (matchingCards.length !== 1) {
      return res.status(409).json({ ok: false, error: 'persisted_hermes_profile_unavailable' });
    }
    const matchedCard = matchingCards[0];
    const grantedTools = exactStrings(objectRecord(matchedCard.runtimeOptions).tools);
    let parentRunId = '';
    if (requestedRunId) {
      const run = await readCardRun({
        projectId: project.id,
        deckId: DEFAULT_PROJECT_DECK_ID,
        runId: requestedRunId,
        cardId: matchedCard.id,
        profile: matchedCard.runtime.profile,
      });
      if (!['pending', 'running'].includes(String(run.state || ''))) {
        return res.status(409).json({ ok: false, error: 'card_turn_run_unavailable' });
      }
      parentRunId = requestedRunId;
    }
    return res.json({
      ok: true,
      context: {
        projectId: project.id,
        deckId: DEFAULT_PROJECT_DECK_ID,
        conversationId: project.id,
        parentRunId,
        callerCardId: matchedCard.id,
        grantedTools,
      },
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'external_mcp_context_failed',
    });
  }
});

mcpInternalRoutes.post('/card-editor', async (req, res) => {
  if (!processAuthorized(req)) {
    return res.status(403).json({ ok: false, error: 'internal_mcp_authorization_required' });
  }
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || '').trim();
  const cardId = String(req.body?.cardId || '').trim();
  if (!projectId || !deckId || !cardId) {
    return res.status(400).json({ ok: false, error: 'card_editor_scope_required' });
  }
  try {
    return res.json({ ok: true, ...(await materializeCardEditor(projectId, deckId, cardId)) });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : 'card_editor_context_unavailable',
    });
  }
});

export default mcpInternalRoutes;
