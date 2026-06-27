// Source-neutral visual grammar for the shared Graph Explorer. Encodes MEANING: semantic role →
// fill, owner graph → border accent (know/think/code), status → ring, proposed cross-graph links →
// dashed/distinct. No purple. Used by GraphExplorerCore's Sigma node/edge reducers.

import type { GraphViewEdge, GraphViewNode, OwnerGraph } from './graphViewAdapter';

const ROLE_COLOR: Readonly<Record<string, string>> = {
  // KnowGraph roles
  issuer: '#8fe3ff', company: '#8fe3ff', organization: '#8fe3ff',
  ticker: '#2dd4bf', security: '#2dd4bf',
  filing: '#94a3b8',
  businesscontext: '#56d364', business: '#56d364',
  riskcontext: '#ff7b72', risk: '#ff7b72',
  managementdiscussioncontext: '#79c0ff', mda: '#79c0ff', documentsection: '#79c0ff',
  evidencesection: '#9fb4c4', source: '#d4a373',
  entity: '#67e8f9', topic: '#67e8f9', person: '#67e8f9', product: '#67e8f9',
  claim: '#f2cc60', assertion: '#f2cc60',
  // ThinkGraph (project work) roles
  goal: '#f0c674', thesis: '#f0c674', hypothesis: '#e3b341',
  question: '#f0883e', open_issue: '#f0883e',
  decision: '#7ee787', option: '#a5d6a7',
  constraint: '#ff9e64', risk_item: '#ff7b72',
  task: '#79c0ff', planstep: '#58a6ff', plan_step: '#58a6ff',
  artifact: '#b39ddb', review: '#9fb4c4', outcome: '#56d364',
  property: '#8fe3ff', number: '#e3b341', metric: '#e3b341', document: '#94a3b8',
};

const OWNER_ACCENT: Readonly<Record<OwnerGraph, string>> = {
  know: '#2dd4bf',   // teal
  think: '#f0c674',  // amber
  code: '#58a6ff',   // blue
  composite: '#9fb4c4',
};

const STATUS_RING: Readonly<Record<string, string>> = {
  supported: '#56d364', contradicted: '#ff5c52', uncertain: '#e3b341', hypothesis: '#9aa7b3',
  accepted: '#56d364', rejected: '#ff5c52', provisional: '#e3b341', unresolved: '#f0883e',
};

export function nodeFill(node: GraphViewNode): string {
  return ROLE_COLOR[(node.semanticKind || '').toLowerCase()] || OWNER_ACCENT[node.ownerGraph] || '#9fb4c4';
}

export function nodeBorder(node: GraphViewNode): string {
  // status ring wins (claims/think objects); otherwise the owner-graph accent identifies the layer.
  const st = statusOf(node);
  if (st && STATUS_RING[st]) return STATUS_RING[st];
  return OWNER_ACCENT[node.ownerGraph] || '#33414f';
}

function statusOf(node: GraphViewNode): string | null {
  if (node.status) return String(node.status).toLowerCase();
  const ss = node.statusSummary || {};
  if (ss.contradicted) return 'contradicted';
  if (ss.supported) return 'supported';
  if (ss.uncertain) return 'uncertain';
  return null;
}

export function nodeSize(node: GraphViewNode, isFocus: boolean): number {
  if (isFocus) return 16;
  const role = (node.semanticKind || '').toLowerCase();
  const base = ['company', 'issuer', 'ticker', 'goal', 'thesis', 'property'].includes(role) ? 11 : 8;
  const deg = Math.min(6, Math.sqrt(Math.max(1, node.degree || 1)) * 1.4);
  return Math.min(18, base + deg);
}

export function nodeLabel(node: GraphViewNode): string {
  const l = (node.displayLabel || node.id).trim();
  return l.length > 32 ? `${l.slice(0, 31)}…` : l;
}

export function edgeColor(edge: GraphViewEdge): string {
  const p = (edge.predicate || '').toLowerCase();
  if (edge.proposed) return '#cfe8f566'; // proposed cross-graph link, visibly tentative (translucent)
  if (p === 'contradicts') return '#ff5c52';
  if (p === 'supported_by' || p === 'supports') return '#56d364';
  if (p === 'has_context') return '#5b6b7a';
  return OWNER_ACCENT[edge.ownerGraph] ? `${OWNER_ACCENT[edge.ownerGraph]}88` : '#566677';
}

export function edgeSize(edge: GraphViewEdge): number {
  if ((edge.predicate || '').toLowerCase() === 'contradicts') return 3;
  return Math.min(4, 1.2 + Math.log2(1 + (edge.weight || 1)));
}

export function edgeLabel(edge: GraphViewEdge): string {
  const p = String(edge.predicate || 'related to').replace(/_/g, ' ');
  const st = edge.statusCounts ? Object.keys(edge.statusCounts).find((k) => k !== 'directly_stated') : null;
  return st ? `${p} (${st})` : p;
}

export const OWNER_GRAPH_ACCENT = OWNER_ACCENT;
