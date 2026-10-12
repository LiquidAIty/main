export type CanonicalEntityProviderAuthority = 'thinkgraph' | 'knowgraph';
export type CanonicalEntityAuthority = CanonicalEntityProviderAuthority | 'both';

export type CanonicalEntityHeader = {
  canonicalName: string;
} & (
  | {
    authority: 'thinkgraph';
    engraphisEntityId: string;
    graphitiEntityId?: never;
  }
  | {
    authority: 'knowgraph';
    engraphisEntityId?: never;
    graphitiEntityId: string;
  }
  | {
    authority: 'both';
    engraphisEntityId: string;
    graphitiEntityId: string;
  }
);

export type CanonicalEntityDirectory = {
  schemaVersion: 'graph-entity-directory';
  projectId: string;
  complete: true;
  counts: { engraphis: number; graphiti: number; total: number };
  revisions: { engraphis: string; graphiti: string };
  entities: CanonicalEntityHeader[];
  sha256: string;
  bytes: number;
  estimatedTokens: number;
  readDurationMs: number;
};

export type CanonicalEntityProviderPointer = {
  authority: CanonicalEntityProviderAuthority;
  entityId: string;
};

export function readCanonicalEntityProviderPointers(
  entity: unknown,
): CanonicalEntityProviderPointer[] | null {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return null;
  const record = entity as Record<string, unknown>;
  const authority = record.authority;
  const canonicalName = record.canonicalName;
  if (typeof canonicalName !== 'string' || !canonicalName.trim()
    || !['thinkgraph', 'knowgraph', 'both'].includes(String(authority))) return null;
  const pointers: CanonicalEntityProviderPointer[] = [];
  if (authority === 'thinkgraph' || authority === 'both') {
    if (typeof record.engraphisEntityId !== 'string'
      || !record.engraphisEntityId.trim()) return null;
    pointers.push({ authority: 'thinkgraph', entityId: record.engraphisEntityId });
  }
  if (authority === 'knowgraph' || authority === 'both') {
    if (typeof record.graphitiEntityId !== 'string'
      || !record.graphitiEntityId.trim()) return null;
    pointers.push({ authority: 'knowgraph', entityId: record.graphitiEntityId });
  }
  const expectedFields = new Set([
    'authority',
    'canonicalName',
    ...pointers.map(pointer => pointer.authority === 'thinkgraph'
      ? 'engraphisEntityId'
      : 'graphitiEntityId'),
  ]);
  if (Object.keys(record).length !== expectedFields.size
    || Object.keys(record).some(field => !expectedFields.has(field))) return null;
  return pointers;
}

export function isCanonicalEntityDirectory(value: unknown): value is CanonicalEntityDirectory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const directory = value as Record<string, any>;
  const counts = directory.counts;
  const revisions = directory.revisions;
  if (directory.schemaVersion !== 'graph-entity-directory'
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
    || !Array.isArray(directory.entities)
    || counts.total !== directory.entities.length) return false;

  const seenNames = new Set<string>();
  const seenIds: Record<CanonicalEntityProviderAuthority, Set<string>> = {
    thinkgraph: new Set(), knowgraph: new Set(),
  };
  const observed = { thinkgraph: 0, knowgraph: 0 };
  for (const entity of directory.entities) {
    const pointers = readCanonicalEntityProviderPointers(entity);
    const canonicalName = String((entity as Record<string, unknown>)?.canonicalName || '');
    if (!pointers || seenNames.has(canonicalName)) return false;
    seenNames.add(canonicalName);
    for (const pointer of pointers) {
      if (seenIds[pointer.authority].has(pointer.entityId)) return false;
      seenIds[pointer.authority].add(pointer.entityId);
      observed[pointer.authority] += 1;
    }
  }
  return observed.thinkgraph === counts.engraphis
    && observed.knowgraph === counts.graphiti;
}
