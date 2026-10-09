import {
  JEV_GRAPH_PHYSICS_PROFILES,
  type JevGraphPhysicsProfile,
} from './jevGraphPhysics';
import {
  DEFAULT_SOLARPUNK_COLORS,
  type SolarpunkColors,
} from './joinedKnowledgeGraphProjection';

export type GraphLayout = 'compact' | 'original' | 'communities' | 'radial' | 'galaxy';
export type GraphStyle = 'classic' | 'cyber' | 'galaxy' | 'solar' | 'solarpunk';
export type RendererGraphStyle = Exclude<GraphStyle, 'solarpunk'>;
export type GraphPresentationPreferences = {
  schemaVersion: 2 | 3 | 4 | 5 | 6;
  layout: GraphLayout;
  style: GraphStyle;
  physicsProfile: JevGraphPhysicsProfile;
  settings: Record<string, number | boolean | string>;
  solarpunkColors: SolarpunkColors;
};

export const GRAPH_LAYOUTS = new Set<GraphLayout>([
  'compact', 'original', 'communities', 'radial', 'galaxy',
]);
export const GRAPH_STYLES = new Set<GraphStyle>([
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

export function safePresentationSettings(
  value: unknown,
): Record<string, number | boolean | string> | undefined {
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

export function presentationStorageKey(): string {
  return 'liquidaity.graph.joined.presentation.v1';
}

export function safePresentationPreferences(): Partial<GraphPresentationPreferences> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(presentationStorageKey()) || '{}');
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
      ...(GRAPH_LAYOUTS.has(parsed.layout) ? { layout: parsed.layout } : {}),
      ...(GRAPH_STYLES.has(parsed.style) ? { style: parsed.style } : {}),
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

export function rendererGraphStyle(style: GraphStyle): RendererGraphStyle {
  return style === 'solarpunk' ? 'cyber' : style;
}

export function initialPresentationStyle(savedStyle: GraphStyle | undefined): GraphStyle {
  return savedStyle || 'solarpunk';
}
