// Entity: Oracle Deployment
// Relationship: Exercises production Caddy routing, public TLS configuration and cookie authentication in an isolated container without real providers or saved state.
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

test('Caddy configures public ACME certificates for numeric and named hosts', () => {
  for (const host of ['198.51.100.10', 'demo.example.com']) {
    const result = spawnSync('caddy', ['adapt', '--config', new URL('./Caddyfile', import.meta.url).pathname, '--adapter', 'caddyfile'], {
      env: { ...process.env, LIQUIDAITY_DOMAIN: host }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    const issuers = config.apps.tls.automation.policies.flatMap(policy => policy.issuers || []);
    assert.ok(issuers.some(issuer => issuer.module === 'acme'
      && issuer.ca === 'https://acme-v02.api.letsencrypt.org/directory'
      && issuer.profile === 'shortlived'));
    assert.ok(!issuers.some(issuer => issuer.module === 'internal'));
    const connections = Object.values(config.apps.http.servers).flatMap(server => server.tls_connection_policies || []);
    assert.ok(connections.some(connection => connection.default_sni === host));
  }
});

test('Caddy preserves Hermes ownership, provider authentication and refreshed cookies', async () => {
  const calls = [];
  const servers = [];
  const listen = async (owner) => {
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      calls.push({ owner, url: req.url, method: req.method, body, headers: req.headers });
      if (owner === 'hermes' && req.url === '/api/auth/me') {
        if (req.headers.cookie === 'session=outage') {
          res.writeHead(503).end('authentication unavailable');
        } else if (!['session=valid', 'session=refresh'].includes(req.headers.cookie)) {
          res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"unauthenticated"}');
        } else {
          if (req.headers.cookie === 'session=refresh') {
            res.setHeader('Set-Cookie', ['access=fresh; HttpOnly; Path=/', 'refresh=rotated; HttpOnly; Path=/']);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"user_id":"fixture"}');
        }
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ owner, url: req.url, method: req.method, body }));
    });
    server.on('upgrade', (req, socket) => {
      calls.push({ owner, url: req.url, method: 'UPGRADE', headers: req.headers });
      const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.on('error', () => {});
      socket.on('end', () => socket.destroy());
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    servers.push(server);
    return `127.0.0.1:${server.address().port}`;
  };
  const hermes = await listen('hermes');
  const product = await listen('product');
  const worldview = await listen('worldview');
  const mcp = await listen('mcp');
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const upgrade = (path, cookie) => new Promise((resolve, reject) => {
    const req = request(origin + path, { headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...(cookie ? { Cookie: cookie } : {}),
    } });
    req.setTimeout(5000, () => req.destroy(new Error('Upgrade timeout')));
    req.on('error', reject);
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on('response', res => { res.resume(); resolve(res.statusCode); });
    req.end();
  });
  const caddy = spawn('caddy', ['run', '--config', new URL('./Caddyfile', import.meta.url).pathname, '--adapter', 'caddyfile'], {
    env: { ...process.env, LIQUIDAITY_DOMAIN: origin, HERMES_HTTP_ORIGIN: hermes,
      PRODUCT_HTTP_ORIGIN: product, WORLDVIEW_HTTP_ORIGIN: worldview, MCP_HTTP_ORIGIN: mcp },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  caddy.stderr.on('data', chunk => { diagnostics += chunk; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100 && caddy.exitCode === null; attempt += 1) {
      try { ready = (await fetch(origin + '/api/health')).ok; } catch {}
      if (ready) break;
      await delay(50);
    }
    assert.ok(ready, diagnostics);
    assert.deepEqual(await (await fetch(origin + '/product/api/projects')).json(), {
      owner: 'product', url: '/api/projects', method: 'GET', body: '',
    });
    assert.equal((await (await fetch(origin + '/api/webapp/socket-ticket')).json()).owner, 'hermes');
    assert.equal((await (await fetch(origin + '/mcp')).json()).owner, 'mcp');
    const before = calls.filter(call => call.owner === 'worldview').length;
    assert.equal((await fetch(origin + '/worldview-native/api/launches')).status, 401);
    assert.equal((await fetch(origin + '/worldview-native/api/launches', { headers: { Cookie: 'session=outage' } })).status, 503);
    assert.equal(calls.filter(call => call.owner === 'worldview').length, before);
    const answer = await fetch(origin + '/worldview-native/api/realtime', {
      method: 'POST', headers: { Cookie: 'session=refresh', 'Content-Type': 'application/json' }, body: '{"message":"fixture"}',
    });
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.headers.getSetCookie().sort(), ['access=fresh; HttpOnly; Path=/', 'refresh=rotated; HttpOnly; Path=/']);
    assert.deepEqual(await answer.json(), { owner: 'worldview', url: '/api/realtime', method: 'POST', body: '{"message":"fixture"}' });
    const forwarded = calls.findLast(call => call.owner === 'worldview');
    assert.equal(forwarded.headers.cookie, undefined);
    assert.equal(forwarded.headers.authorization, undefined);
    assert.equal(calls.findLast(call => call.url === '/api/auth/me').method, 'GET');
    assert.equal(await upgrade('/api/ws'), 101);
    assert.equal(calls.findLast(call => call.method === 'UPGRADE').owner, 'hermes');
    assert.equal(await upgrade('/worldview-native/api/realtime'), 401);
    assert.equal(await upgrade('/worldview-native/api/realtime', 'session=valid'), 101);
    const upgradedProvider = calls.findLast(call => call.method === 'UPGRADE');
    assert.equal(upgradedProvider.owner, 'worldview');
    assert.equal(upgradedProvider.headers.cookie, undefined);
  } finally {
    if (caddy.exitCode === null) { caddy.kill('SIGTERM'); await once(caddy, 'exit'); }
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  }
});
