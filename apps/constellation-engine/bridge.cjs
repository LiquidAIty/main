'use strict';

// Thin newline-delimited JSON adapter over the pinned upstream engine. The
// process owns one database and one ConstellationEngine instance for life.
// Stdout is protocol-only; upstream diagnostics are redirected to stderr.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');

process.env.ENGINE_COLD_START = '0';
process.env.ENGINE_CONSOLIDATION_RESWEEP = '0';
process.env.CONSTELLATION_CONSOLIDATION = '0';

const protocolWrite = (payload) => {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
};

for (const level of ['log', 'warn', 'error', 'info']) {
  console[level] = (...values) => {
    process.stderr.write(`[constellation] ${values.map(String).join(' ')}\n`);
  };
}

const dbPath = path.resolve(String(process.argv[2] || '').trim());
if (!dbPath) {
  throw new Error('constellation_database_path_required');
}
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const engineModulePath = require.resolve('constellation-engine/engine.cjs');
const enginePackageRoot = path.dirname(engineModulePath);
const mimirScript = path.join(enginePackageRoot, 'scripts', 'mimir-js', 'index.js');
const mimirPort = Number.parseInt(process.env.MIMIR_PORT || '18810', 10);
if (!Number.isInteger(mimirPort) || mimirPort < 1024 || mimirPort > 65535) {
  throw new Error('constellation_mimir_port_invalid');
}
process.env.MIMIR_PORT = String(mimirPort);
const { ConstellationEngine } = require(engineModulePath);
const engine = new ConstellationEngine(dbPath);

let mimirChild = null;
let mimirStartedAt = null;
let mimirFailure = null;
let mimirEmbedderReady = false;
let mimirStopRequested = false;
const mimirLogs = [];
let reembedJob = null;
let autonomyRun = null;
let autonomyTimer = null;
const identityPreviews = new Map();

const EDGE_TYPES = new Set([
  'causal',
  'contrastive',
  'hierarchical',
  'associative',
  'temporal',
  'supersedes',
  'coactivation',
  'collision',
  'builds_on',
  'resolves',
  'contradicts',
]);
const ENGINE_VERSION = '1.0.5';
const ENGINE_REVISION = 'ac460489f1cd3cd629fa96f2730e5ae9daa4326c';

function rememberMimirLog(value) {
  const line = String(value || '').trim();
  if (!line) return;
  mimirLogs.push(line.slice(0, 500));
  while (mimirLogs.length > 20) mimirLogs.shift();
}

async function httpJson(route, { method = 'GET', body = null, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (timeout.unref) timeout.unref();
  try {
    const response = await fetch(`http://127.0.0.1:${mimirPort}${route}`, {
      method,
      headers: body == null ? undefined : { 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`mimir_http_${response.status}:${payload.error || 'request_failed'}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function mimirProcessAlive() {
  return mimirChild != null && mimirChild.exitCode == null && !mimirChild.killed;
}

async function readMimirStatus() {
  if (!mimirProcessAlive()) {
    mimirEmbedderReady = false;
    return {
      state: mimirFailure ? 'failed' : 'stopped',
      embedderReady: false,
      model: 'Xenova/bge-m3',
      dimension: 1024,
      port: mimirPort,
      startedAt: mimirStartedAt,
      failure: mimirFailure,
      logs: mimirFailure ? mimirLogs.slice(-5) : [],
    };
  }
  try {
    const status = await httpJson('/status', { timeoutMs: 1500 });
    mimirEmbedderReady = status.embedder_ready === true;
    const sameInstall = !process.env.INSTALL_ID
      || status.install_id === process.env.INSTALL_ID;
    return {
      state: status.embedder_ready && sameInstall ? 'ready' : 'warming',
      embedderReady: status.embedder_ready === true,
      sameInstall,
      model: status.embedder_model || 'Xenova/bge-m3',
      dimension: Number(status.embedder_dim || 1024),
      port: Number(status.port || mimirPort),
      pid: mimirChild.pid,
      startedAt: mimirStartedAt,
      uptimeMs: status.uptime_ms,
      databasePath: dbPath,
    };
  } catch (error) {
    return {
      state: 'starting',
      embedderReady: false,
      model: 'Xenova/bge-m3',
      dimension: 1024,
      port: mimirPort,
      pid: mimirChild.pid,
      startedAt: mimirStartedAt,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function ensureMimir({ waitForEmbedder = false, maxWaitSeconds = 30 } = {}) {
  if (!fs.existsSync(mimirScript)) throw new Error('constellation_mimir_script_missing');
  if (!mimirProcessAlive()) {
    mimirFailure = null;
    mimirEmbedderReady = false;
    mimirStopRequested = false;
    mimirStartedAt = new Date().toISOString();
    const env = {
      ...process.env,
      MIMIR_PORT: String(mimirPort),
      MIMIR_PORT_RANGE: '1',
      MIMIR_HOST: '127.0.0.1',
      CONSTELLATION_DB: dbPath,
      MIMIR_WATCHDOG: '0',
      MIMIR_HEARTBEAT: '0',
      MIMIR_DREAM: '0',
      MIMIR_EDGE_EVOLUTION: '0',
      MIMIR_HEBB: '0',
      MIMIR_RUMINATION: '0',
      MIMIR_EDGE_DECAY: '0',
      MIMIR_WAL_CHECKPOINT: '0',
      MIMIR_HEALTH_MONITOR: '0',
      MIMIR_SEGMENTER: '0',
      // The bridge has its own explicit bounded native controller. The
      // launcher's model-calling autonomy loop is never armed implicitly.
      MIMIR_AUTONOMY_V3_ENABLED: '0',
    };
    mimirChild = spawn(process.execPath, [mimirScript], {
      cwd: enginePackageRoot,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    mimirChild.stdout?.on('data', rememberMimirLog);
    mimirChild.stderr?.on('data', rememberMimirLog);
    mimirChild.once('exit', (code, signal) => {
      const expected = closed || mimirStopRequested;
      if (!expected) {
        mimirFailure = `mimir_exited:${code ?? 'null'}:${signal || 'none'}`;
      } else {
        mimirFailure = null;
      }
      mimirEmbedderReady = false;
    });
  }
  const deadline = Date.now() + (boundedInteger(maxWaitSeconds, 30, 1, 180, 'max_wait_seconds') * 1000);
  let status = await readMimirStatus();
  while (
    status.state !== 'failed'
    && status.state !== 'stopped'
    && (waitForEmbedder ? !status.embedderReady : status.state === 'starting')
    && Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    status = await readMimirStatus();
  }
  if (status.state === 'failed' || status.state === 'stopped') {
    const detail = Array.isArray(status.logs) ? status.logs.join('|') : '';
    throw new Error(
      `constellation_mimir_start_failed:${status.failure || status.state}${detail ? `:${detail}` : ''}`
    );
  }
  if (waitForEmbedder && !status.embedderReady) {
    throw new Error('constellation_mimir_embedder_timeout');
  }
  return status;
}

function stopMimir() {
  if (!mimirProcessAlive()) return false;
  mimirStopRequested = true;
  mimirChild.kill('SIGTERM');
  return true;
}

function engineReceipt() {
  const semanticReady = mimirProcessAlive() && !mimirFailure;
  return {
    engine: 'constellation-engine',
    engineVersion: ENGINE_VERSION,
    engineRevision: ENGINE_REVISION,
    semanticState: mimirEmbedderReady ? 'ready' : (semanticReady ? 'warming' : 'available'),
    semanticReason: mimirEmbedderReady
      ? null
      : (semanticReady ? 'embedder_loading' : 'explicit_start_required'),
    semanticModel: 'Xenova/bge-m3',
    semanticDimension: 1024,
    mimirPort,
    deterministicTopologyReady: true,
    consolidationState: 'off',
    databasePath: dbPath,
    counts: engine.stats(),
  };
}

function text(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`constellation_${field}_required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`constellation_${field}_too_large`);
  }
  return normalized;
}

function optionalText(value, field, maxLength) {
  if (value == null || value === '') return null;
  return text(value, field, maxLength);
}

function boundedInteger(value, fallback, minimum, maximum, field) {
  const resolved = value == null ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`constellation_${field}_invalid`);
  }
  return resolved;
}

function boundedNumber(value, fallback, minimum, maximum, field) {
  const resolved = value == null ? fallback : Number(value);
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`constellation_${field}_invalid`);
  }
  return resolved;
}

function requiredBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw new Error(`constellation_${field}_invalid`);
  }
  return value;
}

function activeNode(nativeId) {
  return engine.db.prepare(
    "SELECT id FROM nodes WHERE id = ? AND state = 'active'"
  ).get(nativeId);
}

function tags(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error('constellation_tags_invalid');
  }
  return [...new Set(value.map((item) => text(item, 'tag', 120)))];
}

function edges(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error('constellation_edges_invalid');
  }
  return value.map((edge) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
      throw new Error('constellation_edge_invalid');
    }
    const type = text(edge.type, 'edge_type', 40);
    if (!EDGE_TYPES.has(type)) throw new Error('constellation_edge_type_invalid');
    return {
      target: text(edge.target, 'edge_target', 300),
      type,
      strength: boundedNumber(edge.strength, 0.5, 0.01, 1, 'edge_strength'),
    };
  });
}

function identitySegments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('constellation_identity_segments_required');
  }
  const resolved = {};
  for (const key of ['name', 'values', 'direction', 'relationship']) {
    if (value[key] != null && value[key] !== '') {
      resolved[key] = text(value[key], `identity_${key}`, 1200);
    }
  }
  if (Object.keys(resolved).length === 0) {
    throw new Error('constellation_identity_segments_required');
  }
  return resolved;
}

function stableDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function identityReadback() {
  return engine.db.prepare(`
    SELECT id, state, created_at, updated_at, l0, l1, l2, tags, source, node_type
      FROM nodes
     WHERE id IN (
       'soul-core-refined-name', 'soul-core-refined-values',
       'soul-core-refined-direction', 'soul-core-refined-relationship'
     )
     ORDER BY id
  `).all().map((row) => {
    let decodedTags = [];
    try { decodedTags = JSON.parse(row.tags || '[]'); } catch { decodedTags = []; }
    return { ...row, tags: Array.isArray(decodedTags) ? decodedTags : [] };
  });
}

function reembedSnapshot() {
  if (!reembedJob) return { state: 'idle', databasePath: dbPath };
  const { cancelRequested, rows, ...publicJob } = reembedJob;
  return { ...publicJob, cancelRequested: cancelRequested === true };
}

function autonomySnapshot() {
  if (!autonomyRun) {
    return {
      state: 'idle',
      concurrency: 0,
      maxConcurrency: 1,
      databasePath: dbPath,
    };
  }
  const { timer, ...publicRun } = autonomyRun;
  return { ...publicRun, maxConcurrency: 1, databasePath: dbPath };
}

async function runAutonomyCycle(runId) {
  const run = autonomyRun;
  if (!run || run.id !== runId || run.state !== 'running') return;
  const elapsedSeconds = Math.floor((Date.now() - Date.parse(run.startedAt)) / 1000);
  if (
    run.completedCycles >= run.limits.maxCycles
    || elapsedSeconds >= run.limits.maxDurationSeconds
    || run.contextBudgetUsed >= run.limits.maxTokens
  ) {
    run.state = 'completed';
    run.completedAt = new Date().toISOString();
    run.completionReason = 'bounded_limit_reached';
    return;
  }
  try {
    const perCycleBudget = Math.min(
      run.limits.perCycleTokens,
      run.limits.maxTokens - run.contextBudgetUsed,
    );
    let result;
    if (run.mode === 'maintenance') {
      result = engine.dream({
        decayFactor: run.maintenance.decayFactor,
        pruneThreshold: run.maintenance.pruneThreshold,
        dormantThreshold: run.maintenance.dormantThreshold,
      });
    } else {
      result = engine.dreamCollide({
        numFoci: run.numFoci,
        budget: perCycleBudget,
        maxDepth: run.limits.maxDepth,
      });
      run.contextBudgetUsed += perCycleBudget;
    }
    run.completedCycles += 1;
    run.lastCycleAt = new Date().toISOString();
    run.lastReceipt = {
      cycle: run.completedCycles,
      mode: run.mode,
      changedDatabase: run.mode === 'maintenance',
      result,
    };
  } catch (error) {
    run.state = 'failed';
    run.completedAt = new Date().toISOString();
    run.failure = error instanceof Error ? error.message : String(error);
    return;
  }
  if (
    run.completedCycles >= run.limits.maxCycles
    || run.contextBudgetUsed >= run.limits.maxTokens
  ) {
    run.state = 'completed';
    run.completedAt = new Date().toISOString();
    run.completionReason = 'bounded_limit_reached';
    return;
  }
  autonomyTimer = setTimeout(() => {
    runAutonomyCycle(runId).catch((error) => {
      if (autonomyRun?.id === runId) {
        autonomyRun.state = 'failed';
        autonomyRun.failure = error instanceof Error ? error.message : String(error);
      }
    });
  }, run.limits.intervalSeconds * 1000);
  if (autonomyTimer.unref) autonomyTimer.unref();
}

function render(args, exact) {
  const focus = exact
    ? text(args.nativeId, 'native_id', 300)
    : (Array.isArray(args.focus)
        ? args.focus.map((item) => text(item, 'focus', 500))
        : text(args.focus, 'focus', 500));
  const result = engine.renderSync(focus, {
    budget: boundedInteger(args.budget, 2000, 100, 12000, 'budget'),
    maxDepth: boundedInteger(args.maxDepth, exact ? 1 : 3, 0, 5, 'max_depth'),
    maxL2: boundedInteger(args.maxL2, 12, 0, 128, 'max_l2'),
  });
  return {
    ...result,
    ...engineReceipt(),
  };
}

function inspect(args) {
  const nativeId = text(args.nativeId, 'native_id', 300);
  const rendered = render({ ...args, nativeId }, true);
  // The public render contract deliberately budgets/downgrades content. Exact
  // IDF inspection also needs the authoritative stored L0/L1/L2 record, so the
  // adapter reads it through the same pinned engine instance and database.
  const row = engine.db.prepare(`
    SELECT id, state, created_at, accessed_at, updated_at, l0, l1, l2, tags,
           tone, valence, arousal, weight, source, node_type, event_at, subkind
      FROM nodes
     WHERE id = ? AND state = 'active'
  `).get(nativeId);
  if (!row) return { ...rendered, inspectedNode: null };
  const inspectedEdges = engine.db.prepare(`
    SELECT id, source, target, edge_type, fine_type, fine_confidence,
           fine_source, strength, state, created_at, accessed_at
      FROM edges
     WHERE state = 'active' AND (source = ? OR target = ?)
     ORDER BY id
     LIMIT 256
  `).all(nativeId, nativeId);
  let resolvedTags = [];
  try {
    const parsed = JSON.parse(row.tags || '[]');
    if (Array.isArray(parsed)) resolvedTags = parsed.map(String);
  } catch {
    resolvedTags = [];
  }
  return {
    ...rendered,
    inspectedNode: { ...row, tags: resolvedTags },
    inspectedEdges,
  };
}

async function dispatch(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error('constellation_request_invalid');
  }
  const args = message.arguments && typeof message.arguments === 'object'
    ? message.arguments
    : {};
  if (message.operation === 'context') return render(args, false);
  if (message.operation === 'inspect') return inspect(args);
  if (message.operation === 'projection') {
    return render({
      focus: text(args.focus, 'focus', 500),
      budget: args.budget ?? 12000,
      maxDepth: args.maxDepth ?? 3,
      maxL2: args.maxL2 ?? 128,
    }, false);
  }
  if (message.operation === 'remember') {
    const id = text(args.id, 'id', 300);
    const source = text(args.source || 'liquidaity', 'source', 160);
    const resolvedTags = tags(args.tags);
    const projectTag = optionalText(args.projectTag, 'project_tag', 180);
    if (projectTag && !resolvedTags.includes(projectTag)) resolvedTags.push(projectTag);
    const written = engine.rememberSync({
      id,
      l0: text(args.l0, 'l0', 1000),
      l1: text(args.l1, 'l1', 8000),
      l2: text(args.l2, 'l2', 50000),
      tags: resolvedTags,
      tone: text(args.tone || 'analytical', 'tone', 80),
      valence: boundedNumber(args.valence, 0, -1, 1, 'valence'),
      arousal: boundedNumber(args.arousal, 0.5, 0, 1, 'arousal'),
      weight: boundedNumber(args.weight, 1, 0.01, 10, 'weight'),
      source,
      edges: edges(args.edges),
      skipDedup: args.skipDedup === true,
      node_type: optionalText(args.nodeType, 'node_type', 100),
      event_at: optionalText(args.eventAt, 'event_at', 100),
      subkind: optionalText(args.subkind, 'subkind', 100),
    });
    return {
      ok: true,
      id: written,
      ...engineReceipt(),
    };
  }
  if (message.operation === 'semantic_status') {
    return { ...(await readMimirStatus()), ...engineReceipt() };
  }
  if (message.operation === 'semantic_start') {
    requiredBoolean(args.confirmStart, 'confirm_start');
    if (args.confirmStart !== true) throw new Error('constellation_confirm_start_required');
    const status = await ensureMimir({
      waitForEmbedder: args.waitForReady !== false,
      maxWaitSeconds: boundedInteger(args.maxWaitSeconds, 90, 1, 180, 'max_wait_seconds'),
    });
    return { ok: true, status, ...engineReceipt() };
  }
  if (message.operation === 'semantic_stop') {
    requiredBoolean(args.confirmStop, 'confirm_stop');
    if (args.confirmStop !== true) throw new Error('constellation_confirm_stop_required');
    const stopped = stopMimir();
    return { ok: true, stopped, state: stopped ? 'stopping' : 'stopped', ...engineReceipt() };
  }
  if (message.operation === 'semantic_context') {
    await ensureMimir({
      waitForEmbedder: true,
      maxWaitSeconds: boundedInteger(args.maxWaitSeconds, 90, 1, 180, 'max_wait_seconds'),
    });
    const focus = Array.isArray(args.focus)
      ? args.focus.map((item) => text(item, 'focus', 500))
      : text(args.focus, 'focus', 500);
    const result = await engine.render(focus, {
      budget: boundedInteger(args.budget, 2000, 100, 12000, 'budget'),
      maxDepth: boundedInteger(args.maxDepth, 3, 0, 5, 'max_depth'),
      maxL2: boundedInteger(args.maxL2, 12, 0, 128, 'max_l2'),
      useVector: true,
    });
    return { ...result, semanticSearch: true, ...engineReceipt() };
  }
  if (message.operation === 'remember_semantic') {
    await ensureMimir({
      waitForEmbedder: true,
      maxWaitSeconds: boundedInteger(args.maxWaitSeconds, 90, 1, 180, 'max_wait_seconds'),
    });
    const id = text(args.id, 'id', 300);
    const resolvedTags = tags(args.tags);
    const projectTag = optionalText(args.projectTag, 'project_tag', 180);
    if (projectTag && !resolvedTags.includes(projectTag)) resolvedTags.push(projectTag);
    const written = await engine.remember({
      id,
      l0: text(args.l0, 'l0', 1000),
      l1: text(args.l1, 'l1', 8000),
      l2: text(args.l2, 'l2', 50000),
      tags: resolvedTags,
      tone: text(args.tone || 'analytical', 'tone', 80),
      valence: boundedNumber(args.valence, 0, -1, 1, 'valence'),
      arousal: boundedNumber(args.arousal, 0.5, 0, 1, 'arousal'),
      weight: boundedNumber(args.weight, 1, 0.01, 10, 'weight'),
      source: text(args.source || 'liquidaity', 'source', 160),
      edges: edges(args.edges),
      skipDedup: args.skipDedup === true,
      node_type: optionalText(args.nodeType, 'node_type', 100),
      event_at: optionalText(args.eventAt, 'event_at', 100),
      subkind: optionalText(args.subkind, 'subkind', 100),
    });
    return { ok: true, id: written, embedded: true, ...engineReceipt() };
  }
  if (message.operation === 'reembed_start') {
    requiredBoolean(args.confirmReembed, 'confirm_reembed');
    if (args.confirmReembed !== true) throw new Error('constellation_confirm_reembed_required');
    if (reembedJob?.state === 'running') throw new Error('constellation_reembed_job_running');
    await ensureMimir({
      waitForEmbedder: true,
      maxWaitSeconds: boundedInteger(args.maxWaitSeconds, 90, 1, 180, 'max_wait_seconds'),
    });
    const maxNodes = boundedInteger(args.maxNodes, 100, 1, 1000, 'max_nodes');
    const maxDurationSeconds = boundedInteger(
      args.maxDurationSeconds, 300, 10, 3600, 'max_duration_seconds'
    );
    const rows = engine.db.prepare(`
      SELECT id, l0, l1
        FROM nodes
       WHERE state = 'active'
       ORDER BY id
       LIMIT ?
    `).all(maxNodes);
    reembedJob = {
      id: randomUUID(),
      state: 'running',
      databasePath: dbPath,
      startedAt: new Date().toISOString(),
      completedAt: null,
      maxNodes,
      totalSelected: rows.length,
      processed: 0,
      failed: 0,
      failures: [],
      maxDurationSeconds,
      cancelRequested: false,
      rows,
    };
    const jobId = reembedJob.id;
    setImmediate(async () => {
      const job = reembedJob;
      if (!job || job.id !== jobId) return;
      const deadline = Date.now() + (job.maxDurationSeconds * 1000);
      for (const row of job.rows) {
        if (job.cancelRequested || Date.now() >= deadline) break;
        try {
          await engine._reembedNode(row.id, row.l0, row.l1);
          job.processed += 1;
          job.lastNodeId = row.id;
        } catch (error) {
          job.failed += 1;
          if (job.failures.length < 20) {
            job.failures.push({
              nodeId: row.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      job.completedAt = new Date().toISOString();
      if (job.cancelRequested) job.state = 'cancelled';
      else if (Date.now() >= deadline && job.processed + job.failed < job.totalSelected) {
        job.state = 'bounded_timeout';
      } else job.state = job.failed > 0 ? 'completed_with_failures' : 'completed';
      delete job.rows;
    });
    return { ok: true, job: reembedSnapshot(), ...engineReceipt() };
  }
  if (message.operation === 'reembed_status') {
    return { job: reembedSnapshot(), ...engineReceipt() };
  }
  if (message.operation === 'reembed_cancel') {
    requiredBoolean(args.confirmCancel, 'confirm_cancel');
    if (args.confirmCancel !== true) throw new Error('constellation_confirm_cancel_required');
    const jobId = text(args.jobId, 'job_id', 100);
    if (!reembedJob || reembedJob.id !== jobId) throw new Error('constellation_reembed_job_not_found');
    reembedJob.cancelRequested = true;
    return { ok: true, job: reembedSnapshot(), ...engineReceipt() };
  }
  if (message.operation === 'identity_preview') {
    const segments = identitySegments(args.segments);
    const batchId = optionalText(args.batchId, 'batch_id', 100);
    const reason = text(args.reason, 'reason', 500);
    const previewId = randomUUID();
    const createdAt = new Date().toISOString();
    const preview = {
      previewId,
      digest: stableDigest({ batchId, segments, reason }),
      createdAt,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      batchId,
      segments,
      reason,
      current: identityReadback(),
      proposedIds: Object.keys(segments).map((key) => `soul-core-refined-${key}`),
      provenance: {
        authority: 'constellation-engine',
        operation: 'saveSoulCore',
        databasePath: dbPath,
      },
    };
    identityPreviews.set(previewId, preview);
    return { preview, ...engineReceipt() };
  }
  if (message.operation === 'identity_apply') {
    requiredBoolean(args.confirmIdentityMutation, 'confirm_identity_mutation');
    if (args.confirmIdentityMutation !== true) {
      throw new Error('constellation_confirm_identity_mutation_required');
    }
    const previewId = text(args.previewId, 'preview_id', 100);
    const digest = text(args.digest, 'digest', 64);
    const preview = identityPreviews.get(previewId);
    if (!preview) throw new Error('constellation_identity_preview_not_found');
    if (Date.parse(preview.expiresAt) <= Date.now()) {
      identityPreviews.delete(previewId);
      throw new Error('constellation_identity_preview_expired');
    }
    if (preview.digest !== digest) throw new Error('constellation_identity_preview_mismatch');
    await ensureMimir({
      waitForEmbedder: true,
      maxWaitSeconds: boundedInteger(args.maxWaitSeconds, 90, 1, 180, 'max_wait_seconds'),
    });
    const result = await engine.saveSoulCore({
      batch_id: preview.batchId,
      segments: preview.segments,
    });
    const readback = identityReadback();
    const expectedIds = new Set(preview.proposedIds);
    const readbackIds = new Set(readback.filter((row) => row.state === 'active').map((row) => row.id));
    const verified = [...expectedIds].every((id) => readbackIds.has(id));
    identityPreviews.delete(previewId);
    return {
      ok: result.ok === true && verified,
      result,
      verified,
      readback,
      provenance: {
        ...preview.provenance,
        previewId,
        digest,
        appliedAt: new Date().toISOString(),
      },
      ...engineReceipt(),
    };
  }
  if (message.operation === 'autonomy_status') {
    return { run: autonomySnapshot(), ...engineReceipt() };
  }
  if (message.operation === 'autonomy_start') {
    requiredBoolean(args.confirmAutonomy, 'confirm_autonomy');
    if (args.confirmAutonomy !== true) throw new Error('constellation_confirm_autonomy_required');
    if (autonomyRun?.state === 'running') throw new Error('constellation_autonomy_running');
    const mode = text(args.mode || 'collide', 'autonomy_mode', 40);
    if (!['collide', 'maintenance'].includes(mode)) {
      throw new Error('constellation_autonomy_mode_invalid');
    }
    if (mode === 'maintenance') {
      requiredBoolean(args.confirmWrites, 'confirm_writes');
      if (args.confirmWrites !== true) throw new Error('constellation_confirm_writes_required');
    }
    autonomyRun = {
      id: randomUUID(),
      state: 'running',
      mode,
      startedAt: new Date().toISOString(),
      completedAt: null,
      completedCycles: 0,
      contextBudgetUsed: 0,
      modelTokensUsed: 0,
      numFoci: boundedInteger(args.numFoci, 3, 2, 8, 'num_foci'),
      limits: {
        maxCycles: boundedInteger(args.maxCycles, 3, 1, 100, 'max_cycles'),
        maxDurationSeconds: boundedInteger(
          args.maxDurationSeconds, 300, 5, 86400, 'max_duration_seconds'
        ),
        intervalSeconds: boundedInteger(args.intervalSeconds, 30, 1, 3600, 'interval_seconds'),
        maxDepth: boundedInteger(args.maxDepth, 3, 0, 5, 'max_depth'),
        maxTokens: boundedInteger(args.maxTokens, 6000, 100, 100000, 'max_tokens'),
        perCycleTokens: boundedInteger(
          args.perCycleTokens, 1000, 100, 4000, 'per_cycle_tokens'
        ),
        maxConcurrency: 1,
      },
      maintenance: {
        decayFactor: boundedNumber(args.decayFactor, 0.95, 0.9, 1, 'decay_factor'),
        pruneThreshold: boundedNumber(args.pruneThreshold, 0.05, 0, 0.2, 'prune_threshold'),
        dormantThreshold: boundedNumber(args.dormantThreshold, 0.001, 0, 0.05, 'dormant_threshold'),
      },
    };
    const runId = autonomyRun.id;
    setImmediate(() => runAutonomyCycle(runId));
    return { ok: true, run: autonomySnapshot(), ...engineReceipt() };
  }
  if (message.operation === 'autonomy_pause') {
    requiredBoolean(args.confirmPause, 'confirm_pause');
    if (args.confirmPause !== true) throw new Error('constellation_confirm_pause_required');
    const runId = text(args.runId, 'run_id', 100);
    if (!autonomyRun || autonomyRun.id !== runId) throw new Error('constellation_autonomy_not_found');
    if (autonomyTimer) clearTimeout(autonomyTimer);
    autonomyTimer = null;
    if (autonomyRun.state === 'running') autonomyRun.state = 'paused';
    autonomyRun.pausedAt = new Date().toISOString();
    return { ok: true, run: autonomySnapshot(), ...engineReceipt() };
  }
  if (message.operation === 'autonomy_stop') {
    requiredBoolean(args.confirmStop, 'confirm_stop');
    if (args.confirmStop !== true) throw new Error('constellation_confirm_stop_required');
    const runId = text(args.runId, 'run_id', 100);
    if (!autonomyRun || autonomyRun.id !== runId) throw new Error('constellation_autonomy_not_found');
    if (autonomyTimer) clearTimeout(autonomyTimer);
    autonomyTimer = null;
    autonomyRun.state = 'stopped';
    autonomyRun.completedAt = new Date().toISOString();
    autonomyRun.completionReason = 'explicit_stop';
    return { ok: true, run: autonomySnapshot(), ...engineReceipt() };
  }
  if (message.operation === 'autonomy_resume') {
    requiredBoolean(args.confirmResume, 'confirm_resume');
    if (args.confirmResume !== true) throw new Error('constellation_confirm_resume_required');
    const runId = text(args.runId, 'run_id', 100);
    if (!autonomyRun || autonomyRun.id !== runId) throw new Error('constellation_autonomy_not_found');
    if (autonomyRun.state !== 'paused') throw new Error('constellation_autonomy_not_paused');
    autonomyRun.state = 'running';
    autonomyRun.resumedAt = new Date().toISOString();
    setImmediate(() => runAutonomyCycle(runId));
    return { ok: true, run: autonomySnapshot(), ...engineReceipt() };
  }
  if (message.operation === 'notification_status') {
    const setting = engine.db.prepare(
      "SELECT value FROM engine_meta WHERE key = 'os_notifications_enabled'"
    ).get();
    const pending = engine.db.prepare(
      'SELECT COUNT(*) AS count FROM notification_outbox WHERE delivered_at IS NULL'
    ).get();
    return {
      enabled: setting?.value === '1',
      pending: Number(pending?.count || 0),
      owner: 'constellation-launcher-outbox',
      databasePath: dbPath,
      ...engineReceipt(),
    };
  }
  if (message.operation === 'notify') {
    requiredBoolean(args.confirmNotification, 'confirm_notification');
    if (args.confirmNotification !== true) {
      throw new Error('constellation_confirm_notification_required');
    }
    const queuedId = engine.enqueueOsNotification({
      kind: text(args.kind, 'notification_kind', 64),
      title: text(args.title, 'notification_title', 120),
      body: text(args.body, 'notification_body', 500),
      deeplink: optionalText(args.deeplink, 'notification_deeplink', 500),
    });
    return {
      ok: queuedId != null,
      queued: queuedId != null,
      queuedId: queuedId == null ? null : Number(queuedId),
      reason: queuedId == null ? 'launcher_notifications_disabled' : null,
      owner: 'constellation-launcher-outbox',
      ...engineReceipt(),
    };
  }
  if (message.operation === 'edge_review') {
    const action = text(args.action, 'edge_review_action', 40);
    const edgeId = boundedInteger(args.edgeId, null, 1, Number.MAX_SAFE_INTEGER, 'edge_id');
    let result;
    if (action === 'flag_stale') {
      result = engine.flagEdgeStale(edgeId, 'manual');
    } else if (action === 'verify') {
      result = engine.recordEdgeVerified(edgeId, 'manual');
    } else if (action === 'propose_fine_type') {
      result = engine.recordFineTypeProposal(
        text(args.coarseType, 'coarse_type', 80),
        text(args.proposedFineType, 'proposed_fine_type', 80),
        edgeId,
      );
    } else {
      throw new Error('constellation_edge_review_action_invalid');
    }
    return { action, edgeId, ...result, ...engineReceipt() };
  }
  if (message.operation === 'adjust_edge_pair') {
    const nodeA = text(args.nodeA, 'node_a', 300);
    const nodeB = text(args.nodeB, 'node_b', 300);
    const edgeType = text(args.edgeType, 'edge_type', 40);
    if (!activeNode(nodeA) || !activeNode(nodeB)) {
      throw new Error('constellation_edge_endpoint_not_found');
    }
    if (!EDGE_TYPES.has(edgeType)) throw new Error('constellation_edge_type_invalid');
    const result = engine.adjustEdgeStrengthBidirectional(
      nodeA,
      nodeB,
      edgeType,
      boundedNumber(args.delta, null, -0.5, 0.5, 'delta'),
      'manual',
    );
    return { nodeA, nodeB, edgeType, ...result, ...engineReceipt() };
  }
  if (message.operation === 'classify_edge_pair') {
    const nodeA = text(args.nodeA, 'node_a', 300);
    const nodeB = text(args.nodeB, 'node_b', 300);
    const edgeType = text(args.edgeType, 'edge_type', 40);
    if (!activeNode(nodeA) || !activeNode(nodeB)) {
      throw new Error('constellation_edge_endpoint_not_found');
    }
    if (!EDGE_TYPES.has(edgeType)) throw new Error('constellation_edge_type_invalid');
    const fineConfidence = args.fineConfidence == null
      ? null
      : boundedNumber(args.fineConfidence, null, 0, 1, 'fine_confidence');
    const result = engine.updateEdgeFineTypeBidirectional(
      nodeA,
      nodeB,
      edgeType,
      text(args.fineType, 'fine_type', 80),
      'manual',
      { fineConfidence },
    );
    return { nodeA, nodeB, edgeType, ...result, ...engineReceipt() };
  }
  if (message.operation === 'inject_message') {
    requiredBoolean(args.confirmInject, 'confirm_inject');
    if (args.confirmInject !== true) throw new Error('constellation_confirm_inject_required');
    await ensureMimir({
      waitForEmbedder: true,
      maxWaitSeconds: boundedInteger(args.maxWaitSeconds, 90, 1, 180, 'max_wait_seconds'),
    });
    const result = await engine.injectAssistantMessage({
      text: text(args.text, 'injected_message', 8000),
      source: text(args.source || 'liquidaity-explicit-inject', 'source', 160),
      batch_id: optionalText(args.batchId, 'batch_id', 100),
    });
    const readback = result.node_id ? inspect({ nativeId: result.node_id }) : null;
    return {
      ok: result.node_id != null,
      result,
      readback,
      delivery: {
        nativeBusConnected: result.broadcasted === true,
        telegramConnected: result.telegram === true,
      },
      ...engineReceipt(),
    };
  }
  if (message.operation === 'capabilities') {
    return {
      ...engineReceipt(),
      modes: {
        deterministicTopology: { enabled: true, lifecycle: 'process-owned' },
        semanticEmbedding: {
          enabled: true,
          lifecycle: 'explicit-lazy-process-owned',
          model: 'Xenova/bge-m3',
          dimension: 1024,
        },
        consolidation: { enabled: false, blocker: 'explicitly_disabled_at_bridge' },
        autonomousColdStart: { enabled: false, blocker: 'explicitly_disabled_at_bridge' },
        autonomousResweep: { enabled: false, blocker: 'explicitly_disabled_at_bridge' },
        boundedNativeAutonomy: {
          enabled: true,
          modes: ['collide', 'maintenance'],
          lifecycle: 'explicit-start-pause-resume-stop',
          maxConcurrency: 1,
          modelCalls: false,
        },
        bulkReembedding: {
          enabled: true,
          lifecycle: 'explicit-bounded-cancellable-job',
          maxNodes: 1000,
          maxDurationSeconds: 3600,
        },
        identityMutation: {
          enabled: true,
          lifecycle: 'preview-confirm-apply-readback',
        },
        launcherOutbox: {
          enabled: true,
          lifecycle: 'existing-native-outbox',
        },
      },
      exposedOperations: [
        'capabilities', 'stats', 'context', 'inspect', 'inspect_edge',
        'check_duplicate', 'edge_types', 'collide', 'remember', 'update_memory',
        'link', 'adjust_edge', 'classify_edge', 'forget', 'maintain',
        'semantic_status', 'semantic_start', 'semantic_stop', 'semantic_context',
        'remember_semantic', 'reembed_start', 'reembed_status', 'reembed_cancel',
        'identity_preview', 'identity_apply', 'autonomy_status', 'autonomy_start',
        'autonomy_pause', 'autonomy_resume', 'autonomy_stop',
        'notification_status', 'notify', 'edge_review', 'adjust_edge_pair',
        'classify_edge_pair', 'inject_message',
      ],
      blockedNativeOperations: [
        {
          operation: 'kickoffSeedExpansion',
          blocker: 'pinned_upstream_requires_a_configured_model_provider_and_full_launcher_http_worker',
        },
        {
          operation: 'draftSoulCore',
          blocker: 'pinned_upstream_requires_constellation_llm_provider_credentials',
        },
        {
          operation: 'rememberRaw',
          blocker: 'pinned_upstream_llm_fetch_has_no_cancellable_timeout_contract',
        },
      ],
    };
  }
  if (message.operation === 'stats') {
    return engineReceipt();
  }
  if (message.operation === 'check_duplicate') {
    return {
      ...engine.checkDuplicate(
        text(args.l0, 'l0', 1000),
        text(args.l2, 'l2', 50000),
      ),
      ...engineReceipt(),
    };
  }
  if (message.operation === 'edge_types') {
    return { edgeTypes: engine.getFineTypesByCoarse(), ...engineReceipt() };
  }
  if (message.operation === 'inspect_edge') {
    const edgeId = boundedInteger(args.edgeId, null, 1, Number.MAX_SAFE_INTEGER, 'edge_id');
    const edge = engine.db.prepare(`
      SELECT id, source, target, edge_type, fine_type, fine_confidence,
             fine_source, strength, state, created_at, accessed_at
        FROM edges
       WHERE id = ?
    `).get(edgeId) || null;
    return { edge, ...engineReceipt() };
  }
  if (message.operation === 'collide') {
    return {
      ...engine.dreamCollide({
        numFoci: boundedInteger(args.numFoci, 3, 2, 8, 'num_foci'),
        budget: boundedInteger(args.budget, 800, 100, 4000, 'budget'),
        maxDepth: boundedInteger(args.maxDepth, 3, 0, 5, 'max_depth'),
      }),
      ...engineReceipt(),
    };
  }
  if (message.operation === 'update_memory') {
    const nativeId = text(args.nativeId, 'native_id', 300);
    if (!activeNode(nativeId)) throw new Error('constellation_native_id_not_found');
    const fields = {};
    if (args.l2 != null) fields.l2 = text(args.l2, 'l2', 50000);
    if (args.tags != null) fields.tags = tags(args.tags);
    if (args.tone != null) fields.tone = text(args.tone, 'tone', 80);
    if (args.valence != null) fields.valence = boundedNumber(args.valence, 0, -1, 1, 'valence');
    if (args.arousal != null) fields.arousal = boundedNumber(args.arousal, 0.5, 0, 1, 'arousal');
    if (args.weight != null) fields.weight = boundedNumber(args.weight, 1, 0.01, 10, 'weight');
    if (args.nodeType != null) fields.node_type = text(args.nodeType, 'node_type', 100);
    if (Object.keys(fields).length === 0) throw new Error('constellation_update_fields_required');
    const updated = await engine.updateNode(nativeId, fields);
    return { ok: updated === nativeId, id: updated, updatedFields: Object.keys(fields), ...engineReceipt() };
  }
  if (message.operation === 'link') {
    const sourceId = text(args.sourceId, 'source_id', 300);
    const resolvedEdges = edges(args.edges);
    if (!activeNode(sourceId)) throw new Error('constellation_source_id_not_found');
    for (const edge of resolvedEdges) {
      if (!activeNode(edge.target)) throw new Error('constellation_edge_target_not_found');
    }
    const created = await engine.addEdges(sourceId, resolvedEdges, { source: 'manual' });
    return { ok: true, sourceId, created, ...engineReceipt() };
  }
  if (message.operation === 'adjust_edge') {
    const edgeId = boundedInteger(args.edgeId, null, 1, Number.MAX_SAFE_INTEGER, 'edge_id');
    const delta = boundedNumber(args.delta, null, -0.5, 0.5, 'delta');
    const result = engine.adjustEdgeStrength(edgeId, delta, 'manual');
    return { ...result, ...engineReceipt() };
  }
  if (message.operation === 'classify_edge') {
    const edgeId = boundedInteger(args.edgeId, null, 1, Number.MAX_SAFE_INTEGER, 'edge_id');
    const fineType = text(args.fineType, 'fine_type', 80);
    const fineConfidence = args.fineConfidence == null
      ? null
      : boundedNumber(args.fineConfidence, null, 0, 1, 'fine_confidence');
    const result = engine.updateEdgeFineType(
      edgeId, fineType, 'manual', { fineConfidence }
    );
    return { ...result, ...engineReceipt() };
  }
  if (message.operation === 'forget') {
    const nativeId = text(args.nativeId, 'native_id', 300);
    requiredBoolean(args.confirmDormant, 'confirm_dormant');
    if (args.confirmDormant !== true) throw new Error('constellation_confirm_dormant_required');
    if (!activeNode(nativeId)) throw new Error('constellation_native_id_not_found');
    engine.forget(nativeId);
    return { ok: true, id: nativeId, state: 'dormant', ...engineReceipt() };
  }
  if (message.operation === 'maintain') {
    requiredBoolean(args.confirmProjectMaintenance, 'confirm_project_maintenance');
    if (args.confirmProjectMaintenance !== true) {
      throw new Error('constellation_confirm_project_maintenance_required');
    }
    const report = engine.dream({
      decayFactor: boundedNumber(args.decayFactor, 0.95, 0.9, 1, 'decay_factor'),
      pruneThreshold: boundedNumber(args.pruneThreshold, 0.05, 0, 0.2, 'prune_threshold'),
      dormantThreshold: boundedNumber(args.dormantThreshold, 0.001, 0, 0.05, 'dormant_threshold'),
    });
    return { ok: true, report, ...engineReceipt() };
  }
  throw new Error('constellation_operation_unknown');
}

let closed = false;
function close() {
  if (closed) return;
  closed = true;
  if (autonomyTimer) clearTimeout(autonomyTimer);
  autonomyTimer = null;
  if (reembedJob?.state === 'running') reembedJob.cancelRequested = true;
  stopMimir();
  try { engine.close(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
}
process.once('SIGTERM', () => { close(); process.exit(0); });
process.once('SIGINT', () => { close(); process.exit(0); });
process.once('exit', close);

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', async (line) => {
  const raw = line.trim();
  if (!raw) return;
  let requestId = null;
  try {
    const message = JSON.parse(raw);
    requestId = message.id ?? null;
    protocolWrite({ id: requestId, ok: true, result: await dispatch(message) });
  } catch (error) {
    protocolWrite({
      id: requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
