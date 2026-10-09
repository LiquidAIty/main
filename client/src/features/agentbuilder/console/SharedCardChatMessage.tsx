import { Fragment, useMemo, type ReactNode } from 'react';

import {
  prepareChatBubbleText,
  tightChatBubbleTextWidth,
} from './pretextBubbleLayout';
import type {
  CanonicalSubjectFocusTarget,
  CanonicalSubjectMatcher,
} from '../../../components/knowledge/canonicalSubjectLinks';

export type SharedCardChatColors = {
  primary: string;
  bg: string;
  panel: string;
  border: string;
  text: string;
  neutral: string;
};

export type SharedCardChatDisplayMessage = {
  messageId?: string;
  role: 'assistant' | 'user';
  text: string;
  speaker: {
    kind: 'user' | 'card';
    label: string;
    cardId?: string;
    profile?: string;
    address?: string;
  };
  target?: {
    kind: 'user' | 'card';
    label: string;
    cardId?: string;
    profile?: string;
    address?: string;
  };
  status?: 'pending' | 'complete' | 'error';
};

export function shouldRenderSharedCardMessage(
  message: SharedCardChatDisplayMessage,
): boolean {
  return message.role !== 'assistant' || Boolean(message.text.trim());
}

export const CANONICAL_SUBJECT_LINK_STYLE = Object.freeze({
  display: 'inline',
  margin: 0,
  padding: 0,
  border: 0,
  background: 'transparent',
  color: '#A7B0BA',
  cursor: 'pointer',
  font: 'inherit',
  fontStyle: 'italic',
  letterSpacing: 'inherit',
  lineHeight: 'inherit',
  textAlign: 'inherit',
  textDecoration: 'underline',
  textDecorationStyle: 'dotted',
  textUnderlineOffset: 3,
} as const);

export const MESSAGE_LANE_MAX_WIDTH = 760;

function linkedChatText(
  text: string,
  role: SharedCardChatDisplayMessage['role'],
  subjectMatcher: CanonicalSubjectMatcher | null | undefined,
  onSubjectFocus: ((target: CanonicalSubjectFocusTarget) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  const segments = subjectMatcher?.segmentMessage(role, text) || [{ text }];
  return segments.map((segment, index) => segment.target && onSubjectFocus ? (
    <button
      key={`${keyPrefix}:subject:${index}`}
      type="button"
      aria-label={`Open ${segment.text} in graph`}
      onClick={() => onSubjectFocus(segment.target!)}
      style={CANONICAL_SUBJECT_LINK_STYLE}
    >
      {segment.text}
    </button>
  ) : <Fragment key={`${keyPrefix}:text:${index}`}>{segment.text}</Fragment>);
}

function safeMarkdownUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function inlineChatMarkdown(
  text: string,
  role: SharedCardChatDisplayMessage['role'],
  subjectMatcher: CanonicalSubjectMatcher | null | undefined,
  onSubjectFocus: ((target: CanonicalSubjectFocusTarget) => void) | undefined,
  keyPrefix: string,
): ReactNode[] {
  const output: ReactNode[] = [];
  let cursor = 0;
  let token = 0;
  const pushText = (value: string) => {
    if (!value) return;
    output.push(...linkedChatText(
      value,
      role,
      subjectMatcher,
      onSubjectFocus,
      `${keyPrefix}:${token++}`,
    ));
  };
  while (cursor < text.length) {
    if (
      text[cursor] === '\\'
      && cursor + 1 < text.length
      && ['*', '_', '`', '\\'].includes(text[cursor + 1])
    ) {
      pushText(text[cursor + 1]);
      cursor += 2;
      continue;
    }
    if (text.startsWith('**', cursor)) {
      const close = text.indexOf('**', cursor + 2);
      if (close > cursor + 2) {
        const current = token++;
        output.push(
          <strong key={`${keyPrefix}:strong:${current}`}>
            {inlineChatMarkdown(
              text.slice(cursor + 2, close),
              role,
              subjectMatcher,
              onSubjectFocus,
              `${keyPrefix}:strong:${current}`,
            )}
          </strong>,
        );
        cursor = close + 2;
        continue;
      }
    }
    if (text[cursor] === '*' || text[cursor] === '_') {
      const marker = text[cursor];
      const close = text.indexOf(marker, cursor + 1);
      if (close > cursor + 1) {
        const current = token++;
        output.push(
          <em key={`${keyPrefix}:em:${current}`}>
            {inlineChatMarkdown(
              text.slice(cursor + 1, close),
              role,
              subjectMatcher,
              onSubjectFocus,
              `${keyPrefix}:em:${current}`,
            )}
          </em>,
        );
        cursor = close + 1;
        continue;
      }
    }
    if (text[cursor] === '`') {
      const close = text.indexOf('`', cursor + 1);
      if (close > cursor + 1) {
        output.push(
          <code key={`${keyPrefix}:code:${token++}`}>
            {text.slice(cursor + 1, close)}
          </code>,
        );
        cursor = close + 1;
        continue;
      }
    }
    if (text[cursor] === '[') {
      const labelEnd = text.indexOf('](', cursor + 1);
      const urlEnd = labelEnd >= 0 ? text.indexOf(')', labelEnd + 2) : -1;
      if (labelEnd > cursor + 1 && urlEnd > labelEnd + 2) {
        const url = safeMarkdownUrl(text.slice(labelEnd + 2, urlEnd));
        if (url) {
          output.push(
            <a
              key={`${keyPrefix}:link:${token++}`}
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              {inlineChatMarkdown(
                text.slice(cursor + 1, labelEnd),
                role,
                subjectMatcher,
                onSubjectFocus,
                `${keyPrefix}:link-label`,
              )}
            </a>,
          );
          cursor = urlEnd + 1;
          continue;
        }
      }
    }
    const next = [
      text.indexOf('\\', cursor + 1),
      text.indexOf('*', cursor + 1),
      text.indexOf('_', cursor + 1),
      text.indexOf('`', cursor + 1),
      text.indexOf('[', cursor + 1),
    ].filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? text.length;
    pushText(text.slice(cursor, next));
    cursor = next;
  }
  return output;
}

function renderChatMarkdown(
  text: string,
  role: SharedCardChatDisplayMessage['role'],
  subjectMatcher: CanonicalSubjectMatcher | null | undefined,
  onSubjectFocus: ((target: CanonicalSubjectFocusTarget) => void) | undefined,
): ReactNode[] {
  const lines = text.split('\n');
  return lines.flatMap((rawLine, index) => {
    const heading = /^(#{1,6})\s+(.+)$/.exec(rawLine);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(rawLine);
    const content = heading?.[2] ?? bullet?.[1] ?? rawLine;
    const inline = inlineChatMarkdown(
      content,
      role,
      subjectMatcher,
      onSubjectFocus,
      `line:${index}`,
    );
    const line = heading
      ? <strong key={`line:${index}:heading`}>{inline}</strong>
      : bullet
        ? (
          <span key={`line:${index}:bullet`}>
            <span aria-hidden="true">• </span>
            {inline}
          </span>
        )
        : <Fragment key={`line:${index}:plain`}>{inline}</Fragment>;
    return index < lines.length - 1
      ? [line, <br key={`line:${index}:break`} />]
      : [line];
  });
}

function SharedCardChatMessageBubble({
  colors,
  laneWidth,
  mainCardId,
  message,
  subjectMatcher,
  onSubjectFocus,
}: {
  colors: SharedCardChatColors;
  laneWidth: number | null;
  mainCardId?: string;
  message: SharedCardChatDisplayMessage;
  subjectMatcher?: CanonicalSubjectMatcher | null;
  onSubjectFocus?: (target: CanonicalSubjectFocusTarget) => void;
}) {
  const text = message.text;
  const isUser = message.role !== 'assistant';
  const horizontalPadding = isUser ? 30 : 32;
  const maximumBubbleWidth = laneWidth == null
    ? null
    : Math.max(
        horizontalPadding + 1,
        Math.min(isUser ? 560 : 640, laneWidth * (isUser ? 0.82 : 0.92)),
      );
  const measurementEnabled = laneWidth != null;
  const prepared = useMemo(
    () => measurementEnabled ? prepareChatBubbleText(text) : null,
    [measurementEnabled, text],
  );
  const measuredContentWidth = useMemo(
    () => tightChatBubbleTextWidth(
      prepared,
      maximumBubbleWidth == null ? 0 : maximumBubbleWidth - horizontalPadding,
    ),
    [maximumBubbleWidth, prepared],
  );
  const measuredBubbleWidth = measuredContentWidth == null
    ? null
    : Math.ceil(measuredContentWidth + horizontalPadding);
  const showSpeaker = !isUser
    && Boolean(message.speaker.cardId)
    && message.speaker.cardId !== mainCardId;
  const speakerAddress = (message.speaker.address || message.speaker.label).replace(/^@/, '');

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        width: '100%',
      }}
    >
      <div
        data-testid="shared-card-chat-message-frame"
        style={{
          maxWidth: isUser ? 'min(82%, 560px)' : 'min(92%, 640px)',
          width: measuredBubbleWidth == null ? 'fit-content' : measuredBubbleWidth,
        }}
      >
        {showSpeaker ? (
          <div
            data-testid="shared-card-chat-speaker"
            style={{
              color: message.status === 'error' ? '#FF9B9B' : colors.neutral,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.04em',
              margin: '0 6px 5px',
              textTransform: 'uppercase',
              textAlign: 'left',
            }}
          >
            @{speakerAddress}
          </div>
        ) : null}
        <div
          style={{
            boxSizing: 'border-box',
            width: '100%',
            padding: isUser ? '11px 15px 12px 15px' : '11px 16px 12px 16px',
            color: colors.text,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            wordBreak: 'normal',
            lineHeight: 1.55,
            fontSize: 13.5,
            letterSpacing: '-0.01em',
            borderRadius: isUser
              ? '16px 16px 5px 16px'
              : '16px 16px 16px 6px',
            background: isUser
              ? 'linear-gradient(165deg, rgba(52,56,62,0.98) 0%, rgba(36,40,46,0.99) 55%, rgba(30,34,40,1) 100%)'
              : 'linear-gradient(180deg, rgba(28,30,34,0.55) 0%, rgba(22,24,28,0.72) 100%)',
            border: isUser
              ? '1px solid rgba(79,162,173,0.22)'
              : '1px solid rgba(255,255,255,0.06)',
            boxShadow: isUser
              ? 'inset 0 1px 0 rgba(255,255,255,0.07), 0 1px 0 rgba(0,0,0,0.35), 0 10px 28px rgba(0,0,0,0.22), 0 0 0 1px rgba(79,162,173,0.06)'
              : 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.18), 0 4px 18px rgba(0,0,0,0.14)',
          }}
        >
          {isUser
            ? text
            : renderChatMarkdown(text, message.role, subjectMatcher, onSubjectFocus)}
        </div>
      </div>
    </div>
  );
}

export default function SharedCardChatMessage({
  colors,
  index,
  laneWidth,
  mainCardId,
  message,
  messageCount,
  subjectMatcher,
  onSubjectFocus,
}: {
  colors: SharedCardChatColors;
  index: number;
  laneWidth: number | null;
  mainCardId?: string;
  message: SharedCardChatDisplayMessage;
  messageCount: number;
  subjectMatcher?: CanonicalSubjectMatcher | null;
  onSubjectFocus?: (target: CanonicalSubjectFocusTarget) => void;
}) {
  return (
    <div
      data-testid="shared-card-chat-message-row"
      style={{
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: MESSAGE_LANE_MAX_WIDTH + 40,
        margin: '0 auto',
        padding: `${index === 0 ? 16 : 7}px 20px ${
          index === messageCount - 1 ? 18 : 7
        }px`,
      }}
    >
      <SharedCardChatMessageBubble
        colors={colors}
        laneWidth={laneWidth}
        mainCardId={mainCardId}
        message={message}
        subjectMatcher={subjectMatcher}
        onSubjectFocus={onSubjectFocus}
      />
    </div>
  );
}
