import { useEffect, useState, type RefObject } from 'react';

import { GRAPH_THEME } from '../graph/graphVisualTokens';
import { providerMemberKey, type GraphAuthority, type GraphProjectionEdge, type GraphProjectionNode, type GraphProjectionV1, type JoinedGraphPresentation } from './joinedKnowledgeGraphProjection';
import {
  graphitiFactIdentity,
  INSPECTOR_RECORD_LIMIT,
  observedEntryTime,
  probabilityLabel,
  sourceDocument,
  type KnowInspectorRecord,
} from './knowledgeGraphInspectorRecords';
import {
  KnowGraphKnow,
  KnowSourceList,
  ThinkRecordCard,
} from './KnowledgeGraphRecordCards';

export function KnowledgeGraphInspector({
  containerRef,
  selectedVisual,
  selected,
  selectedEdge,
  inspectedAuthority,
  inspectedProjection,
  activeJoinedPresentation,
  directThinkAvailable,
  directKnowAvailable,
  focusRequestPending,
  focused,
  onToggleFocus,
  onSelectAuthority,
  onInspectNode,
  onRefreshSelection,
  onRemoveThinkGraphEvidence,
  onRemoveKnowGraphEvidence,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  selectedVisual: GraphProjectionNode | undefined;
  selected: GraphProjectionNode | undefined;
  selectedEdge: GraphProjectionEdge | undefined;
  inspectedAuthority: GraphAuthority | null;
  inspectedProjection: GraphProjectionV1 | null;
  activeJoinedPresentation: JoinedGraphPresentation;
  directThinkAvailable: boolean;
  directKnowAvailable: boolean;
  focusRequestPending: boolean;
  focused: boolean;
  onToggleFocus(): void;
  onSelectAuthority(authority: GraphAuthority): void;
  onInspectNode(
    visualId: string,
    authority: GraphAuthority | null,
    memberKey: string | null,
  ): void;
  onRefreshSelection(): void;
  onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
  onRemoveKnowGraphEvidence?: (graphitiFactUuid: string) => Promise<void>;
}) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  useEffect(() => {
    setRemoveError(null);
  }, [selected?.id, selectedEdge?.id]);
  const selectedProperties = selected?.properties || {};
  const evidenceIds = new Set<string>(selected ? [selected.id] : []);
  for (const episodeId of selected?.provenanceEpisodeIds || []) {
    evidenceIds.add(episodeId);
  }
  for (const edge of selectedEdge ? [selectedEdge] : []) {
    for (const value of [edge.properties?.episodes, edge.properties?.supportingEpisodeUuids]) {
      for (const id of Array.isArray(value) ? value : typeof value === 'string' ? [value] : []) {
        evidenceIds.add(String(id));
      }
    }
    if (edge.predicate === 'MENTIONS') evidenceIds.add(edge.source);
  }
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
  const thinks = directThinks.map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftTime = observedEntryTime(left.item.ingestedAt)?.dateTime || '';
      const rightTime = observedEntryTime(right.item.ingestedAt)?.dateTime || '';
      return rightTime.localeCompare(leftTime) || left.index - right.index;
    })
    .map(({ item }) => item);
  const visibleThinks = thinks.slice(0, INSPECTOR_RECORD_LIMIT);
  const earlierThinks = thinks.slice(INSPECTOR_RECORD_LIMIT);
  const providerLabel = (id: string) => (
    inspectedProjection?.nodes.find((node) => node.id === id)?.label || id
  );
  const provenanceById = new Map<string, Record<string, any>>(
    (inspectedProjection?.provenanceNodes || []).map((node) => [node.id, {
      uuid: node.id,
      name: node.label,
      ...(node.properties || {}),
    }]),
  );
  const directKnowItems: KnowInspectorRecord[] = (
    inspectedAuthority === 'knowgraph' && selected && !selectedEdge
  ) ? (() => {
      const incidentEdges = (inspectedProjection?.edges || [])
        .filter((edge) => edge.source === selected.id || edge.target === selected.id);
      const episodeIds = new Set<string>((selected.provenanceEpisodeIds || []).map(String));
      for (const edge of incidentEdges) {
        const ids = edge.properties?.supportingEpisodeUuids ?? edge.properties?.episodes;
        for (const id of Array.isArray(ids) ? ids : typeof ids === 'string' ? [ids] : []) {
          episodeIds.add(String(id));
        }
      }
      const episodesWithContent = new Set<string>();
      const episodeRecords = [...episodeIds].flatMap((episodeId): KnowInspectorRecord[] => {
        const episode = provenanceById.get(episodeId);
        if (!episode) return [];
        const body = typeof episode.content === 'string' ? episode.content.trim() : '';
        if (!body) return [];
        episodesWithContent.add(episodeId);
        return [{
          kind: 'episode',
          graphitiId: episodeId,
          know: {
            portableKind: 'know',
            title: String(episode.name || episode.source_name || episodeId),
            fact: body,
            observedAt: episode.created_at,
            sourceDate: episode.reference_time,
          },
          episodes: [episode],
        }];
      });
      const factRecords = incidentEdges.flatMap((edge): KnowInspectorRecord[] => {
        const graphitiFactUuid = graphitiFactIdentity(edge);
        const fact = typeof edge.properties?.fact === 'string'
          ? edge.properties.fact.trim()
          : '';
        if (!graphitiFactUuid || !fact) return [];
        const ids = edge.properties?.supportingEpisodeUuids ?? edge.properties?.episodes;
        const supportingIds = (
          Array.isArray(ids) ? ids : typeof ids === 'string' ? [ids] : []
        ).map(String);
        if (supportingIds.some((id) => episodesWithContent.has(id))) return [];
        return [{
          kind: 'fact',
          graphitiId: graphitiFactUuid,
          know: {
            ...(edge.properties || {}),
            portableKind: 'know',
            title: String(edge.properties?.title || edge.predicate || graphitiFactUuid),
            fact,
            observedAt: edge.properties?.createdAt ?? edge.properties?.created_at,
            sourceDate: edge.properties?.referenceTime ?? edge.properties?.validAt,
            graphitiRelation: edge.properties?.graphitiRelation || edge.predicate,
          },
          episodes: supportingIds.flatMap((id) => {
            const episode = provenanceById.get(id);
            return episode ? [episode] : [];
          }),
        }];
      });
      return [...episodeRecords, ...factRecords].sort((left, right) => {
        const leftTime = observedEntryTime(left.know.observedAt)?.dateTime || '';
        const rightTime = observedEntryTime(right.know.observedAt)?.dateTime || '';
        return rightTime.localeCompare(leftTime) || left.graphitiId.localeCompare(right.graphitiId);
      });
    })() : [];
  const visibleKnowItems = directKnowItems.slice(0, INSPECTOR_RECORD_LIMIT);
  const earlierKnowItems = directKnowItems.slice(INSPECTOR_RECORD_LIMIT);
  const knowSourceListId = 'knowgraph-subject-sources';
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
      : directKnowAvailable);
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
  const deleteKnow = async (graphitiFactUuid: string) => {
    if (!onRemoveKnowGraphEvidence) return;
    setRemovingId(graphitiFactUuid);
    setRemoveError(null);
    try {
      await onRemoveKnowGraphEvidence(graphitiFactUuid);
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
              {candidate === 'thinkgraph' ? 'Think' : 'Know'}
            </button>
          ))}
        </div>
      ) : null}
      {selected ? (
        <span
          className="graph-inspector-subject"
          tabIndex={-1}
          aria-hidden="true"
          data-testid={`${inspectedAuthority}-node-inspector`}
          data-entity-id={selected.id}
        >
          {selected.label}
        </span>
      ) : null}
      {visibleThinks.length ? (
        <section className="graph-inspector-records" data-testid="think-records">
          <h4>{visibleThinks.length > 1 ? 'Recent Thinks' : 'Recent Think'}</h4>
          {visibleThinks.map((item) => (
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
      {earlierThinks.length ? (
        <details className="graph-think-history">
          <summary>Earlier Thinks ({earlierThinks.length})</summary>
          <div>{earlierThinks.map((item) => (
            <ThinkRecordCard
              key={item.id}
              item={item}
              heading="Think"
              removing={removingId === item.id}
              onRemove={onRemoveThinkGraphEvidence
                ? () => { void deleteThink(item.id); }
                : undefined}
            />
          ))}</div>
        </details>
      ) : null}
      {visibleKnowItems.length ? (
        <section className="graph-inspector-records" data-testid="know-records">
          <h4>{visibleKnowItems.length > 1 ? 'Current Knows' : 'Current Know'}</h4>
          {visibleKnowItems.map((record, index) => (
            <KnowGraphKnow
              key={record.graphitiId}
              record={record}
              heading={visibleKnowItems.length > 1 ? `Know ${index + 1}` : 'Know'}
              removing={removingId === record.graphitiId}
              onRemove={onRemoveKnowGraphEvidence && record.kind === 'fact'
                ? () => { void deleteKnow(record.graphitiId); }
                : undefined}
            />
          ))}
        </section>
      ) : null}
      {earlierKnowItems.length ? (
        <details className="graph-know-history">
          <summary>Earlier Knows ({earlierKnowItems.length})</summary>
          <div>{earlierKnowItems.map((record, index) => (
            <KnowGraphKnow
              key={record.graphitiId}
              record={record}
              heading={`Earlier Know ${index + 1}`}
              removing={removingId === record.graphitiId}
              onRemove={onRemoveKnowGraphEvidence && record.kind === 'fact'
                ? () => { void deleteKnow(record.graphitiId); }
                : undefined}
            />
          ))}</div>
        </details>
      ) : null}
      {inspectedAuthority === 'knowgraph' && selected && !selectedEdge
        ? <KnowSourceList records={directKnowItems} id={knowSourceListId} />
        : null}
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
      {evidence.length && !(selected && inspectedAuthority === 'knowgraph') ? (
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
