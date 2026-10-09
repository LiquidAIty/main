import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./projectAccess', () => ({
  requireOwnedProject: vi.fn(async () => ({ ownerUserId: 'owner-one' })),
}));

import { requestPythonRailsJson } from '../services/pythonRailsClient';
import { createJevGraphFocusRouter } from './jevGraphFocus.routes';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()));
});

function focusRequest() {
  return {
    schemaVersion: 'jev-focus.request.v1',
    sourceRevision: 'combined-projection:17',
    projectId: 'project-one',
    center: {
      visualId: 'visual-center',
      title: 'Center',
      providerMembers: [{
        authority: 'ThinkGraph',
        entityId: 'center-think',
        title: 'Center',
        description: 'Stored center Think.',
      }],
    },
    candidates: [{
      visualId: 'visual-neighbor',
      authority: 'ThinkGraph',
      entityId: 'neighbor-think',
      title: 'Neighbor',
      description: null,
      incidentRelationships: [{
        edgeId: 'visual-edge-one',
        relationshipId: 'relationship-one',
        sourceVisualId: 'visual-center',
        sourceId: 'center-think',
        sourceTitle: 'Center',
        targetVisualId: 'visual-neighbor',
        targetId: 'neighbor-think',
        targetTitle: 'Neighbor',
        predicate: 'EXPLAINS',
        direction: 'outgoing',
        relationshipWeight: 0.72,
      }],
    }],
  };
}

async function serve(
  requestRails = vi.fn<typeof requestPythonRailsJson>(async () => ({ ok: true })),
) {
  const app = express();
  app.use(express.json());
  app.use('/graph', createJevGraphFocusRouter({ requestRails }));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  closers.push(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/graph`,
    requestRails,
  };
}

describe('bounded JevFocus transport', () => {
  it('forwards the exact versioned provider-subject request to Python rails', async () => {
    const result = {
      schemaVersion: 'jev-focus.v1',
      sourceRevision: 'combined-projection:17',
      status: 'success',
      decisionId: 'decision-one',
      errorCode: null,
      distribution: { focus_one: 1 },
      candidates: [],
    };
    const requestRails = vi.fn<typeof requestPythonRailsJson>(async () => result);
    const { base } = await serve(requestRails);
    const payload = focusRequest();
    const response = await fetch(`${base}/jev-focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(requestRails).toHaveBeenCalledExactlyOnceWith('/graph/jev-focus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });

  it('rejects an unbounded or nonincident request before Python rails', async () => {
    const { base, requestRails } = await serve();
    const payload = focusRequest();
    payload.candidates[0].incidentRelationships[0].sourceVisualId = 'not-the-center';
    const response = await fetch(`${base}/jev-focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'jev_focus_request_invalid' });
    expect(requestRails).not.toHaveBeenCalled();
  });

  it('returns a truthful empty fallback when Python rails is unavailable', async () => {
    const requestRails = vi.fn<typeof requestPythonRailsJson>(async () => {
      throw new Error('PYTHON_RAILS_UNAVAILABLE');
    });
    const { base } = await serve(requestRails);
    const response = await fetch(`${base}/jev-focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(focusRequest()),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 'jev-focus.v1',
      sourceRevision: 'combined-projection:17',
      status: 'unavailable',
      decisionId: null,
      errorCode: 'jev_focus_python_rails_unavailable',
      distribution: {},
      candidates: [],
    });
    expect(requestRails).toHaveBeenCalledOnce();
  });
});
