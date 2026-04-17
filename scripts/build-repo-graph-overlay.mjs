#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'repo-graph-overlay.json');
const GRAPH_METADATA_HEADER_LINE_LIMIT = 40;
const ALLOWED_FIELDS = ['entity', 'role', 'relates_to', 'depends_on', 'feeds_to'];

const ACTIVE_MVP_FILES = [
  'client/src/pages/agentbuilder.tsx',
  'client/src/components/builder/BuilderCanvas.tsx',
  'client/src/components/builder/useBuilderDeckRuntimeActions.ts',
  'client/src/components/builder/deckRunState.ts',
  'client/src/components/builder/deckExecution.ts',
  'client/src/components/assist/PlanWikiSurface.tsx',
  'apps/backend/src/v3/routes/decks.routes.ts',
  'apps/backend/src/v3/runtime/deckRuntime.ts',
  'apps/backend/src/v3/decks/executionPlan.ts',
  'apps/backend/src/v3/runtime/graphExecution.ts',
  'apps/backend/src/v3/decks/store.ts',
  'apps/backend/src/routes/knowgraph.routes.ts',
  'apps/backend/src/v3/routes/messages.routes.ts',
  'apps/backend/src/v3/cards/runtime.ts',
  'apps/backend/src/v3/messages/store.ts',
  'apps/backend/src/services/graphService.ts',
  'services/knowgraph/app.py',
  'services/knowgraph/ingest.py',
];

function dedupeStrings(values) {
  const deduped = [];
  const seen = new Set();
  for (const rawValue of values) {
    const value = String(rawValue || '').trim();
    if (!value) continue;
    const folded = value.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    deduped.push(value);
  }
  return deduped;
}

function stripGraphCommentPrefix(line) {
  const stripped = line.trim();
  if (stripped.startsWith('//')) return stripped.slice(2).trim();
  if (stripped.startsWith('#')) return stripped.slice(1).trim();
  return stripped;
}

function parseGraphMetadata(text) {
  const lines = text.split(/\r?\n/);
  let entity = null;
  let role = null;
  const relatesTo = [];
  const dependsOn = [];
  const feedsTo = [];

  for (const line of lines.slice(0, GRAPH_METADATA_HEADER_LINE_LIMIT)) {
    const candidate = stripGraphCommentPrefix(line);
    if (!candidate.toLowerCase().startsWith('@graph ')) continue;

    const body = candidate.slice(7);
    const separatorIndex = body.indexOf(':');
    if (separatorIndex < 0) continue;

    const fieldKey = body.slice(0, separatorIndex).trim().toLowerCase().replace(/-/g, '_');
    const rawValue = body.slice(separatorIndex + 1).trim();
    if (!ALLOWED_FIELDS.includes(fieldKey) || !rawValue) continue;

    if (fieldKey === 'entity') {
      entity = rawValue;
    } else if (fieldKey === 'role') {
      role = rawValue;
    } else if (fieldKey === 'relates_to') {
      relatesTo.push(...rawValue.split(','));
    } else if (fieldKey === 'depends_on') {
      dependsOn.push(...rawValue.split(','));
    } else if (fieldKey === 'feeds_to') {
      feedsTo.push(...rawValue.split(','));
    }
  }

  if (!entity) return null;

  return {
    entity,
    role,
    relates_to: dedupeStrings(relatesTo),
    depends_on: dedupeStrings(dependsOn),
    feeds_to: dedupeStrings(feedsTo),
  };
}

async function main() {
  const files = [];

  for (const relativePath of ACTIVE_MVP_FILES) {
    const absolutePath = path.join(REPO_ROOT, relativePath);
    let text;
    try {
      text = await fs.readFile(absolutePath, 'utf8');
    } catch (error) {
      console.warn(`[SKIP] Cannot read ${relativePath}: ${error.message}`);
      continue;
    }

    const metadata = parseGraphMetadata(text);
    if (!metadata) continue;

    files.push({
      path: relativePath.replace(/\\/g, '/'),
      entity: metadata.entity,
      role: metadata.role,
      relates_to: metadata.relates_to,
      depends_on: metadata.depends_on,
      feeds_to: metadata.feeds_to,
    });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));

  const overlay = {
    metadata: {
      generated_at: new Date().toISOString(),
      root: REPO_ROOT,
      source: 'scripts/build-repo-graph-overlay.mjs',
      active_mvp_file_count: ACTIVE_MVP_FILES.length,
      annotated_file_count: files.length,
      allowed_fields: ALLOWED_FIELDS,
      active_mvp_files: ACTIVE_MVP_FILES,
    },
    files,
  };

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(overlay, null, 2)}\n`, 'utf8');
  console.log(`[OK] Wrote ${files.length} overlay entries to ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
}

main().catch((error) => {
  console.error('[FATAL]', error);
  process.exit(1);
});
