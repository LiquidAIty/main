/**
 * Entity: Project Knowledge Graph
 * Relationship: This file validates and persists authority-scoped layout, style, physics, material colors, and bounded renderer settings without owning graph data.
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

export type RendererLayout = 'compact' | 'original' | 'communities' | 'radial' | 'galaxy';

export type PresentationStyle = 'classic' | 'cyber' | 'galaxy' | 'solar' | 'solarpunk';

export type RendererStyle = Exclude<PresentationStyle, 'solarpunk'>;

export type GraphPresentationPreferences = {
  schemaVersion: 2 | 3 | 4 | 5 | 6;
  layout: RendererLayout;
  style: PresentationStyle;
  physicsProfile: JevGraphPhysicsProfile;
  settings: Record<string, number | boolean | string>;
  solarpunkColors: SolarpunkColors;
};

export const RENDERER_LAYOUTS = new Set<RendererLayout>([
  'compact', 'original', 'communities', 'radial', 'galaxy',
]);

export const PRESENTATION_STYLES = new Set<PresentationStyle>([
  'classic', 'cyber', 'galaxy', 'solar', 'solarpunk',
]);

export const JEV_PHYSICS = new Set<JevGraphPhysicsProfile>(JEV_GRAPH_PHYSICS_PROFILES);

export const SOLARPUNK_HEX = /^#[0-9a-f]{6}$/i;

export const PRESENTATION_SETTING_BOUNDS = {
  size: [1, 12],
  font: [6, 24],
  linkw: [0.1, 2],
  labelDensity: [1, 100],
  repel: [0, 400],
  link: [4, 80],
  gravity: [0, 400],
} as const;

export function safePresentationSettings(value: unknown): Record<string, number | boolean | string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const settings: Record<string, number | boolean | string> = {};
  if (typeof source.labels === 'boolean') settings.labels = source.labels;
  for (const [key, [minimum, maximum]] of Object.entries(PRESENTATION_SETTING_BOUNDS)) {
    const candidate = source[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)
      && candidate >= minimum && candidate <= maximum) {
      settings[key] = candidate;
    }
  }
  return settings;
}

export function presentationStorageKey(authority: GraphSurfaceAuthority): string {
  return `liquidaity.graph.${authority}.presentation.v1`;
}

export function safePresentationPreferences(
  authority: GraphSurfaceAuthority,
): Partial<GraphPresentationPreferences> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(presentationStorageKey(authority)) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const settings = safePresentationSettings(parsed.settings);
    const rawColors = parsed.solarpunkColors && typeof parsed.solarpunkColors === 'object'
      ? parsed.solarpunkColors as Partial<SolarpunkColors>
      : {};
    const defaultColors = DEFAULT_SOLARPUNK_COLORS;
    const legacyThinkColor = /^(?:#6e5fae|#3979e8)$/i.test(String(rawColors.think || ''));
    const legacyThinkEdgeColor = /^#3979e8$/i.test(
      String(rawColors.thinkRelationship || ''),
    );
    return {
      ...([2, 3, 4, 5, 6].includes(parsed.schemaVersion)
        ? { schemaVersion: parsed.schemaVersion as 2 | 3 | 4 | 5 | 6 }
        : {}),
      ...(RENDERER_LAYOUTS.has(parsed.layout) ? { layout: parsed.layout } : {}),
      ...(PRESENTATION_STYLES.has(parsed.style) ? { style: parsed.style } : {}),
      ...(JEV_PHYSICS.has(parsed.physicsProfile) ? { physicsProfile: parsed.physicsProfile } : {}),
      ...(settings ? { settings } : {}),
      solarpunkColors: {
        think: !legacyThinkColor && SOLARPUNK_HEX.test(String(rawColors.think || ''))
          ? String(rawColors.think) : defaultColors.think,
        know: SOLARPUNK_HEX.test(String(rawColors.know || ''))
          ? String(rawColors.know) : defaultColors.know,
        thinkRelationship: !legacyThinkEdgeColor
          && SOLARPUNK_HEX.test(String(rawColors.thinkRelationship || ''))
          ? String(rawColors.thinkRelationship) : defaultColors.thinkRelationship,
        knowRelationship: SOLARPUNK_HEX.test(String(rawColors.knowRelationship || ''))
          ? String(rawColors.knowRelationship) : defaultColors.knowRelationship,
      },
    };
  } catch {
    return {};
  }
}

export function rendererStyle(style: PresentationStyle): RendererStyle {
  return style === 'solarpunk' ? 'cyber' : style;
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
  delete next.material_focus_active;
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
