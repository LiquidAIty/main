import type { ReactNode } from 'react';

import RightGlassDrawer from '../../../components/graph/RightGlassDrawer';
import {
  graphCompanionTabButtonStyle,
  graphCompanionTabGroupStyle,
} from '../../../components/graph/graphVisualTokens';
import WorldSignalsInspectorPanel, {
  type WorldSignalsDrawerSection,
} from '../../../components/worldsignals/WorldSignalsInspectorPanel';
import type {
  WorldSignalsInspectorBridge,
  WorldSignalsLayerState,
} from '../../../components/worldsignals/WorldSignalsSurface';
import TradingUiInspectorPanel from '../../trading/TradingUiInspectorPanel';
import type { TradingConfiguration } from '../../trading/tradingState';

type AgentInspectorRole = {
  kind: 'agent';
  open: boolean;
  title: string;
  onClose: () => void;
  onOpen: () => void;
  children: ReactNode;
};

type TradingInspectorRole = {
  kind: 'trading';
  open: boolean;
  configuration: Record<string, unknown>;
  onClose: () => void;
  onOpen: () => void;
  onSave: (configuration: TradingConfiguration) => void;
};

type WorldSignalsInspectorRole = {
  kind: 'worldsignals';
  open: boolean;
  section: WorldSignalsDrawerSection;
  bridge: WorldSignalsInspectorBridge | null;
  layerState: WorldSignalsLayerState | null;
  onClose: () => void;
  onOpen: () => void;
  onSectionChange: (section: WorldSignalsDrawerSection) => void;
};

type WorldViewInspectorRole = {
  kind: 'worldview';
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  setInspectorHost: (host: HTMLDivElement | null) => void;
};

export type AgentBuilderInspectorRole =
  | AgentInspectorRole
  | TradingInspectorRole
  | WorldSignalsInspectorRole
  | WorldViewInspectorRole;

const AGENT_EDITOR_DEFAULT_WIDTH = 344;

export default function AgentBuilderInspectorDrawer({
  role,
}: {
  role: AgentBuilderInspectorRole | null;
}) {
  if (!role) return null;

  const title = role.kind === 'agent'
    ? role.title
    : role.kind === 'trading'
      ? 'Trading settings'
      : role.kind === 'worldsignals'
        ? 'WorldSignals'
        : '';
  const openAriaLabel = role.kind === 'agent'
    ? 'Open Agent Inspector'
    : role.kind === 'trading'
      ? 'Open Trading Inspector'
      : role.kind === 'worldsignals'
        ? 'Open WorldSignals Inspector'
        : 'Open WorldView controls';
  // WorldSignals retains the saved key from before its factual rename.
  const storageKey = role.kind === 'agent'
    ? 'liquidaity.drawer.inspector.agent.v1.width'
    : role.kind === 'trading'
      ? 'card.drawer.inspector.trading.v1.width'
      : role.kind === 'worldsignals'
        ? 'liquidaity.drawer.inspector.worldsignal.v1.width'
        : 'liquidaity.drawer.inspector.worldview.v1.width';

  return (
    <RightGlassDrawer
      isOpen={role.open}
      title={title}
      onClose={role.onClose}
      onOpen={role.onOpen}
      collapsedLabel={null}
      openAriaLabel={openAriaLabel}
      movable={role.kind !== 'trading'}
      defaultWidth={AGENT_EDITOR_DEFAULT_WIDTH}
      resetWidthOnOpen={false}
      minWidth={300}
      maxWidth={560}
      storageKey={storageKey}
      dataTestId="workspace-inspector-drawer"
      right={12}
      top={48}
    >
      {role.kind === 'worldview' ? <div ref={role.setInspectorHost} /> : null}
      {role.kind === 'worldsignals' ? (
        <>
          <div
            className="flex min-w-0 flex-wrap"
            style={graphCompanionTabGroupStyle({ gap: 6, marginBottom: 10 })}
          >
            {(['markets', 'layers'] as const).map((section) => {
              const selected = role.section === section;
              return (
                <button
                  key={section}
                  data-testid={`worldsignals-inspector-tab-${section}`}
                  aria-pressed={selected}
                  onClick={(event) => {
                    event.stopPropagation();
                    role.onSectionChange(section);
                  }}
                  className="whitespace-nowrap transition-colors duration-150 ease-out"
                  style={graphCompanionTabButtonStyle(selected)}
                >
                  {section === 'markets' ? 'Markets' : 'Layers'}
                </button>
              );
            })}
          </div>
          <WorldSignalsInspectorPanel
            section={role.section}
            bridge={role.bridge}
            layerState={role.layerState}
          />
        </>
      ) : null}
      {role.kind === 'trading' ? (
        <TradingUiInspectorPanel
          configuration={role.configuration}
          onSave={role.onSave}
        />
      ) : null}
      {role.kind === 'agent' ? role.children : null}
    </RightGlassDrawer>
  );
}
