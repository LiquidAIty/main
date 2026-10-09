import type { HermesCardProfileView } from '../features/agentbuilder/hermesCardProfile';

type HermesProfileStatus = 'idle' | 'loading' | 'ready' | 'failed';

export type CardInspectorHermesToolsModel = {
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

export type CardInspectorHermesToolsActions = {
  toggleHermesToolset(name: string, enabled: boolean): void;
  checkMcpServer(serverName: string): void | Promise<void>;
};

export function CardInspectorHermesCapabilities({
  hermes, actions,
}: {
  hermes: CardInspectorHermesToolsModel;
  actions: CardInspectorHermesToolsActions;
}) {
  return (
    <section
      aria-label="Hermes capabilities"
      data-testid="hermes-toolsets"
      style={{ display: 'grid', gap: 8, padding: '10px 12px', border: '1px solid #3A4A4F', borderRadius: 8 }}
    >
      <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Hermes capabilities</div>
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
                    display: 'grid', gridTemplateColumns: '18px 1fr', gap: 8, alignItems: 'start',
                    padding: '7px 8px', border: '1px solid #344542', borderRadius: 6, cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={`Enable Hermes ${label}`}
                    checked={hermes.savedToolsetNames.includes(toolset.name)}
                    onChange={(event) => actions.toggleHermesToolset(toolset.name, event.target.checked)}
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
          <div style={{ color: '#80969F', fontSize: 11 }}>No Hermes toolsets are available for this profile.</div>
        )
      ) : (
        <div role="status" style={{ color: '#80969F', fontSize: 11 }}>Loading Hermes capabilities…</div>
      )}
    </section>
  );
}

export function CardInspectorHermesRuntime({
  hermes, actions,
}: {
  hermes: CardInspectorHermesToolsModel;
  actions: CardInspectorHermesToolsActions;
}) {
  if (!hermes.profileState) return null;

  return (
    <section
      data-testid="effective-hermes-runtime"
      style={{
        display: 'grid', gap: 8, padding: '10px 12px', border: '1px solid #3A4A4F',
        borderRadius: 8, background: '#202827',
      }}
    >
      <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Effective runtime / diagnostics</div>
      <div style={{ color: '#91A9B8', fontSize: 11 }}>
        Profile {hermes.profileState.binding.profile} · saved Card authority materializes at Run start. Effective Hermes profile values are read-only here.
      </div>
      {hermes.profileState.profile.mcpServers.length ? hermes.profileState.profile.mcpServers.map((server) => {
        const checked = hermes.mcpChecks[server.name];
        return (
          <div
            key={server.name}
            style={{ display: 'grid', gap: 5, padding: '8px 9px', border: '1px solid #344542', borderRadius: 6 }}
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
              {server.transport}{server.toolFilter.length ? ` · ${server.toolFilter.join(', ')}` : ''}
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
  );
}
