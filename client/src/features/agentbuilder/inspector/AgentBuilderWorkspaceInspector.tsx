import type { ComponentProps } from 'react';

import type {
  WorldSignalsInspectorBridge,
  WorldSignalsLayerState,
} from '../../../components/worldsignals/WorldSignalsSurface';
import type {
  WorldSignalsDrawerSection,
} from '../../../components/worldsignals/WorldSignalsInspectorPanel';
import type { TradingConfiguration } from '../../trading/tradingState';
import AgentCardInspectorPanel from './AgentCardInspectorPanel';
import AgentBuilderInspectorDrawer, {
  type AgentBuilderInspectorRole,
} from './AgentBuilderInspectorDrawer';

export default function AgentBuilderWorkspaceInspector({
  workspaceView,
  agent,
  worldSignals,
  worldView,
  trading,
}: {
  workspaceView: string;
  agent: {
    available: boolean;
    open: boolean;
    title: string;
    onClose: () => void;
    onOpen: () => void;
    panelProps: ComponentProps<typeof AgentCardInspectorPanel>;
  } | null;
  worldSignals: {
    section: WorldSignalsDrawerSection | null;
    open: boolean;
    bridge: WorldSignalsInspectorBridge | null;
    layerState: WorldSignalsLayerState | null;
    onClose: () => void;
    onOpen: () => void;
    onSectionChange: (section: WorldSignalsDrawerSection) => void;
  };
  worldView: {
    available: boolean;
    open: boolean;
    onClose: () => void;
    onOpen: () => void;
    setInspectorHost: (host: HTMLDivElement | null) => void;
  };
  trading: {
    available: boolean;
    open: boolean;
    configuration: Record<string, unknown>;
    onClose: () => void;
    onOpen: () => void;
    onSave: (configuration: TradingConfiguration) => void;
  };
}) {
  let role: AgentBuilderInspectorRole | null = null;
  if (workspaceView === 'canvas' && agent?.available) {
    role = {
      kind: 'agent',
      open: agent.open,
      title: agent.title,
      onClose: agent.onClose,
      onOpen: agent.onOpen,
      children: <AgentCardInspectorPanel {...agent.panelProps} />,
    };
  } else if (workspaceView === 'worldsignals' && worldSignals.section) {
    role = {
      kind: 'worldsignals',
      open: worldSignals.open,
      section: worldSignals.section,
      bridge: worldSignals.bridge,
      layerState: worldSignals.layerState,
      onClose: worldSignals.onClose,
      onOpen: worldSignals.onOpen,
      onSectionChange: worldSignals.onSectionChange,
    };
  } else if (workspaceView === 'worldview' && worldView.available) {
    role = {
      kind: 'worldview',
      open: worldView.open,
      onClose: worldView.onClose,
      onOpen: worldView.onOpen,
      setInspectorHost: worldView.setInspectorHost,
    };
  } else if (workspaceView === 'trading' && trading.available) {
    role = {
      kind: 'trading',
      open: trading.open,
      configuration: trading.configuration,
      onClose: trading.onClose,
      onOpen: trading.onOpen,
      onSave: trading.onSave,
    };
  }
  return <AgentBuilderInspectorDrawer role={role} />;
}
