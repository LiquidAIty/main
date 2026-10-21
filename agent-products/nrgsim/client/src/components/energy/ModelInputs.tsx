// Entity: Building Modeling
// Relationship: Renders contextual SDK-bound controls using the recovered slider, exact-entry and category patterns inside the shared inspector.
import { GRAPH_THEME, graphDrawerButtonStyle } from '../../../../../../client/src/components/graph/graphVisualTokens';

export type InputControl = {
  id: string; label: string; tab: string; group: string; scopes: string[]; objectHandle: string;
  value: number | string | boolean; units: string; min: number; max: number; step: number;
  kind: 'number' | 'boolean'; integer: boolean;
  detail?: boolean;
  sliderMax?: number;
  choices: null | { value: string | number; label: string }[];
};
export type InputValues = Record<string, number | string | boolean>;

export default function ModelInputs({ controls, values, disabled, onChange }: {
  controls: InputControl[]; values: InputValues; disabled: boolean;
  onChange: (id: string, value: number | string | boolean) => void;
}) {
  const groups = [...new Set(controls.map(control => control.group))];
  const input = graphDrawerButtonStyle({ width: '100%', minHeight: 29, fontSize: 12, padding: '3px 6px', textAlign: 'left' });
  return <div style={{ display: 'grid', gap: 10 }}>{groups.map(group => {
    const fields = controls.filter(control => control.group === group);
    const renderFields = (items: InputControl[]) => <div style={{ display: 'grid', gap: 10, paddingTop: 6 }}>{items.map(control => {
      const value = values[control.id] ?? control.value;
      const changed = value !== control.value;
      return <label key={control.id} data-model-object={control.objectHandle} data-input-id={control.id} style={{ display: 'grid', gap: 3 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{control.label}{changed ? ' *' : ''}</span><span style={{ opacity: .7, whiteSpace: 'nowrap' }}>{control.units}</span>
        </span>
        {control.choices ? <select aria-label={control.label} style={input} disabled={disabled} value={String(value)}
          onChange={event => onChange(control.id, control.choices!.find(option => String(option.value) === event.target.value)!.value)}>
          {control.choices.map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
        </select> : control.kind === 'boolean' ? <input aria-label={control.label} type="checkbox" disabled={disabled} checked={Boolean(value)} onChange={event => onChange(control.id, event.target.checked)} /> :
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input aria-label={`${control.label} slider`} type="range" min={control.min} max={Math.max(control.sliderMax ?? control.max, Number(value))} step={control.integer ? 1 : 'any'} value={Number(value)}
              disabled={disabled} onChange={event => onChange(control.id, Number(event.target.value))} style={{ flex: 1, minWidth: 50, accentColor: GRAPH_THEME.accent.primary }} />
            <input aria-label={control.label} type="number" min={control.min} max={control.max} step={control.integer ? 1 : 'any'} value={value as number}
              disabled={disabled} onChange={event => onChange(control.id, event.target.value === '' ? '' : Number(event.target.value))}
              style={{ ...input, width: 90 }} />
          </div>}
      </label>;
    })}</div>;
    return <section key={group}>{fields.length > 1 || fields[0].label !== group ? <h3 style={{ fontSize: 12, margin: 0, color: GRAPH_THEME.accent.primary }}>{group}</h3> : null}
      {renderFields(fields.filter(control => !control.detail))}
      {fields.some(control => control.detail) ? <details style={{ marginTop: 8 }}><summary style={{ fontSize: 11, cursor: 'pointer' }}>Details</summary>{renderFields(fields.filter(control => control.detail))}</details> : null}
    </section>;
  })}</div>;
}
