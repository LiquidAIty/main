/**
 * Entity: Graph Presentation
 * Relationship: Renders the shared inspector’s Think, Know, Code, source, relationship, probability, time, and removal controls while keeping one evidence surface.
 *
 * Entity: ThinkGraph
 * Relationship: Presents bounded Think summaries, details, relationships, timestamps, probabilities, and removal actions for the exact selected Engraphis Entity.
 *
 * Entity: KnowGraph
 * Relationship: Presents bounded two-sided Knows and safe HTTPS citations for the exact selected Graphiti Entity without rendering citations as graph nodes.
 *
 * Entity: CodeGraph
 * Relationship: Presents exact CBM File/Symbol identity, source-owned Feature contributions, bounded structural neighbors, and explicitly loaded source without creating another Inspector.
 */

import type { CodeGraphSelectedSymbol } from './codeGraphProjection';
import type { GraphProjectionNode } from './knowledgeGraphProjection';

export function knowEvidenceIdentity(item: Record<string, unknown>): string | null {
  const providerEpisodeId = typeof item.graphitiEpisodeId === 'string'
    ? item.graphitiEpisodeId.trim()
    : '';
  return providerEpisodeId || null;
}

type SourceLinkView = {
  url: string;
  label: string;
  publisher: string;
  fingerprint: string | null;
};

const SECRET_CITATION_QUERY_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)/i;

function safeSourceUrl(value: string): URL | null {
  if (value.length > 2048 || value.includes('\\')
    || [...value].some(character => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !parsed.hostname
      || parsed.username || parsed.password
      || [...parsed.searchParams.keys()].some(key => SECRET_CITATION_QUERY_KEY.test(key))) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

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
    const parsed = safeSourceUrl(url);
    if (parsed) validUrls.set(url, parsed);
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

export function graphEntryTime(value: unknown): { dateTime: string; label: string } | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const parts = value as Record<string, unknown>;
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      const milliseconds = Date.UTC(
        year,
        month - 1,
        day,
        Number(parts.hour || 0),
        Number(parts.minute || 0),
        Number(parts.second || 0),
        Math.floor(Number(parts.nanosecond || 0) / 1_000_000),
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

export function compactProbability(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric)).toFixed(2).replace(/^0/, '');
}

function thinkRelationships(item: Record<string, any>): string[] {
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

export function ThinkRecordCard({
  item,
  heading,
  removing = false,
  onRemove,
}: {
  item: Record<string, any>;
  heading: string;
  removing?: boolean;
  onRemove?: () => void;
}) {
  const entryTime = graphEntryTime(item.ingestedAt);
  const summary = typeof item.summary === 'string' && item.summary.trim()
    ? item.summary
    : typeof item.content === 'string' && item.content.trim()
      ? item.content
      : null;
  const relationships = thinkRelationships(item);
  return <section className="graph-note graph-think" data-memory-id={item.id}>
    <div className="graph-think-heading">
      <h4>{String(item.title || heading)}</h4>
    </div>
    {entryTime ? <p className="graph-record-time"><time dateTime={entryTime.dateTime}>
      {entryTime.label}
    </time></p> : null}
    {summary ? <p>{summary}</p> : null}
    {relationships.length ? <section className="graph-think-section">
      <h5>Relationships</h5>
      <ul>{relationships.map(value => <li key={value}>{value}</li>)}</ul>
    </section> : null}
    {onRemove ? <button type="button" aria-label="Delete record" disabled={removing}
      style={{ width: 'fit-content', padding: '3px 8px', fontSize: 11 }} onClick={() => {
      if (window.confirm('Delete this record?')) onRemove();
    }}>
      {removing ? 'Deleting…' : 'Delete'}
    </button> : null}
  </section>;
}

export type KnowInspectorRecord = {
  episodeId: string;
  know: Record<string, any>;
  episode: Record<string, any>;
};

export const INSPECTOR_RECORD_LIMIT = 2;

function uniqueRecordSources(records: KnowInspectorRecord[]): SourceLinkView[] {
  const sources = new Map<string, SourceLinkView>();
  for (const record of records) {
    const candidates: Record<string, unknown>[] = [record.episode];
    for (const sideKey of ['idea', 'counterIdea'] as const) {
      const side = record.episode[sideKey];
      if (!side || typeof side !== 'object' || Array.isArray(side)) continue;
      const citations = (side as Record<string, unknown>).citations;
      if (!Array.isArray(citations)) continue;
      for (const citation of citations) {
        if (citation && typeof citation === 'object' && !Array.isArray(citation)) {
          candidates.push(citation as Record<string, unknown>);
        }
      }
    }
    for (const candidate of candidates) {
      for (const link of sourceLinks(candidate)) {
        sources.set(
          link.fingerprint ? `fingerprint:${link.fingerprint}` : `url:${link.url}`,
          link,
        );
      }
    }
  }
  return [...sources.values()];
}

function KnowSide({
  label,
  side,
}: {
  label: 'For' | 'Against';
  side: Record<string, unknown>;
}) {
  const body = typeof side.body === 'string' ? side.body.trim() : '';
  if (!body) return null;
  const detail = typeof side.detail === 'string' ? side.detail.trim() : '';
  const citations = Array.isArray(side.citations)
    ? side.citations.flatMap((candidate): Array<{
        link: SourceLinkView;
        supports: string;
      }> => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
        const citation = candidate as Record<string, unknown>;
        return sourceLinks(citation).map(link => ({
          link,
          supports: typeof citation.supports === 'string' ? citation.supports.trim() : '',
        }));
      })
    : [];
  return <div className="graph-know-side">
    <strong>{label}</strong>
    <p>{body}</p>
    {detail && detail !== body ? <details>
      <summary>More</summary>
      <p>{detail}</p>
    </details> : null}
    {citations.length ? <ul className="graph-know-citations">
      {citations.map(({ link, supports }, index) => <li key={`${link.url}:${index}`}>
        <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
        <small>{link.publisher}</small>
        {supports ? <p>{supports}</p> : null}
      </li>)}
    </ul> : null}
  </div>;
}

export function KnowGraphKnow({
  record,
  heading,
  removing = false,
  onRemove,
}: {
  record: KnowInspectorRecord;
  heading: string;
  removing?: boolean;
  onRemove?: () => void;
}) {
  const { episodeId, know } = record;
  const entryTime = graphEntryTime(know.observedAt);
  const sourceDate = graphEntryTime(know.sourceDate);
  return <section className="graph-note graph-know" data-episode-id={episodeId}>
    <div className="graph-think-heading"><h5>{String(know.title || heading)}</h5></div>
    <KnowSide label="For" side={know.idea || {}} />
    <KnowSide label="Against" side={know.counterIdea || {}} />
    {entryTime ? <p className="graph-record-time"><span>Observed</span>{' '}<time dateTime={entryTime.dateTime}>{entryTime.label}</time></p> : null}
    {sourceDate ? <p className="graph-record-time"><span>Source date</span>{' '}<time dateTime={sourceDate.dateTime}>{sourceDate.label}</time></p> : null}
    {onRemove ? <button
      type="button"
      aria-label="Delete record"
      disabled={removing}
      style={{ width: 'fit-content', padding: '3px 8px', fontSize: 11 }}
      onClick={() => {
        if (window.confirm('Delete this record?')) onRemove();
      }}
    >{removing ? 'Deleting…' : 'Delete'}</button> : null}
  </section>;
}

export function KnowSourceList({
  records,
}: {
  records: KnowInspectorRecord[];
}) {
  const sources = uniqueRecordSources(records);
  if (!sources.length) return null;
  return <section className="knowgraph-sources graph-entity-sources">
    <h4>Sources</h4>
    {sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
      <span>{source.label}</span>
      <small>{source.publisher}</small>
    </a>)}
  </section>;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

function relationshipNames(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item): string[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const qualifiedName = String(record.qualified_name || record.qualifiedName || record.name || '').trim();
    return qualifiedName ? [qualifiedName] : [];
  }) : [];
}

export function CodeGraphNodeDetails({
  node,
  source,
  sourceLoading,
  sourceError,
  onLoadSource,
}: {
  node: GraphProjectionNode;
  source: CodeGraphSelectedSymbol | null;
  sourceLoading: boolean;
  sourceError: string | null;
  onLoadSource?: (qualifiedName: string) => void;
}) {
  const properties = node.properties || {};
  const recordKind = String(properties.recordKind || 'record');
  const filePath = String(properties.filePath || '');
  const qualifiedName = String(properties.qualifiedName || '');
  const featureName = String(properties.featureName || '');
  const features = stringValues(properties.features);
  const memberFiles = stringValues(properties.memberFilePaths);
  const contributions = Array.isArray(properties.contributions)
    ? properties.contributions.filter((item): item is Record<string, unknown> => (
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    ))
    : [];
  const callers = relationshipNames(source?.relationshipEvidence?.callers);
  const callees = relationshipNames(source?.relationshipEvidence?.callees);
  return <div data-testid="codegraph-node-details" data-provider-id={node.id}>
    <dl className="graph-record-fields graph-edge-meaning">
      <div><dt>Kind</dt><dd>{recordKind === 'symbol' ? String(properties.symbolKind || node.type || 'Symbol') : recordKind}</dd></div>
      {featureName ? <div><dt>Feature</dt><dd>{featureName}</dd></div> : null}
      {filePath ? <div><dt>Path</dt><dd>{filePath}</dd></div> : null}
      {qualifiedName ? <div><dt>Qualified identity</dt><dd>{qualifiedName}</dd></div> : null}
      {Number.isFinite(Number(properties.startLine)) ? <div><dt>Lines</dt><dd>
        {String(properties.startLine)}{Number.isFinite(Number(properties.endLine))
          ? `–${String(properties.endLine)}` : ''}
      </dd></div> : null}
    </dl>
    {features.length ? <section className="graph-inspector-records">
      <h4>Feature memberships</h4>
      <ul>{features.map(feature => <li key={feature}>{feature}</li>)}</ul>
    </section> : null}
    {contributions.length ? <section className="graph-inspector-records">
      <h4>Source relationships</h4>
      <ul>{contributions.map((contribution, index) => <li key={`${String(contribution.feature)}:${index}`}>
        <strong>{String(contribution.feature || 'Feature')}</strong>
        {' — '}{String(contribution.relationship || '')}
      </li>)}</ul>
    </section> : null}
    {memberFiles.length ? <section className="graph-inspector-records">
      <h4>Contributing files</h4>
      <ul>{memberFiles.map(path => <li key={path}>{path}</li>)}</ul>
    </section> : null}
    {recordKind === 'symbol' && qualifiedName && onLoadSource ? <div className="knowledge-authority-actions">
      <button type="button" disabled={sourceLoading} onClick={() => onLoadSource(qualifiedName)}>
        {sourceLoading ? 'Loading source…' : source ? 'Reload source' : 'Load source'}
      </button>
    </div> : null}
    {sourceError ? <p role="alert">{sourceError}</p> : null}
    {source ? <details open className="codegraph-source">
      <summary>Current source · {source.properties.file}
        {source.properties.startLine ? `:${source.properties.startLine}` : ''}</summary>
      <pre>{source.content}</pre>
      {callers.length ? <section><h4>Callers</h4><ul>{callers.map(value => <li key={value}>{value}</li>)}</ul></section> : null}
      {callees.length ? <section><h4>Callees</h4><ul>{callees.map(value => <li key={value}>{value}</li>)}</ul></section> : null}
      {source.truncated ? <p>Provider result truncated.</p> : null}
    </details> : null}
  </div>;
}
