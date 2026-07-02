import { beforeEach, describe, expect, it } from 'vitest';
import { applyGraphNavToolResult } from './graphNavToolResult';
import { graphSelection } from './graphSelectionStore';

describe('applyGraphNavToolResult → GraphExplorerCore selection store', () => {
  beforeEach(() => graphSelection.reset());

  it('ignores non-navigation tools', () => {
    expect(applyGraphNavToolResult('some_non_nav_tool', '{"ok":true}')).toBe(false);
    expect(graphSelection.get().focusRequest).toBeNull();
  });

  it('applies graph_focus as a focus request + selection (raw navigation payload)', () => {
    const ok = applyGraphNavToolResult('graph_focus', JSON.stringify({ navigation: { action: 'focus', graph: 'think', nodeId: 'think:q1' } }));
    expect(ok).toBe(true);
    expect(graphSelection.get().selectedNodeId).toBe('think:q1');
    expect(graphSelection.get().focusRequest?.id).toBe('think:q1');
  });

  it('applies graph_focus through an MCP {content:[{text}]} wrapper', () => {
    const wrapped = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ navigation: { action: 'focus', graph: 'know', nodeId: 'kg:42' } }) }] });
    expect(applyGraphNavToolResult('graph_focus', wrapped)).toBe(true);
    expect(graphSelection.get().selectedNodeId).toBe('kg:42');
  });

  it('applies graph_highlight as pinned nodes', () => {
    applyGraphNavToolResult('graph_highlight', JSON.stringify({ navigation: { action: 'highlight', graph: 'think', nodeIds: ['a', 'b', 'a'] } }));
    expect(graphSelection.get().pinnedNodeIds).toEqual(['a', 'b']);
  });

  it('applies graph_clear_highlight', () => {
    graphSelection.setPinned(['a', 'b']);
    graphSelection.requestFocus('a');
    applyGraphNavToolResult('graph_clear_highlight', JSON.stringify({ navigation: { action: 'clear_highlight', graph: 'think' } }));
    const s = graphSelection.get();
    expect(s.pinnedNodeIds).toEqual([]);
    expect(s.selectedNodeId).toBeNull();
    expect(s.focusRequest).toBeNull();
  });

  it('ignores malformed output without throwing', () => {
    expect(applyGraphNavToolResult('graph_focus', 'not json')).toBe(false);
  });
});
