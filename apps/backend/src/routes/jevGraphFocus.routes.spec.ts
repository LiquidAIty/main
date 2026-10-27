/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Jev Decisions
 * Relationship: This file verifies bounded graph-focus transport, exact projection revisions, strict response validation, and honest Python-rails failures without a fallback decision.
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies only a current declared provider neighborhood crosses the manual focus transport.
 * Entity: Authentication
 * Relationship: This file verifies Project authorization completes before Python rails receives any focus request.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOwnedProject: vi.fn(async () => ({ ownerUserId: 'owner-one' })),
}));

vi.mock('./projectAccess', () => ({
  requireOwnedProject: mocks.requireOwnedProject,
}));

import { PythonRailsHttpError, requestPythonRailsJson } from '../services/pythonRailsClient';
import { createJevGraphFocusRouter } from './jevGraphFocus.routes';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()));
  mocks.requireOwnedProject.mockReset();
  mocks.requireOwnedProject.mockResolvedValue({ ownerUserId: 'owner-one' });
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
  it('forwards the exact versioned provider-Entity request to Python rails', async () => {
    const result = {
      schemaVersion: 'jev-focus.v1',
      sourceRevision: 'combined-projection:17',
      status: 'success',
      decisionId: 'decision-one',
      errorCode: null,
      distribution: { focus_one: 1 },
      candidates: [{
        choiceId: 'focus_one',
        probability: 1,
        rank: 1,
        selected: true,
      }],
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

  it('returns an HTTP failure instead of a success-shaped fallback when Python rails is unavailable', async () => {
    const requestRails = vi.fn<typeof requestPythonRailsJson>(async () => {
      throw Object.assign(new Error('PYTHON_RAILS_UNAVAILABLE'), {
        code: 'PYTHON_RAILS_UNAVAILABLE',
      });
    });
    const { base } = await serve(requestRails);
    const response = await fetch(`${base}/jev-focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(focusRequest()),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'jev_focus_python_rails_unavailable',
    });
    expect(requestRails).toHaveBeenCalledOnce();
  });

  it('rejects a wrong-revision or malformed Python response', async () => {
    const requestRails = vi.fn<typeof requestPythonRailsJson>(async () => ({
      schemaVersion: 'jev-focus.v1',
      sourceRevision: 'other-revision',
      status: 'success',
      decisionId: 'decision-one',
      errorCode: null,
      distribution: { focus_one: 2 },
      candidates: [],
    }));
    const { base } = await serve(requestRails);
    const response = await fetch(`${base}/jev-focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(focusRequest()),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'jev_focus_response_invalid' });
  });

  it('preserves authorization and typed Python HTTP failures', async () => {
    const requestRails = vi.fn<typeof requestPythonRailsJson>(async () => {
      throw new PythonRailsHttpError(429, 'provider_rate_limited');
    });
    mocks.requireOwnedProject.mockImplementationOnce(async () => {
      throw new Error('database_unavailable');
    });
    const { base } = await serve(requestRails);
    const denied = await fetch(`${base}/jev-focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(focusRequest()),
    });
    expect(denied.status).toBe(500);
    expect(await denied.json()).toEqual({ error: 'project_authorization_failed' });
    expect(requestRails).not.toHaveBeenCalled();

    const limited = await fetch(`${base}/jev-focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(focusRequest()),
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: 'python_rails_http_429',
    });
  });
});
