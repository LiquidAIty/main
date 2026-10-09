import type { ReactNode } from 'react';

import {
  GRAPH_THEME,
  SOLARPUNK_PALETTE,
} from '../../../components/graph/graphVisualTokens';

type RailColors = {
  panel: string;
  border: string;
  primary: string;
  text: string;
};

type RailVisibility = {
  showKnowledge: boolean;
  showWorldSignals: boolean;
  showWorldView: boolean;
  showTrading: boolean;
};

type AgentBuilderRailProps = {
  colors: RailColors;
  workspaceView: string;
  visibleRailItems: RailVisibility;
  moonOrb: ReactNode;
  onShowWorldSignalsWorkspace: () => void;
  onShowWorldViewWorkspace: () => void;
  onShowCanvasWorkspace: () => void;
  onOpenAddAgent: () => void;
  onShowKnowledgeWorkspace: () => void;
  onShowTradingWorkspace: () => void;
  onOpenNavigationDrawer: () => void;
};

function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

function HexPlusIcon({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="4.75"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M32 4.5L55.5 18V46L32 59.5L8.5 46V18L32 4.5Z" />
      <path d="M32 19V45" strokeLinecap="round" />
      <path d="M19 32H45" strokeLinecap="round" />
    </svg>
  );
}

export default function AgentBuilderRail({
  colors,
  workspaceView,
  visibleRailItems,
  moonOrb,
  onShowWorldSignalsWorkspace,
  onShowWorldViewWorkspace,
  onShowCanvasWorkspace,
  onOpenAddAgent,
  onShowKnowledgeWorkspace,
  onShowTradingWorkspace,
  onOpenNavigationDrawer,
}: AgentBuilderRailProps) {
  return (
    <aside
      className="h-full flex flex-col items-center gap-3 py-3"
      style={{
        width: 54,
        background: colors.panel,
        borderRight: `1px solid ${colors.border}`,
      }}
    >
      {visibleRailItems.showWorldSignals ? (
        <button
          type="button"
          title="World"
          aria-label="World"
          data-testid="rail-world-button"
          onClick={onShowWorldSignalsWorkspace}
          className="p-2 rounded"
          style={{ color: workspaceView === 'worldsignals' ? colors.primary : colors.text }}
        >
          <Icon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2c3 3 4.5 6.33 4.5 10S15 19 12 22M12 2c-3 3-4.5 6.33-4.5 10S9 19 12 22" />
        </button>
      ) : null}
      {visibleRailItems.showWorldView ? (
        <button
          type="button"
          title="WorldView"
          aria-label="WorldView"
          data-testid="rail-worldview-button"
          onClick={onShowWorldViewWorkspace}
          className="p-2 rounded"
          style={{ color: workspaceView === 'worldview' ? colors.primary : colors.text }}
        >
          <div
            style={{
              position: 'relative',
              width: 28,
              height: 28,
              borderRadius: '50%',
              overflow: 'visible',
              animation: 'builder-orb-float 21s ease-in-out infinite',
              boxShadow: [
                'inset 0 1px 1px rgba(255,255,255,0.12)',
                `0 0 14px ${SOLARPUNK_PALETTE.sea}24`,
                `0 0 26px ${SOLARPUNK_PALETTE.sun}14`,
              ].join(', '),
            }}
          >
            {moonOrb}
          </div>
        </button>
      ) : null}
      <button
        title="Agents"
        aria-label="Agents"
        data-testid="rail-plus-button"
        // One normal Add Agent control owns both saved-Card reuse and new-Card
        // creation. Off-canvas it first switches to the canvas workspace.
        onClick={() => {
          if (workspaceView === 'canvas') {
            onOpenAddAgent();
          } else {
            onShowCanvasWorkspace();
          }
        }}
        className="p-2 rounded"
        style={{ color: workspaceView === 'canvas' ? colors.primary : colors.text }}
      >
        <HexPlusIcon />
      </button>
      {visibleRailItems.showKnowledge ? (
        <button
          title="Graphs"
          aria-label="Graphs"
          data-testid="rail-graphs-button"
          onClick={onShowKnowledgeWorkspace}
          className="p-2 rounded"
          style={{
            color: workspaceView === 'knowledge' ? colors.primary : colors.text,
          }}
        >
          <Icon d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
        </button>
      ) : null}
      {visibleRailItems.showTrading ? (
        <button
          title="Trading"
          aria-label="Trading"
          data-testid="rail-trading-button"
          onClick={onShowTradingWorkspace}
          className="p-2 rounded"
          style={{
            color:
              workspaceView === 'trading'
                ? GRAPH_THEME.accent.solar
                : colors.text,
          }}
        >
          <Icon d="M4 18h16M6 15l3-3 3 2 4-6 2 2" />
        </button>
      ) : null}
      <div className="flex-1" />

      <button
        title="Menu"
        aria-label="Menu"
        data-testid="rail-three-lines-button"
        onClick={onOpenNavigationDrawer}
        className="p-2 rounded"
        style={{
          color: colors.text,
          background: 'transparent',
        }}
      >
        <Icon d="M4 7h16M4 12h16M4 17h16" />
      </button>
    </aside>
  );
}
