import { createHash } from 'crypto';
import neo4j from 'neo4j-driver';
import type { Driver } from 'neo4j-driver';

export type Neo4jKgEntity = {
  id: string;
  name: string;
  type?: string | null;
  aliases?: string[] | null;
  evidence_chunk_ids?: string[] | null;
};

export type Neo4jKgRelationship = {
  from: string;
  to: string;
  type?: string | null;
  confidence?: number | null;
  evidence_chunk_ids?: string[] | null;
};

export type Neo4jSyncInput = {
  projectId: string;
  entities: Neo4jKgEntity[];
  relationships: Neo4jKgRelationship[];
  provenance: Record<string, unknown>;
};

export type Neo4jSyncResult = {
  enabled: boolean;
  entities: number;
  rels: number;
  reason?: string;
};

let driver: Driver | null = null;
let constraintsReady = false;
let connectivityReady = false;

function isEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env.NEO4J_ENABLED ?? '0'));
}

function canonicalType(value: unknown): string {
  const t = String(value ?? '').trim().toLowerCase();
  return t || 'unknown';
}

function canonicalName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function safeRelTypeLabel(value: unknown): string {
  const cleaned = String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'RELATED_TO';
}

function getDriver(): Driver {
  if (driver) return driver;
  const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
  const user = process.env.NEO4J_USER || 'neo4j';
  const password = process.env.NEO4J_PASSWORD || 'changeme';
  driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  return driver;
}

async function ensureConstraints() {
  if (constraintsReady) return;
  const session = getDriver().session();
  try {
    await session.run(
      'CREATE CONSTRAINT kg_entity_uid_project IF NOT EXISTS FOR (e:Entity) REQUIRE (e.project_id, e.entity_uid) IS UNIQUE',
    );
    try {
      await session.run(
        'CREATE CONSTRAINT kg_rel_uid_project IF NOT EXISTS FOR ()-[r:REL]-() REQUIRE (r.project_id, r.rel_uid) IS UNIQUE',
      );
    } catch (err: any) {
      console.warn('[KG_V2][NEO4J] relationship uniqueness constraint skipped:', err?.message || err);
    }
    constraintsReady = true;
  } finally {
    await session.close();
  }
}

async function ensureConnectivity() {
  if (connectivityReady) return;
  await getDriver().verifyConnectivity();
  connectivityReady = true;
}

type UpsertEntityPayload = {
  extractId: string;
  entityUid: string;
  canonicalName: string;
  displayName: string;
  entityType: string;
  confidence: number;
  aliases: string[];
  evidenceChunkIds: string[];
};

type UpsertRelPayload = {
  relUid: string;
  relType: string;
  relTypeLabel: string;
  aUid: string;
  bUid: string;
  confidence: number;
  weight: number;
  evidenceDocId: string;
  evidenceChunkIds: string[];
};

export async function syncKgToNeo4j(input: Neo4jSyncInput): Promise<Neo4jSyncResult> {
  if (!isEnabled()) {
    return { enabled: false, entities: 0, rels: 0, reason: 'disabled' };
  }

  const projectId = String(input.projectId || '').trim();
  if (!projectId) {
    return { enabled: true, entities: 0, rels: 0, reason: 'project_id_missing' };
  }

  await ensureConnectivity();
  await ensureConstraints();

  const createdAt = String(input.provenance?.createdAt ?? new Date().toISOString());
  const updatedAt = new Date().toISOString();
  const evidenceDocId = String(input.provenance?.doc_id ?? '').trim();
  const sourceMethod = String(input.provenance?.method ?? 'kg_v2_ingest');

  const entityPayloads: UpsertEntityPayload[] = [];
  const entityUidByExtractId = new Map<string, string>();

  for (const entity of input.entities || []) {
    const displayName = String(entity?.name ?? '').trim();
    const extractId = String(entity?.id ?? '').trim();
    if (!displayName || !extractId) continue;

    const entityType = canonicalType(entity?.type);
    const canonical = canonicalName(displayName);
    const entityUid = sha256(`${projectId}|${entityType}|${canonical}`);
    const aliases = Array.isArray(entity?.aliases)
      ? entity.aliases.map((v) => String(v).trim()).filter(Boolean)
      : [];
    const evidenceChunkIds = Array.isArray(entity?.evidence_chunk_ids)
      ? entity.evidence_chunk_ids.map((v) => String(v).trim()).filter(Boolean)
      : [];

    entityUidByExtractId.set(extractId, entityUid);
    entityPayloads.push({
      extractId,
      entityUid,
      canonicalName: canonical,
      displayName,
      entityType,
      confidence: 0.5,
      aliases,
      evidenceChunkIds,
    });
  }

  const relPayloads: UpsertRelPayload[] = [];
  for (const rel of input.relationships || []) {
    const from = String(rel?.from ?? '').trim();
    const to = String(rel?.to ?? '').trim();
    if (!from || !to) continue;
    const aUid = entityUidByExtractId.get(from);
    const bUid = entityUidByExtractId.get(to);
    if (!aUid || !bUid) continue;

    const relType = canonicalType(rel?.type || 'related_to');
    const relUid = sha256(`${projectId}|${relType}|${aUid}|${bUid}|${evidenceDocId}`);
    const evidenceChunkIds = Array.isArray(rel?.evidence_chunk_ids)
      ? rel.evidence_chunk_ids.map((v) => String(v).trim()).filter(Boolean)
      : [];
    const confidence =
      typeof rel?.confidence === 'number' && Number.isFinite(rel.confidence)
        ? rel.confidence
        : 0.5;

    relPayloads.push({
      relUid,
      relType,
      relTypeLabel: safeRelTypeLabel(relType),
      aUid,
      bUid,
      confidence,
      weight: confidence,
      evidenceDocId,
      evidenceChunkIds,
    });
  }

  const session = getDriver().session();
  try {
    await session.executeWrite(async (tx) => {
      for (const e of entityPayloads) {
        await tx.run(
          `
            MERGE (n:Entity { project_id: $projectId, entity_uid: $entityUid })
            SET n.name = $displayName,
                n.canonical_name = $canonicalName,
                n.etype = $entityType,
                n.extract_id = $extractId,
                n.confidence = $confidence,
                n.aliases = $aliases,
                n.evidence_chunk_ids = $evidenceChunkIds,
                n.source_doc_id = $evidenceDocId,
                n.source_method = $sourceMethod,
                n.updated_at = $updatedAt,
                n.created_at = coalesce(n.created_at, $createdAt)
          `,
          {
            projectId,
            entityUid: e.entityUid,
            canonicalName: e.canonicalName,
            displayName: e.displayName,
            entityType: e.entityType,
            extractId: e.extractId,
            confidence: e.confidence,
            aliases: e.aliases,
            evidenceChunkIds: e.evidenceChunkIds,
            evidenceDocId,
            sourceMethod,
            createdAt,
            updatedAt,
          },
        );
      }

      for (const r of relPayloads) {
        await tx.run(
          `
            MERGE (a:Entity { project_id: $projectId, entity_uid: $aUid })
            MERGE (b:Entity { project_id: $projectId, entity_uid: $bUid })
            MERGE (a)-[rel:${r.relTypeLabel} { project_id: $projectId, rel_uid: $relUid }]->(b)
            SET rel.r_type = $relType,
                rel.weight = $weight,
                rel.confidence = $confidence,
                rel.evidence_doc_id = $evidenceDocId,
                rel.evidence_chunk_ids = $evidenceChunkIds,
                rel.source_method = $sourceMethod,
                rel.updated_at = $updatedAt,
                rel.created_at = coalesce(rel.created_at, $createdAt)
          `,
          {
            projectId,
            aUid: r.aUid,
            bUid: r.bUid,
            relUid: r.relUid,
            relType: r.relType,
            weight: r.weight,
            confidence: r.confidence,
            evidenceDocId: r.evidenceDocId,
            evidenceChunkIds: r.evidenceChunkIds,
            sourceMethod,
            createdAt,
            updatedAt,
          },
        );
      }
    });
  } finally {
    await session.close();
  }

  return {
    enabled: true,
    entities: entityPayloads.length,
    rels: relPayloads.length,
  };
}

