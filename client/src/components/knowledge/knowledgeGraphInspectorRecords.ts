import type { GraphProjectionNode } from './joinedKnowledgeGraphProjection';

export type SourceLinkView = {
  url: string;
  label: string;
  publisher: string;
  fingerprint: string | null;
  locator?: string;
  supports?: string;
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
      ...(String(candidate.locator || '').trim()
        ? { locator: String(candidate.locator).trim() }
        : {}),
      ...(String(candidate.supports || '').trim()
        ? { supports: String(candidate.supports).trim() }
        : {}),
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
  const candidates = [
    { ...properties, ...body },
    ...(Array.isArray(body.citations) ? body.citations : []),
    ...(
      body.idea && typeof body.idea === 'object' && !Array.isArray(body.idea)
        && Array.isArray((body.idea as Record<string, unknown>).citations)
        ? (body.idea as Record<string, unknown>).citations as unknown[]
        : []
    ),
    ...(
      body.counterIdea && typeof body.counterIdea === 'object'
        && !Array.isArray(body.counterIdea)
        && Array.isArray((body.counterIdea as Record<string, unknown>).citations)
        ? (body.counterIdea as Record<string, unknown>).citations as unknown[]
        : []
    ),
    ...(Array.isArray(body.sources) ? body.sources : []),
    ...(Array.isArray(body.findings) ? body.findings : []),
  ];
  const links = new Map<string, { url: string; label: string }>();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    for (const link of sourceLinks(candidate as Record<string, unknown>)) {
      links.set(link.url, link);
    }
  }
  return { links: [...links.values()] };
}

export type KnowSideView = {
  body: string;
  detail: string | null;
  citations: SourceLinkView[];
};

function knowSidePresentation(value: unknown): KnowSideView {
  const side = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const body = typeof side.body === 'string' ? side.body.trim() : '';
  const detail = typeof side.detail === 'string' && side.detail.trim()
    ? side.detail.trim()
    : null;
  const citations = new Map<string, SourceLinkView>();
  const rawCitations = Array.isArray(side.citations) ? side.citations : [];
  for (const candidate of rawCitations) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    for (const citation of sourceLinks(candidate as Record<string, unknown>)) {
      citations.set(citation.url, citation);
    }
  }
  return { body, detail, citations: [...citations.values()] };
}

export function knowRecordPresentation(item: Record<string, any>): {
  idea: KnowSideView;
  counterIdea: KnowSideView;
} {
  const properties = item.properties && typeof item.properties === 'object'
    ? item.properties as Record<string, unknown>
    : {};
  const raw = String(item.body || item.content || properties.content || '');
  let structured: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      structured = parsed as Record<string, unknown>;
    }
  } catch { /* Plain-text Knows use their content directly. */ }
  return {
    idea: knowSidePresentation(item.idea ?? structured.idea),
    counterIdea: knowSidePresentation(item.counterIdea ?? structured.counterIdea),
  };
}

export function thinkRecordDetail(item: Record<string, any>): string | null {
  if (typeof item.detail === 'string' && item.detail.trim()) return item.detail.trim();
  const metadata = item.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const structured = metadata.structured_extraction;
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return null;
  const think = structured.think;
  if (!think || typeof think !== 'object' || Array.isArray(think)) return null;
  return typeof think.detail === 'string' && think.detail.trim()
    ? think.detail.trim()
    : null;
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

export const INSPECTOR_RECORD_LIMIT = 12;
