/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file validates authority-scoped saved layout, style, physics, material colors, and renderer settings without owning graph data.
 */

import {
  JEV_GRAPH_PHYSICS_PROFILES,
  type JevGraphPhysicsProfile,
} from './jevGraphPhysics';
import {
  DEFAULT_SOLARPUNK_COLORS,
  type GraphAuthority,
  type GraphProjectionEdge,
  type GraphProjectionNode,
  type GraphSurfaceAuthority,
  type SolarpunkColors,
} from './knowledgeGraphProjection';

export type RendererLayout = 'compact' | 'original' | 'communities';

export type PresentationStyle = 'classic' | 'cyber' | 'galaxy' | 'solar' | 'solarpunk';

export type RendererStyle = Exclude<PresentationStyle, 'solarpunk'>;

export type GraphPresentationPreferences = {
  schemaVersion?: 2 | 3 | 4 | 5 | 6 | 7;
  layout?: RendererLayout;
  physicsProfile?: JevGraphPhysicsProfile;
  style?: PresentationStyle;
  solarpunkColors?: SolarpunkColors;
  settings?: Partial<Record<'repel' | 'link' | 'gravity' | 'linkw' | 'size' | 'font' | 'labelDensity', number>> & { labels?: boolean };
};

const KNOWLEDGE_PRESENTATION_LAYOUTS = new Set<RendererLayout>([
  'compact', 'original', 'communities',
]);
export const SOLARPUNK_HEX = /^#[0-9a-f]{6}$/i;
const JEV_PHYSICS = new Set<JevGraphPhysicsProfile>(JEV_GRAPH_PHYSICS_PROFILES);
const PRESENTATION_SETTING_BOUNDS = {
  repel: [0, 400],
  link: [4, 80],
  gravity: [0, 400],
  linkw: [0.1, 2],
  size: [1, 12],
  font: [6, 24],
  labelDensity: [1, 100],
} as const;

export function presentationStorageKey(authority: GraphSurfaceAuthority): string {
  return `liquidaity.graph.${authority}.presentation.v1`;
}

function safePresentationSettings(
  value: unknown,
): GraphPresentationPreferences['settings'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const settings: NonNullable<GraphPresentationPreferences['settings']> = {};
  for (const [key, [minimum, maximum]] of Object.entries(PRESENTATION_SETTING_BOUNDS)) {
    const candidate = source[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)
      && candidate >= minimum && candidate <= maximum) {
      settings[key as keyof typeof PRESENTATION_SETTING_BOUNDS] = candidate;
    }
  }
  if (typeof source.labels === 'boolean') settings.labels = source.labels;
  return settings;
}

export function safePresentationPreferences(
  authority: GraphSurfaceAuthority,
): GraphPresentationPreferences {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(presentationStorageKey(authority)) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const source = parsed as Record<string, unknown>;
    const settings = safePresentationSettings(source.settings);
    const rawColors = source.solarpunkColors;
    const solarpunkColors = rawColors && typeof rawColors === 'object' && !Array.isArray(rawColors)
      ? Object.fromEntries(Object.entries(DEFAULT_SOLARPUNK_COLORS).map(([key, fallback]) => {
        const value = (rawColors as Record<string, unknown>)[key];
        return [key, typeof value === 'string' && SOLARPUNK_HEX.test(value) ? value : fallback];
      })) as SolarpunkColors
      : undefined;
    return {
      ...(typeof source.schemaVersion === 'number'
        && [2, 3, 4, 5, 6, 7].includes(source.schemaVersion)
        ? { schemaVersion: source.schemaVersion as 2 | 3 | 4 | 5 | 6 | 7 }
        : {}),
      ...(KNOWLEDGE_PRESENTATION_LAYOUTS.has(source.layout as RendererLayout)
        ? { layout: source.layout as RendererLayout }
        : {}),
      ...(JEV_PHYSICS.has(source.physicsProfile as JevGraphPhysicsProfile)
        ? { physicsProfile: source.physicsProfile as JevGraphPhysicsProfile }
        : {}),
      ...(['classic', 'cyber', 'galaxy', 'solar', 'solarpunk'].includes(String(source.style))
        ? { style: source.style as PresentationStyle } : {}),
      ...(settings ? { settings } : {}),
      ...(solarpunkColors ? { solarpunkColors } : {}),
    };
  } catch {
    return {};
  }
}

export function withoutSolarpunkMaterial(node: GraphProjectionNode): GraphProjectionNode {
  const next = { ...node };
  delete next.material_kind;
  delete next.material_role;
  delete next.material_blue;
  delete next.material_orange;
  delete next.material_surface;
  delete next.material_think_active;
  delete next.material_know_active;
  delete next.material_code_present;
  return next;
}

export function solarpunkEdgeFields(
  authority: GraphAuthority,
  colors: SolarpunkColors,
): Pick<GraphProjectionEdge, 'material_kind' | 'material_authority' | 'material_color'> {
  return {
    material_kind: 'solarpunk',
    material_authority: authority,
    material_color: authority === 'knowgraph'
      ? colors.knowRelationship
      : colors.thinkRelationship,
  };
}

export function withoutSolarpunkEdgeMaterial(edge: GraphProjectionEdge): GraphProjectionEdge {
  const next = { ...edge };
  delete next.material_kind;
  delete next.material_authority;
  delete next.material_color;
  return next;
}
