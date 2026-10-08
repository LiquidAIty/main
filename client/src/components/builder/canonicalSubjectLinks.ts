import type {
  CanonicalSubjectDirectory,
  GraphProjectionNode,
  GraphProjectionV1,
  JoinedGraphPresentation,
} from '../knowledge/KnowledgeAuthorityGraphSurface';

export type CanonicalSubjectAuthority = 'thinkgraph' | 'knowgraph';

export type CanonicalSubjectFocusMember = {
  authority: CanonicalSubjectAuthority;
  entityId: string;
  entityKind: string;
};

export type CanonicalSubjectFocusTarget = {
  projectId: string;
  directorySha256: string;
  canonicalName: string;
  view: CanonicalSubjectAuthority | 'all';
  members: CanonicalSubjectFocusMember[];
};

export type CanonicalSubjectFocusRequest = CanonicalSubjectFocusTarget & {
  requestId: number;
};

export type CanonicalSubjectTextSegment = {
  text: string;
  target?: CanonicalSubjectFocusTarget;
};

export type CanonicalSubjectMatcher = {
  revisionKey: string;
  segmentMessage: (
    role: 'assistant' | 'user',
    text: string,
  ) => CanonicalSubjectTextSegment[];
};

export type CanonicalSubjectFocusSurface = 'joined';

type TrieNode = {
  children: Map<string, TrieNode>;
  terminal?: boolean;
  target?: CanonicalSubjectFocusTarget;
};

type SubjectRecord = CanonicalSubjectFocusMember & {
  canonicalName: string;
  node: GraphProjectionNode;
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

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

function isWordCharacter(value: string | undefined): boolean {
  return Boolean(value && WORD_CHARACTER.test(value));
}

function firstCodePoint(value: string): string | undefined {
  return Array.from(value)[0];
}

function lastCodePoint(value: string): string | undefined {
  return Array.from(value).at(-1);
}

function hasWordBoundaries(text: string, start: number, end: number, name: string): boolean {
  const left = start > 0 ? Array.from(text.slice(0, start)).at(-1) : undefined;
  const right = end < text.length ? Array.from(text.slice(end))[0] : undefined;
  return (!isWordCharacter(firstCodePoint(name)) || !isWordCharacter(left))
    && (!isWordCharacter(lastCodePoint(name)) || !isWordCharacter(right));
}

function protectedCharacters(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  const protect = (start: number, end: number) => {
    mask.fill(1, Math.max(0, start), Math.min(text.length, end));
  };
  const atLineStart = (index: number) => index === 0 || text[index - 1] === '\n';

  for (let index = 0; index < text.length;) {
    if (mask[index]) {
      index += 1;
      continue;
    }
    const fence = atLineStart(index) && (text.startsWith('```', index)
      ? '```'
      : text.startsWith('~~~', index) ? '~~~' : null);
    if (fence) {
      let close = text.indexOf(fence, index + fence.length);
      while (close >= 0 && !atLineStart(close)) close = text.indexOf(fence, close + 1);
      const end = close < 0 ? text.length : close + fence.length;
      protect(index, end);
      index = end;
      continue;
    }
    if (text[index] === '`') {
      let runLength = 1;
      while (text[index + runLength] === '`') runLength += 1;
      const marker = '`'.repeat(runLength);
      const close = text.indexOf(marker, index + runLength);
      const end = close < 0 ? text.length : close + runLength;
      protect(index, end);
      index = end;
      continue;
    }
    if (text[index] === '[') {
      const close = text.indexOf(']', index + 1);
      if (close >= 0) {
        let end = close + 1;
        if (text[end] === '(') {
          const destinationEnd = text.indexOf(')', end + 1);
          if (destinationEnd >= 0) end = destinationEnd + 1;
        }
        protect(index, end);
        index = end;
        continue;
      }
    }
    if (text[index] === '【') {
      const close = text.indexOf('】', index + 1);
      if (close >= 0) {
        protect(index, close + 1);
        index = close + 1;
        continue;
      }
    }
    const isUrl = text.startsWith('https://', index)
      || text.startsWith('http://', index)
      || text.startsWith('www.', index);
    if (isUrl) {
      let end = index + 1;
      while (end < text.length && !/[\s<>\[\]{}]/u.test(text[end])) end += 1;
      protect(index, end);
      index = end;
      continue;
    }
    index += 1;
  }
  return mask;
}

function validDirectory(
  projections: Record<CanonicalSubjectAuthority, GraphProjectionV1>,
): CanonicalSubjectDirectory | null {
  const directory = projections.thinkgraph.canonicalSubjectDirectory;
  if (!isCanonicalSubjectDirectory(directory)
    || projections.thinkgraph.projectId !== directory.projectId
    || projections.knowgraph.projectId !== directory.projectId) return null;
  return directory;
}

function exactSubjectRecords(
  projections: Record<CanonicalSubjectAuthority, GraphProjectionV1>,
  directory: CanonicalSubjectDirectory,
): SubjectRecord[] | null {
  const nodesByAuthority: Record<CanonicalSubjectAuthority, Map<string, GraphProjectionNode>> = {
    thinkgraph: new Map(projections.thinkgraph.nodes.map(node => [node.id, node])),
    knowgraph: new Map(projections.knowgraph.nodes.map(node => [node.id, node])),
  };
  const records: SubjectRecord[] = [];
  for (const subject of directory.subjects) {
    const pointer = readCanonicalSubjectProviderPointer(subject);
    if (!pointer) return null;
    const node = nodesByAuthority[pointer.authority].get(pointer.entityId);
    if (!node
      || node.canonicalName !== subject.canonicalName
      || node.label !== subject.canonicalName
      || node.entityKind !== subject.entityKind
      || node.projectId !== directory.projectId
      || node.episodeId !== undefined
      || node.memoryType !== undefined) continue;
    records.push({
      authority: pointer.authority,
      entityId: pointer.entityId,
      canonicalName: subject.canonicalName,
      entityKind: subject.entityKind,
      node,
    });
  }
  return records;
}

function buildTargets(
  records: SubjectRecord[],
  directory: CanonicalSubjectDirectory,
): CanonicalSubjectFocusTarget[] {
  const directoryNames = new Map<string, number>();
  for (const subject of directory.subjects) {
    directoryNames.set(subject.canonicalName, (directoryNames.get(subject.canonicalName) || 0) + 1);
  }
  const recordsByName = new Map<string, SubjectRecord[]>();
  for (const record of records) {
    const named = recordsByName.get(record.canonicalName) || [];
    named.push(record);
    recordsByName.set(record.canonicalName, named);
  }
  const targets: CanonicalSubjectFocusTarget[] = [];
  for (const [canonicalName, named] of recordsByName) {
    if (named.length !== directoryNames.get(canonicalName)) continue;
    const authorities = new Set(named.map(record => record.authority));
    if (named.length > 2 || named.length !== authorities.size) continue;
    targets.push({
      projectId: directory.projectId,
      directorySha256: directory.sha256,
      canonicalName,
      view: named.length === 2 ? 'all' : named[0].authority,
      members: named.map(({ authority, entityId, entityKind }) => ({
        authority, entityId, entityKind,
      })),
    });
  }
  return targets;
}

function buildTrie(
  targets: CanonicalSubjectFocusTarget[],
  directory: CanonicalSubjectDirectory,
): TrieNode {
  const root: TrieNode = { children: new Map() };
  const targetsByName = new Map(targets.map(target => [target.canonicalName, target]));
  for (const canonicalName of new Set(
    directory.subjects.map(subject => subject.canonicalName),
  )) {
    let node = root;
    for (let index = 0; index < canonicalName.length; index += 1) {
      const character = canonicalName[index];
      const child = node.children.get(character) || { children: new Map() };
      node.children.set(character, child);
      node = child;
    }
    node.terminal = true;
    node.target = targetsByName.get(canonicalName);
  }
  return root;
}

function segmentText(
  trie: TrieNode,
  text: string,
): CanonicalSubjectTextSegment[] {
  const mask = protectedCharacters(text);
  const protectedPrefix = new Uint32Array(text.length + 1);
  for (let index = 0; index < text.length; index += 1) {
    protectedPrefix[index + 1] = protectedPrefix[index] + mask[index];
  }
  const candidates: Array<{
    start: number;
    end: number;
    target?: CanonicalSubjectFocusTarget;
  }> = [];
  for (let start = 0; start < text.length; start += 1) {
    if (mask[start]) continue;
    let node = trie;
    for (let end = start; end < text.length; end += 1) {
      node = node.children.get(text[end])!;
      if (!node) break;
      if (node.terminal
        && protectedPrefix[end + 1] === protectedPrefix[start]
        && hasWordBoundaries(text, start, end + 1, text.slice(start, end + 1))) {
        candidates.push({ start, end: end + 1, target: node.target });
      }
    }
  }
  const selected: typeof candidates = [];
  for (const candidate of candidates.sort((left, right) => (
    (right.end - right.start) - (left.end - left.start)
    || left.start - right.start
    || text.slice(left.start, left.end).localeCompare(text.slice(right.start, right.end))
  ))) {
    if (selected.some(existing => (
      candidate.start < existing.end && candidate.end > existing.start
    ))) continue;
    selected.push(candidate);
  }
  selected.sort((left, right) => left.start - right.start);
  if (!selected.length) return [{ text }];
  const segments: CanonicalSubjectTextSegment[] = [];
  let cursor = 0;
  for (const match of selected) {
    if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start) });
    segments.push({
      text: text.slice(match.start, match.end),
      ...(match.target ? { target: match.target } : {}),
    });
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

export function createCanonicalSubjectMatcher(
  projections: Record<CanonicalSubjectAuthority, GraphProjectionV1>,
): CanonicalSubjectMatcher | null {
  const directory = validDirectory(projections);
  if (!directory) return null;
  const records = exactSubjectRecords(projections, directory);
  if (!records) return null;
  const targets = buildTargets(records, directory);
  const trie = buildTrie(targets, directory);
  return {
    revisionKey: [
      directory.projectId,
      directory.revisions.engraphis,
      directory.revisions.graphiti,
      directory.sha256,
    ].join(':'),
    segmentMessage: (role, text) => role === 'assistant' && targets.length
      ? segmentText(trie, text)
      : [{ text }],
  };
}

function exactFocusNode(
  projection: GraphProjectionV1,
  directory: CanonicalSubjectDirectory,
  request: CanonicalSubjectFocusRequest,
  member: CanonicalSubjectFocusMember,
): GraphProjectionNode | null {
  const headers = directory.subjects.filter(subject => {
    const pointer = readCanonicalSubjectProviderPointer(subject);
    return pointer?.authority === member.authority
      && pointer.entityId === member.entityId
      && subject.canonicalName === request.canonicalName
      && subject.entityKind === member.entityKind;
  });
  if (headers.length !== 1) return null;
  const nodes = projection.nodes.filter(node => node.id === member.entityId);
  if (nodes.length !== 1) return null;
  const node = nodes[0];
  return node.canonicalName === request.canonicalName
    && node.label === request.canonicalName
    && node.entityKind === member.entityKind
    && node.projectId === request.projectId
    && node.episodeId === undefined
    && node.memoryType === undefined
    ? node
    : null;
}

/** Resolve hidden click metadata against the graph's current provider presentation. */
export function resolveCanonicalSubjectFocusVisualId({
  authority,
  projection,
  joinedPresentation,
  directory,
  request,
}: {
  authority: CanonicalSubjectFocusSurface;
  projection: GraphProjectionV1;
  joinedPresentation?: JoinedGraphPresentation;
  directory?: CanonicalSubjectDirectory | null;
  request: CanonicalSubjectFocusRequest;
}): string | null {
  if (!isCanonicalSubjectDirectory(directory)
    || request.projectId !== directory.projectId
    || request.directorySha256 !== directory.sha256
    || projection.projectId !== request.projectId
    || !Number.isSafeInteger(request.requestId)
    || request.requestId < 1) return null;
  if (request.members.length === 1 && joinedPresentation) {
    const member = request.members[0];
    if (request.view !== member.authority) return null;
    const providerProjection = joinedPresentation.providerProjections[member.authority];
    if (!exactFocusNode(providerProjection, directory, request, member)) return null;
    const visualId = joinedPresentation.visualNodeIdByProviderMember.get(
      `${member.authority}:${member.entityId}`,
    );
    if (!visualId) return null;
    const variants = joinedPresentation.nodeVariants.get(visualId) || [];
    return variants.length === 1
      && variants[0].authority === member.authority
      && variants[0].node.id === member.entityId
      && projection.nodes.some(node => node.id === visualId)
      ? visualId
      : null;
  }
  if (request.view !== 'all'
    || request.members.length !== 2
    || !joinedPresentation
    || joinedPresentation.projection.projectId !== request.projectId) return null;
  const authorities = new Set(request.members.map(member => member.authority));
  if (authorities.size !== 2) return null;
  const visualIds = request.members.map(member => {
    const providerProjection = joinedPresentation.providerProjections[member.authority];
    if (!exactFocusNode(providerProjection, directory, request, member)) return null;
    return joinedPresentation.visualNodeIdByProviderMember.get(
      `${member.authority}:${member.entityId}`,
    ) || null;
  });
  if (!visualIds[0] || visualIds[0] !== visualIds[1]) return null;
  const variants = joinedPresentation.nodeVariants.get(visualIds[0]) || [];
  if (variants.length !== 2 || request.members.some(member => !variants.some(variant => (
    variant.authority === member.authority && variant.node.id === member.entityId
  )))) return null;
  return projection.nodes.some(node => node.id === visualIds[0]) ? visualIds[0] : null;
}
