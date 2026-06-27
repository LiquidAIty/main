// Pure KnowGraph explorer visual grammar — encode MEANING, not a uniform gray field.
// EDGAR objects and source-backed evidence are ONE graph with different roles; this module maps
// each role/edge/outcome to a stable visual treatment. No d3, no React — unit-testable in isolation
// (the visual grammar is the months-long miss, so it gets its own proof surface).
//
// `import type` of KnowledgeGraphNode is erased at compile time, so importing this module never
// pulls the d3/React renderer into a test.

import { GRAPH_THEME } from '../graph/graphVisualTokens';
import type { KnowledgeGraphNode, KnowledgeGraphSource } from './KnowledgeGraphNVL';

export type { KnowledgeGraphNode } from './KnowledgeGraphNVL';

function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}
function truncateGraphLabel(value: string, maxLength = 28): string {
  const normalized = String(value || '').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
function formatRelationshipLabel(value: string): string {
  return truncateGraphLabel(String(value || '').replace(/_/g, ' '), 26);
}

// Distinct color per KnowGraph object ROLE. Cyan/teal/green/red/amber cockpit palette (no purple).
// Unknown roles keep a source-based color so nothing is hidden.
const NODE_ROLE_COLOR: Readonly<Record<string, string>> = {
  issuer: '#8fe3ff', company: '#8fe3ff', organization: '#8fe3ff',
  ticker: '#2dd4bf', security: '#2dd4bf',
  filing: '#94a3b8',
  businesscontext: '#56d364', business: '#56d364',
  riskcontext: '#ff7b72', risk: '#ff7b72',
  managementdiscussioncontext: '#79c0ff', management: '#79c0ff', mda: '#79c0ff', documentsection: '#79c0ff',
  evidencesection: '#9fb4c4', evidence: '#9fb4c4',
  observedentity: '#67e8f9', entity: '#67e8f9', topic: '#67e8f9', person: '#67e8f9', product: '#67e8f9',
  sourcebackedassertion: '#f2cc60', claim: '#f2cc60', assertion: '#f2cc60',
  source: '#d4a373',
  question: '#f0883e',
  assessment: '#e3b341',
};

function fallbackColor(node: KnowledgeGraphNode): string {
  const src: KnowledgeGraphSource =
    node.source === 'mixed' ? 'mixed' : node.originSource === 'know' ? 'know' : node.originSource === 'think' ? 'think' : node.source;
  if (src === 'mixed') return GRAPH_THEME.accent.mixed;
  return src === 'know' ? GRAPH_THEME.accent.know : GRAPH_THEME.accent.think;
}

export function nodeRole(node: KnowledgeGraphNode): string {
  return String(node.type || '').trim().toLowerCase();
}
export function isClaimRole(role: string): boolean {
  return role === 'sourcebackedassertion' || role === 'claim' || role === 'assertion';
}
export function nodeColorByRole(node: KnowledgeGraphNode): string {
  return NODE_ROLE_COLOR[nodeRole(node)] || fallbackColor(node);
}
// Size = role weight + degree, in a small readable range. No giant moons; no uniform dots.
export function nodeRadiusFor(node: KnowledgeGraphNode): number {
  const role = nodeRole(node);
  const base = clamp(8 + Math.sqrt(Math.max(1, node.degree || 1)) * 2.1, 8, 22);
  const bump =
    role === 'issuer' || role === 'company' ? 4
    : role === 'ticker' || role === 'security' ? 2
    : isClaimRole(role) || role === 'evidencesection' || role === 'source' ? -1
    : 0;
  return clamp(base + bump, 7, 26);
}
// Concise label: a claim shows its OBJECT (RDW / RWE / "28 locations"), never a full sentence —
// the full assertion text stays in hover / Inspector. Everything else uses its canonical name.
export function conciseNodeLabel(node: KnowledgeGraphNode): string {
  const role = nodeRole(node);
  const props = (node.properties || {}) as Record<string, unknown>;
  if (isClaimRole(role)) {
    const obj = String(props.object ?? '').trim();
    const pred = String(props.predicate ?? '').trim();
    return truncateGraphLabel(obj || formatRelationshipLabel(pred) || 'claim', 22);
  }
  return truncateGraphLabel(node.label || node.id, 26);
}
// Edge color encodes relationship MEANING: contradiction = conflict, support = supportive.
export function edgeColorByType(type: string, fallback: string): string {
  const t = String(type || '').trim().toLowerCase();
  if (t === 'contradicts') return '#ff5c52';
  if (t === 'supported_by' || t === 'supports') return '#56d364';
  return fallback;
}
// A claim's ring encodes its OUTCOME without deleting competing paths or asserting truth — the
// source path stays inspectable. directly_stated has no special ring (extracted, unverified).
export function outcomeRingColor(node: KnowledgeGraphNode): string | null {
  if (!isClaimRole(nodeRole(node))) return null;
  const o = String(((node.properties || {}) as Record<string, unknown>).outcome ?? '').trim().toLowerCase();
  if (o === 'supported') return '#56d364';
  if (o === 'contradicted') return '#ff5c52';
  if (o === 'uncertain' || o === 'unresolved') return '#e3b341';
  if (o === 'hypothesis') return '#9aa7b3';
  return null;
}
