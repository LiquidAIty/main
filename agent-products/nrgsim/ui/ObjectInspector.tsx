// Entity: Building Inspector
// Relationship: Selection-specific input panels submit model edits; internal identities and SDK diagnostics are not presented as controls.
import { useState } from 'react';
import { graphCompanionTabButtonStyle, graphCompanionTabGroupStyle } from '../../../client/src/components/graph/graphVisualTokens';
import type { DrawingSettings, ModelObject } from './contracts';
import LayoutInputs, { type Author } from './inputs/LayoutInputs';
import ConstructionInputs from './inputs/ConstructionInputs';
import OpeningInputs from './inputs/OpeningInputs';
import LoadInputs from './inputs/LoadInputs';
import HvacInputs from './inputs/HvacInputs';
import InputField from './inputs/InputField';

export default function ObjectInspector(props: {
  object: ModelObject | null; objects: Readonly<Record<string, ModelObject>>;
  drawing: DrawingSettings; setDrawing: (next: DrawingSettings) => void;
  view: 'plan' | '3d'; setView: (view: 'plan' | '3d') => void;
  busy: boolean; author: Author; onNew: () => void; onSave: () => void;
  models: readonly { id: string; label: string; savedAt?: string }[];
  activeModel: string | null; onOpen: (id: string) => void;
}) {
  const { object, objects, busy, author } = props;
  const isSurface = object?.type === 'Surface' || object?.type === 'SubSurface';
  const isSpace = object?.type === 'Space';
  const hasConstruction = isSurface || isSpace || object?.type === 'Building';
  const hasOpenings = object?.type === 'Surface' && object.surfaceType === 'Wall'
    && object.outsideBoundaryCondition === 'Outdoors';
  const tabs = [...(isSpace ? ['Activity'] : []), ...(hasConstruction ? ['Construction'] : []),
    ...(hasOpenings ? ['Openings'] : []), ...(isSpace ? ['Lighting', 'HVAC'] : []),
    ...(!isSurface ? ['Geometry'] : [])];
  const [tab, setTab] = useState(isSurface ? 'Construction' : isSpace ? 'Activity' : 'Geometry');
  const activeTab = tabs.includes(tab) ? tab : tabs[0];
  return <section className="building-editor-inputs" data-testid="nrgsim-inspector">
    {object && <InputField key={`${object.handle}:name`} label="Name" value={object.name} busy={busy}
      onCommit={(name) => author({ operation: 'rename', handle: object.handle, type: object.type, name })} />}
    <nav aria-label="Building inputs" style={graphCompanionTabGroupStyle({ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 })}>
      {tabs.map((name) => <button type="button" key={name} aria-pressed={activeTab === name}
        style={graphCompanionTabButtonStyle(activeTab === name)} onClick={() => setTab(name)}>{name}</button>)}
    </nav>
    {!isSurface && <div hidden={activeTab !== 'Geometry'}><LayoutInputs {...props} /></div>}
    {hasConstruction && object && <div hidden={activeTab !== 'Construction'}>
      <ConstructionInputs object={object} objects={objects} busy={busy} author={author} />
    </div>}
    {hasOpenings && object && <div hidden={activeTab !== 'Openings'}>
      <OpeningInputs object={object} objects={objects} busy={busy} author={author} />
    </div>}
    {isSpace && object && <>
      <div hidden={activeTab !== 'Activity'}>
        <LoadInputs space={object} objects={objects} kind="People" busy={busy} author={author} />
        <LoadInputs space={object} objects={objects} kind="ElectricEquipment" busy={busy} author={author} />
      </div>
      <div hidden={activeTab !== 'Lighting'}>
        <LoadInputs space={object} objects={objects} kind="Lights" busy={busy} author={author} />
      </div>
      <div hidden={activeTab !== 'HVAC'}><HvacInputs key={`${object.handle}:${object.thermalZone}`} space={object} objects={objects} busy={busy} author={author} /></div>
    </>}
  </section>;
}
