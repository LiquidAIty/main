import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Dispatch,
  MouseEvent,
  SetStateAction,
} from 'react';

const CHAT_MIN_WIDTH = 280;
const CANVAS_MIN_WIDTH = 520;
const COMPANION_MIN_WIDTH = 360;
const COLLAPSE_EDGE_PX = 28;

type UseAgentBuilderWorkspaceLayoutArgs<T extends string> = {
  setWorkspaceView: Dispatch<SetStateAction<T>>;
  workspaceView: T;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export default function useAgentBuilderWorkspaceLayout<T extends string>({
  setWorkspaceView,
  workspaceView,
}: UseAgentBuilderWorkspaceLayoutArgs<T>) {
  const [chatPanelWidth, setChatPanelWidth] = useState(420);
  const [splitterActive, setSplitterActive] = useState(false);
  const [splitterDragging, setSplitterDragging] = useState(false);
  const workspaceShellRef = useRef<HTMLDivElement | null>(null);
  const resizeSessionRef = useRef<{
    startX: number;
    startWidth: number;
    pendingWidth: number;
    reservedWidth: number;
  } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  const clampChatWidth = useCallback(
    (nextWidth: number, reservedWidth: number) => {
      const shellWidth = workspaceShellRef.current?.clientWidth ?? 0;
      if (shellWidth <= 0) return Math.max(CHAT_MIN_WIDTH, nextWidth);
      return clamp(
        nextWidth,
        CHAT_MIN_WIDTH,
        Math.max(CHAT_MIN_WIDTH, shellWidth - reservedWidth),
      );
    },
    [],
  );

  const resolveChatMaxWidth = useCallback((reservedWidth: number) => {
    const shellWidth = workspaceShellRef.current?.clientWidth ?? 0;
    if (shellWidth <= 0) return CHAT_MIN_WIDTH;
    return Math.max(CHAT_MIN_WIDTH, shellWidth - reservedWidth);
  }, []);

  const finishResize = useCallback(
    (mode: 'commit' | 'cancel') => {
      const session = resizeSessionRef.current;
      if (!session) return;
      resizeSessionRef.current = null;
      setSplitterDragging(false);
      setSplitterActive(false);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      if (mode === 'cancel') {
        setChatPanelWidth(session.startWidth);
        return;
      }
      setChatPanelWidth(session.pendingWidth);
      const maxWidth = resolveChatMaxWidth(session.reservedWidth);
      if (session.pendingWidth >= maxWidth - COLLAPSE_EDGE_PX) {
        setWorkspaceView('chat' as T);
      }
    },
    [resolveChatMaxWidth, setWorkspaceView],
  );

  useEffect(() => {
    if (!splitterDragging) return;
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const session = resizeSessionRef.current;
      if (!session) return;
      const delta = event.clientX - session.startX;
      session.pendingWidth = clampChatWidth(
        session.startWidth + delta,
        session.reservedWidth,
      );
      if (resizeFrameRef.current !== null) return;
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        const activeSession = resizeSessionRef.current;
        if (activeSession) {
          setChatPanelWidth(activeSession.pendingWidth);
        }
      });
    };
    const handleMouseUp = () => finishResize('commit');
    const handleWindowBlur = () => finishResize('commit');
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      finishResize('cancel');
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [clampChatWidth, finishResize, splitterDragging]);

  useEffect(
    () => () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const reservedWidth =
      workspaceView === 'canvas'
        ? CANVAS_MIN_WIDTH
        : COMPANION_MIN_WIDTH;
    const syncWidth = () => {
      setChatPanelWidth((current) =>
        clampChatWidth(current, reservedWidth),
      );
    };
    syncWidth();
    window.addEventListener('resize', syncWidth);
    return () => window.removeEventListener('resize', syncWidth);
  }, [clampChatWidth, workspaceView]);

  const handleSplitterMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      setSplitterActive(true);
      const reservedWidth =
        workspaceView === 'canvas'
          ? CANVAS_MIN_WIDTH
          : COMPANION_MIN_WIDTH;
      resizeSessionRef.current = {
        startX: event.clientX,
        startWidth: chatPanelWidth,
        pendingWidth: chatPanelWidth,
        reservedWidth,
      };
      setSplitterDragging(true);
    },
    [chatPanelWidth, workspaceView],
  );

  return {
    canvasMinWidth: CANVAS_MIN_WIDTH,
    chatMinWidth: CHAT_MIN_WIDTH,
    chatPanelWidth,
    companionMinWidth: COMPANION_MIN_WIDTH,
    handleSplitterMouseDown,
    onSplitterMouseEnter: () => setSplitterActive(true),
    onSplitterMouseLeave: () => {
      if (!splitterDragging) setSplitterActive(false);
    },
    splitterActive,
    workspaceShellRef,
  };
}
