import { useEffect, useState, type RefObject } from 'react';

import { GRAPH_THEME } from '../graph/graphVisualTokens';
import { providerMemberKey, type GraphAuthority, type GraphProjectionEdge, type GraphProjectionNode, type GraphProjectionV1, type JoinedGraphPresentation } from './joinedKnowledgeGraphProjection';
import {
  INSPECTOR_RECORD_LIMIT,
  observedEntryTime,
  probabilityLabel,
  sourceDocument,
} from './knowledgeGraphInspectorRecords';
import { KnowRecordCard, ThinkRecordCard } from './KnowledgeGraphRecordCards';

export function KnowledgeGraphInspector({
  containerRef,
  selectedVisual,
  selected,
  selectedEdge,
  inspectedAuthority,
  inspectedProjection,
  activeJoinedPresentation,
  selectedEntityContext,
  entityContextError,
  entityContextQuery,
  entityContextLimit,
  directThinkAvailable,
  knowgraphEntityAvailable,
  focusRequestPending,
  focused,
  onToggleFocus,
  onSelectAuthority,
  onSearchEntityContext,
  onSetEntityContextLimit,
  onInspectNode,
  onRefreshSelection,
  onRemoveThinkGraphEvidence,
  onRemoveThinkGraphRelationship,
  onRemoveKnowGraphEvidence,
  onRemoveKnowGraphRelationship,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  selectedVisual: GraphProjectionNode | undefined;
  selected: GraphProjectionNode | undefined;
  selectedEdge: GraphProjectionEdge | undefined;
  inspectedAuthority: GraphAuthority | null;
  inspectedProjection: GraphProjectionV1 | null;
  activeJoinedPresentation: JoinedGraphPresentation;
  selectedEntityContext?: Record<string, any> | null;
  entityContextError?: string | null;
  entityContextQuery?: string;
  entityContextLimit?: number;
  directThinkAvailable: boolean;
  knowgraphEntityAvailable: boolean;
  focusRequestPending: boolean;
  focused: boolean;
  onToggleFocus(): void;
  onSelectAuthority(authority: GraphAuthority): void;
  onSearchEntityContext?: (query: string) => void;
  onSetEntityContextLimit?: (limit: number) => void;
  onInspectNode(
    visualId: string,
    authority: GraphAuthority | null,
    memberKey: string | null,
  ): void;
  onRefreshSelection(): void;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveThinkGraphRelationship?: (edgeId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (episodeId: string) => Promise<void>;
  onRemoveKnowGraphRelationship?: (graphitiRelationshipId: string) => Promise<void>;
}) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [recordView, setRecordView] = useState<'relevant' | 'recent'>('relevant');
  const [searchDraft, setSearchDraft] = useState(String(entityContextQuery || ''));
  useEffect(() => {
    setRemoveError(null);
  }, [selected?.id, selectedEdge?.id]);
  useEffect(() => {
    setRecordView('relevant');
    setSearchDraft(String(entityContextQuery || ''));
  }, [entityContextQuery, inspectedAuthority, selected?.id]);
  const selectedProperties = selected?.properties || {};
  const evidenceIds = new Set<string>(selected ? [selected.id] : []);
  const evidence = [
    ...(inspectedProjection?.nodes || []),
    ...(inspectedProjection?.provenanceNodes || []),
  ].filter((node) => evidenceIds.has(node.id))
    .map((node) => ({ node, ...sourceDocument(node) }))
    .filter((item) => item.links.length);
  const selectedEvidence = (selectedEdge?.properties || selectedProperties).evidence;
  const evidenceRecords = Array.isArray(selectedEvidence)
    ? selectedEvidence.filter((item): item is Record<string, any> => (
      item !== null && typeof item === 'object' && typeof item.id === 'string'
    ))
    : [];
  const directThinks = inspectedAuthority === 'thinkgraph' && selected && !selectedEdge
    ? evidenceRecords
    : [];
  const directKnows = inspectedAuthority === 'knowgraph' && selected && !selectedEdge
    ? evidenceRecords
    : [];
  const thinks = directThinks.map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftTime = observedEntryTime(left.item.ingestedAt)?.dateTime || '';
      const rightTime = observedEntryTime(right.item.ingestedAt)?.dateTime || '';
      return rightTime.localeCompare(leftTime) || left.index - right.index;
    })
    .map(({ item }) => item);
  const thinkSelection = selectedEntityContext?.thinks;
  const knowSelection = selectedEntityContext?.knows;
  const contextThinks = (value: unknown): Record<string, any>[] => (
    Array.isArray(value) ? value.flatMap((item) => (
      item && typeof item === 'object' && !Array.isArray(item)
        && typeof item.engraphisMemoryId === 'string'
        ? [{
          ...item,
          id: item.engraphisMemoryId,
          summary: item.body,
          content: item.body,
        }]
        : []
    )) : []
  );
  const recentThinks = inspectedAuthority === 'thinkgraph'
    ? (thinkSelection ? contextThinks(thinkSelection.recent).slice(
      0, Math.min(entityContextLimit || 1, INSPECTOR_RECORD_LIMIT),
    ) : thinks.slice(0, 1))
    : [];
  const relevantThinks = inspectedAuthority === 'thinkgraph' && thinkSelection
    ? contextThinks(thinkSelection.relevant).slice(
      0, Math.min(entityContextLimit || 1, INSPECTOR_RECORD_LIMIT),
    )
    : [];
  const knows = directKnows.map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftTime = observedEntryTime(left.item.ingestedAt)?.dateTime || '';
      const rightTime = observedEntryTime(right.item.ingestedAt)?.dateTime || '';
      return rightTime.localeCompare(leftTime) || left.index - right.index;
    })
    .map(({ item }) => item);
  const visibleKnows = knows.slice(0, 1);
  const contextKnows = (value: unknown): Record<string, any>[] => (
    Array.isArray(value) ? value.flatMap((item) => (
      item && typeof item === 'object' && !Array.isArray(item)
        && typeof item.graphitiEpisodeId === 'string'
        ? [{ ...item, id: item.graphitiEpisodeId }]
        : []
    )) : []
  );
  const recentKnows = inspectedAuthority === 'knowgraph'
    ? (knowSelection ? contextKnows(knowSelection.recent).slice(
      0, Math.min(entityContextLimit || 1, INSPECTOR_RECORD_LIMIT),
    ) : visibleKnows.slice(0, 1))
    : [];
  const relevantKnows = inspectedAuthority === 'knowgraph' && knowSelection
    ? contextKnows(knowSelection.relevant).slice(
      0, Math.min(entityContextLimit || 1, INSPECTOR_RECORD_LIMIT),
    )
    : [];
  const activeRecordView = String(entityContextQuery || '').trim()
    ? recordView
    : 'recent';
  const providerLabel = (id: string) => (
    inspectedProjection?.nodes.find((node) => node.id === id)?.label || id
  );
  const jev = selectedEdge?.properties?.jev
    && typeof selectedEdge.properties.jev === 'object'
    && !Array.isArray(selectedEdge.properties.jev)
    ? selectedEdge.properties.jev as Record<string, unknown>
    : null;
  const jevDistribution = jev?.distribution && typeof jev.distribution === 'object'
    ? Object.entries(jev.distribution as Record<string, unknown>)
      .filter((entry): entry is [string, number] => Number.isFinite(Number(entry[1])))
      .sort((left, right) => Number(right[1]) - Number(left[1]))
    : [];
  const jevWinner = jev ? String(jev.winner || selectedEdge?.predicate || '') : '';
  const naturalRelationship = jev && typeof jev.natural_relationship === 'string'
    ? jev.natural_relationship
    : '';
  const jevWinnerProbability = probabilityLabel(
    jevDistribution.find(([choice]) => choice === jevWinner)?.[1],
  );
  const availableNodeAuthorities = (['thinkgraph', 'knowgraph'] as const)
    .filter((candidate) => candidate === 'thinkgraph'
      ? directThinkAvailable
      : knowgraphEntityAvailable);
  const visualNodeIdForProvider = (entityId: string) => inspectedAuthority
    ? activeJoinedPresentation.visualNodeIdByProviderMember.get(
      providerMemberKey(inspectedAuthority, entityId),
    ) || entityId
    : entityId;
  const inspectProviderNode = (entityId: string) => {
    const visualId = visualNodeIdForProvider(entityId);
    onInspectNode(
      visualId,
      inspectedAuthority,
      inspectedAuthority ? providerMemberKey(inspectedAuthority, entityId) : null,
    );
  };
  const deleteThink = async (memoryId: string) => {
    if (!onRemoveThinkGraphEvidence) return;
    setRemovingId(memoryId);
    setRemoveError(null);
    try {
      await onRemoveThinkGraphEvidence(memoryId);
    } catch (failure) {
      setRemoveError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRemovingId(null);
    }
  };
  const deleteRelationship = async (graphitiRelationshipId: string) => {
    const remove = inspectedAuthority === 'thinkgraph'
      ? onRemoveThinkGraphRelationship
      : onRemoveKnowGraphRelationship;
    if (!remove) return;
    setRemovingId(graphitiRelationshipId);
    setRemoveError(null);
    try {
      await remove(graphitiRelationshipId);
      onRefreshSelection();
    } catch (failure) {
      setRemoveError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRemovingId(null);
    }
  };
  const deleteKnow = async (episodeId: string) => {
    if (!onRemoveKnowGraphEvidence) return;
    setRemovingId(episodeId);
    setRemoveError(null);
    try {
      await onRemoveKnowGraphEvidence(episodeId);
      onRefreshSelection();
    } catch (failure) {
      setRemoveError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div
      ref={containerRef}
      className="knowledge-authority-controls"
      role="region"
      aria-label={`${selected?.label || selectedEdge?.predicate || ''} details`}
    >
      {selectedVisual ? (
        <div className="knowledge-authority-actions">
          <button type="button" disabled={focusRequestPending} onClick={onToggleFocus}>
            {focused ? 'Expand' : 'Focus'}
          </button>
        </div>
      ) : null}
      {selected && availableNodeAuthorities.length ? (
        <div role="tablist" aria-label={`${selected.label} graph evidence`} style={{ display: 'flex', gap: 6 }}>
          {availableNodeAuthorities.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={candidate === inspectedAuthority}
              onClick={() => onSelectAuthority(candidate)}
              style={{
                minWidth: 72,
                padding: '6px 12px',
                borderRadius: 8,
                border: `1px solid ${candidate === inspectedAuthority
                  ? GRAPH_THEME.accent.primaryBorder
                  : GRAPH_THEME.drawer.inputBorder}`,
                background: candidate === inspectedAuthority
                  ? GRAPH_THEME.accent.primarySoft
                  : GRAPH_THEME.drawer.inputBackground,
                color: candidate === inspectedAuthority
                  ? GRAPH_THEME.surface.text
                  : GRAPH_THEME.drawer.inputMuted,
                fontWeight: 700,
              }}
            >
              {candidate === 'thinkgraph' ? 'ThinkGraph' : 'KnowGraph'}
            </button>
          ))}
        </div>
      ) : null}
      {selected ? (
        <span
          className="graph-inspector-entity"
          tabIndex={-1}
          aria-hidden="true"
          data-testid={`${inspectedAuthority}-node-inspector`}
          data-entity-id={selected.id}
        >
          {selected.label}
        </span>
      ) : null}
      {selected && !selectedEdge && onSearchEntityContext ? (
        <form
          className="graph-context-search"
          aria-label="Knowledge search"
          onSubmit={(event) => {
            event.preventDefault();
            const query = searchDraft.trim();
            if (query) onSearchEntityContext(query);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}
        >
          <input
            aria-label="Search"
            placeholder="Search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            style={{ minWidth: 0, flex: 1 }}
          />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10 }}>
            Results
            <select
              aria-label="Results"
              value={Math.min(entityContextLimit || 1, INSPECTOR_RECORD_LIMIT)}
              onChange={(event) => onSetEntityContextLimit?.(Number(event.target.value))}
              style={{ width: 42, padding: '2px 3px', fontSize: 10 }}
            >
              {Array.from({ length: INSPECTOR_RECORD_LIMIT }, (_, index) => index + 1)
                .map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button
            type="button"
            aria-label={recordView === 'relevant' ? 'Show Recent' : 'Show Relevant'}
            title={recordView === 'relevant' ? 'Recent' : 'Relevant'}
            onClick={() => setRecordView(current => (
              current === 'relevant' ? 'recent' : 'relevant'
            ))}
            style={{ width: 24, minWidth: 24, padding: '2px 4px', fontSize: 14 }}
          >
            {recordView === 'relevant' ? '›' : '‹'}
          </button>
        </form>
      ) : null}
      {activeRecordView === 'relevant' && relevantThinks.length ? (
        <section className="graph-inspector-records" data-testid="think-relevant-records">
          <h4>Relevant</h4>
          {relevantThinks.map((item) => <ThinkRecordCard
            key={item.id}
            item={item}
            heading="Think"
            removing={removingId === item.id}
            onRemove={onRemoveThinkGraphEvidence
              ? () => { void deleteThink(item.id); }
              : undefined}
          />)}
        </section>
      ) : null}
      {activeRecordView === 'recent' && recentThinks.length ? (
        <section className="graph-inspector-records" data-testid="think-records">
          <h4>Recent</h4>
          {recentThinks.map((item) => (
            <ThinkRecordCard
              key={item.id}
              item={item}
              heading="Think"
              removing={removingId === item.id}
              onRemove={inspectedAuthority === 'thinkgraph' && onRemoveThinkGraphEvidence
                ? () => { void deleteThink(item.id); }
                : undefined}
            />
          ))}
        </section>
      ) : null}
      {activeRecordView === 'relevant' && relevantKnows.length ? (
        <section className="graph-inspector-records" data-testid="know-relevant-records">
          <h4>Relevant</h4>
          {relevantKnows.map((item) => <KnowRecordCard
            key={item.id}
            item={item}
            removing={removingId === item.id}
            onRemove={onRemoveKnowGraphEvidence
              ? () => { void deleteKnow(item.id); }
              : undefined}
          />)}
        </section>
      ) : null}
      {activeRecordView === 'recent' && recentKnows.length ? (
        <section className="graph-inspector-records" data-testid="know-records">
          <h4>Recent</h4>
          {recentKnows.map((item) => <KnowRecordCard
            key={item.id}
            item={item}
            removing={removingId === item.id}
            onRemove={onRemoveKnowGraphEvidence
              ? () => { void deleteKnow(item.id); }
              : undefined}
          />)}
        </section>
      ) : null}
      {activeRecordView === 'relevant' && entityContextError ? (
        <p role="status" title={entityContextError}>Relevant unavailable</p>
      ) : null}
      {selectedEdge ? (
        <article
          data-testid={`${inspectedAuthority}-edge-inspector`}
          data-relationship-id={selectedEdge.id}
        >
          <h4 tabIndex={-1}>
            {providerLabel(selectedEdge.source)} → {selectedEdge.predicate} → {providerLabel(selectedEdge.target)}
          </h4>
          {(['fact', 'summary', 'reason'] as const).map((key) => (
            typeof selectedEdge.properties?.[key] === 'string' && selectedEdge.properties[key]
              ? <p key={key}>{String(selectedEdge.properties[key])}</p>
              : null
          ))}
          <button type="button" onClick={() => inspectProviderNode(selectedEdge.source)}>
            {providerLabel(selectedEdge.source)}
          </button>
          <button type="button" onClick={() => inspectProviderNode(selectedEdge.target)}>
            {providerLabel(selectedEdge.target)}
          </button>
          {((inspectedAuthority === 'knowgraph' && onRemoveKnowGraphRelationship)
            || (inspectedAuthority === 'thinkgraph' && onRemoveThinkGraphRelationship)) ? (
            <button
              type="button"
              aria-label="Remove Relationship"
              disabled={removingId === selectedEdge.id}
              onClick={() => {
                if (window.confirm('Remove this Relationship?')) {
                  void deleteRelationship(selectedEdge.id);
                }
              }}
            >
              {removingId === selectedEdge.id ? 'Removing…' : 'Remove'}
            </button>
          ) : null}
        </article>
      ) : null}
      {selectedEdge ? (
        <dl className="graph-record-fields graph-edge-meaning">
          <div>
            <dt>Direction</dt>
            <dd>{providerLabel(selectedEdge.source)} → {providerLabel(selectedEdge.target)}</dd>
          </div>
          {jevWinner ? <div><dt>Jev winner</dt><dd>{jevWinner}</dd></div> : null}
          {jevWinnerProbability ? <div><dt>Probability</dt><dd>{jevWinnerProbability}</dd></div> : null}
          {naturalRelationship ? (
            <div><dt>Natural extracted relationship</dt><dd>{naturalRelationship}</dd></div>
          ) : null}
        </dl>
      ) : null}
      {jevDistribution.length ? (
        <details className="graph-jev-distribution" open>
          <summary>Jev relationship probabilities</summary>
          <dl>{jevDistribution.map(([choice, probability]) => {
            const probabilityText = probabilityLabel(probability) || '0.0%';
            return (
              <div key={choice} data-winner={choice === jevWinner}>
                <dt>{choice}</dt>
                <dd>
                  <span className="graph-jev-probability-track" aria-hidden="true">
                    <span className="graph-jev-probability-fill" style={{ width: probabilityText }} />
                  </span>
                  <span>{probabilityText}</span>
                </dd>
              </div>
            );
          })}</dl>
        </details>
      ) : null}
      {removeError ? <p role="alert">{removeError}</p> : null}
      {evidence.length ? (
        <section className="knowgraph-sources">
          <h4>Sources</h4>
          {evidence.map(({ node, links }) => (
            <details key={node.id}>
              <summary>{node.label}</summary>
              {links.map((link) => (
                <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              ))}
              {typeof node.properties?.content === 'string'
                ? <pre>{node.properties.content}</pre>
                : null}
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}
