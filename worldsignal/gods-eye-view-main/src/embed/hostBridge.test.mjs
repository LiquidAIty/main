import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  projectSelection,
  resolveEmbedMode,
  validFocusRequest,
  validHostConfig,
} from './hostBridge.js';

test('distribution startup seals native layers without deleting historical share tokens', async () => {
  const { DataLayerManager } = await import('../data/manager.js');
  const { LAYER_STATE_REGISTRY, decodeLayerStateParams } = await import('../data/layerState.js');
  const source = await readFile(new URL('../main.js', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/^\s*dataManager\.finalizeRegistrations\([\s\S]*?\);/gm)];
  assert.equal(calls.length, 1, 'exercise the actual startup call, not a copied registry adapter');
  const available = LAYER_STATE_REGISTRY.filter((entry) => entry.id !== 'telegeography-submarine-cables');
  const dataManager = new DataLayerManager({});
  for (const entry of available) dataManager.register({ id: entry.id });
  runInNewContext(calls[0][0], { dataManager, LAYER_STATE_REGISTRY });
  assert.equal(dataManager.registrationsFinalized, true);

  const incompleteManager = new DataLayerManager({});
  for (const entry of available.filter((entry) => entry.id !== 'earthquakes')) {
    incompleteManager.register({ id: entry.id });
  }
  assert.throws(() => runInNewContext(calls[0][0], {
    dataManager: incompleteManager, LAYER_STATE_REGISTRY,
  }), /Layer serialization registry mismatch/);
  assert.deepEqual(decodeLayerStateParams(new URLSearchParams('v=2&l=u.e')).enabledLayerIds,
    ['earthquakes', 'telegeography-submarine-cables']);
});

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
