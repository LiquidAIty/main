// @vitest-environment jsdom
/**
 * Entity: CodeGraph
 * Relationship: Verifies exact inspected targets, review/removal flags, Project-scoped browser persistence, and storage failures without source or agent writes.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CodeGraphChangeReview } from './CodeGraphChangeReview';
import type { GraphProjectionNode } from './knowledgeGraphProjection';

const path = 'client/src/view.tsx';
const file: GraphProjectionNode = { id: 'file-identity', label: 'view.tsx', properties: { recordKind: 'file', filePath: path } };
const feature: GraphProjectionNode = { id: 'feature:CodeGraph', label: 'CodeGraph', properties: { recordKind: 'feature', memberFilePaths: [path] } };

beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function openReview() {
  const panel = screen.getByLabelText('CodeGraph review') as HTMLDetailsElement;
  panel.open = true;
  fireEvent(panel, new Event('toggle'));
}

it('flags the inspected whole file for removal without a request and restores its note', async () => {
  const view = render(<CodeGraphChangeReview projectId="project-one" selectedNode={file} />);
  openReview();
  fireEvent.change(screen.getByLabelText('Review action'), { target: { value: 'remove' } });
  fireEvent.change(screen.getByLabelText('Review note'), { target: { value: 'Rejected duplicate path. Preserve the working feature.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save flag' }));
  expect(screen.getByText('Flags (1)')).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('codegraph.review.project-one')!)[0]).toMatchObject({
    label: path, paths: [path], intent: 'remove', note: 'Rejected duplicate path. Preserve the working feature.',
  });
  view.unmount();
  render(<CodeGraphChangeReview projectId="project-one" />);
  openReview();
  expect(await screen.findByText('Rejected duplicate path. Preserve the working feature.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear flag' }));
  expect(JSON.parse(localStorage.getItem('codegraph.review.project-one')!)).toEqual([]);
});

it('keeps existing category flags readable after category canvas nodes are removed', () => {
  localStorage.setItem('codegraph.review.project-one', JSON.stringify([{
    id: feature.id, paths: [path], label: feature.label, intent: 'review',
    note: 'Retained category note.', at: '2026-11-02T12:00:00Z',
  }]));
  render(<CodeGraphChangeReview projectId="project-one" />);
  openReview();
  fireEvent.click(screen.getByRole('button', { name: 'CodeGraph' }));
  expect(screen.getByLabelText('Review note')).toHaveProperty('value', 'Retained category note.');
  fireEvent.click(screen.getByRole('button', { name: 'Save flag' }));
  expect(JSON.parse(localStorage.getItem('codegraph.review.project-one')!)[0]).toMatchObject({
    id: 'feature:CodeGraph', paths: [path], label: 'CodeGraph',
  });
});

it('does not read another Project flags', () => {
  localStorage.setItem('codegraph.review.other-project', JSON.stringify([
    { id: 'other', label: 'Other file', paths: ['other.ts'], intent: 'review', note: 'Private note', at: '2026-11-02T12:00:00Z' },
  ]));
  render(<CodeGraphChangeReview projectId="project-one" />);
  openReview();
  expect(screen.queryByText('Private note')).toBeNull();
  expect(screen.getByText('Flags (0)')).toBeTruthy();
});

it('never overwrites unreadable existing flags', async () => {
  localStorage.setItem('codegraph.review.project-one', 'not-json');
  render(<CodeGraphChangeReview projectId="project-one" selectedNode={file} />);
  openReview();
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Saved flags could not be read. Existing browser storage has not been replaced.');
  expect(screen.getByRole('button', { name: 'Save flag' })).toHaveProperty('disabled', true);
  expect(localStorage.getItem('codegraph.review.project-one')).toBe('not-json');
});

it('reports failed flag persistence and retains the note in its editor', async () => {
  render(<CodeGraphChangeReview projectId="project-one" selectedNode={file} />);
  openReview();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  fireEvent.change(screen.getByLabelText('Review note'), { target: { value: 'Keep this note.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save flag' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Flag not saved: browser storage is unavailable. Your note remains in the editor.');
  expect(screen.getByLabelText('Review note')).toHaveProperty('value', 'Keep this note.');
  expect(screen.getByText('Flags (0)')).toBeTruthy();
});
