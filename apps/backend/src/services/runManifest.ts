import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCardRunDir, resolveCardRunManifestPath } from '../coder/workspaceRoot';
import type { RunArtifactEntry, RunManifest } from '../types';

const SCHEMA_VERSION = 1;

// ── Atomic write ─────────────────────────────────────────────────────────

function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${randomUUID().slice(0, 8)}.tmp`);
  try {
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, filePath);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

// ── Hash ──────────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function fileHash(absPath: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

// ── Manifest lifecycle ───────────────────────────────────────────────────

export function createRunManifest(params: {
  projectId: string;
  deckId?: string | null;
  conversationId?: string | null;
  cardId: string;
  runId: string;
  parentRunId?: string | null;
  runtime?: string | null;
  provider?: string | null;
  model?: string | null;
  initiatingRequestRef?: string | null;
  startedAt?: string;
}): RunManifest {
  const manifest: RunManifest = {
    schemaVersion: SCHEMA_VERSION,
    projectId: params.projectId,
    deckId: params.deckId ?? null,
    conversationId: params.conversationId ?? null,
    cardId: params.cardId,
    runId: params.runId,
    parentRunId: params.parentRunId ?? null,
    runtime: params.runtime ?? null,
    provider: params.provider ?? null,
    model: params.model ?? null,
    initiatingRequestRef: params.initiatingRequestRef ?? null,
    startedAt: params.startedAt ?? new Date().toISOString(),
    completedAt: null,
    status: 'running',
    artifacts: [],
    childRunIds: [],
    toolEvidenceRefs: [],
    graphEvidenceRefs: [],
    testEvidenceRefs: [],
    errorSummary: null,
  };
  const dir = resolveCardRunDir(params.projectId, params.cardId, params.runId);
  mkdirSync(dir, { recursive: true });
  writeManifest(manifest);
  return manifest;
}

export function readManifest(projectId: string, cardId: string, runId: string): RunManifest | null {
  const p = resolveCardRunManifestPath(projectId, cardId, runId);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as RunManifest;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!parsed.projectId || !parsed.cardId || !parsed.runId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeManifest(manifest: RunManifest): void {
  const p = resolveCardRunManifestPath(manifest.projectId, manifest.cardId, manifest.runId);
  const copy = { ...manifest };
  const content = JSON.stringify(copy, null, 2);
  copy.manifestHash = sha256(content);
  atomicWrite(p, JSON.stringify(copy, null, 2));
}

export function registerArtifact(
  manifest: RunManifest,
  params: {
    relativePath: string;
    artifactType: RunArtifactEntry['artifactType'];
    mime?: string | null;
    bytes: number;
    producerCardId?: string;
    evidenceRole?: RunArtifactEntry['evidenceRole'];
    summary?: string | null;
  },
): RunArtifactEntry {
  const absPath = path.join(
    resolveCardRunDir(manifest.projectId, manifest.cardId, manifest.runId),
    params.relativePath,
  );
  const entry: RunArtifactEntry = {
    artifactId: `art_${randomUUID().slice(0, 12)}`,
    relativePath: params.relativePath,
    artifactType: params.artifactType,
    mime: params.mime ?? null,
    bytes: params.bytes,
    hash: fileHash(absPath),
    createdAt: new Date().toISOString(),
    producerCardId: params.producerCardId ?? manifest.cardId,
    evidenceRole: params.evidenceRole ?? null,
    summary: params.summary ?? null,
  };
  // Idempotent: update if same path exists, otherwise add
  const existing = manifest.artifacts.findIndex((a) => a.relativePath === params.relativePath);
  if (existing >= 0) {
    manifest.artifacts[existing] = entry;
  } else {
    manifest.artifacts.push(entry);
  }
  writeManifest(manifest);
  return entry;
}

export function completeManifest(manifest: RunManifest, params?: { outputSummary?: string }): void {
  manifest.status = 'completed';
  manifest.completedAt = new Date().toISOString();
  if (params?.outputSummary) {
    manifest.errorSummary = null;
  }
  writeManifest(manifest);
}

export function failManifest(manifest: RunManifest, error: string): void {
  manifest.status = 'failed';
  manifest.completedAt = new Date().toISOString();
  manifest.errorSummary = error;
  writeManifest(manifest);
}

export function listCardRuns(projectId: string, cardId: string): RunManifest[] {
  const cw = resolveCardRunDir(projectId, cardId, '_').replace(/[/\\][^/\\]*$/, '');
  const runsDir = path.dirname(cw);
  if (!existsSync(runsDir)) return [];
  const manifests: RunManifest[] = [];
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const m = readManifest(projectId, cardId, entry.name);
    if (m) manifests.push(m);
  }
  manifests.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  return manifests;
}
