/**
 * Entity: Trading
 * Relationship: Reads and renders the selected Trader-authored Markdown file through Hermes's authenticated file API without generating journal entries or reading session history.
 */
import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { hermesWebappHost } from '../hermes/hermesHost';

type JournalFile = { text: string; path: string; byteSize: number; binary: boolean; truncated: boolean };

export function journalMarkup(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }), {
    ALLOWED_TAGS: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del',
      'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'],
    ALLOWED_ATTR: ['href', 'title', 'start'],
  });
}

export default function MarkdownJournal({ profile, path = '', onSelectPath }: {
  profile: string;
  path?: string;
  onSelectPath?: (path: string) => void;
}) {
  const [selected, setSelected] = useState(path);
  const [draft, setDraft] = useState(path);
  const [revision, setRevision] = useState(0);
  const [file, setFile] = useState<JournalFile | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState(false);
  useEffect(() => { setSelected(path); setDraft(path); setFile(null); }, [profile, path]);
  useEffect(() => {
    setFile(null);
    setError('');
    if (!selected) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const read = hermesWebappHost().fetchJSON;
        if (!read) throw new Error('Hermes file access is unavailable.');
        const params = new URLSearchParams({ profile, path: selected });
        const result = await read<JournalFile>(`/api/fs/read-text?${params}`, { signal: controller.signal });
        if (result.binary || typeof result.text !== 'string' || !/\.(md|markdown)$/i.test(result.path)) {
          throw new Error('Select a readable Markdown file.');
        }
        if (!controller.signal.aborted) setFile(result);
      } catch {
        if (!controller.signal.aborted) setError('Journal unavailable. Check the file path and Hermes file access. Nothing was created or replaced.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [profile, selected, revision]);
  const html = useMemo(() => journalMarkup(file?.text || ''), [file?.text]);
  const open = () => {
    const next = draft.trim();
    if (next && !/\.(md|markdown)$/i.test(next)) { setError('Choose an .md or .markdown file.'); return; }
    setError('');
    setSelected(next);
    setRevision(value => value + 1);
    if (!onSelectPath || next === path) return;
    onSelectPath(next);
  };
  return <div className="markdown-journal" data-testid="trading-journal">
    <form onSubmit={event => { event.preventDefault(); void open(); }}>
      <label>Markdown file<input aria-label="Journal file path" value={draft} maxLength={4096}
        placeholder="Path supplied by Trader" onChange={event => setDraft(event.target.value)} /></label>
      <button type="submit">Open</button>
      <button type="button" disabled={!selected || loading} onClick={() => setRevision(value => value + 1)}>Refresh journal</button>
      {file && <button type="button" aria-pressed={source} onClick={() => setSource(value => !value)}>{source ? 'Formatted' : 'Markdown'}</button>}
    </form>
    {!selected && <p>Open Trader’s Markdown journal. Trader owns its contents; no journal is generated from decisions or chat history.</p>}
    {loading && <p role="status">Reading journal…</p>}
    {error && <p role="alert">{error}</p>}
    {file && <>
      <div className="journal-file-name">{file.path}</div>
      {file.truncated && <p role="status">Hermes returned a truncated preview. The full file is unchanged.</p>}
      {source ? <pre>{file.text}</pre> : <article aria-label="Trader Markdown journal" dangerouslySetInnerHTML={{ __html: html }} />}
    </>}
  </div>;
}
