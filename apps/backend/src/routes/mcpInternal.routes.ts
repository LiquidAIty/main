// Entity: MCP Host
// Relationship: This file exposes process-secret-only context and Card-editor projections to the supervised MCP host without creating a public arbitrary-Card API.
// Entity: Authentication
// Relationship: This file resolves a verified external issuer and subject to one existing local user grant before exposing application context.
// Entity: Credentials
// Relationship: This file rejects every internal request that does not carry the exact shared MCP process secret.
// Entity: Projects
// Relationship: This file binds external context to one Project actually owned by the granted local user.
// Entity: Saved Cards
// Relationship: This file resolves one enabled persisted Card and returns only its exact profile, caller identity, and saved tool ceiling.
// Entity: Run Ledger
// Relationship: This file accepts an optional parent Run only when it matches the resolved Card and remains pending or running.
// Entity: IDD
// Relationship: This file returns the canonical Card-editor materialization for one exact Project, deck, and Card to the internal MCP process.

import { Router, type Request } from 'express';

import { resolveExternalIdentityProjectGrant } from '../auth/externalIdentityGrantStore';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { getDeckDocument } from '../decks/deckDomainClient';
import { readCardRun } from '../services/cardRunLifecycle';
import { CARD_RUNTIME_CONTRACT } from '../services/cardRuntimeGateway';
import { internalMcpProcessSecretAuthorized } from '../services/mcp/internalMcpAuth';
import { getOwnedProjectByReference } from '../services/projectStore';
import { materializeCardEditor } from './builderIdd.routes';
import {
  exactStrings,
  objectRecord,
  projectCardAuthority,
} from '../services/projectCardAuthority';

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
      card.runtime.kind === CARD_RUNTIME_CONTRACT.kind
      && card.enabled !== false
      && (
        profile
          ? card.runtime.profile.toLowerCase() === profile.toLowerCase()
          : card.runtime.mode === 'main'
      )
    ));
    if (matchingCards.length !== 1) {
      return res.status(409).json({ ok: false, error: 'persisted_card_profile_unavailable' });
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
        mainEntryAuthorized: matchedCard.runtime.mode === 'main',
      },
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'external_mcp_context_failed',
    });
  }
});

mcpInternalRoutes.post('/card-context', async (req, res) => {
  if (!processAuthorized(req)) {
    return res.status(403).json({ ok: false, error: 'internal_mcp_authorization_required' });
  }
  const projectId = String(req.body?.projectId || '').trim();
  const deckId = String(req.body?.deckId || '').trim();
  const profile = String(req.body?.profile || '').trim().toLowerCase();
  const conversationId = String(req.body?.conversationId || '').trim();
  const runId = String(req.body?.runId || '').trim();
  if (!projectId || !deckId || !profile || !conversationId || !runId) {
    return res.status(400).json({ ok: false, error: 'card_runtime_context_required' });
  }
  try {
    const authority = await projectCardAuthority(projectId, deckId);
    const matches = authority.cards.filter((candidate) => (
      candidate.card.enabled !== false
      && candidate.card.runtime.kind === CARD_RUNTIME_CONTRACT.kind
      && candidate.profile.toLowerCase() === profile
    ));
    if (matches.length !== 1) {
      return res.status(409).json({ ok: false, error: 'persisted_card_profile_unavailable' });
    }
    const matched = matches[0];
    const run = await readCardRun({
      projectId,
      deckId,
      runId,
      cardId: matched.card.id,
      profile: matched.profile,
      conversationId,
    });
    if (!['pending', 'running'].includes(String(run.state || ''))) {
      return res.status(409).json({ ok: false, error: 'card_turn_run_unavailable' });
    }
    return res.json({
      ok: true,
      context: {
        projectId,
        deckId,
        conversationId,
        parentRunId: runId,
        callerCardId: matched.card.id,
        grantedTools: exactStrings(objectRecord(matched.card.runtimeOptions).tools),
        mainEntryAuthorized: false,
      },
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'card_runtime_context_failed',
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
