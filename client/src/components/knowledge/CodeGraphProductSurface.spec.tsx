import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('launch Graphs surface', () => {
  it('mounts one mixed native graph without graph-mode or CodeGraph presentation scaffolding', () => {
    const framework = readFileSync(
      new URL('./KnowledgeGraphFramework.tsx', import.meta.url),
      'utf8',
    );
    const nativeSurface = readFileSync(
      new URL('./NativeAuthorityGraphSurface.tsx', import.meta.url),
      'utf8',
    );

    expect(framework).toContain('<NativeJoinedGraphSurface');
    expect(framework).not.toContain('Knowledge graph view');
    expect(framework).not.toContain('graph-kind-');
    expect(framework).not.toContain('NativeCodeGraphSurface');
    expect(framework).not.toContain('NativeThinkGraphSurface');
    expect(framework).not.toContain('NativeKnowGraphSurface');
    expect(nativeSurface).not.toContain('NativeCodeGraphSurface');
    expect(nativeSurface).not.toContain('toCodeGraphData');
    expect(nativeSurface).not.toContain("mode: 'joined' | 'all'");
    expect(nativeSurface).not.toContain("mode === 'all'");
  });

  it('keeps complete semantic records in the calm inspector without click-time contextual reranking', () => {
    const nativeSurface = readFileSync(
      new URL('./NativeAuthorityGraphSurface.tsx', import.meta.url),
      'utf8',
    );
    const graphAttention = readFileSync(
      new URL('../../features/agentbuilder/state/useAgentBuilderGraphAttention.ts', import.meta.url),
      'utf8',
    );
    const thinkCard = nativeSurface.slice(
      nativeSurface.indexOf('function ThinkGraphThink'),
      nativeSurface.indexOf('type KnowInspectorRecord'),
    );
    const openNodeInspector = nativeSurface.slice(
      nativeSurface.indexOf('const openNodeInspector'),
      nativeSurface.indexOf('inspectNodeRef.current = openNodeInspector'),
    );

    expect(nativeSurface).toContain('const INSPECTOR_RECORD_LIMIT = 2');
    expect(nativeSurface).toContain('const visibleThinks = thinks.slice(0, INSPECTOR_RECORD_LIMIT)');
    expect(nativeSurface).toContain('const visibleKnowItems = directKnowItems.slice(0, INSPECTOR_RECORD_LIMIT)');
    expect(thinkCard.indexOf('semanticSections.map')).toBeLessThan(
      thinkCard.indexOf('<h5>Properties</h5>'),
    );
    expect(nativeSurface).toContain('<KnowRecordCitation record={record}');
    expect(nativeSurface).not.toContain('<summary>Details</summary>');
    expect(nativeSurface).not.toContain('<summary>Technical details</summary>');
    expect(nativeSurface).not.toContain('<details className="graph-know-history">');
    expect(nativeSurface).not.toMatch(/(?:slice|substring)\(0,\s*140\)/);
    expect(openNodeInspector).not.toContain('setSelectedAuthority(null)');
    expect(graphAttention).not.toContain('readContextualNode');
    expect(graphAttention).not.toContain('/api/main/session/contextual-node-read');
    expect(graphAttention).toContain('KNOWGRAPH_STARTUP_RETRY_DELAYS_MS');
    expect(graphAttention).toContain(
      'refreshKnowGraph(undefined, KNOWGRAPH_STARTUP_RETRY_DELAYS_MS.length)',
    );
    expect(nativeSurface).toContain('panelBodyRef.current.scrollTop = 0');
  });
});
