import type {
  GraphProjectionEdge,
  GraphProjectionNode,
} from './joinedKnowledgeGraphProjection';

export function graphitiFactIdentity(edge: GraphProjectionEdge): string | null {
  const properties = edge.properties;
  if (properties?.portableKind !== 'know') return null;
  const graphitiFactUuid = typeof properties.graphitiFactUuid === 'string'
    ? properties.graphitiFactUuid.trim()
    : '';
  return graphitiFactUuid || null;
}

export type SourceLinkView = {
  url: string;
  label: string;
  publisher: string;
  fingerprint: string | null;
};

function sourcePathLabel(url: URL): string {
  const finalSegment = decodeURIComponent(
    url.pathname.split('/').filter(Boolean).at(-1) || '',
  ).replace(/\.[a-z0-9]+$/i, '');
  const readable = finalSegment.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return readable
    ? readable.charAt(0).toUpperCase() + readable.slice(1)
    : url.hostname;
}

export function sourceLinks(candidate: Record<string, unknown>): SourceLinkView[] {
  const rawUrls: unknown[] = [candidate.source_url, candidate.url];
  const described = candidate.source_description ?? candidate.sourceDescription;
  if (Array.isArray(described)) rawUrls.push(...described);
  else if (typeof described === 'string' && described.trim()) {
    try {
      const parsed = JSON.parse(described);
      if (Array.isArray(parsed)) rawUrls.push(...parsed);
      else rawUrls.push(described);
    } catch {
      rawUrls.push(described);
    }
  }
  const validUrls = new Map<string, URL>();
  for (const rawUrl of rawUrls) {
    if (typeof rawUrl !== 'string') continue;
    const url = rawUrl.trim();
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      validUrls.set(url, parsed);
    } catch { /* Invalid URLs are not clickable citations. */ }
  }
  const fingerprint = validUrls.size === 1
    ? String(
      candidate.content_fingerprint
      || candidate.source_fingerprint
      || candidate.document_fingerprint
      || '',
    ).trim() || null
    : null;
  const explicitLabel = validUrls.size === 1
    ? String(candidate.source_title || candidate.title || '').trim()
    : '';
  const links = new Map<string, SourceLinkView>();
  for (const [url, parsed] of validUrls) {
    const item = {
      url,
      label: explicitLabel || sourcePathLabel(parsed),
      publisher: String(candidate.publisher || parsed.hostname),
      fingerprint,
    };
    links.set(fingerprint ? `fingerprint:${fingerprint}` : `url:${url}`, item);
  }
  return [...links.values()];
}

export function sourceDocument(node: GraphProjectionNode) {
  const properties = node.properties || {};
  let body: Record<string, unknown> = {};
  if (typeof properties.content === 'string') {
    try {
      const parsed = JSON.parse(properties.content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
    } catch { /* Plain-text episodes keep their original content. */ }
  }
  const candidates = [{ ...properties, ...body }, ...(Array.isArray(body.sources) ? body.sources : []), ...(Array.isArray(body.findings) ? body.findings : [])];
  const links = new Map<string, { url: string; label: string }>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    for (const link of sourceLinks(candidate as Record<string, unknown>)) {
      links.set(link.url, link);
    }
  }
  return { links: [...links.values()] };
}

export function observedEntryTime(value: unknown): { dateTime: string; label: string } | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const parts = value as Record<string, unknown>;
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      const milliseconds = Date.UTC(
        year, month - 1, day, Number(parts.hour || 0), Number(parts.minute || 0),
        Number(parts.second || 0), Math.floor(Number(parts.nanosecond || 0) / 1_000_000),
      ) - Number(parts.timeZoneOffsetSeconds || 0) * 1_000;
      const date = new Date(milliseconds);
      if (!Number.isNaN(date.getTime())) {
        return { dateTime: date.toISOString(), label: date.toLocaleString() };
      }
    }
  }
  const numeric = Number(value);
  const milliseconds = Number.isFinite(numeric)
    ? numeric * (Math.abs(numeric) < 10_000_000_000 ? 1_000 : 1)
    : Date.parse(String(value));
  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return { dateTime: date.toISOString(), label: date.toLocaleString() };
}

export function probabilityLabel(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return `${(Math.max(0, Math.min(1, numeric)) * 100).toFixed(1)}%`;
}

export function engraphisThinkRelationships(item: Record<string, any>): string[] {
  const metadata = item.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const structured = metadata.structured_extraction;
  const raw = structured && typeof structured === 'object' && !Array.isArray(structured)
    ? structured.relations
    : metadata.relations;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value): string[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const relation = value as Record<string, unknown>;
    const source = typeof relation.source === 'string' ? relation.source.trim() : '';
    const predicate = typeof relation.relation === 'string' ? relation.relation.trim() : '';
    const target = typeof relation.target === 'string' ? relation.target.trim() : '';
    return source && predicate && target ? [`${source} ${predicate} ${target}`] : [];
  });
}

export type KnowInspectorRecord = {
  kind: 'episode' | 'fact';
  graphitiId: string;
  know: Record<string, any>;
  episodes: Record<string, any>[];
};

export const INSPECTOR_RECORD_LIMIT = 2;

export function uniqueRecordSources(records: KnowInspectorRecord[]): SourceLinkView[] {
  const sources = new Map<string, SourceLinkView>();
  for (const record of records) {
    for (const episode of record.episodes) {
      for (const link of sourceLinks(episode)) {
        sources.set(
          link.fingerprint ? `fingerprint:${link.fingerprint}` : `url:${link.url}`,
          link,
        );
      }
    }
  }
  return [...sources.values()];
}
