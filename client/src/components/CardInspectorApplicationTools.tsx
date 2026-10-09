import type {
  DisplayedToolRow,
  InputDictionaryToolPage,
  InputDictionaryToolReference,
} from '../features/agentbuilder/cardConfigurationEditor';

export type CardInspectorApplicationToolsModel = {
  autoToolsEnabled: boolean;
  autoToolsVisible: boolean;
  query: string;
  namespace: string;
  page: InputDictionaryToolPage;
  showSelectedOnly: boolean;
  busy: boolean;
  error: boolean;
  savedToolNames: string[];
  selectedRows: DisplayedToolRow[];
  availableRows: InputDictionaryToolReference[];
};

export type CardInspectorApplicationToolsActions = {
  changeAutoTools(enabled: boolean): void;
  changeToolQuery(value: string): void;
  changeToolNamespace(value: string): void;
  changeShowSelectedOnly(enabled: boolean): void;
  clearSelectedTools(): void;
  toggleTool(name: string, enabled: boolean): void;
  showPreviousToolPage(): void;
  showNextToolPage(): void;
};

const toolChoiceStyle = {
  display: 'grid', gridTemplateColumns: '18px 1fr', gap: 8, alignItems: 'start',
  padding: '7px 8px', border: '1px solid #3A4A4F', borderRadius: 6, cursor: 'pointer',
} as const;

function ToolChoice({
  title, description, checked, disabled, availability, onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  availability: string;
  onChange(enabled: boolean): void;
}) {
  return (
    <label style={toolChoiceStyle}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={`Include ${title}`}
      />
      <span>
        <span title={description} style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
          {title}
        </span>
        <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>{availability}</span>
      </span>
    </label>
  );
}

export function CardInspectorApplicationTools({
  dictionary, actions,
}: {
  dictionary: CardInspectorApplicationToolsModel;
  actions: CardInspectorApplicationToolsActions;
}) {
  return (
    <>
      {dictionary.autoToolsVisible ? (
        <label style={{ color: '#D5E4E8', fontSize: 12, fontWeight: 600 }}>
          <input
            type="checkbox"
            aria-label="AutoTools"
            checked={dictionary.autoToolsEnabled}
            onChange={(event) => actions.changeAutoTools(event.target.checked)}
          />{' '}
          AutoTools
        </label>
      ) : null}
      <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Application capabilities</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
        <input
          value={dictionary.query}
          onChange={(event) => actions.changeToolQuery(event.target.value)}
          placeholder="Search ID, name, namespace, or description"
          aria-label="Search tools"
        />
        <select
          value={dictionary.namespace}
          onChange={(event) => actions.changeToolNamespace(event.target.value)}
          aria-label="Filter tools by namespace"
        >
          <option value="">All namespaces</option>
          {dictionary.page.namespaces.map((namespace) => (
            <option key={namespace} value={namespace}>{namespace}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ color: '#91A9B8', fontSize: 11 }}>
          <input
            type="checkbox"
            checked={dictionary.showSelectedOnly}
            onChange={(event) => actions.changeShowSelectedOnly(event.target.checked)}
          />{' '}
          Selected only
        </label>
        <button type="button" disabled={!dictionary.savedToolNames.length} onClick={actions.clearSelectedTools}>
          Clear selected
        </button>
        <span style={{ color: '#80969F', fontSize: 11 }}>
          {dictionary.busy ? 'Loading tools…' : !dictionary.error ? `${dictionary.page.total.toLocaleString()} tools` : null}
        </span>
      </div>
      {dictionary.error ? (
        <div role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>
          Tool options unavailable. Saved selections are unchanged.
        </div>
      ) : null}
      {dictionary.selectedRows.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
            Selected · {dictionary.selectedRows.length}
          </div>
          {dictionary.selectedRows.map((tool) => (
            <ToolChoice
              key={tool.name}
              title={tool.title || tool.name}
              description={tool.description}
              checked={dictionary.savedToolNames.includes(tool.name)}
              availability={`${tool.availability === 'stale' ? ' · Unavailable in current catalog' : ''}${tool.availability === 'disabled' ? ' · Currently unavailable' : ''}`}
              onChange={(enabled) => {
                if (!enabled || tool.availability === 'available') actions.toggleTool(tool.name, enabled);
              }}
            />
          ))}
        </div>
      ) : null}
      {!dictionary.showSelectedOnly && dictionary.availableRows.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Available</div>
          {dictionary.availableRows.map((tool) => (
            <ToolChoice
              key={tool.canonicalId}
              title={tool.displayName || tool.canonicalId}
              description={tool.description}
              checked={dictionary.savedToolNames.includes(tool.canonicalId)}
              disabled={!tool.available}
              availability={!tool.available ? ' · Unavailable in current catalog' : ''}
              onChange={(enabled) => actions.toggleTool(tool.canonicalId, enabled)}
            />
          ))}
        </div>
      ) : !dictionary.selectedRows.length && !dictionary.busy && !dictionary.error ? (
        <div style={{ color: '#91A9B8', fontSize: 11 }}>
          {dictionary.showSelectedOnly ? 'No tools are selected for this card.' : 'No tools match this search.'}
        </div>
      ) : null}
      {!dictionary.showSelectedOnly && !dictionary.busy && !dictionary.error ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button type="button" disabled={dictionary.page.offset <= 0} onClick={actions.showPreviousToolPage}>
            Previous
          </button>
          <span style={{ color: '#80969F', fontSize: 11 }}>
            {dictionary.page.total
              ? `${dictionary.page.offset + 1}-${Math.min(dictionary.page.offset + dictionary.page.limit, dictionary.page.total)}`
              : '0'}
          </span>
          <button type="button" disabled={!dictionary.page.hasMore} onClick={actions.showNextToolPage}>
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}
