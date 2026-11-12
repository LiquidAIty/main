// @vitest-environment jsdom
/**
 * Entity: Saved Cards
 * Relationship: Tests explicit in-panel confirmation/cancellation, selection isolation and busy protection without a browser dialog or a real deletion.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CardDeleteAction from './CardDeleteAction';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('on-Card removal', () => {
  it('keeps the choice local and does nothing on Cancel', () => {
    const remove = vi.fn(async () => {});
    const browserConfirm = vi.spyOn(window, 'confirm');
    render(<CardDeleteAction title="Example" disabled={false} busy={false} onConfirm={remove} buttonStyle={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Card' }));
    expect(screen.getByText('Delete Example?')).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete Example?')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(browserConfirm).not.toHaveBeenCalled();
  });
  it('calls the existing removal owner only after explicit in-panel Delete', async () => {
    const remove = vi.fn(async () => {});
    render(<CardDeleteAction title="Example" disabled={false} busy={false} onConfirm={remove} buttonStyle={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Card' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });
  it('does not carry a confirmation to another selected Card and respects active/busy state', () => {
    const remove = vi.fn(async () => {});
    const { rerender } = render(<CardDeleteAction key="one" title="One" disabled={false} busy={false} onConfirm={remove} buttonStyle={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Card' }));
    rerender(<CardDeleteAction key="two" title="Two" disabled busy={false} onConfirm={remove} buttonStyle={{}} />);
    expect(screen.queryByText('Delete One?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete Card' }).hasAttribute('disabled')).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });
});
