import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkDevelopmentDependencies,
  DEVELOPMENT_DEPENDENCY_REQUIREMENTS,
  formatDependencyPreflightFailure,
} from './preflight-dev-dependencies.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function writeFixtureFile(root, relativePath, contents = '') {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

async function createDependencyFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'liquidaity-startup-preflight-'));
  const declarationPaths = new Set(
    DEVELOPMENT_DEPENDENCY_REQUIREMENTS
      .filter((requirement) => requirement.kind === 'package')
      .map((requirement) => requirement.declaredIn),
  );
  for (const declarationPath of declarationPaths) {
    await writeFixtureFile(
      root,
      declarationPath,
      await readFile(path.join(REPO_ROOT, declarationPath), 'utf8'),
    );
  }

  for (const requirement of DEVELOPMENT_DEPENDENCY_REQUIREMENTS) {
    if (requirement.kind === 'file') {
      await writeFixtureFile(root, requirement.path, 'fixture');
      continue;
    }
    const source = await readFile(path.join(REPO_ROOT, requirement.path), 'utf8');
    await writeFixtureFile(root, requirement.path, source);
    const manifest = JSON.parse(source);
    const binTarget = typeof manifest.bin === 'string'
      ? manifest.bin
      : manifest.bin?.[requirement.bin];
    if (requirement.bin && typeof binTarget === 'string') {
      await writeFixtureFile(root, path.join(path.dirname(requirement.path), binTarget), 'fixture');
    }
  }
  return root;
}

async function fileSnapshot(root) {
  const entries = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else {
        const contents = await readFile(absolute);
        entries.push(`${path.relative(root, absolute)}:${createHash('sha256').update(contents).digest('hex')}`);
      }
    }
  }
  await visit(root);
  return entries.sort();
}

async function withDependencyFixture(run) {
  const root = await createDependencyFixture();
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('the current repaired dependency trees pass the non-mutating preflight', async () => {
  assert.deepEqual(await checkDevelopmentDependencies(REPO_ROOT), []);
});

test('a complete dependency fixture passes without mutation', async () => {
  await withDependencyFixture(async (root) => {
    const before = await fileSnapshot(root);
    assert.deepEqual(await checkDevelopmentDependencies(root), []);
    assert.deepEqual(await fileSnapshot(root), before);
  });
});

test('root launcher, manifest, and generated-client damage produces only explicit root recovery', async () => {
  await withDependencyFixture(async (root) => {
    await unlink(path.join(root, 'node_modules/.bin/vite.cmd'));
    await writeFile(path.join(root, 'node_modules/vitest/package.json'), '{');
    await unlink(path.join(root, 'node_modules/.prisma/client/query_engine-windows.dll.node'));
    const issues = await checkDevelopmentDependencies(root);
    const message = formatDependencyPreflightFailure(issues);
    assert.match(message, /node_modules\/\.bin\/vite\.cmd/);
    assert.match(message, /node_modules\/vitest\/package\.json/);
    assert.match(message, /query_engine-windows\.dll\.node/);
    assert.match(message, /npm ci\n  npm run prisma:generate/);
    assert.doesNotMatch(message, /npm ci --prefix agent-products\/gods-eye-view/);
    assert.match(message, /No recovery command was run\./);
  });
});

test("missing package-local WorldView dependencies produce only the God's Eye recovery", async () => {
  await withDependencyFixture(async (root) => {
    await unlink(path.join(root, 'agent-products/gods-eye-view/node_modules/vite-plugin-cesium/package.json'));
    const issues = await checkDevelopmentDependencies(root);
    const message = formatDependencyPreflightFailure(issues);
    assert.match(message, /vite-plugin-cesium\/package\.json/);
    assert.match(message, /npm ci --prefix agent-products\/gods-eye-view --ignore-scripts/);
    assert.doesNotMatch(message, /Root recovery/);
  });
});

function scriptTokens(value) {
  return value.split(/\s+/);
}

test('the canonical package scripts preflight before stopping and use fail-only supervision', async () => {
  const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const scripts = packageJson.scripts;
  assert.ok(scripts['dev:fresh'].startsWith(
    'node scripts/preflight-dev-dependencies.mjs && npm run dev:stop && ',
  ));
  for (const name of ['dev:services', 'dev:dependent-services']) {
    const tokens = scriptTokens(scripts[name]);
    assert.ok(tokens.includes('--kill-others-on-fail'), `${name} must kill siblings only on failure`);
    assert.ok(!tokens.includes('--kill-others'), `${name} must not kill siblings after a successful exit`);
    assert.match(scripts[name], /--success all/);
  }
  assert.doesNotMatch(scripts['dev:dependent-services'], /npm run dev:worldsignals/);
  assert.match(scripts['dev:dependent-services'], /-StartPythonRailsAfterWorldSignals/);
  assert.match(scripts['dev:dependent-services'], /"npm run dev:frontend"/);
  assert.match(scripts['dev:dependent-services'], /"npm run dev:worldview"/);
});

test('WorldSignals has one startup invocation inside the Python-rails sibling', async () => {
  const source = await readFile(path.join(REPO_ROOT, 'scripts/start-dependent-services.ps1'), 'utf8');
  assert.equal((source.match(/npm\.cmd run dev:worldsignals/g) || []).length, 1);
  const worldSignalsStart = source.indexOf('& npm.cmd run dev:worldsignals');
  const credentialReadback = source.indexOf('$env:WORLDSIGNALS_HMAC_SECRET = $secret');
  const pythonRailsStart = source.indexOf('& npm.cmd run dev:python-rails');
  assert.ok(worldSignalsStart >= 0 && credentialReadback > worldSignalsStart);
  assert.ok(pythonRailsStart > credentialReadback);
  assert.doesNotMatch(source, /Write-(?:Host|Output).*\$secret/i);
});

async function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      windowsHide: true,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({
      code,
      signal,
      stdout,
      stderr,
      elapsedMs: Date.now() - startedAt,
    }));
  });
}

async function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function portIsListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(250);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

async function waitForClosedPort(port) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (!await portIsListening(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`fixture port ${port} remained open`);
}

async function createProcessFixtures() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'liquidaity-startup-processes-'));
  const server = path.join(root, 'server.mjs');
  const exit = path.join(root, 'exit.mjs');
  await writeFile(server, `
import net from 'node:net';
const port = Number(process.argv[2]);
const duration = Number(process.argv[3]);
const server = net.createServer((socket) => socket.destroy());
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.listen(port, '127.0.0.1', () => console.log('fixture-ready'));
setTimeout(stop, duration);
`);
  await writeFile(exit, `setTimeout(() => process.exit(Number(process.argv[3])), Number(process.argv[2]));\n`);
  return { root, server, exit };
}

function quoted(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

async function runConcurrentFixture(names, commands) {
  const cli = path.join(REPO_ROOT, 'node_modules/concurrently/dist/bin/concurrently.js');
  return runProcess(process.execPath, [
    cli,
    '--kill-others-on-fail',
    '--success',
    'all',
    '--names',
    names.join(','),
    ...commands,
  ]);
}

for (const failingName of ['frontend', 'worldview']) {
  test(`${failingName} failure terminates its long-lived application sibling and exits nonzero`, async () => {
    const fixture = await createProcessFixtures();
    const port = await unusedPort();
    const otherName = failingName === 'frontend' ? 'worldview' : 'frontend';
    try {
      const commands = failingName === 'frontend'
        ? [
          `${quoted(process.execPath)} ${quoted(fixture.exit)} 700 23`,
          `${quoted(process.execPath)} ${quoted(fixture.server)} ${port} 8000`,
        ]
        : [
          `${quoted(process.execPath)} ${quoted(fixture.server)} ${port} 8000`,
          `${quoted(process.execPath)} ${quoted(fixture.exit)} 700 23`,
        ];
      const result = await runConcurrentFixture([failingName, otherName], commands);
      assert.notEqual(result.code, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /fixture-ready/);
      await waitForClosedPort(port);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

test('a successful one-shot command does not terminate a healthy long-lived sibling', async () => {
  const fixture = await createProcessFixtures();
  const port = await unusedPort();
  try {
    const result = await runConcurrentFixture(['application', 'compose-up'], [
      `${quoted(process.execPath)} ${quoted(fixture.server)} ${port} 1200`,
      `${quoted(process.execPath)} ${quoted(fixture.exit)} 100 0`,
    ]);
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(result.elapsedMs >= 900, `long-lived sibling ended after only ${result.elapsedMs} ms`);
    await waitForClosedPort(port);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('an unavailable WorldSignals bootstrap still starts Python rails without fabricating a credential', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'liquidaity-worldsignals-unavailable-'));
  const logPath = path.join(root, 'npm-calls.log');
  const npmStub = path.join(root, 'npm.cmd');
  await writeFile(npmStub, `@echo off\r\n` +
    `echo %*>>"%STARTUP_TEST_LOG%"\r\n` +
    `if "%2"=="dev:worldsignals" exit /b 17\r\n` +
    `if "%2"=="dev:python-rails" (\r\n` +
    `  if defined WORLDSIGNALS_HMAC_SECRET (echo python-secret=present>>"%STARTUP_TEST_LOG%") else (echo python-secret=absent>>"%STARTUP_TEST_LOG%")\r\n` +
    `  exit /b 0\r\n` +
    `)\r\n` +
    `exit /b 99\r\n`);
  const env = {
    ...process.env,
    PATH: `${root}${path.delimiter}${process.env.PATH || ''}`,
    STARTUP_TEST_LOG: logPath,
  };
  delete env.WORLDSIGNALS_HMAC_SECRET;
  try {
    const result = await runProcess('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(REPO_ROOT, 'scripts/start-dependent-services.ps1'),
      '-StartPythonRailsAfterWorldSignals',
    ], { env });
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    const calls = (await readFile(logPath, 'utf8')).trim().split(/\r?\n/);
    assert.deepEqual(calls, [
      'run dev:worldsignals',
      'run dev:python-rails',
      'python-secret=absent',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
