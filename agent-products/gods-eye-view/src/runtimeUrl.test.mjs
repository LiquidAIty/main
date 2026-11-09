import test from 'node:test';
import assert from 'node:assert/strict';

import { configureRuntimeBaseUrl, runtimeUrl } from './runtimeUrl.js';
import { worldViewBrowserAccess } from '../vite.config.js';

test('standalone and Node callers keep native relative URLs unchanged', () => {
  assert.equal(runtimeUrl('/api/launches'), '/api/launches');
  assert.equal(runtimeUrl('mic.svg'), 'mic.svg');
});

test("direct mount scopes God's Eye provider and asset URLs under its proxy root", () => {
  const dispose = configureRuntimeBaseUrl('/worldview-gods-eye/');
  try {
    assert.equal(runtimeUrl('/api/launches'), '/worldview-gods-eye/api/launches');
    assert.equal(runtimeUrl('/mic.svg'), '/worldview-gods-eye/mic.svg');
    assert.equal(runtimeUrl('https://example.test/feed'), 'https://example.test/feed');
  } finally {
    dispose();
  }
  assert.equal(runtimeUrl('/api/launches'), '/api/launches');
});

test('Hermes-hosted mount resolves API and assets against the existing provider', () => {
  const dispose = configureRuntimeBaseUrl('http://127.0.0.1:4174/');
  try {
    assert.equal(runtimeUrl('/api/celestrak/stations'), 'http://127.0.0.1:4174/api/celestrak/stations');
    assert.equal(runtimeUrl('/models/aircraft.glb'), 'http://127.0.0.1:4174/models/aircraft.glb');
    assert.equal(runtimeUrl('https://api.cesium.com/'), 'https://api.cesium.com/');
  } finally { dispose(); }
});

test('provider CORS allows only the named local browser hosts and bounded preflights', () => {
  const invoke = (origin, method = 'GET', extraHeaders = {}) => {
    const headers = {};
    let continued = false;
    let ended = false;
    const res = { statusCode: 200, setHeader: (name, value) => { headers[name] = value; },
      end: () => { ended = true; } };
    worldViewBrowserAccess({ method, headers: { origin, ...extraHeaders } }, res,
      () => { continued = true; });
    return { headers, continued, ended, status: res.statusCode };
  };
  const allowed = invoke('http://127.0.0.1:9120');
  assert.equal(allowed.headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:9120');
  assert.equal(allowed.headers['Access-Control-Allow-Credentials'], undefined);
  assert.equal(allowed.continued, true);
  assert.equal(invoke('https://unapproved.example').headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(invoke('http://127.0.0.1:9120', 'OPTIONS', {
    'access-control-request-method': 'POST', 'access-control-request-headers': 'Content-Type',
  }).status, 204);
  for (const origin of ['https://unapproved.example', 'http://127.0.0.1:9999']) {
    assert.equal(invoke(origin, 'OPTIONS', { 'access-control-request-method': 'GET' }).status, 403);
  }
  assert.equal(invoke('http://127.0.0.1:9120', 'OPTIONS', {
    'access-control-request-method': 'DELETE',
  }).status, 403);
});
