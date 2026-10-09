import {
  engraphisThinkRelationships,
  observedEntryTime,
  uniqueRecordSources,
  type KnowInspectorRecord,
} from './knowledgeGraphInspectorRecords';

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
  const entryTime = observedEntryTime(item.ingestedAt);
  const summary = typeof item.summary === 'string' && item.summary.trim()
    ? item.summary
    : typeof item.content === 'string' && item.content.trim()
      ? item.content
      : null;
  const relationships = engraphisThinkRelationships(item);
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

export function KnowRecordCitation({ record }: { record: KnowInspectorRecord }) {
  const sources = uniqueRecordSources([record]);
  if (!sources.length) return null;
  const source = sources[0];
  return <p className="graph-know-citation">
    <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a>
    <span>{source.publisher}</span>
  </p>;
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
  const { graphitiId, know } = record;
  const entryTime = observedEntryTime(know.observedAt);
  const sourceDate = observedEntryTime(know.sourceDate);
  return <section className="graph-note graph-know" data-graphiti-id={graphitiId}>
    <div className="graph-think-heading"><h5>{String(know.title || heading)}</h5>
      {typeof know.graphitiRelation === 'string' && know.graphitiRelation
        ? <span>{know.graphitiRelation}</span> : null}
    </div>
    {typeof know.fact === 'string' && know.fact ? <p>{know.fact}</p> : null}
    <KnowRecordCitation record={record} />
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
  id,
}: {
  records: KnowInspectorRecord[];
  id: string;
}) {
  const sources = uniqueRecordSources(records);
  if (!sources.length) return null;
  return <section id={id} className="knowgraph-sources graph-subject-sources">
    <h4>Sources</h4>
    {sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
      <span>{source.label}</span>
      <small>{source.publisher}</small>
    </a>)}
  </section>;
}
