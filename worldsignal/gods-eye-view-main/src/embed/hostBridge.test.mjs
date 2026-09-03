import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectSelection,
  resolveEmbedMode,
  validFocusRequest,
  validHostConfig,
} from './hostBridge.js';

test('embed mode requires supervised host ownership and a loopback origin', () => {
  assert.deepEqual(
    resolveEmbedMode('?embed=1&agentRuntime=supervised&hostOrigin=http%3A%2F%2Flocalhost%3A5173'),
    { enabled: true, hostOrigin: 'http://localhost:5173' },
  );
  assert.equal(resolveEmbedMode('?embed=1&agentRuntime=host').enabled, false);
  assert.equal(
    resolveEmbedMode('?embed=1&agentRuntime=supervised&hostOrigin=https%3A%2F%2Fexample.com').enabled,
    false,
  );
});

test('selection projection preserves only bounded source identity and real coordinates', () => {
  assert.deepEqual(projectSelection({
    id: 'flight-1',
    layerId: 'flights',
    callsign: 'SOURCE 1',
    longitude: -77.03,
    latitude: 38.9,
    updatedAt: Date.parse('2026-09-03T10:00:00Z'),
    entity: { circular: 'not copied' },
  }), {
    id: 'flight-1',
    type: 'flights',
    label: 'SOURCE 1',
    position: { longitude: -77.03, latitude: 38.9 },
    observedAt: '2026-09-03T10:00:00.000Z',
  });
  assert.equal(projectSelection({ id: 'bad', layerId: 'flights', longitude: 220, latitude: 0 }).position, null);
});

test('host configuration preserves the native agent as explicitly user-initiated', () => {
  assert.equal(validHostConfig({
    schemaVersion: 'gev.embed.host-config.v1',
    projectId: 'project-1',
    cardId: 'card-worldview',
    parentRuntime: 'hermes',
    nativeAgentPolicy: 'user-initiated',
  }), true);
  assert.equal(validHostConfig({
    schemaVersion: 'gev.embed.host-config.v1',
    projectId: 'project-1',
    cardId: 'card-worldview',
    parentRuntime: 'autogen',
    nativeAgentPolicy: 'always-on',
  }), false);
});

test('evidence flight accepts only the configured Card scope and real coordinates', () => {
  const config = {
    schemaVersion: 'gev.embed.host-config.v1',
    projectId: 'project-1',
    cardId: 'card-worldview',
    parentRuntime: 'hermes',
    nativeAgentPolicy: 'user-initiated',
  };
  assert.deepEqual(validFocusRequest({
    schemaVersion: 'gev.embed.focus.v1',
    projectId: 'project-1',
    cardId: 'card-worldview',
    id: 'candidate-1',
    position: { longitude: -97.7431, latitude: 30.2672 },
  }, config), {
    id: 'candidate-1',
    longitude: -97.7431,
    latitude: 30.2672,
  });
  assert.equal(validFocusRequest({
    schemaVersion: 'gev.embed.focus.v1',
    projectId: 'other-project',
    cardId: 'card-worldview',
    position: { longitude: -97.7431, latitude: 30.2672 },
  }, config), null);
  assert.equal(validFocusRequest({
    schemaVersion: 'gev.embed.focus.v1',
    projectId: 'project-1',
    cardId: 'card-worldview',
    id: 'candidate-1',
    position: { longitude: 500, latitude: 30.2672 },
  }, config), null);
  assert.equal(validFocusRequest({
    schemaVersion: 'gev.embed.focus.v1',
    projectId: 'project-1',
    cardId: 'card-worldview',
    position: { longitude: -97.7431, latitude: 30.2672 },
  }, config), null);
});
