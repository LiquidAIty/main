// Entity: WorldView
// Relationship: Verifies the production HTTP server installs the real native providers, bounds static access, and disposes provider timers without external network access.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createWorldViewHttpProviders } from '../../agent-products/gods-eye-view/vite.config.js';
import { createWorldViewServer } from './worldview-server.mjs';

const expectedProviders = [
  'opensky-proxy', 'celestrak-proxy', 'tomtom-proxy', 'firms-proxy',
  'rocket-launches-proxy', 'terrain-heights-proxy', 'adsbdb-proxy',
  'overpass-proxy', 'military-installations-proxy', 'regional-brief-proxy',
  'weather-effects-proxy', 'cctv-proxy', 'radio-browser-proxy', 'gbfs-proxy',
  'adsblol-proxy', 'ais-live-proxy', 'track-backfill-proxies',
  'openai-realtime-proxy', 'google-places-context-proxy',
];

function http(server, path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('production server retains native providers, HTTP semantics, static boundary and disposal', async (t) => {
  const originalCwd = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'worldview-provider-test-'));
  const envNames = ['AISSTREAM_API_KEY', 'FIRMS_MAP_KEY', 'TOMTOM_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_MAPS_API_KEY'];
  const oldEnv = new Map(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  process.chdir(directory);
  const intervals = [];
  const cleared = new Set();
  const setIntervalOriginal = globalThis.setInterval;
  const clearIntervalOriginal = globalThis.clearInterval;
  t.mock.method(globalThis, 'setInterval', (...args) => {
    const timer = setIntervalOriginal(...args);
    intervals.push(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearInterval', (timer) => {
    cleared.add(timer);
    clearIntervalOriginal(timer);
  });
  const upstreamCalls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const parsed = new URL(url);
    upstreamCalls.push(parsed.href);
    if (parsed.origin === 'https://celestrak.org') {
      return new Response('ISS (ZARYA)\n1 25544U 98067A   26315.00000000  .00000000  00000-0  00000-0 0  9991\n2 25544  51.6400  10.0000 0001000  20.0000  30.0000 15.50000000123456\n');
    }
    if (parsed.origin === 'https://ll.thespacedevs.com') {
      return Response.json({ results: [{ id: 'fixture-launch', name: 'HTTP transport fixture' }] });
    }
    throw new Error(`External network forbidden in production registration test: ${parsed.origin}`);
  });

  const providers = createWorldViewHttpProviders();
  assert.deepEqual(providers.map((provider) => provider.name), expectedProviders);
  assert.equal(providers.filter((provider) => provider.configurePreviewServer).length, 9);
  assert.ok(providers.every((provider) => typeof provider.install === 'function' && typeof provider.configureServer === 'function'));
  const server = createWorldViewServer();
  t.after(async () => {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    process.chdir(originalCwd);
    for (const [name, value] of oldEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const health = await http(server, '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.text).providers, expectedProviders);
  assert.equal(health.headers['x-powered-by'], undefined);
  assert.equal(JSON.parse((await http(server, '/')).text).service, 'worldview', 'existing readiness reads the provider root');
  const asset = await http(server, '/mic.svg');
  assert.equal(asset.status, 200);
  assert.match(asset.headers['content-type'], /image\/svg\+xml/);
  for (const path of ['/.env', '/vite.config.js', '/src/app/mount.js', '/../package.json', '/models/../../package.json']) {
    assert.ok([403, 404].includes((await http(server, path)).status), path);
  }

  for (const [path, status, method = 'GET', body] of [
    ['/api/celestrak/invalid_group', 400],
    ['/api/launches', 405, 'POST'],
    ['/api/tomtom/status', 200],
    ['/api/firms', 503],
    ['/api/terrain/heights?points=invalid', 400],
    ['/api/adsbdb/route/!', 400],
    ['/api/overpass', 405],
    ['/api/overpass', 400, 'POST', ''],
    ['/api/route?coords=invalid', 200],
    ['/api/military-installations', 400],
    ['/api/regional-brief', 400],
    ['/api/weather-effects', 400],
    ['/api/radio/not-a-route', 404],
    ['/api/gbfs/invalid', 405, 'POST'],
    ['/api/ais-live', 503],
    ['/api/opensky-track', 400],
    ['/api/adsblol/trace', 400],
    ['/api/openai/hud-summary', 405],
    ['/api/realtime/token', 503],
    ['/api/google/nearby-places', 503],
    ['/api/google/text-search', 503],
  ]) {
    const result = await http(server, path, { method, body });
    assert.equal(result.status, status, `${method} ${path}: ${result.text}`);
    assert.doesNotMatch(result.text, /worldview_route_not_found/, path);
  }
  assert.deepEqual(upstreamCalls, [], 'invalid or unconfigured requests must make no upstream calls');

  const tle = await http(server, '/api/celestrak/stations');
  assert.equal(tle.status, 200);
  assert.match(tle.text, /ISS \(ZARYA\)/);
  assert.equal((await http(server, '/api/celestrak/stations')).headers['x-tle-cache'], 'HIT');
  const launches = await http(server, '/api/launches');
  assert.equal(launches.status, 200);
  assert.equal(JSON.parse(launches.text).results[0].id, 'fixture-launch');
  assert.equal((await http(server, '/api/launches')).headers['x-gev-cache'], 'HIT');
  assert.equal(upstreamCalls.length, 2, 'existing provider caches must coalesce repeated HTTP reads');
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(intervals.length, 3, 'AIS watchdog and two lazy cache flush timers');
  assert.ok(intervals.every((timer) => cleared.has(timer)), 'closing the production server disposes every provider interval');
});
