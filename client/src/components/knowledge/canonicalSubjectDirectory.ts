export type CanonicalSubjectAuthority = 'thinkgraph' | 'knowgraph';

export type CanonicalSubjectHeader = {
  canonicalName: string;
  entityKind: string;
} & (
  | { engraphisEntityId: string; graphitiEntityId?: never }
  | { engraphisEntityId?: never; graphitiEntityId: string }
);

export type CanonicalSubjectDirectory = {
  schemaVersion: 'graph-subject-directory';
  projectId: string;
  complete: true;
  counts: { engraphis: number; graphiti: number; total: number };
  revisions: { engraphis: string; graphiti: string };
  subjects: CanonicalSubjectHeader[];
  sha256: string;
  bytes: number;
  estimatedTokens: number;
  readDurationMs: number;
};

export function readCanonicalSubjectProviderPointer(
  subject: unknown,
): { authority: CanonicalSubjectAuthority; entityId: string } | null {
  if (!subject || typeof subject !== 'object' || Array.isArray(subject)) return null;
  const record = subject as Record<string, unknown>;
  const hasEngraphisId = Object.prototype.hasOwnProperty.call(record, 'engraphisEntityId');
  const hasGraphitiId = Object.prototype.hasOwnProperty.call(record, 'graphitiEntityId');
  if (hasEngraphisId === hasGraphitiId) return null;
  const idField = hasEngraphisId ? 'engraphisEntityId' : 'graphitiEntityId';
  const expectedFields = new Set([idField, 'canonicalName', 'entityKind']);
  if (Object.keys(record).length !== expectedFields.size
    || Object.keys(record).some(field => !expectedFields.has(field))) return null;
  const entityId = record[idField];
  if (typeof entityId !== 'string' || !entityId.trim()
    || typeof record.canonicalName !== 'string' || !record.canonicalName.trim()
    || typeof record.entityKind !== 'string' || !record.entityKind.trim()) return null;
  return {
    authority: hasEngraphisId ? 'thinkgraph' : 'knowgraph',
    entityId,
  };
}

export function isCanonicalSubjectDirectory(value: unknown): value is CanonicalSubjectDirectory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const directory = value as Record<string, any>;
  const counts = directory.counts;
  const revisions = directory.revisions;
  if (directory.schemaVersion !== 'graph-subject-directory'
    || directory.complete !== true
    || typeof directory.projectId !== 'string' || !directory.projectId
    || !counts || typeof counts !== 'object' || Array.isArray(counts)
    || Object.keys(counts).sort().join(':') !== 'engraphis:graphiti:total'
    || !Number.isSafeInteger(counts.engraphis) || counts.engraphis < 0
    || !Number.isSafeInteger(counts.graphiti) || counts.graphiti < 0
    || !Number.isSafeInteger(counts.total) || counts.total < 0
    || !revisions || typeof revisions !== 'object' || Array.isArray(revisions)
    || Object.keys(revisions).sort().join(':') !== 'engraphis:graphiti'
    || typeof revisions.engraphis !== 'string' || !revisions.engraphis
    || typeof revisions.graphiti !== 'string' || !revisions.graphiti
    || typeof directory.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(directory.sha256)
    || !Number.isSafeInteger(directory.bytes) || directory.bytes < 1
    || !Number.isSafeInteger(directory.estimatedTokens) || directory.estimatedTokens < 1
    || !Number.isFinite(directory.readDurationMs) || directory.readDurationMs < 0
    || !Array.isArray(directory.subjects)
    || counts.total !== directory.subjects.length) return false;

  const seenIds: Record<CanonicalSubjectAuthority, Set<string>> = {
    thinkgraph: new Set(), knowgraph: new Set(),
  };
  const seenNames: Record<CanonicalSubjectAuthority, Set<string>> = {
    thinkgraph: new Set(), knowgraph: new Set(),
  };
  const observed = { thinkgraph: 0, knowgraph: 0 };
  for (const subject of directory.subjects) {
    const pointer = readCanonicalSubjectProviderPointer(subject);
    const record = subject as Record<string, unknown>;
    if (!pointer
      || seenIds[pointer.authority].has(pointer.entityId)
      || seenNames[pointer.authority].has(String(record.canonicalName))) return false;
    seenIds[pointer.authority].add(pointer.entityId);
    seenNames[pointer.authority].add(String(record.canonicalName));
    observed[pointer.authority] += 1;
  }
  return observed.thinkgraph === counts.engraphis
    && observed.knowgraph === counts.graphiti
    && observed.thinkgraph + observed.knowgraph === counts.total;
}
