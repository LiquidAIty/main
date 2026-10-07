import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

const CHAT_MIN_WIDTH = 280;
const SPLITTER_WIDTH = 10;
const DEFAULT_CHAT_WIDTH = 420;
// The existing 12px knowledge-tab row (10px left inset, five labels with 12px
// horizontal padding, 1px borders, and 6px gaps) ends at 400.84375px in the
// product font stack. Keep the full CodeGraph control visible in integer CSS
// pixels, then let Main overlap the graph underplane beyond that boundary.
export const KNOWLEDGE_TAB_STRIP_SAFE_WIDTH = 401;

export const COMPANION_MIN_WIDTHS = Object.freeze({
  canvas: 520,
  knowledge: 520,
  trading: 520,
  worldsignal: 360,
  worldview: 720,
});

export function companionMinimumWidth(workspaceView: string): number {
  return COMPANION_MIN_WIDTHS[
    workspaceView as keyof typeof COMPANION_MIN_WIDTHS
  ] ?? COMPANION_MIN_WIDTHS.knowledge;
}

export function workspaceCollisionWidth(
  workspaceView: string,
  companionMinWidth: number,
): number {
  return workspaceView === 'knowledge'
    ? KNOWLEDGE_TAB_STRIP_SAFE_WIDTH
    : companionMinWidth;
}

export function resolveHybridWorkspaceGeometry({
  workspaceWidth,
  mainWidth,
  companionMinWidth,
  collisionWidth = companionMinWidth,
  splitterWidth = SPLITTER_WIDTH,
}: {
  workspaceWidth: number;
  mainWidth: number;
  companionMinWidth: number;
  collisionWidth?: number;
  splitterWidth?: number;
}) {
  const boundedWorkspaceWidth = Math.max(0, Number(workspaceWidth) || 0);
  const boundedSplitterWidth = Math.max(0, Number(splitterWidth) || 0);
  const boundedMainWidth = Math.max(0, Number(mainWidth) || 0);
  const boundedCompanionMinWidth = Math.max(0, Number(companionMinWidth) || 0);
  const boundedCollisionWidth = Math.min(
    boundedCompanionMinWidth,
    Math.max(0, Number(collisionWidth) || 0),
  );
  const companionVisibleWidth = Math.max(
    0,
    boundedWorkspaceWidth - boundedMainWidth - boundedSplitterWidth,
  );
  // Keep the real renderer at its safe surface width even while its adjacent
  // pane is clipped narrower. Resizing a force/canvas renderer down to the
  // collision sliver can clear its viewport and leave it blank when expanded.
  const companionViewportWidth = Math.max(
    boundedCompanionMinWidth,
    companionVisibleWidth,
  );
  const companionOverlayWidth = Math.max(
    0,
    boundedCollisionWidth - companionVisibleWidth,
  );
  return {
    companionOverlayWidth,
    companionContentMinWidth: boundedCompanionMinWidth,
    companionViewportWidth,
    companionVisibleWidth,
  };
}

type UseAgentBuilderWorkspaceLayoutArgs<T extends string> = {
  workspaceView: T;
};

type ResizeSession = {
  kind: 'standard' | 'worldview';
  pointerId: number;
  pointerTarget: HTMLDivElement;
  startX: number;
  startWidth: number;
  pendingWidth: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function releaseCapturedPointer(session: ResizeSession) {
  const target = session.pointerTarget;
  try {
    if (
      typeof target.releasePointerCapture === 'function'
      && (typeof target.hasPointerCapture !== 'function'
        || target.hasPointerCapture(session.pointerId))
    ) {
      target.releasePointerCapture(session.pointerId);
    }
  } catch {
    // The browser may already have released capture during blur or pointercancel.
  }
}

export default function useAgentBuilderWorkspaceLayout<T extends string>({
  workspaceView,
}: UseAgentBuilderWorkspaceLayoutArgs<T>) {
  const [standardChatPanelWidth, setStandardChatPanelWidth] = useState(DEFAULT_CHAT_WIDTH);
  const [worldviewChatPanelWidth, setWorldviewChatPanelWidth] = useState(DEFAULT_CHAT_WIDTH);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [splitterActive, setSplitterActive] = useState(false);
  const [splitterDragging, setSplitterDragging] = useState(false);
  const workspaceShellRef = useRef<HTMLDivElement | null>(null);
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const chatPanelWidth = workspaceView === 'worldview'
    ? worldviewChatPanelWidth
    : standardChatPanelWidth;
  const companionMinWidth = companionMinimumWidth(workspaceView);

  const clampChatWidth = useCallback((nextWidth: number) => {
    const shellWidth = workspaceShellRef.current?.clientWidth ?? 0;
    if (shellWidth <= 0) return Math.max(CHAT_MIN_WIDTH, nextWidth);
    const maximum = Math.max(0, shellWidth - SPLITTER_WIDTH);
    const minimum = Math.min(CHAT_MIN_WIDTH, maximum);
    return clamp(nextWidth, minimum, maximum);
  }, []);

  const setWidthForKind = useCallback((kind: 'standard' | 'worldview', width: number) => {
    if (kind === 'worldview') {
      setWorldviewChatPanelWidth(width);
    } else {
      setStandardChatPanelWidth(width);
    }
  }, []);

  const finishResize = useCallback(
    (mode: 'commit' | 'cancel') => {
      const session = resizeSessionRef.current;
      if (!session) return;
      resizeSessionRef.current = null;
      releaseCapturedPointer(session);
      setSplitterDragging(false);
      setSplitterActive(false);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      setWidthForKind(
        session.kind,
        mode === 'cancel' ? session.startWidth : session.pendingWidth,
      );
    },
    [setWidthForKind],
  );

  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const session = resizeSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      const delta = event.clientX - session.startX;
      session.pendingWidth = clampChatWidth(session.startWidth + delta);
      if (resizeFrameRef.current !== null) return;
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        const activeSession = resizeSessionRef.current;
        if (activeSession) {
          setWidthForKind(activeSession.kind, activeSession.pendingWidth);
        }
      });
    };
    const handlePointerUp = (event: globalThis.PointerEvent) => {
      if (event.pointerId === resizeSessionRef.current?.pointerId) finishResize('commit');
    };
    const handlePointerCancel = (event: globalThis.PointerEvent) => {
      if (event.pointerId === resizeSessionRef.current?.pointerId) finishResize('cancel');
    };
    const handleWindowBlur = () => finishResize('commit');
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      finishResize('cancel');
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [clampChatWidth, finishResize, setWidthForKind]);

  useEffect(
    () => () => {
      const session = resizeSessionRef.current;
      if (session) releaseCapturedPointer(session);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const syncWidth = () => {
      const shellWidth = workspaceShellRef.current?.clientWidth ?? 0;
      setWorkspaceWidth(shellWidth);
      if (workspaceView === 'worldview') {
        setWorldviewChatPanelWidth((current) => clampChatWidth(current));
      } else {
        setStandardChatPanelWidth((current) => clampChatWidth(current));
      }
    };
    syncWidth();
    const shell = workspaceShellRef.current;
    const observer = shell && typeof ResizeObserver === 'function'
      ? new ResizeObserver(syncWidth)
      : null;
    if (shell && observer) observer.observe(shell);
    window.addEventListener('resize', syncWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', syncWidth);
    };
  }, [clampChatWidth, workspaceView]);

  const handleSplitterPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const pointerId = event.pointerId;
      const pointerTarget = event.currentTarget;
      try {
        pointerTarget.setPointerCapture?.(pointerId);
      } catch {
        // Window listeners still guarantee release if capture is unavailable.
      }
      setSplitterActive(true);
      resizeSessionRef.current = {
        kind: workspaceView === 'worldview' ? 'worldview' : 'standard',
        pointerId,
        pointerTarget,
        startX: event.clientX,
        startWidth: chatPanelWidth,
        pendingWidth: chatPanelWidth,
      };
      setSplitterDragging(true);
    },
    [chatPanelWidth, workspaceView],
  );

  const geometry = useMemo(
    () => resolveHybridWorkspaceGeometry({
      workspaceWidth,
      mainWidth: chatPanelWidth,
      companionMinWidth,
      collisionWidth: workspaceCollisionWidth(workspaceView, companionMinWidth),
    }),
    [chatPanelWidth, companionMinWidth, workspaceView, workspaceWidth],
  );

  return {
    chatMinWidth: CHAT_MIN_WIDTH,
    chatPanelWidth,
    companionMinWidth,
    ...geometry,
    handleSplitterPointerDown,
    onSplitterPointerEnter: () => setSplitterActive(true),
    onSplitterPointerLeave: () => {
      if (!splitterDragging) setSplitterActive(false);
    },
    splitterActive,
    workspaceShellRef,
  };
}
