/**
 * Entity: Project Knowledge Graph
 * Relationship: Compacts the exact enabled Think, Know, and Code presentation plus one open node into bounded provider pointers, then publishes the same JSON to the four Hermes profile plugin caches outside the inference hot path.
 */

import type {
  GraphProjectionNode,
  JoinedGraphPresentation,
} from '../../components/knowledge/knowledgeGraphProjection';
import { hermesWebappHost, onHermesEvent } from './hermesHost';

export const NAVIGATION_MAP_SCHEMA = 'liquidaity.navigation-map.v1';
export const NAVIGATION_MAP_PROFILES = ['main', 'builder', 'thinkgraph', 'knowgraph'] as const;

type NavigationAuthority = 'thinkgraph' | 'knowgraph' | 'codegraph';

export type HermesNavigationMap = {
  schemaVersion: typeof NAVIGATION_MAP_SCHEMA;
  projectId: string;
  layers: NavigationAuthority[];
  revision: string;
  nodes: Array<[string, 'Entity' | 'File', Array<[NavigationAuthority, string]>]>;
  relationships: Array<[NavigationAuthority, string, number, string, number]>;
  focus: null | [
    number,
    Array<[string, string, string]>,
    Array<[string, string, string, string, string]>,
    number[],
  ];
};

export type HermesNavigationMapSync = {
  status: 'synced';
  sha256: string;
  bytes: number;
  estimatedTokens: number;
  nodes: number;
  relationships: number;
  focused: boolean;
};

type PublishResponse = {
  ok?: boolean;
  sha256?: string;
  bytes?: number;
  estimatedTokens?: number;
  nodes?: number;
  relationships?: number;
  focused?: boolean;
  detail?: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function evidence(node: GraphProjectionNode): Array<Record<string, any>> {
  const records = node.properties?.evidence;
  return Array.isArray(records)
    ? records.filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object')
    : [];
}

function thinkRecords(presentation: JoinedGraphPresentation, visualId: string) {
  return (presentation.nodeVariants.get(visualId) || [])
    .filter((variant) => variant.authority === 'thinkgraph')
    .flatMap((variant) => evidence(variant.node))
    .flatMap((item): Array<[string, string, string]> => {
      const id = text(item.id);
      const body = text(item.summary) || text(item.content);
      if (!id || !body) return [];
      return [[id, text(item.title) || 'Think', body]];
    })
    .slice(0, 2);
}

function knowRecords(presentation: JoinedGraphPresentation, visualId: string) {
  return (presentation.nodeVariants.get(visualId) || [])
    .filter((variant) => variant.authority === 'knowgraph')
    .flatMap((variant) => evidence(variant.node))
    .flatMap((item): Array<[string, string, string, string, string]> => {
      const id = text(item.graphitiEpisodeId);
      const observation = text(item.observation);
      const interpretation = text(item.interpretation);
      const citation = item.citation && typeof item.citation === 'object'
        ? item.citation as Record<string, unknown> : {};
      const source = text(citation.url) || text(citation.sourceUrl) || text(citation.source_url);
      if (!id || !observation || !interpretation) return [];
      return [[id, text(item.title) || 'Know', observation, interpretation, source]];
    })
    .slice(0, 2);
}

export function buildHermesNavigationMap(
  presentation: JoinedGraphPresentation,
  focusedVisualNodeId: string | null,
): HermesNavigationMap {
  const layers = (['thinkgraph', 'knowgraph', 'codegraph'] as const)
    .filter((authority) => presentation.layerVisibility?.[authority] === true);
  const nodeIndexByVisualId = new Map<string, number>();
  const nodes: HermesNavigationMap['nodes'] = [];
  for (const visible of presentation.projection.nodes) {
    const pointers: Array<[NavigationAuthority, string]> = [];
    for (const variant of presentation.nodeVariants.get(visible.id) || []) {
      if (layers.includes(variant.authority)) pointers.push([variant.authority, variant.node.id]);
    }
    const code = presentation.codeNodeVariants?.get(visible.id);
    if (code && layers.includes('codegraph')) {
      pointers.push(['codegraph', text(code.properties?.filePath) || code.id]);
    }
    if (!pointers.length) continue;
    nodeIndexByVisualId.set(visible.id, nodes.length);
    nodes.push([
      text(visible.canonicalName) || text(visible.label) || visible.id,
      code ? 'File' : 'Entity',
      pointers,
    ]);
  }

  const relationships: HermesNavigationMap['relationships'] = [];
  for (const visible of presentation.projection.edges) {
    const source = nodeIndexByVisualId.get(visible.source);
    const target = nodeIndexByVisualId.get(visible.target);
    if (source === undefined || target === undefined) continue;
    const knowledge = presentation.edgeVariants.get(visible.id);
    const code = presentation.codeEdgeVariants?.get(visible.id);
    const authority: NavigationAuthority | null = knowledge?.authority
      || (code ? 'codegraph' : null);
    const providerId = knowledge?.edge.id || code?.id || '';
    if (!authority || !layers.includes(authority) || !providerId) continue;
    relationships.push([
      authority,
      providerId,
      source,
      text(knowledge?.edge.predicate || code?.predicate || visible.predicate),
      target,
    ]);
  }

  const focusedNode = focusedVisualNodeId
    ? nodeIndexByVisualId.get(focusedVisualNodeId)
    : undefined;
  const associatedCodeNodes = focusedNode === undefined ? [] : [
    ...new Set(presentation.projection.nodes.flatMap((visible) => {
      const index = nodeIndexByVisualId.get(visible.id);
      const code = presentation.codeNodeVariants?.get(visible.id);
      if (index === undefined || !code) return [];
      if (visible.id === focusedVisualNodeId) return [index];
      const targets = code.properties?.categoryTargets;
      return targets && typeof targets === 'object'
        && Object.values(targets).includes(focusedVisualNodeId) ? [index] : [];
    })),
  ];
  const focus: HermesNavigationMap['focus'] = focusedNode === undefined
    ? null
    : [
        focusedNode,
        layers.includes('thinkgraph')
          ? thinkRecords(presentation, focusedVisualNodeId!)
          : [],
        layers.includes('knowgraph')
          ? knowRecords(presentation, focusedVisualNodeId!)
          : [],
        layers.includes('codegraph') ? associatedCodeNodes : [],
      ];
  return {
    schemaVersion: NAVIGATION_MAP_SCHEMA,
    projectId: presentation.projection.projectId,
    layers,
    revision: presentation.projection.revision || 'unversioned',
    nodes,
    relationships,
    focus,
  };
}

let lastPublished = '';
let lastResult: HermesNavigationMapSync | null = null;
let currentMap: HermesNavigationMap | null = null;
let reconnectSubscriptionStarted = false;
let currentPublication: Promise<HermesNavigationMapSync> | null = null;
let currentPublicationJson = '';
let publicationTail: Promise<unknown> = Promise.resolve();

function ensureReconnectPublication(): void {
  if (reconnectSubscriptionStarted) return;
  reconnectSubscriptionStarted = true;
  void onHermesEvent('main', 'gateway.ready', () => {
    if (!currentMap) return;
    lastPublished = '';
    lastResult = null;
    void publishHermesNavigationMap(currentMap).catch(() => undefined);
  }).catch(() => {
    reconnectSubscriptionStarted = false;
  });
}

async function clearProfile(profile: string): Promise<void> {
  const fetchJSON = hermesWebappHost().fetchJSON;
  if (!fetchJSON) throw new Error('Hermes Webapp fetchJSON is unavailable.');
  await fetchJSON(`/api/plugins/liquidaity/navigation-map?profile=${encodeURIComponent(profile)}`, {
    method: 'DELETE',
  });
}

async function publishHermesNavigationMapNow(
  map: HermesNavigationMap,
  serialized: string,
): Promise<HermesNavigationMapSync> {
  const fetchJSON = hermesWebappHost().fetchJSON;
  if (!fetchJSON) throw new Error('Hermes Webapp fetchJSON is unavailable.');
  await Promise.all(NAVIGATION_MAP_PROFILES.map(clearProfile));
  try {
    const responses = await Promise.all(NAVIGATION_MAP_PROFILES.map((profile) => (
      fetchJSON<PublishResponse>(
        `/api/plugins/liquidaity/navigation-map?profile=${encodeURIComponent(profile)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: serialized,
        },
      )
    )));
    const first = responses[0];
    if (!first?.ok || !first.sha256 || responses.some((response) => (
      response.ok !== true || response.sha256 !== first.sha256
    ))) throw new Error(first?.detail || 'Hermes navigation-map publication mismatch.');
    const result: HermesNavigationMapSync = {
      status: 'synced',
      sha256: first.sha256,
      bytes: Number(first.bytes || 0),
      estimatedTokens: Number(first.estimatedTokens || 0),
      nodes: Number(first.nodes || 0),
      relationships: Number(first.relationships || 0),
      focused: first.focused === true,
    };
    lastPublished = serialized;
    lastResult = result;
    return result;
  } catch (error) {
    await Promise.allSettled(NAVIGATION_MAP_PROFILES.map(clearProfile));
    lastPublished = '';
    lastResult = null;
    throw error;
  }
}

export function publishHermesNavigationMap(
  map: HermesNavigationMap,
): Promise<HermesNavigationMapSync> {
  currentMap = map;
  ensureReconnectPublication();
  const serialized = JSON.stringify(map);
  if (!currentPublication && serialized === lastPublished && lastResult) {
    return Promise.resolve(lastResult);
  }
  if (currentPublication && serialized === currentPublicationJson) return currentPublication;
  const publication = publicationTail
    .catch(() => undefined)
    .then(() => publishHermesNavigationMapNow(map, serialized));
  publicationTail = publication;
  currentPublication = publication;
  currentPublicationJson = serialized;
  const clear = () => {
    if (currentPublication === publication) {
      currentPublication = null;
      currentPublicationJson = '';
    }
  };
  void publication.then(clear, clear);
  return publication;
}

export function clearHermesNavigationMap(): Promise<void> {
  currentMap = null;
  lastPublished = '';
  lastResult = null;
  const publication = publicationTail
    .catch(() => undefined)
    .then(async () => {
      await Promise.all(NAVIGATION_MAP_PROFILES.map(clearProfile));
      if (currentMap === null) {
        lastPublished = '';
        lastResult = null;
      }
    });
  publicationTail = publication;
  const tracked = publication.then(() => ({
    status: 'synced' as const,
    sha256: '',
    bytes: 0,
    estimatedTokens: 0,
    nodes: 0,
    relationships: 0,
    focused: false,
  }));
  currentPublication = tracked;
  currentPublicationJson = '';
  const clear = () => {
    if (currentPublication === tracked) currentPublication = null;
  };
  void tracked.then(clear, clear);
  return publication.then(() => undefined);
}

export async function awaitHermesNavigationMapReady(): Promise<void> {
  while (currentPublication) await currentPublication;
  const expected = currentMap ? JSON.stringify(currentMap) : '';
  if (currentMap && (!lastResult || lastPublished !== expected)) {
    throw new Error('Hermes navigation map is not synchronized.');
  }
}
