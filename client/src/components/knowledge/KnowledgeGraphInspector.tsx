/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file renders the shared inspector for Think, Know, Code, source, relationship, probability, time, and removal details on one evidence surface.
 *
 * Entity: ThinkGraph
 * Relationship: Presents Think details and the research tag, and lazily opens cited source excerpts before the full exchange.
 *
 * Entity: KnowGraph
 * Relationship: Presents and edits exact first-class Knows and safe citation provenance through the Project-scoped Graphiti writer, without rendering citations as nodes.
 *
 * Entity: CodeGraph
 * Relationship: This file presents File identity, source-owned category contributions, directed structural file neighbors, and explicitly loaded source without creating another Inspector.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { applicationFetch } from '../../lib/applicationApi';
import type { CodeGraphFileSource } from './codeGraphProjection';
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
  const resolvedUrl = candidate.resolvedUrl ?? candidate.resolved_url;
  const rawUrls: unknown[] = [
    candidate.source_url,
    resolvedUrl || candidate.url,
  ];
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
      || candidate.contentFingerprint
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
  projectId,
  removing = false,
  onRemove,
  renderText,
}: {
  item: Record<string, any>;
  heading: string;
  projectId?: string;
  removing?: boolean;
  onRemove?: () => void;
  renderText?: (text: string) => ReactNode;
}) {
  const entryTime = graphEntryTime(item.ingestedAt);
  const summary = typeof item.summary === 'string' && item.summary.trim()
    ? item.summary
    : typeof item.content === 'string' && item.content.trim()
      ? item.content
      : null;
  const relationships = thinkRelationships(item);
  const detail = item.detail ?? item.metadata?.structured_extraction?.think?.detail;
  const researchRequested = item.researchRequested ?? item.metadata?.structured_extraction?.think?.researchRequested;
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(null); setError(''); }, [item.id]);
  const save = async () => {
    if (draft === null || !projectId) return;
    setSaving(true); setError('');
    try {
      const response = await applicationFetch('/api/thinkgraph/correct', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, memoryId: item.id, content: draft }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(String(result.error || 'Could not edit this Think.'));
      setDraft(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setSaving(false); }
  };
  return <section className="graph-note graph-think" data-memory-id={item.id}>
    <div className="graph-think-heading">
      <h4>{renderText ? renderText(String(item.title || heading)) : String(item.title || heading)}</h4>
    </div>
    {entryTime ? <p className="graph-record-time"><time dateTime={entryTime.dateTime}>
      {entryTime.label}
    </time></p> : null}
    {draft !== null ? <form className="graph-record-edit" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>Think content<textarea required maxLength={100000} value={draft} onChange={event => setDraft(event.target.value)} /></label>
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      <button type="button" disabled={saving} onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
    </form> : summary ? <p>{renderText ? renderText(summary) : summary}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {typeof detail === 'string' && detail.trim() && detail !== summary ? <details>
      <summary>More</summary>
      <p>{renderText ? renderText(detail) : detail}</p>
    </details> : null}
    {relationships.length ? <section className="graph-think-section">
      <h5>Relationships</h5>
      <ul>{relationships.map(value => <li key={value}>{renderText ? renderText(value) : value}</li>)}</ul>
    </section> : null}
    {researchRequested === true ? <small>Research requested</small> : null}
    {projectId ? <ThinkSourceExchange key={`${projectId}:${item.id}`} projectId={projectId} memoryId={String(item.id)}
      chunkCount={item.metadata?.thinkgraph_origin?.source_chunks?.length ?? 0} /> : null}
    {projectId && draft === null ? <button type="button" aria-label="Edit record" disabled={removing}
      onClick={() => setDraft(summary || '')}>Edit</button> : null}
    {onRemove && draft === null ? <button type="button" aria-label="Delete record" disabled={removing}
      style={{ width: 'fit-content', padding: '3px 8px', fontSize: 11 }} onClick={() => {
      onRemove();
    }}>
      {removing ? 'Deleting…' : 'Delete'}
    </button> : null}
  </section>;
}

function ThinkSourceExchange({ projectId, memoryId, chunkCount = 0 }: { projectId: string; memoryId: string; chunkCount?: number }) {
  const [result, setResult] = useState<{ sources: Array<{
    status: string; conversationId: string; assistantMessageId: string; completedAt?: string;
    messages?: Array<{ messageId: string; role: string; content: string; createdAt: string }>;
    chunks?: Array<{ id: string; status: string; role?: string; content?: string; heading?: string;
      index?: number; count?: number; messageId?: string; createdAt?: string }>;
  }> } | null>(null);
  const [showExchange, setShowExchange] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const details = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => () => request.current?.abort(), [projectId, memoryId]);
  const load = async (includeExchange = false) => {
    if ((!includeExchange && result) || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setError('');
    try {
      const response = await applicationFetch(`/api/thinkgraph/sources?${new URLSearchParams({ projectId, memoryId,
        ...(includeExchange ? { includeExchange: 'true' } : {}) })}`, {
        signal: controller.signal,
      });
      const value = await response.json();
      if (!response.ok || !Array.isArray(value.sources)) throw new Error('Source exchange unavailable.');
      if (!controller.signal.aborted) { setResult(value); setShowExchange(includeExchange); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Source exchange unavailable.');
    } finally {
      if (request.current === controller) request.current = null;
    }
  };
  return <details ref={details} className="graph-think-source" onToggle={event => {
    if (event.target === event.currentTarget && event.currentTarget.open) void load();
  }}>
    <summary>Source excerpts ({result ? result.sources.reduce((count, source) => count + (source.chunks?.length ?? 0), 0) : chunkCount})</summary>
    {error ? <p role="alert">{error}</p> : !result ? <p>Loading source…</p> : !result.sources.length
      ? <p>The original source reference is unavailable.</p>
      : result.sources.map(source => <article key={`${source.conversationId}:${source.assistantMessageId}`}>
        <small>Conversation: {source.conversationId}</small>
        {source.completedAt ? <p><time dateTime={source.completedAt}>{graphEntryTime(source.completedAt)?.label}</time></p> : null}
        {source.status !== 'available' ? <p>The source was deleted or is unavailable.</p> : <>
          {!source.chunks?.length ? <p>This older record has exchange-level provenance, not chunk citations.</p> : source.chunks.map(chunk =>
            <section key={chunk.id} data-source-chunk-id={chunk.id}>
              {chunk.status !== 'available' ? <p>The source excerpt is unavailable.</p> : <>
                <strong>{chunk.role === 'user' ? 'User' : 'Main'} · excerpt {(chunk.index ?? 0) + 1} of {chunk.count}</strong>
                {chunk.createdAt ? <p><time dateTime={chunk.createdAt}>{graphEntryTime(chunk.createdAt)?.label}</time></p> : null}
                {chunk.heading ? <p>{chunk.heading}</p> : null}
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{chunk.content}</p>
              </>}
            </section>)}
          {showExchange ? source.messages?.map(message => <section key={message.messageId} data-source-message-id={message.messageId}>
            <strong>{message.role === 'user' ? 'User' : 'Main'}</strong>
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.content}</p>
          </section>) : null}
        </>}
      </article>)}
    {result && !showExchange ? <button type="button" onClick={() => void load(true)}>Open full exchange</button> : null}
    {showExchange ? <button type="button" onClick={() => setShowExchange(false)}>Hide full exchange</button> : null}
    <button type="button" onClick={() => { if (details.current) details.current.open = false; }}>Collapse</button>
  </details>;
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
    for (const possibleSource of [record.know.citation, record.episode.citation]) {
      if (possibleSource && typeof possibleSource === 'object' && !Array.isArray(possibleSource)) {
        candidates.push(possibleSource as Record<string, unknown>);
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

export function KnowGraphKnow({
  record,
  projectId,
  heading,
  removing = false,
  onRemove,
  renderText,
}: {
  record: KnowInspectorRecord;
  projectId?: string;
  heading: string;
  removing?: boolean;
  onRemove?: () => void;
  renderText?: (text: string) => ReactNode;
}) {
  const { episodeId, know } = record;
  const citation = know.citation
    && typeof know.citation === 'object'
    && !Array.isArray(know.citation)
    ? know.citation as Record<string, unknown>
    : {};
  const direction = know.direction
    && typeof know.direction === 'object'
    && !Array.isArray(know.direction)
    ? know.direction as Record<string, unknown>
    : {};
  const observation = typeof know.observation === 'string' ? know.observation.trim() : '';
  const interpretation = typeof know.interpretation === 'string'
    ? know.interpretation.trim()
    : '';
  const evidence = typeof citation.evidence === 'string' ? citation.evidence.trim() : '';
  const entryTime = graphEntryTime(citation.retrievedAt ?? know.observedAt);
  const sourceDateValue = citation.eventAt ?? citation.publishedAt ?? know.sourceDate;
  const sourceYear = typeof sourceDateValue === 'string' && /^\d{4}$/.test(sourceDateValue.trim())
    ? sourceDateValue.trim() : null;
  const sourceDate = sourceYear
    ? { dateTime: sourceYear, label: sourceYear }
    : graphEntryTime(sourceDateValue);
  const links = sourceLinks(citation);
  const relation = typeof direction.relation === 'string'
    ? direction.relation.trim()
    : '';
  const proposition = typeof direction.proposition === 'string'
    ? direction.proposition.trim()
    : '';
  const [draft, setDraft] = useState<{
    observation: string; interpretation: string; citation: Record<string, unknown>;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  useEffect(() => { setDraft(null); setEditError(null); }, [episodeId]);
  const save = async () => {
    if (!draft || !projectId) return;
    setSaving(true); setEditError(null);
    try {
      const response = await applicationFetch('/api/knowgraph/edit-know', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, uuid: episodeId, ...draft }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Could not edit this Know.');
      setDraft(null);
    } catch (error) { setEditError(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  return <section className="graph-note graph-know" data-episode-id={episodeId}>
    <div className="graph-think-heading"><h5>{renderText ? renderText(String(know.title || heading)) : String(know.title || heading)}</h5></div>
    {draft ? <form className="graph-record-edit" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>Finding<textarea required maxLength={8000} value={draft.observation}
        onChange={event => setDraft({ ...draft, observation: event.target.value })} /></label>
      <label>Interpretation<textarea required maxLength={8000} value={draft.interpretation}
        onChange={event => setDraft({ ...draft, interpretation: event.target.value })} /></label>
      {(['url', 'title', 'publisher', 'locator'] as const).map(field => <label key={field}>
        {({ url: 'Citation URL', title: 'Citation title', publisher: 'Publisher', locator: 'Source location' })[field]}
        <input required={field !== 'locator'} value={String(draft.citation[field] || '')}
          onChange={event => setDraft({ ...draft, citation: { ...draft.citation, [field]: event.target.value } })} />
      </label>)}
      <label>Source passage<textarea required minLength={20} maxLength={12000}
        value={String(draft.citation.evidence || '')}
        onChange={event => setDraft({ ...draft, citation: { ...draft.citation, evidence: event.target.value } })} /></label>
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      <button type="button" disabled={saving} onClick={() => { setDraft(null); setEditError(null); }}>Cancel</button>
    </form> : <>
      {observation ? <div className="graph-know-finding">
        <strong>Finding</strong>
        <p>{renderText ? renderText(observation) : observation}</p>
      </div> : null}
      {interpretation ? <div className="graph-know-interpretation">
        <strong>Interpretation</strong>
        <p>{renderText ? renderText(interpretation) : interpretation}</p>
      </div> : null}
      {relation && proposition ? <p className="graph-know-direction">
        <strong>{relation.charAt(0).toUpperCase() + relation.slice(1)}</strong>
        {': '}{renderText ? renderText(proposition) : proposition}
      </p> : null}
      {links.length ? <ul className="graph-know-citations">
        {links.map(link => <li key={link.url}>
          <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
          <small>{link.publisher}</small>
        </li>)}
      </ul> : null}
      {evidence ? <details>
        <summary>Source passage</summary>
        <blockquote>{evidence}</blockquote>
      </details> : null}
    </>}
    {editError ? <p role="alert">{editError}</p> : null}
    {entryTime ? <p className="graph-record-time"><span>Retrieved</span>{' '}<time dateTime={entryTime.dateTime}>{entryTime.label}</time></p> : null}
    {sourceDate ? <p className="graph-record-time"><span>Source date</span>{' '}<time dateTime={sourceDate.dateTime}>{sourceDate.label}</time></p> : null}
    {projectId && !draft ? <button type="button" aria-label="Edit record" disabled={removing}
      onClick={() => { setDraft({ observation, interpretation, citation: { ...citation } }); setEditError(null); }}>Edit</button> : null}
    {onRemove && !draft ? <button
      type="button"
      aria-label="Delete record"
      disabled={removing}
      style={{ width: 'fit-content', padding: '3px 8px', fontSize: 11 }}
      onClick={() => {
        onRemove();
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

export function CodeGraphNodeDetails({
  node,
  source,
  sourceLoading,
  sourceError,
  onLoadSource,
  onOpenFile,
  connections = [],
  connectionLoading,
  connectionError,
  onLoadConnections,
  files = [],
  onExpand,
}: {
  node: GraphProjectionNode;
  source: CodeGraphFileSource | null;
  sourceLoading: boolean;
  sourceError: string | null;
  onLoadSource?: (filePath: string) => void;
  onOpenFile?: (path: string) => void;
  connections?: Array<{ filePath: string; direction: 'incoming' | 'outgoing'; kind: string }>;
  connectionLoading?: boolean;
  connectionError?: string | null;
  onLoadConnections?: () => void;
  files?: GraphProjectionNode[];
  onExpand?: () => void;
}) {
  const properties = node.properties || {};
  const recordKind = String(properties.recordKind || 'record');
  const filePath = String(properties.filePath || '');
  const features = stringValues(properties.features);
  const contributions = Array.isArray(properties.contributions)
    ? properties.contributions.filter((item): item is Record<string, unknown> => (
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    ))
    : [];
  return <div data-testid="codegraph-node-details" data-provider-id={node.id}>
    {recordKind === 'feature' ? <section className="graph-inspector-records">
      <h4>Declared code membership</h4>
      <ul>{files.map(file => <li key={file.id}>
        <strong>{file.label}</strong>
        <small style={{ display: 'block' }}>{String(file.properties?.filePath)}</small>
        {(Array.isArray(file.properties?.contributions) ? file.properties.contributions : [])
          .filter((contribution: any) => contribution.feature === properties.featureName)
          .map((contribution: any, index: number) => <p key={index}>{String(contribution.relationship)}</p>)}
        <button type="button" className="codegraph-file-link" aria-label={`View source ${file.label}`}
          onClick={() => onOpenFile?.(String(file.properties?.filePath))}>View source</button>
      </li>)}</ul>
      {onExpand ? <button type="button" onClick={onExpand}>Expand code</button> : null}
    </section> : null}
    <dl className="graph-record-fields graph-edge-meaning">
      <div><dt>Kind</dt><dd>{recordKind}</dd></div>
      {filePath ? <div><dt>Path</dt><dd>{filePath}</dd></div> : null}
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
    {recordKind === 'file' ? <section className="graph-inspector-records">
      <h4>File connections</h4>
      <p>{properties.structuralLoaded
        ? properties.structuralComplete ? 'Selected file read complete.' : 'Selected file read incomplete.'
        : 'Selected file not yet read.'} Counts describe the loaded CBM neighborhood.</p>
      <dl className="graph-record-fields">
        <div><dt>Known caller files</dt><dd>{String(properties.callerFileCount ?? 'Not read')}</dd></div>
        <div><dt>Known called files</dt><dd>{String(properties.calledFileCount ?? 'Not read')}</dd></div>
      </dl>
      {onLoadConnections ? <button type="button" disabled={connectionLoading}
        onClick={onLoadConnections}>{connectionLoading ? 'Reading connections…' : 'Read connections'}</button> : null}
      {connectionError ? <p role="alert">{connectionError}</p> : null}
      <ul>{connections.map(connection => <li key={`${connection.kind}:${connection.direction}:${connection.filePath}`}>
        {connection.direction === 'incoming' ? '← ' : '→ '}{connection.kind}{' '}
        <button type="button" className="codegraph-file-link"
          onClick={() => onOpenFile?.(connection.filePath)}>{connection.filePath}</button>
      </li>)}</ul>
    </section> : null}
    {recordKind === 'file' && filePath && onLoadSource ? <div className="knowledge-authority-actions">
      <button type="button" disabled={sourceLoading} onClick={() => onLoadSource(filePath)}>
        {sourceLoading ? 'Loading source…' : source ? 'Reload source' : 'Open file'}
      </button>
    </div> : null}
    {sourceError ? <p role="alert">{sourceError}</p> : null}
    {source ? <details open className="codegraph-source">
      <summary>Repository source · {source.properties.file}
        {source.properties.startLine ? `:${source.properties.startLine}` : ''}</summary>
      <pre>{source.content}</pre>
      {source.truncated ? <p>Source or connection result truncated.</p> : null}
    </details> : null}
  </div>;
}
