import {
  knowRecordPresentation,
  observedEntryTime,
  thinkRecordDetail,
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
  const detail = thinkRecordDetail(item);
  return <section className="graph-note graph-think" data-memory-id={item.id}>
    <div className="graph-think-heading">
      <h4>{String(item.title || heading)}</h4>
    </div>
    {entryTime ? <p className="graph-record-time"><time dateTime={entryTime.dateTime}>
      {entryTime.label}
    </time></p> : null}
    {summary ? <p>{summary}</p> : null}
    {detail ? <details><summary>More</summary><p>{detail}</p></details> : null}
    {onRemove ? <button type="button" aria-label="Remove Think" disabled={removing}
      style={{ width: 'fit-content', padding: '3px 8px', fontSize: 11 }} onClick={() => {
      if (window.confirm('Remove this Think?')) onRemove();
    }}>
      {removing ? 'Removing…' : 'Remove'}
    </button> : null}
  </section>;
}

export function KnowRecordCard({
  item,
  removing = false,
  onRemove,
}: {
  item: Record<string, any>;
  removing?: boolean;
  onRemove?: () => void;
}) {
  const entryTime = observedEntryTime(item.ingestedAt);
  const { idea, counterIdea } = knowRecordPresentation(item);
  const sides = [
    { label: 'For', value: idea },
    { label: 'Against', value: counterIdea },
  ] as const;
  return <section className="graph-note graph-know" data-episode-id={item.id}>
    <h5>{String(item.title || 'Know')}</h5>
    {entryTime ? <p className="graph-record-time"><time dateTime={entryTime.dateTime}>
      {entryTime.label}
    </time></p> : null}
    {sides.map(({ label, value }) => <section key={label} data-know-side={label.toLowerCase()}>
      <h6>{label}</h6>
      {value.body ? <p>{value.body}</p> : null}
      {value.detail ? <details><summary>More</summary><p>{value.detail}</p></details> : null}
      {value.citations.map(citation => <p className="graph-know-citation" key={citation.url}>
        <a href={citation.url} target="_blank" rel="noreferrer">{citation.label}</a>
        <span>{[citation.publisher, citation.locator].filter(Boolean).join(' · ')}</span>
        {citation.supports ? <span>{citation.supports}</span> : null}
      </p>)}
    </section>)}
    {onRemove ? <button type="button" aria-label="Remove Know" disabled={removing}
      style={{ width: 'fit-content', padding: '3px 8px', fontSize: 11 }} onClick={() => {
      if (window.confirm('Remove this Know?')) onRemove();
    }}>
      {removing ? 'Removing…' : 'Remove'}
    </button> : null}
  </section>;
}
