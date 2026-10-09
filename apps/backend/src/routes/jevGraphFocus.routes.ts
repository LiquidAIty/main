import { Router } from 'express';

import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { requireOwnedProject } from './projectAccess';

type RequestRails = typeof requestPythonRailsJson;

type JevGraphFocusRouterDependencies = {
  requestRails?: RequestRails;
};

const REQUEST_KEYS = [
  'schemaVersion', 'sourceRevision', 'projectId', 'center', 'candidates',
] as const;
const CENTER_KEYS = ['visualId', 'title', 'providerMembers'] as const;
const MEMBER_KEYS = ['authority', 'entityId', 'title'] as const;
const CANDIDATE_KEYS = [
  'visualId', 'authority', 'entityId', 'title', 'description', 'incidentRelationships',
] as const;
const RELATIONSHIP_KEYS = [
  'edgeId', 'relationshipId', 'sourceVisualId', 'sourceId', 'sourceTitle',
  'targetVisualId', 'targetId', 'targetTitle', 'predicate', 'direction',
  'relationshipWeight',
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every(key => allowed.has(key));
}

function boundedString(value: unknown, maximum: number, required = true): value is string {
  return typeof value === 'string'
    && value.length <= maximum
    && (!required || value.trim().length > 0);
}

function boundedDescription(value: unknown): value is string | null {
  return value === null || boundedString(value, 2_000, false);
}

function graphAuthority(value: unknown): value is 'ThinkGraph' | 'KnowGraph' {
  return value === 'ThinkGraph' || value === 'KnowGraph';
}

function validJevFocusRequest(value: unknown): value is Record<string, unknown> {
  if (!record(value) || !exactKeys(value, REQUEST_KEYS)
    || value.schemaVersion !== 'jev-focus.request.v1'
    || !boundedString(value.sourceRevision, 512)
    || !boundedString(value.projectId, 256)
    || !record(value.center)
    || !exactKeys(value.center, CENTER_KEYS)
    || !boundedString(value.center.visualId, 512)
    || !boundedString(value.center.title, 256)
    || !Array.isArray(value.center.providerMembers)
    || value.center.providerMembers.length < 1
    || value.center.providerMembers.length > 16
    || !Array.isArray(value.candidates)
    || value.candidates.length < 1
    || value.candidates.length > 12) {
    return false;
  }
  const centerVisualId = value.center.visualId;
  const centerMemberKeys = new Set<string>();
  for (const member of value.center.providerMembers) {
    if (!record(member) || !exactKeys(member, MEMBER_KEYS, ['description'])
      || !graphAuthority(member.authority)
      || !boundedString(member.entityId, 512)
      || !boundedString(member.title, 256)
      || (member.description !== undefined
        && !boundedDescription(member.description))) {
      return false;
    }
    const key = `${member.authority}\0${member.entityId}`;
    if (centerMemberKeys.has(key)) return false;
    centerMemberKeys.add(key);
  }

  const candidateKeys = new Set<string>();
  const relationshipKeys = new Set<string>();
  for (const candidate of value.candidates) {
    if (!record(candidate) || !exactKeys(candidate, CANDIDATE_KEYS)
      || !boundedString(candidate.visualId, 512)
      || candidate.visualId === centerVisualId
      || !graphAuthority(candidate.authority)
      || !boundedString(candidate.entityId, 512)
      || !boundedString(candidate.title, 256)
      || !boundedDescription(candidate.description)
      || !Array.isArray(candidate.incidentRelationships)
      || candidate.incidentRelationships.length < 1
      || candidate.incidentRelationships.length > 24) {
      return false;
    }
    const candidateKey = `${candidate.authority}\0${candidate.entityId}`;
    if (candidateKeys.has(candidateKey) || centerMemberKeys.has(candidateKey)) return false;
    candidateKeys.add(candidateKey);
    for (const relationship of candidate.incidentRelationships) {
      if (!record(relationship) || !exactKeys(relationship, RELATIONSHIP_KEYS)
        || !boundedString(relationship.edgeId, 512)
        || !boundedString(relationship.relationshipId, 512)
        || !boundedString(relationship.sourceVisualId, 512)
        || !boundedString(relationship.sourceId, 512)
        || !boundedString(relationship.sourceTitle, 256)
        || !boundedString(relationship.targetVisualId, 512)
        || !boundedString(relationship.targetId, 512)
        || !boundedString(relationship.targetTitle, 256)
        || !boundedString(relationship.predicate, 256)
        || !['incoming', 'outgoing'].includes(String(relationship.direction))) {
        return false;
      }
      const relationshipKey = `${candidate.authority}\0${relationship.relationshipId}`;
      if (relationshipKeys.has(relationshipKey)) return false;
      relationshipKeys.add(relationshipKey);
      const weight = relationship.relationshipWeight;
      if (weight !== null && (typeof weight !== 'number'
        || !Number.isFinite(weight) || weight < 0 || weight > 1)) {
        return false;
      }
      const outgoing = relationship.sourceVisualId === centerVisualId
        && relationship.targetVisualId === candidate.visualId
        && centerMemberKeys.has(`${candidate.authority}\0${relationship.sourceId}`)
        && relationship.targetId === candidate.entityId
        && relationship.direction === 'outgoing';
      const incoming = relationship.sourceVisualId === candidate.visualId
        && relationship.targetVisualId === centerVisualId
        && relationship.sourceId === candidate.entityId
        && centerMemberKeys.has(`${candidate.authority}\0${relationship.targetId}`)
        && relationship.direction === 'incoming';
      if (!outgoing && !incoming) return false;
    }
  }
  return true;
}

function unavailable(sourceRevision: string) {
  return {
    schemaVersion: 'jev-focus.v1',
    sourceRevision,
    status: 'unavailable',
    decisionId: null,
    errorCode: 'jev_focus_python_rails_unavailable',
    distribution: {},
    candidates: [],
  };
}

export function createJevGraphFocusRouter(
  { requestRails = requestPythonRailsJson }: JevGraphFocusRouterDependencies = {},
) {
  const router = Router();
  router.post('/jev-focus', async (req, res) => {
    if (!validJevFocusRequest(req.body)) {
      return res.status(400).json({ error: 'jev_focus_request_invalid' });
    }
    try {
      if (!await requireOwnedProject(req, res, String(req.body.projectId))) return undefined;
      return res.json(await requestRails('/graph/jev-focus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      }));
    } catch {
      return res.json(unavailable(String(req.body.sourceRevision)));
    }
  });
  return router;
}

export default createJevGraphFocusRouter();
