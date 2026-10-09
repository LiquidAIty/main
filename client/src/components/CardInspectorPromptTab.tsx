import {
  cardPromptFieldRanges,
  type CardEditorConfiguration,
  type CardPromptFields,
} from '../features/agentbuilder/cardConfigurationEditor';

export type CardInspectorPromptTabModel = {
  runtime: {
    mode: CardEditorConfiguration['runtime']['mode'];
    orchestratorEnabled: boolean;
  };
  outboundConnections: Array<{
    cardId: string;
    title: string;
    direction: 'incoming' | 'outgoing';
  }>;
  cardName: {
    draft: string;
  };
  prompt: {
    text: string;
    parts: CardPromptFields & Record<string, string>;
    touched: Record<string, boolean>;
  };
};

export type CardInspectorPromptTabActions = {
  changeOrchestrator(enabled: boolean): void;
  changeCardName(value: string): void;
  changePromptField(field: string, value: string): void;
};

export function CardInspectorPromptTab({
  view,
  actions,
}: {
  view: CardInspectorPromptTabModel;
  actions: CardInspectorPromptTabActions;
}) {
  const orchestratorOn = view.runtime.mode !== 'magentic_one'
    && (view.runtime.mode === 'main' || view.runtime.orchestratorEnabled);

  return (
    <div data-testid="card-inspector-prompt-surface" style={{ display: 'grid', gap: 16 }}>
      <section aria-label="Prompt configuration">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {view.runtime.mode !== 'magentic_one' ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#E0DED5', fontSize: 12 }}>
              <input
                type="checkbox"
                aria-label="Orchestrator"
                checked={orchestratorOn}
                disabled={view.runtime.mode === 'main'}
                onChange={(event) => actions.changeOrchestrator(event.target.checked)}
              />
              Orchestrator
            </label>
          ) : null}

          {orchestratorOn && view.outboundConnections.length > 0 ? (
            <label style={{ display: 'grid', gap: 7, color: '#E0DED5', fontSize: 12 }}>
              <span style={{ fontWeight: 700 }}>All connected agents</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {view.outboundConnections.map((connection) => (
                  <span
                    key={`${connection.direction}:${connection.cardId}`}
                    style={{
                      padding: '3px 7px',
                      borderRadius: 999,
                      border: '1px solid rgba(242,166,74,.28)',
                      background: 'rgba(242,166,74,.08)',
                      color: '#F0D2A9',
                      fontSize: 10,
                    }}
                  >
                    {connection.title}
                  </span>
                ))}
              </span>
              <textarea
                aria-label="All connected agents"
                value={view.prompt.parts.connectedAgents}
                placeholder={view.outboundConnections
                  .map((connection) => (
                    `${connection.title} is a connected teammate. Describe when and why this Card should call it.`
                  ))
                  .join('\n')}
                onChange={(event) => actions.changePromptField('connectedAgents', event.target.value)}
                rows={Math.max(5, Math.min(10, view.outboundConnections.length + 3))}
                style={{
                  width: '100%',
                  padding: 10,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid rgba(242,166,74,.26)',
                  borderRadius: 8,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  resize: 'vertical',
                }}
              />
            </label>
          ) : null}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Name
              </label>
              <input
                type="text"
                value={view.cardName.draft}
                onChange={(event) => actions.changeCardName(event.target.value)}
                placeholder="Enter agent name"
                style={{
                  width: '100%',
                  padding: 8,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: 8,
                }}
              />
            </div>
          </div>

          {([
            ['role', 'Role'],
            ['goal', 'Goal'],
            ['constraints', 'Constraints'],
            ['ioSchema', 'Input schema'],
            ['outputExpectations', 'Output expectations'],
          ] as const).map(([field, label]) => (
            <div key={field}>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                {label}
              </label>
              <textarea
                aria-label={label}
                value={view.prompt.parts[field]}
                onChange={(event) => actions.changePromptField(field, event.target.value)}
                rows={5}
                style={{
                  width: '100%',
                  padding: 10,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: 8,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  resize: 'vertical',
                }}
              />
            </div>
          ))}

          {cardPromptFieldRanges(view.prompt.text).filter((block) => (
            !['role', 'goal', 'constraints', 'ioSchema', 'outputExpectations', 'connectedAgents'].includes(block.key)
            && (block.start !== block.end || view.prompt.touched[block.key])
          )).map((block) => (
            <label key={block.key} style={{ display: 'grid', gap: 6, color: '#E0DED5', fontSize: 12 }}>
              {block.key === 'memoryPolicy' ? 'Memory policy' : block.label}
              <textarea
                aria-label={block.key === 'memoryPolicy' ? 'Memory policy' : block.label}
                value={view.prompt.parts[block.key] ?? ''}
                onChange={(event) => actions.changePromptField(block.key, event.target.value)}
                rows={5}
                style={{ width: '100%', padding: 10, background: '#2B2B2B', color: '#FFF',
                  border: '1px solid #3A3A3A', borderRadius: 8, fontFamily: 'monospace',
                  fontSize: 13, resize: 'vertical' }}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}



