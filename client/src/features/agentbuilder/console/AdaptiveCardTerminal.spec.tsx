// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdaptiveCardTerminal, { reconcileTerminalEvents, reconcileCardTerminal, requestCardTranscript, usesAdaptiveCardTerminal, RuntimeEventList,
  type CardTerminalObservation, type CardTerminalEvent } from './AdaptiveCardTerminal';
import type { CardRuntime } from '../../../types/agentgraph';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const runtime: CardRuntime = { kind: 'hermes', mode: 'delegate', profile: 'research' };
const identity = { projectId: 'p', deckId: 'd', cardId: 'c', cardName: 'Saved Card', runId: 'r', parentRunId: null, nativeChildId: null };
const model: CardTerminalEvent = { ...identity, id: 'r:model', kind: 'model', sequence: 1, timestamp: null, text: 'Model text' };
const observation: CardTerminalObservation = { ...identity, events: [model], activeAgentCount: 1, observation: 'live',
  unavailableReason: null, transcript: { sessionId: 's', unavailableReason: null }, finalText: '', errorCode: null, errorSummary: '' };
const props = { enabled: true, projectId: 'p', deckId: 'd', cardId: 'c', runtime, busy: false,
  children: <textarea aria-label="Dynamic context / input" defaultValue="Existing mission" /> };
const running = { runId: 'r', state: 'running', status: 'working', output: '', error: null, terminal: observation };

describe('ordinary saved Card adaptive terminal', () => {
  it('retains observed events through temporary disconnect and completion without mixing Runs', () => {
    const disconnected: CardTerminalObservation = { ...observation, events: [], observation: 'unavailable',
      activeAgentCount: null, unavailableReason: 'hermes_active_turn_unavailable' };
    const retained = reconcileCardTerminal(observation, disconnected)!;
    expect(retained.events).toEqual([model]);
    expect(retained.observation).toBe('unavailable');
    expect(retained.activeAgentCount).toBeNull();
    const completed = reconcileCardTerminal(retained, { ...disconnected, observation: 'finished',
      finalText: 'Accepted final', activeAgentCount: 0 });
    expect(completed?.events).toEqual([model]);
    expect(completed?.finalText).toBe('Accepted final');
    expect(reconcileCardTerminal(retained, { ...disconnected, runId: 'different' })?.events).toEqual([]);
  });

  it('orders concurrent workers without identity collisions and filters exact tasks', () => {
    const a = { ...model, id: 'native-1', taskId: 't_a', agentId: 'attempt-1', text: 'Worker A', sequence: 2 };
    const b = { ...a, taskId: 't_b', agentId: 'attempt-2', text: 'Worker B', sequence: 1 };
    const retry = { ...a, agentId: 'attempt-3', text: 'Replacement A', sequence: 3 };
    expect(reconcileTerminalEvents([retry, a, b, a])).toEqual([b, a, retry]);
    const view = render(<RuntimeEventList events={[retry, a, b, a]} taskId="t_a" />);
    expect(screen.getByText('Worker A')).toBeTruthy();
    expect(screen.getByText('Replacement A')).toBeTruthy();
    expect(screen.queryByText('Worker B')).toBeNull();
    view.rerender(<RuntimeEventList events={[retry, a, b, a]} />);
    expect(screen.getAllByText('Worker A')).toHaveLength(1);
    expect(screen.getByText('Worker B')).toBeTruthy();
  });

  it('bounds long output and defers expandable tool payload rendering', () => {
    const text = 'x'.repeat(9000);
    render(<RuntimeEventList events={[{ ...model, text }, { ...model, id: 'tool', kind: 'tool_result', toolName: 'read', detail: 'deferred detail' }]} />);
    expect(document.body.textContent).not.toContain('deferred detail');
    expect(document.body.textContent).not.toContain('x'.repeat(4001));
    fireEvent.click(screen.getByText('Show more output'));
    expect(document.body.textContent).toContain('x'.repeat(8000));
    expect(document.body.textContent).not.toContain(text);
  });

  it('keeps model conversation out of Main technical output without hiding tool failures', () => {
    render(<RuntimeEventList main events={[
      { ...model, category: 'conversation.answer' },
      { ...model, id: 'done', category: 'conversation.answer', kind: 'completion', status: 'completed', text: 'Final chat reply' },
      { ...model, id: 'tool', category: 'execution.tool', kind: 'tool_error', status: 'failed', toolName: 'lookup', detail: 'missing' },
    ]} />);
    expect(screen.queryByText('Model text')).toBeNull();
    expect(screen.queryByText('Final chat reply')).toBeNull();
    expect(screen.getByText('lookup')).toBeTruthy();
    expect(screen.getByText('failed')).toBeTruthy();
  });

  it('uses canonical runtime bindings and keeps Main and Coder on their specialized surfaces', () => {
    expect(usesAdaptiveCardTerminal('agent', runtime)).toBe(true);
    for (const specialized of [
      { kind: 'hermes', mode: 'main', profile: 'main' },
      { kind: 'hermes', mode: 'delegate', profile: 'coder' },
    ] as CardRuntime[]) expect(usesAdaptiveCardTerminal('agent', specialized)).toBe(false);
    expect(usesAdaptiveCardTerminal('agent', { kind: 'hermes', mode: 'kanban', profile: 'anything' })).toBe(true);
    for (const mode of ['assistant', 'magentic_one'] as const) {
      expect(usesAdaptiveCardTerminal('agent', { kind: 'autogen', mode })).toBe(true);
    }
    expect(usesAdaptiveCardTerminal('graph', runtime)).toBe(false);
    expect(usesAdaptiveCardTerminal(undefined, runtime)).toBe(false);
    render(<AdaptiveCardTerminal {...props} enabled={false} run={running} />);
    expect(screen.queryByTestId('adaptive-card-terminal')).toBeNull();
    expect(screen.getByLabelText('Dynamic context / input')).toBeTruthy();
  });

  it('keeps the existing dormant input and submission control unchanged', () => {
    const submit = vi.fn();
    render(<AdaptiveCardTerminal {...props} run={null}>
      <button onClick={submit}>Run existing input</button>
    </AdaptiveCardTerminal>);
    fireEvent.click(screen.getByText('Run existing input'));
    expect(submit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('log')).toBeNull();
    expect(screen.queryByTestId('terminal-active-agents')).toBeNull();
  });

  it('shows starting without inventing authorization or model activity', () => {
    render(<AdaptiveCardTerminal {...props} busy run={null} />);
    expect(screen.getByTestId('adaptive-card-terminal').getAttribute('data-state')).toBe('starting');
    expect(screen.queryByLabelText('Dynamic context / input')).toBeNull();
    expect(screen.queryByTestId('terminal-active-agents')).toBeNull();
  });

  it('updates model text in place, deduplicates IDs and excludes reasoning', () => {
    const view = render(<AdaptiveCardTerminal {...props} run={running} />);
    const updated = { ...model, text: 'Model text appended' };
    view.rerender(<AdaptiveCardTerminal {...props} run={{ ...running,
      terminal: { ...observation, events: [model, updated, { ...model, id: 'thought', kind: 'reasoning', text: 'private thought' } as unknown as CardTerminalEvent] },
    }} />);
    expect(screen.getAllByText('Model text appended')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('private thought');
    expect(reconcileTerminalEvents([model, updated])).toEqual([updated]);
  });

  it('honors manual scrolling and offers return to live without another request', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const view = render(<AdaptiveCardTerminal {...props} run={running} />);
    const output = screen.getByTestId('card-terminal-output');
    Object.defineProperties(output, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 100 } });
    output.scrollTop = 100; fireEvent.scroll(output);
    view.rerender(<AdaptiveCardTerminal {...props} run={{ ...running,
      terminal: { ...observation, events: [{ ...model, text: 'More text' }] },
    }} />);
    expect(output.scrollTop).toBe(100);
    fireEvent.click(screen.getByText('Return to live'));
    expect(output.scrollTop).toBe(1000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders real tool/child failures and only the provided executing count', () => {
    render(<AdaptiveCardTerminal {...props} run={{ ...running, terminal: { ...observation, activeAgentCount: 3,
      events: [model, { ...model, id: 'tool', kind: 'tool_error', toolName: 'lookup', status: 'failed', detail: 'not_indexed' },
        { ...model, id: 'child', kind: 'child_finished', runId: 'child-run', parentRunId: 'r', nativeChildId: 'native-child', status: 'failed' }],
    } }} />);
    expect(screen.getByTestId('terminal-active-agents').textContent).toBe('3');
    expect(screen.getByText('lookup')).toBeTruthy();
    expect(screen.getAllByText('failed')).toHaveLength(2);
    expect(screen.getByText('native-child')).toBeTruthy();
    expect(screen.queryByLabelText('Dynamic context / input')).toBeNull();
  });

  it('keeps final result while reopening/deleting only the selected runtime transcript', async () => {
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      return { ok: true, json: async () => ({ ok: true, result: { ...identity,
        ...(request.action === 'transcript' ? { events: [model] } : { deleted: true }) } }) };
    });
    vi.stubGlobal('fetch', fetch);
    render(<AdaptiveCardTerminal {...props} run={{ ...running, state: 'completed', status: 'complete',
      output: 'Accepted final', terminal: { ...observation, finalText: 'Accepted final', activeAgentCount: 0, observation: 'finished' },
    }} />);
    expect(screen.queryByTestId('terminal-active-agents')).toBeNull();
    expect(screen.queryByText('Model text')).toBeNull();
    fireEvent.click(screen.getByText('Show transcript'));
    await screen.findByText('Model text');
    fireEvent.click(screen.getByText('Delete transcript'));
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Confirm delete transcript'));
    await waitFor(() => expect(document.body.textContent).toContain('Transcript deleted.'));
    expect(screen.getByTestId('card-terminal-final').textContent).toBe('Accepted final');
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)))).toEqual([
      { action: 'transcript', projectId: 'p', deckId: 'd', cardId: 'c', runId: 'r' },
      { action: 'delete_transcript', projectId: 'p', deckId: 'd', cardId: 'c', runId: 'r' },
    ]);
    fireEvent.click(screen.getByText('New input'));
    expect(screen.queryByRole('log')).toBeNull();
    expect(screen.getByLabelText('Dynamic context / input')).toBeTruthy();
    fireEvent.click(screen.getByText('Previous result'));
    expect(screen.getByTestId('card-terminal-final').textContent).toBe('Accepted final');
  });

  it('does not replace the Mag One adapter or expose a fabricated stop command', () => {
    render(<AdaptiveCardTerminal {...props} runtime={{ kind: 'autogen', mode: 'magentic_one' }} onStop={vi.fn()}
      run={{ ...running, terminal: { ...observation, events: [], observation: 'unavailable', unavailableReason: 'autogen_adapter_completion_only' } }} />);
    expect(screen.getByText(/reports output at completion/)).toBeTruthy();
    expect(screen.queryByText('Stop')).toBeNull();
    expect(screen.queryByText('Model text')).toBeNull();
  });

  it('reports structured fatal failure and refuses mismatched transcript responses', async () => {
    render(<AdaptiveCardTerminal {...props} run={{ ...running, state: 'failed', status: 'failed',
      terminal: { ...observation, finalText: '', errorCode: 'native_failed', errorSummary: 'Native failure', activeAgentCount: 0 },
    }} />);
    expect(screen.getByRole('alert').textContent).toBe('native_failed: Native failure');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, result: { runId: 'other', events: [] } }) })));
    await expect(requestCardTranscript({ action: 'transcript', projectId: 'p', deckId: 'd', cardId: 'c', runId: 'r' })).rejects.toThrow('identity_mismatch');
  });

  it.each(['projectId', 'deckId', 'cardId'])('rejects a transcript response with the wrong %s', async (field) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true,
      result: { ...identity, [field]: 'other', events: [model] } }) })));
    await expect(requestCardTranscript({ action: 'transcript', projectId: 'p', deckId: 'd', cardId: 'c', runId: 'r' }))
      .rejects.toThrow('card_transcript_identity_mismatch');
  });
});
