import { CardScriptEditor } from '../features/agentbuilder/CardScriptEditor';
import type { SavedCardConfiguration } from '../types/agentgraph';
import {
  CardInspectorApplicationTools,
  type CardInspectorApplicationToolsActions,
  type CardInspectorApplicationToolsModel,
} from './CardInspectorApplicationTools';
import {
  CardInspectorHermesCapabilities,
  CardInspectorHermesRuntime,
  type CardInspectorHermesToolsActions,
  type CardInspectorHermesToolsModel,
} from './CardInspectorHermesTools';

type SavedCardScript = NonNullable<SavedCardConfiguration['script']>;

export type CardInspectorScriptModel = {
  cardId: string;
  script: SavedCardScript;
  selectedTools: string[];
};

export type CardInspectorToolsTabModel = {
  dictionary: CardInspectorApplicationToolsModel;
  hermes: CardInspectorHermesToolsModel;
  script: CardInspectorScriptModel;
  mcpConnectionIdsText: string;
};

export type CardInspectorToolsTabActions = CardInspectorApplicationToolsActions
  & CardInspectorHermesToolsActions
  & {
    changeScript(script: SavedCardScript): void;
    changeMcpConnections(value: string): void;
  };

export function CardInspectorToolsTab({
  view, actions,
}: {
  view: CardInspectorToolsTabModel;
  actions: CardInspectorToolsTabActions;
}) {
  return (
    <div data-testid="card-inspector-tools-surface" style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CardInspectorApplicationTools dictionary={view.dictionary} actions={actions} />
        <CardInspectorHermesCapabilities hermes={view.hermes} actions={actions} />
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
        <CardInspectorHermesRuntime hermes={view.hermes} actions={actions} />
      </div>
    </div>
  );
}
