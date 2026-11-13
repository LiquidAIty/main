// @vitest-environment jsdom
/**
 * Entity: Trading
 * Relationship: Verifies actual-file journal rendering, native profile-scoped reads, sanitized Markdown and honest unavailable states without a database journal or transcript fallback.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarkdownJournal, { journalMarkup } from './MarkdownJournal';

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../hermes/hermesHost', () => ({ hermesWebappHost: () => ({ fetchJSON: read }) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const file = (text: string, path = '/workspace/trader-notes.md') => ({ text, path, binary: false, truncated: false, byteSize: text.length });

describe('Trader Markdown journal', () => {
  it('renders only the selected file and refreshes it explicitly', async () => {
    const text = '# My journal\n\nA human-readable note.\n\n| Observation | Status |\n| --- | --- |\n| Review | Open |';
    read.mockResolvedValue(file(text));
    render(<MarkdownJournal profile="trading" path="/workspace/trader-notes.md" />);
    await screen.findByRole('heading', { name: 'My journal' });
    expect(screen.getByRole('table')).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(1);
    const url = new URL(read.mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe('/api/fs/read-text');
    expect(url.searchParams.get('profile')).toBe('trading');
    expect(url.searchParams.get('path')).toBe('/workspace/trader-notes.md');
    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
    expect(document.querySelector('pre')?.textContent).toBe(text);
    read.mockResolvedValue(file('# Updated by Trader'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh journal' }));
    await screen.findByText('# Updated by Trader');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not synthesize a journal when no file is selected or the file is unavailable', async () => {
    const { rerender } = render(<MarkdownJournal profile="trading" />);
    expect(read).not.toHaveBeenCalled();
    read.mockRejectedValue(new Error('404'));
    rerender(<MarkdownJournal profile="trading" path="/workspace/missing.md" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was created or replaced');
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('passes only the explicitly selected path to the existing Card save callback', async () => {
    read.mockResolvedValue(file('Actual content', '/workspace/my-notes.md'));
    const save = vi.fn();
    render(<MarkdownJournal profile="trading" onSelectPath={save} />);
    fireEvent.change(screen.getByLabelText('Journal file path'), { target: { value: '/workspace/my-notes.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('/workspace/my-notes.md'));
    await screen.findByText('Actual content');
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('rejects a binary result and identifies a truncated native preview', async () => {
    read.mockResolvedValue({ ...file('Binary'), binary: true });
    render(<MarkdownJournal profile="trading" path="/workspace/trader-notes.md" />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Binary')).toBeNull();
    read.mockResolvedValue({ ...file('Actual preview'), truncated: true });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh journal' }));
    await screen.findByText('Actual preview');
    expect(screen.getByRole('status').textContent).toContain('truncated preview');
  });

  it('never displays the previous file after changing the selected path', async () => {
    let finishOld: (value: ReturnType<typeof file>) => void = () => {};
    read.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    read.mockResolvedValue(file('Current file', '/workspace/new.md'));
    const { rerender } = render(<MarkdownJournal profile="trading" path="/workspace/old.md" />);
    rerender(<MarkdownJournal profile="trading" path="/workspace/new.md" />);
    await screen.findByText('Current file');
    await act(async () => finishOld(file('Old result', '/workspace/old.md')));
    expect(screen.queryByText('Old result')).toBeNull();
  });

  it('renders formatting without executable HTML or automatic external media loads', () => {
    const html = journalMarkup('# Note\n\n<script>bad()</script><img src="https://example.com/track"><iframe src="https://example.com"></iframe><a href="javascript:bad()" onclick="bad()">link</a>\n\n**Bold**');
    expect(html).toContain('<h1>Note</h1>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).not.toMatch(/<script|<img|<iframe|javascript:|onclick=/i);
  });
});
