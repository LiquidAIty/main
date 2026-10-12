import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import {
  showCanvasWorkspaceInUrl,
  showKnowledgeWorkspaceInUrl,
  showWorldViewWorkspaceInUrl,
} from './agentBuilderWorkspaceUrl';
import type { DeckCard } from '../../../types/agentgraph';

export type AgentBuilderWorkspaceView =
  | 'chat'
  | 'canvas'
  | 'knowledge'
  | 'trading'
  | 'worldsignals'
  | 'worldview';

export type AgentBuilderCanvasFocus = { zone: 'agents'; nonce: number } | null;

export default function useAgentBuilderWorkspaceNavigation({
  cardDraftFlushRef,
  closeInspectorDrawer,
  setDeckStatusMessage,
  setInspectorDrawerOpen,
  setWorkspaceView,
  setCanvasFocusZone,
  setWorldViewInspectorOpen,
  tradingCard,
  worldSignalsCardId,
  worldViewCard,
}: {
  cardDraftFlushRef: MutableRefObject<(() => Promise<boolean>) | null>;
  closeInspectorDrawer: () => Promise<boolean>;
  setDeckStatusMessage: Dispatch<SetStateAction<string | null>>;
  setInspectorDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setWorkspaceView: Dispatch<SetStateAction<AgentBuilderWorkspaceView>>;
  setCanvasFocusZone: Dispatch<SetStateAction<AgentBuilderCanvasFocus>>;
  setWorldViewInspectorOpen: Dispatch<SetStateAction<boolean>>;
  tradingCard: DeckCard | null;
  worldSignalsCardId: string | null;
  worldViewCard: DeckCard | null;
}) {
  const showCanvasWorkspace = useCallback(async () => {
    if (!(await closeInspectorDrawer())) return;
    setWorkspaceView('canvas');
    showCanvasWorkspaceInUrl();
    setCanvasFocusZone({ zone: 'agents', nonce: Date.now() });
  }, [closeInspectorDrawer, setCanvasFocusZone, setWorkspaceView]);

  const showKnowledgeWorkspace = useCallback(async () => {
    if (!(await closeInspectorDrawer())) return;
    setWorkspaceView('knowledge');
    showKnowledgeWorkspaceInUrl();
  }, [closeInspectorDrawer, setWorkspaceView]);

  const showTradingWorkspace = useCallback(async () => {
    if (cardDraftFlushRef.current && !(await cardDraftFlushRef.current())) return;
    if (!tradingCard?.id) {
      setDeckStatusMessage('Trading saved Card is unavailable.');
      return;
    }
    setInspectorDrawerOpen(false);
    setWorkspaceView('trading');
  }, [
    cardDraftFlushRef,
    setDeckStatusMessage,
    setInspectorDrawerOpen,
    setWorkspaceView,
    tradingCard?.id,
  ]);

  const showWorldSignalsWorkspace = useCallback(async () => {
    if (!(await closeInspectorDrawer())) return;
    if (!worldSignalsCardId) {
      setDeckStatusMessage('WorldSignals saved Card is unavailable.');
      return;
    }
    setWorkspaceView('worldsignals');
  }, [
    closeInspectorDrawer,
    setDeckStatusMessage,
    setWorkspaceView,
    worldSignalsCardId,
  ]);

  const showWorldViewWorkspace = useCallback(async () => {
    if (!(await closeInspectorDrawer())) return;
    if (!worldViewCard?.id) {
      setDeckStatusMessage('WorldView saved Card is unavailable.');
      return;
    }
    setWorkspaceView('worldview');
    setWorldViewInspectorOpen(true);
    showWorldViewWorkspaceInUrl();
  }, [
    closeInspectorDrawer,
    setDeckStatusMessage,
    setWorkspaceView,
    setWorldViewInspectorOpen,
    worldViewCard?.id,
  ]);

  return {
    showCanvasWorkspace,
    showKnowledgeWorkspace,
    showTradingWorkspace,
    showWorldSignalsWorkspace,
    showWorldViewWorkspace,
  };
}
