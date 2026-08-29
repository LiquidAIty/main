'use strict';

// Thin newline-delimited JSON adapter over the pinned upstream engine. The
// process owns one database and one ConstellationEngine instance for life.
// Stdout is protocol-only; upstream diagnostics are redirected to stderr.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

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

const { ConstellationEngine } = require('constellation-engine/engine.cjs');
const engine = new ConstellationEngine(dbPath);

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
    engine: 'constellation-engine',
    engineVersion: '1.0.5',
    engineRevision: 'ac460489f1cd3cd629fa96f2730e5ae9daa4326c',
    semanticState: 'degraded',
    semanticReason: 'mimir_embedding_daemon_not_owned_by_liquidaity',
    deterministicTopologyReady: true,
    consolidationState: 'off',
    databasePath: dbPath,
    counts: engine.stats(),
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
  };
}

function dispatch(message) {
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
      engine: 'constellation-engine',
      engineVersion: '1.0.5',
      engineRevision: 'ac460489f1cd3cd629fa96f2730e5ae9daa4326c',
      semanticState: 'degraded',
      deterministicTopologyReady: true,
      consolidationState: 'off',
      counts: engine.stats(),
    };
  }
  if (message.operation === 'stats') {
    return {
      engine: 'constellation-engine',
      engineVersion: '1.0.5',
      engineRevision: 'ac460489f1cd3cd629fa96f2730e5ae9daa4326c',
      semanticState: 'degraded',
      deterministicTopologyReady: true,
      consolidationState: 'off',
      databasePath: dbPath,
      counts: engine.stats(),
    };
  }
  throw new Error('constellation_operation_unknown');
}

let closed = false;
function close() {
  if (closed) return;
  closed = true;
  try { engine.close(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
}
process.once('SIGTERM', () => { close(); process.exit(0); });
process.once('SIGINT', () => { close(); process.exit(0); });
process.once('exit', close);

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  const raw = line.trim();
  if (!raw) return;
  let requestId = null;
  try {
    const message = JSON.parse(raw);
    requestId = message.id ?? null;
    protocolWrite({ id: requestId, ok: true, result: dispatch(message) });
  } catch (error) {
    protocolWrite({
      id: requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
