import type { RefObject } from 'react';

import {
  JEV_GRAPH_PHYSICS_PROFILE_LABELS,
  JEV_GRAPH_PHYSICS_PROFILES,
  type JevGraphPhysicsProfile,
} from './jevGraphPhysics';
import type { SolarpunkColors } from './joinedKnowledgeGraphProjection';
import {
  SOLARPUNK_HEX,
  type GraphLayout,
  type GraphStyle,
} from './knowledgeGraphPresentationPreferences';

export function KnowledgeGraphPresentationControls({
  containerRef,
  physicsProfile,
  changePhysicsProfile,
  layout,
  changeLayout,
  style,
  changeStyle,
  solarpunkColors,
  changeSolarpunkColor,
  settings,
  changeSetting,
  resetPresetDefaults,
  appliedPresetNodeSize,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  physicsProfile: JevGraphPhysicsProfile;
  changePhysicsProfile: (value: JevGraphPhysicsProfile) => void;
  layout: GraphLayout;
  changeLayout: (value: GraphLayout) => void;
  style: GraphStyle;
  changeStyle: (value: GraphStyle) => void;
  solarpunkColors: SolarpunkColors;
  changeSolarpunkColor: (key: keyof SolarpunkColors, value: string) => void;
  settings: Record<string, number | boolean | string>;
  changeSetting: (key: string, value: number | boolean) => void;
  resetPresetDefaults: () => void;
  appliedPresetNodeSize: number | null;
}) {
  return <div ref={containerRef} className="knowledge-authority-controls">
    <label>Physics profile<select aria-label="Physics profile" value={physicsProfile} onChange={event => {
      changePhysicsProfile(event.target.value as JevGraphPhysicsProfile);
    }}>
      {JEV_GRAPH_PHYSICS_PROFILES.map(profile => <option key={profile} value={profile}>
        {JEV_GRAPH_PHYSICS_PROFILE_LABELS[profile]}
      </option>)}
    </select></label>
    <label>Layout<select aria-label="Layout" value={layout} onChange={event => {
      changeLayout(event.target.value as GraphLayout);
    }}>
      <option value="compact">Compact</option><option value="original">Original</option>
      <option value="communities">Communities</option><option value="radial">Radial</option>
      <option value="galaxy">Galaxy gravity</option>
    </select></label>
    <label>Style<select aria-label="Style" value={style} onChange={event => {
      changeStyle(event.target.value as GraphStyle);
    }}>
      <option value="classic">Classic</option><option value="cyber">Cyberpunk</option>
      <option value="solarpunk">Solarpunk</option><option value="galaxy">Galaxy</option>
      <option value="solar">Solar</option>
    </select></label>
    {style === 'solarpunk'
      ? <fieldset aria-label="Solarpunk colors" style={{ display: 'grid', gap: 6 }}>
      <legend>Solarpunk colors</legend>
      {([['Think nodes', 'think'], ['Know nodes', 'know'],
        ['Think edges', 'thinkRelationship'],
        ['Know edges', 'knowRelationship']] as const)
        .map(([label, key]) => <label key={key}>
          <span>{label}</span>
          <input type="color" aria-label={label} value={solarpunkColors[key]}
            onChange={event => {
              const value = event.target.value;
              if (!SOLARPUNK_HEX.test(value)) return;
              changeSolarpunkColor(key, value);
            }} />
        </label>)}
    </fieldset> : null}
    <label><input type="checkbox" checked={settings.labels === true} onChange={event => {
      changeSetting('labels', event.target.checked);
    }} />Entity labels</label>
    {([
      ['Node size', 'size', 1, 12, 1], ['Text size', 'font', 6, 24, 1],
      ['Line width', 'linkw', 0.1, 2, 0.01], ['Label density', 'labelDensity', 1, 100, 1],
      ['Repel force', 'repel', 0, 400, 1], ['Link distance', 'link', 4, 80, 1],
      ['Center gravity', 'gravity', 0, 400, 1],
    ] as const).map(([label, key, min, max, step]) => <label key={key}>
      <span>{label}</span>
      <input aria-label={label} type="range" min={min} max={max} step={step}
        value={Number(settings[key] ?? min)} onChange={event => {
          changeSetting(key, Number(event.target.value));
        }} />
      <output>{settings[key]}</output>
    </label>)}
    <button type="button" aria-label="Reset to preset defaults" onClick={resetPresetDefaults}>
      {appliedPresetNodeSize === null
        ? 'Reset to preset defaults'
        : `Preset defaults applied · node size ${appliedPresetNodeSize}`}
    </button>
  </div>;
}
