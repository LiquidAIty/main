/**
 * Entity: CodeGraph
 * Relationship: Keeps explicit review/removal flags on inspected CodeGraph Files in browser presentation state, without editing source or invoking agents.
 */
import { useEffect, useState } from 'react';
import type { GraphProjectionNode } from './knowledgeGraphProjection';

type Target = { id: string; label: string; paths: string[] };
type Flag = Target & { intent: 'review' | 'remove'; note: string; at: string };

function nodeTarget(node: GraphProjectionNode | null): Target | null {
  if (!node) return null;
  const properties = node.properties || {};
  if (typeof properties.filePath === 'string') {
    return { id: 'file:' + properties.filePath, label: properties.filePath, paths: [properties.filePath] };
  }
  return null;
}

function validFlag(value: unknown): value is Flag {
  if (!value || typeof value !== 'object') return false;
  const item = value as Flag;
  return typeof item.id === 'string' && typeof item.label === 'string'
    && Array.isArray(item.paths) && item.paths.every(path => typeof path === 'string')
    && (item.intent === 'review' || item.intent === 'remove') && typeof item.note === 'string'
    && typeof item.at === 'string';
}

export function CodeGraphChangeReview({ projectId, selectedNode = null }: {
  projectId: string;
  selectedNode?: GraphProjectionNode | null;
}) {
  const storageKey = 'codegraph.review.' + projectId;
  const [flags, setFlags] = useState<Flag[]>([]);
  const [storageError, setStorageError] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [intent, setIntent] = useState<Flag['intent']>('review');
  const [note, setNote] = useState('');

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (!Array.isArray(saved) || !saved.every(validFlag)) throw new Error('invalid flags');
      setFlags(saved);
      setStorageError('');
    } catch {
      setStorageError('Saved flags could not be read. Existing browser storage has not been replaced.');
    }
  }, [storageKey]);

  useEffect(() => {
    const selected = nodeTarget(selectedNode);
    if (selected) setTarget(selected);
  }, [selectedNode]);

  useEffect(() => {
    const saved = flags.find(flag => flag.id === target?.id);
    setIntent(saved?.intent || 'review');
    setNote(saved?.note || '');
  }, [target?.id, flags]);

  function saveFlags(next: Flag[]) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setFlags(next);
      setStorageError('');
    } catch {
      setStorageError('Flag not saved: browser storage is unavailable. Your note remains in the editor.');
    }
  }

  return <details className="codegraph-review" aria-label="CodeGraph review">
    <summary>Code review · {flags.length} flags</summary>
    <section>
      {target ? <div className="codegraph-review-editor">
        <strong>{target.label}</strong>
        <small>{target.paths.length} file{target.paths.length === 1 ? '' : 's'} selected</small>
        <label>Action<select aria-label="Review action" value={intent} onChange={event => setIntent(event.target.value as Flag['intent'])}>
          <option value="review">Flag for review</option><option value="remove">Remove this approach</option>
        </select></label>
        <label>Note<textarea aria-label="Review note" value={note} maxLength={8000}
          onChange={event => setNote(event.target.value)} placeholder="What should change?" /></label>
        <button type="button" disabled={storageError.startsWith('Saved flags')}
          onClick={() => saveFlags([...flags.filter(flag => flag.id !== target.id), {
            ...target, intent, note, at: new Date().toISOString(),
          }])}>Save flag</button>
      </div> : <p>Select a File in CodeGraph to flag it.</p>}
      <details open={flags.length > 0}>
        <summary>Flags ({flags.length})</summary>
        {flags.map(flag => <article key={flag.id}>
          <button type="button" onClick={() => setTarget(flag)}>{flag.label}</button>
          <strong>{flag.intent === 'remove' ? 'Remove this approach' : 'Flag for review'}</strong>
          {flag.note ? <p>{flag.note}</p> : null}
          <small>Flagged {new Date(flag.at).toLocaleString()}</small>
          <details><summary>Selected files ({flag.paths.length})</summary><ul>{flag.paths.map(path => <li key={path}>{path}</li>)}</ul></details>
          <button type="button" onClick={() => saveFlags(flags.filter(item => item.id !== flag.id))}>Clear flag</button>
        </article>)}
      </details>
      {storageError ? <p role="alert">{storageError}</p> : null}
      <small>Flags stay in this browser. They do not delete files, approve changes, or automatically stop an agent.</small>
    </section>
  </details>;
}
