import type { ReactNode } from 'react';

import { GRAPH_THEME } from '../../../components/graph/graphVisualTokens';

type RailColors = {
  panel: string;
  border: string;
  primary: string;
  text: string;
};

type RailVisibility = {
  showKnowledge: boolean;
  showWorldsignal: boolean;
  showTrading: boolean;
  showCode: boolean;
  showDataFormulator: boolean;
  // Terminal icon for the OpenClaude Console Bridge. Optional so existing
  // callers keep compiling; shown when Local Coder is bus-connected or a
  // console session exists.
  showOpenClaudeConsole?: boolean;
};

type AgentBuilderRailProps = {
  colors: RailColors;
  workspaceView: string;
  visibleRailItems: RailVisibility;
  moonOrb: ReactNode;
  onShowWorldsignalWorkspace: () => void;
  onShowCanvasWorkspace: () => void;
  onQuickAddAssistNode: () => void;
  onShowKnowledgeWorkspace: () => void;
  onShowTradingWorkspace: () => void;
  onShowCodeWorkspace: () => void;
  onShowDataFormulatorWorkspace: () => void;
  onOpenNavigationDrawer: () => void;
  openClaudeConsoleActive?: boolean;
  onOpenOpenClaudeConsole?: () => void;
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
  onShowWorldsignalWorkspace,
  onShowCanvasWorkspace,
  onQuickAddAssistNode,
  onShowKnowledgeWorkspace,
  onShowTradingWorkspace,
  onShowCodeWorkspace,
  onShowDataFormulatorWorkspace,
  onOpenNavigationDrawer,
  openClaudeConsoleActive,
  onOpenOpenClaudeConsole,
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
      {visibleRailItems.showWorldsignal ? (
        <button
          type="button"
          title="World"
          aria-label="World"
          data-testid="rail-moon-orb-button"
          onClick={onShowWorldsignalWorkspace}
          className="p-2 rounded"
          style={{ color: workspaceView === 'worldsignal' ? colors.primary : colors.text }}
        >
          <div
            style={{
              position: 'relative',
              width: 28,
              height: 28,
              borderRadius: '50%',
              overflow: 'visible',
              animation: 'builder-orb-float 21s ease-in-out infinite',
              boxShadow:
                'inset 0 1px 1px rgba(255,255,255,0.12), 0 0 14px rgba(79,162,173,0.14), 0 0 26px rgba(125,105,180,0.08)',
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
        // Camera rail: focus the agent/bus zone on the single unified canvas. Never
        // swaps node sets and never quick-adds (quick-add cleared the task overlay).
        onClick={onShowCanvasWorkspace}
        className="p-2 rounded"
        style={{ color: workspaceView === 'canvas' ? colors.primary : colors.text }}
      >
        <HexPlusIcon />
      </button>
      {visibleRailItems.showKnowledge ? (
        <button
          title="Knowledge"
          aria-label="Knowledge"
          data-testid="rail-burst-button"
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
      {visibleRailItems.showCode ? (
        <button
          title="Code"
          aria-label="Code"
          data-testid="rail-code-button"
          onClick={onShowCodeWorkspace}
          className="p-2 rounded"
          style={{
            color:
              workspaceView === 'code' ? GRAPH_THEME.accent.solar : colors.text,
          }}
        >
          <Icon d="M9 7 4 12l5 5 M15 7l5 5-5 5 M13 5l-2 14" />
        </button>
      ) : null}
      {visibleRailItems.showDataFormulator ? (
        <button
          title="Data Formulator"
          aria-label="Data Formulator"
          data-testid="rail-data-formulator-button"
          onClick={onShowDataFormulatorWorkspace}
          className="p-2 rounded"
          style={{
            color:
              workspaceView === 'data-formulator'
                ? GRAPH_THEME.accent.solar
                : colors.text,
          }}
        >
          <Icon d="M4 5h16v14H4z M7 9h4 M7 13h4 M13 9h4 M13 13h4" />
        </button>
      ) : null}
      {visibleRailItems.showOpenClaudeConsole ? (
        <button
          type="button"
          title="Code Console"
          aria-label="Code Console"
          data-testid="rail-openclaude-console-button"
          onClick={onOpenOpenClaudeConsole}
          className="p-2 rounded"
          style={{ color: openClaudeConsoleActive ? colors.primary : colors.text }}
        >
          <Icon d="M4 5h16v14H4z M7 9l3 3-3 3 M13 15h4" />
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
