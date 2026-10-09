import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import SharedCardChatMessage, {
  MESSAGE_LANE_MAX_WIDTH,
  shouldRenderSharedCardMessage,
  type SharedCardChatColors,
  type SharedCardChatDisplayMessage,
} from './SharedCardChatMessage';
import type {
  CanonicalSubjectFocusTarget,
  CanonicalSubjectMatcher,
} from '../../../components/knowledge/canonicalSubjectLinks';

export function followLatestOutput(atBottom: boolean): 'auto' | false {
  return atBottom ? 'auto' : false;
}

export function sharedCardMessageKey(
  index: number,
  message: SharedCardChatDisplayMessage,
): string {
  return message.messageId || `message-index:${index}`;
}

export function SharedCardChatViewport({
  messages,
  mainCardId,
  colors,
  subjectMatcher,
  onSubjectFocus,
}: {
  messages: SharedCardChatDisplayMessage[];
  mainCardId?: string;
  colors: SharedCardChatColors;
  subjectMatcher?: CanonicalSubjectMatcher | null;
  onSubjectFocus?: (target: CanonicalSubjectFocusTarget) => void;
}) {
  const [messageLaneWidth, setMessageLaneWidth] = useState<number | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const renderableMessages = useMemo(
    () => messages.filter(shouldRenderSharedCardMessage),
    [messages],
  );

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport || typeof ResizeObserver !== 'function') return;
    const syncWidth = () => {
      // Pretext needs the actual text lane width. This observes the one
      // continuously-resizable chat viewport; Virtuoso remains the sole row
      // height/scroll measurement owner.
      const nextWidth = Math.max(
        0,
        Math.min(MESSAGE_LANE_MAX_WIDTH, viewport.clientWidth - 40),
      );
      setMessageLaneWidth((current) => current === nextWidth ? current : nextWidth);
    };
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const renderMessage = useCallback((index: number, message: SharedCardChatDisplayMessage) => (
    <SharedCardChatMessage
      colors={colors}
      index={index}
      laneWidth={messageLaneWidth}
      mainCardId={mainCardId}
      message={message}
      messageCount={renderableMessages.length}
      subjectMatcher={subjectMatcher}
      onSubjectFocus={onSubjectFocus}
    />
  ), [
    colors,
    mainCardId,
    messageLaneWidth,
    onSubjectFocus,
    renderableMessages.length,
    subjectMatcher,
  ]);

  const returnToLatest = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      align: 'end',
      behavior: 'smooth',
    });
  }, []);

  return (
    <div
      ref={messageViewportRef}
      data-testid="shared-card-chat-message-viewport"
      className="flex-1"
      style={{
        position: 'relative',
        flex: '1 1 0',
        minHeight: 0,
      }}
    >
      <Virtuoso
        ref={virtuosoRef}
        data={renderableMessages}
        data-testid="shared-card-chat-message-list"
        className="shared-card-chat-scroll"
        style={{ height: '100%', width: '100%' }}
        alignToBottom
        initialTopMostItemIndex={{
          index: Math.max(0, renderableMessages.length - 1),
          align: 'end',
        }}
        followOutput={followLatestOutput}
        atBottomStateChange={setIsAtBottom}
        computeItemKey={sharedCardMessageKey}
        itemContent={renderMessage}
      />
      {!isAtBottom && renderableMessages.length > 0 ? (
        <button
          type="button"
          data-testid="shared-card-chat-return-to-latest"
          aria-label="Return to latest"
          title="Return to latest"
          onClick={returnToLatest}
          style={{
            position: 'absolute',
            right: 16,
            bottom: 10,
            zIndex: 3,
            width: 32,
            height: 32,
            display: 'grid',
            placeItems: 'center',
            borderRadius: '50%',
            border: `1px solid ${colors.border}`,
            background: colors.panel,
            color: colors.text,
            boxShadow: '0 7px 18px rgba(0,0,0,0.28)',
            cursor: 'pointer',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14" />
            <path d="m19 12-7 7-7-7" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
