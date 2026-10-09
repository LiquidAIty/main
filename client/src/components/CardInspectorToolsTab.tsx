import { CardScriptEditor } from '../features/agentbuilder/CardScriptEditor';
import type {
  DisplayedToolRow,
  InputDictionaryToolPage,
  InputDictionaryToolReference,
} from '../features/agentbuilder/cardConfigurationEditor';
import type { HermesCardProfileView } from '../features/agentbuilder/hermesCardProfile';
import type { SavedCardConfiguration } from '../types/agentgraph';

type SavedCardScript = NonNullable<SavedCardConfiguration['script']>;
type HermesProfileStatus = 'idle' | 'loading' | 'ready' | 'failed';

export type CardInspectorScriptModel = {
  cardId: string;
  script: SavedCardScript;
  selectedTools: string[];
};

export type CardInspectorToolsTabModel = {
  dictionary: {
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
  hermes: {
    profileState: HermesCardProfileView | null;
    profileStatus: HermesProfileStatus;
    profileError: string | null;
    savedToolsetNames: string[];
    mcpChecks: Record<string, {
      status: 'checking' | 'connected' | 'failed';
      toolCount: number;
      error: string | null;
    }>;
  };
  script: CardInspectorScriptModel;
  mcpConnectionIdsText: string;
};

export type CardInspectorToolsTabActions = {
  changeAutoTools(enabled: boolean): void;
  changeToolQuery(value: string): void;
  changeToolNamespace(value: string): void;
  changeShowSelectedOnly(enabled: boolean): void;
  clearSelectedTools(): void;
  toggleTool(name: string, enabled: boolean): void;
  showPreviousToolPage(): void;
  showNextToolPage(): void;
  toggleHermesToolset(name: string, enabled: boolean): void;
  changeScript(script: SavedCardScript): void;
  changeMcpConnections(value: string): void;
  checkMcpServer(serverName: string): void | Promise<void>;
};

export function CardInspectorToolsTab({
  view,
  actions,
}: {
  view: CardInspectorToolsTabModel;
  actions: CardInspectorToolsTabActions;
}) {
  const { dictionary, hermes } = view;

  return (
    <div data-testid="card-inspector-tools-surface" style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
        <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
          Application capabilities
        </div>
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
          <button
            type="button"
            disabled={!dictionary.savedToolNames.length}
            onClick={actions.clearSelectedTools}
          >
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
              <label
                key={tool.name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '18px 1fr',
                  gap: 8,
                  alignItems: 'start',
                  padding: '7px 8px',
                  border: '1px solid #3A4A4F',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={dictionary.savedToolNames.includes(tool.name)}
                  onChange={(event) => {
                    if (!event.target.checked || tool.availability === 'available') {
                      actions.toggleTool(tool.name, event.target.checked);
                    }
                  }}
                  aria-label={`Include ${tool.title || tool.name}`}
                />
                <span>
                  <span title={tool.description} style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
                    {tool.title || tool.name}
                  </span>
                  <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                    {tool.availability === 'stale' ? ' · Unavailable in current catalog' : ''}
                    {tool.availability === 'disabled' ? ' · Currently unavailable' : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : null}
        {!dictionary.showSelectedOnly && dictionary.availableRows.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
              Available
            </div>
            {dictionary.availableRows.map((tool) => (
              <label
                key={tool.canonicalId}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '18px 1fr',
                  gap: 8,
                  alignItems: 'start',
                  padding: '7px 8px',
                  border: '1px solid #3A4A4F',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={dictionary.savedToolNames.includes(tool.canonicalId)}
                  disabled={!tool.available}
                  onChange={(event) => actions.toggleTool(tool.canonicalId, event.target.checked)}
                  aria-label={`Include ${tool.displayName || tool.canonicalId}`}
                />
                <span>
                  <span title={tool.description} style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
                    {tool.displayName || tool.canonicalId}
                  </span>
                  <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                    {!tool.available ? ' · Unavailable in current catalog' : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : !dictionary.selectedRows.length && !dictionary.busy && !dictionary.error ? (
          <div style={{ color: '#91A9B8', fontSize: 11 }}>
            {dictionary.showSelectedOnly
              ? 'No tools are selected for this card.'
              : 'No tools match this search.'}
          </div>
        ) : null}
        {!dictionary.showSelectedOnly && !dictionary.busy && !dictionary.error ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <button
              type="button"
              disabled={dictionary.page.offset <= 0}
              onClick={actions.showPreviousToolPage}
            >
              Previous
            </button>
            <span style={{ color: '#80969F', fontSize: 11 }}>
              {dictionary.page.total
                ? `${dictionary.page.offset + 1}-${Math.min(dictionary.page.offset + dictionary.page.limit, dictionary.page.total)}`
                : '0'}
            </span>
            <button
              type="button"
              disabled={!dictionary.page.hasMore}
              onClick={actions.showNextToolPage}
            >
              Next
            </button>
          </div>
        ) : null}
        <section
            aria-label="Hermes capabilities"
            data-testid="hermes-toolsets"
            style={{
              display: 'grid',
              gap: 8,
              padding: '10px 12px',
              border: '1px solid #3A4A4F',
              borderRadius: 8,
            }}
          >
            <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
              Hermes capabilities
            </div>
            <div style={{ color: '#80969F', fontSize: 10.5 }}>
              Hermes toolsets saved on this Card. These are not MCP tools.
            </div>
            {hermes.profileStatus === 'failed' ? (
              <div role="alert" style={{ color: '#FFA2A2', fontSize: 11 }}>
                {hermes.profileError || 'Hermes capabilities unavailable. Saved selections are unchanged.'}
              </div>
            ) : hermes.profileState ? (
              hermes.profileState.profile.toolsets.length ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  {hermes.profileState.profile.toolsets.map((toolset) => {
                    const label = toolset.label || toolset.name;
                    return (
                      <label
                        key={toolset.name}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '18px 1fr',
                          gap: 8,
                          alignItems: 'start',
                          padding: '7px 8px',
                          border: '1px solid #344542',
                          borderRadius: 6,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Enable Hermes ${label}`}
                          checked={hermes.savedToolsetNames.includes(toolset.name)}
                          onChange={(event) => actions.toggleHermesToolset(
                            toolset.name,
                            event.target.checked,
                          )}
                        />
                        <span>
                          <span title={toolset.description} style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
                            {label}{label !== toolset.name ? ` · ${toolset.name}` : ''}
                          </span>
                          <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                            {typeof toolset.tool_count === 'number' ? `${toolset.tool_count} tools · ` : ''}
                            Profile readback: {toolset.enabled ? 'enabled' : 'disabled'}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: '#80969F', fontSize: 11 }}>
                  No Hermes toolsets are available for this profile.
                </div>
              )
            ) : (
              <div role="status" style={{ color: '#80969F', fontSize: 11 }}>
                Loading Hermes capabilities…
              </div>
            )}
        </section>
        <CardScriptEditor
          cardId={view.script.cardId}
          script={view.script.script}
          selectedTools={view.script.selectedTools}
          onChange={actions.changeScript}
        />
        <section
          aria-label="External connections"
          style={{ display: 'grid', gap: 8, padding: '10px 12px', border: '1px solid #3A4A4F', borderRadius: 8 }}
        >
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>External connections</div>
          <label style={{ display: 'grid', gap: 6, color: '#D5E4E8', fontSize: 12 }}>
            External MCP connection references
            <textarea
              aria-label="External MCP connection references"
              value={view.mcpConnectionIdsText}
              onChange={(event) => actions.changeMcpConnections(event.target.value)}
              placeholder="One configured connection ID per line"
              rows={4}
            />
          </label>
        </section>
        {hermes.profileState ? (
          <section
            data-testid="effective-hermes-runtime"
            style={{
              display: 'grid',
              gap: 8,
              padding: '10px 12px',
              border: '1px solid #3A4A4F',
              borderRadius: 8,
              background: '#202827',
            }}
          >
            <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
              Effective runtime / diagnostics
            </div>
            <div style={{ color: '#91A9B8', fontSize: 11 }}>
              Profile {hermes.profileState.binding.profile} · saved Card authority materializes at Run start. Effective Hermes profile values are read-only here.
            </div>
            {hermes.profileState.profile.mcpServers.length ? hermes.profileState.profile.mcpServers.map((server) => {
              const checked = hermes.mcpChecks[server.name];
              return (
                <div
                  key={server.name}
                  style={{
                    display: 'grid',
                    gap: 5,
                    padding: '8px 9px',
                    border: '1px solid #344542',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ color: '#D5E4E8', fontSize: 11.5 }}>
                      {server.name} · {server.enabled ? 'enabled' : 'disabled'} · {server.credentialStatus.replace('_', ' ')}
                    </div>
                    <button
                      type="button"
                      onClick={() => void actions.checkMcpServer(server.name)}
                      disabled={!server.enabled || checked?.status === 'checking'}
                    >
                      {checked?.status === 'checking' ? 'Checking…' : 'Check connection'}
                    </button>
                  </div>
                  <div style={{ color: '#80969F', fontSize: 10.5 }}>
                    {server.transport}
                    {server.toolFilter.length ? ` · ${server.toolFilter.join(', ')}` : ''}
                  </div>
                  {checked ? (
                    <div style={{ color: checked.status === 'connected' ? '#72D7C7' : checked.status === 'failed' ? '#FFA2A2' : '#80969F', fontSize: 10.5 }}>
                      {checked.status === 'connected'
                        ? `Connected · ${checked.toolCount} MCP tools discovered`
                        : checked.status === 'failed'
                          ? checked.error || 'Connection failed.'
                          : 'Checking connection…'}
                    </div>
                  ) : null}
                </div>
              );
            }) : (
              <div style={{ color: '#80969F', fontSize: 11 }}>No Hermes MCP connections are configured.</div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}


