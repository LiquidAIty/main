import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import type { DirectChatTarget } from "../../features/agentbuilder/console/mainSessionClient";
import type { MainChatVoicePhase } from "../../features/agentbuilder/console/useAgentBuilderMainChat";
import UploadAttachment from "../knowledge/UploadAttachment";
import {
  prepareChatBubbleText,
  tightChatBubbleTextWidth,
} from "./pretextBubbleLayout";

type BuilderChatColors = {
  primary: string;
  bg: string;
  panel: string;
  border: string;
  text: string;
  neutral: string;
};

function safeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") return json;
  } catch {
    // fallback below
  }
  return String(value);
}

type BuilderChatMessage = {
  role: "assistant" | "user";
  text: string;
  speaker: { kind: "user" | "card"; label: string; cardId?: string; profile?: string; address?: string };
  target?: { kind: "user" | "card"; label: string; cardId?: string; profile?: string; address?: string };
  status?: "pending" | "complete" | "error";
};

function shouldRenderMessage(message: BuilderChatMessage): boolean {
  return message.role !== "assistant" || Boolean(safeText(message.text).trim());
}

export function followLatestOutput(atBottom: boolean): "auto" | false {
  return atBottom ? "auto" : false;
}

function BuilderChatMessageBubble({
  colors,
  laneWidth,
  mainCardId,
  message,
}: {
  colors: BuilderChatColors;
  laneWidth: number | null;
  mainCardId?: string;
  message: BuilderChatMessage;
}) {
  const text = safeText(message.text);
  const isUser = message.role !== "assistant";
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
  const speakerAddress = safeText(message.speaker.address || message.speaker.label)
    .replace(/^@/, "");

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        width: "100%",
      }}
    >
      <div
        data-testid="builder-chat-message-frame"
        style={{
          maxWidth: isUser ? "min(82%, 560px)" : "min(92%, 640px)",
          width: measuredBubbleWidth == null ? "fit-content" : measuredBubbleWidth,
        }}
      >
        {showSpeaker ? (
          <div
            data-testid="builder-chat-speaker"
            style={{
              color: message.status === "error" ? "#FF9B9B" : colors.neutral,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.04em",
              margin: "0 6px 5px",
              textTransform: "uppercase",
              textAlign: "left",
            }}
          >
            @{speakerAddress}
          </div>
        ) : null}
        <div
          style={{
            boxSizing: "border-box",
            width: "100%",
            padding: isUser ? "11px 15px 12px 15px" : "11px 16px 12px 16px",
            color: colors.text,
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            wordBreak: "normal",
            lineHeight: 1.55,
            fontSize: 13.5,
            letterSpacing: "-0.01em",
            borderRadius: isUser
              ? "16px 16px 5px 16px"
              : "16px 16px 16px 6px",
            background: isUser
              ? "linear-gradient(165deg, rgba(52,56,62,0.98) 0%, rgba(36,40,46,0.99) 55%, rgba(30,34,40,1) 100%)"
              : "linear-gradient(180deg, rgba(28,30,34,0.55) 0%, rgba(22,24,28,0.72) 100%)",
            border: isUser
              ? "1px solid rgba(79,162,173,0.22)"
              : "1px solid rgba(255,255,255,0.06)",
            boxShadow: isUser
              ? "inset 0 1px 0 rgba(255,255,255,0.07), 0 1px 0 rgba(0,0,0,0.35), 0 10px 28px rgba(0,0,0,0.22), 0 0 0 1px rgba(79,162,173,0.06)"
              : "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.18), 0 4px 18px rgba(0,0,0,0.14)",
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

export default function BuilderChat({
  messages,
  mainCardId,
  directChatTargets = [],
  onSend,
  knowledgeProjectId,
  colors,
  busy = false,
  connecting = false,
  queuedCount = 0,
  historyLoading = false,
  error = null,
  voiceError = null,
  voicePhase = "idle",
  onVoiceStart,
  onVoiceStop,
  onStop,
  draft,
  onDraftChange,
}: {
  messages: BuilderChatMessage[];
  /** Main is the ambient voice of this chat; only directly addressed non-Main Cards need a label. */
  mainCardId?: string;
  directChatTargets?: DirectChatTarget[];
  onSend: (t: string) => void;
  knowledgeProjectId: string;
  colors: BuilderChatColors;
  /** The real SSE turn is still open; the composer remains available and submissions queue. */
  busy?: boolean;
  /** The send request is opening; additional submissions queue behind it. */
  connecting?: boolean;
  /** Inputs waiting to use the same canonical Main session after its active turn. */
  queuedCount?: number;
  /** Native conversation history is rejoining; prevent a send that could be overwritten by readback. */
  historyLoading?: boolean;
  /** Visible transport/configuration failure; never represented as assistant speech. */
  error?: string | null;
  voiceError?: string | null;
  voicePhase?: MainChatVoicePhase;
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
  onStop?: () => void;
  draft?: string;
  onDraftChange?: (value: string) => void;
}) {
  const [localDraft, setLocalDraft] = useState("");
  const [selectedAddressIndex, setSelectedAddressIndex] = useState(0);
  const [messageLaneWidth, setMessageLaneWidth] = useState<number | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const interactionDisabled = historyLoading;
  const value = draft === undefined ? localDraft : draft;
  const setValue = (next: string) => {
    if (draft === undefined) setLocalDraft(next);
    onDraftChange?.(next);
  };
  const addressMatch = /^@([a-z0-9_-]*)$/i.exec(value);
  const addressPrefix = addressMatch?.[1]?.toLowerCase() ?? null;
  const addressSuggestions = addressPrefix === null
    ? []
    : directChatTargets.filter((agent) => (
      Boolean(agent.address)
      &&
      agent.aliases.some((alias) => alias.toLowerCase().startsWith(addressPrefix))
    ));
  const boundedAddressIndex = addressSuggestions.length > 0
    ? Math.min(selectedAddressIndex, addressSuggestions.length - 1)
    : 0;
  useEffect(() => {
    setSelectedAddressIndex(0);
  }, [addressPrefix]);
  const completeAddress = (index = boundedAddressIndex) => {
    const agent = addressSuggestions[index];
    if (!agent?.address) return;
    setValue(`@${agent.address} `);
    setSelectedAddressIndex(0);
  };
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const renderableMessages = useMemo(
    () => messages.filter(shouldRenderMessage),
    [messages],
  );

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport || typeof ResizeObserver !== "function") return;
    const syncWidth = () => {
      // Pretext needs the actual text lane width. This observes the one
      // continuously-resizable chat viewport; Virtuoso remains the sole row
      // height/scroll measurement owner.
      const nextWidth = Math.max(0, viewport.clientWidth - 40);
      setMessageLaneWidth((current) => current === nextWidth ? current : nextWidth);
    };
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const renderMessage = useCallback((index: number, message: BuilderChatMessage) => (
    <div
      data-testid="builder-chat-message-row"
      style={{
        boxSizing: "border-box",
        padding: `${index === 0 ? 16 : 7}px 20px ${
          index === renderableMessages.length - 1 ? 18 : 7
        }px`,
      }}
    >
      <BuilderChatMessageBubble
        colors={colors}
        laneWidth={messageLaneWidth}
        mainCardId={mainCardId}
        message={message}
      />
    </div>
  ), [colors, mainCardId, messageLaneWidth, renderableMessages.length]);

  const returnToLatest = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior: "smooth",
    });
  }, []);

  const send = () => {
    if (!value.trim() || interactionDisabled) return;
    onSend(value);
    setValue("");
  };
  return (
    <div data-testid="builder-chat-panel" className="h-full flex flex-col" style={{ gap: 12 }}>
      <style>
        {`
          .builder-chat-scroll {
            scrollbar-width: thin;
            scrollbar-color: #4E4E4E transparent;
          }
          .builder-chat-scroll::-webkit-scrollbar { width: 7px; }
          .builder-chat-scroll::-webkit-scrollbar-track { background: transparent; }
          .builder-chat-scroll::-webkit-scrollbar-thumb {
            background: #4E4E4E;
            border-radius: 999px;
            border: 1px solid rgba(0, 0, 0, 0.25);
          }
          .builder-chat-scroll::-webkit-scrollbar-thumb:hover {
            background: #616161;
          }
          @keyframes builder-chat-active-pulse {
            0%, 100% { opacity: 0.3; transform: scale(0.82); }
            50% { opacity: 1; transform: scale(1); }
          }
        `}
      </style>
      <div
        ref={messageViewportRef}
        data-testid="builder-chat-message-viewport"
        className="flex-1"
        style={{
          position: "relative",
          flex: "1 1 0",
          minHeight: 0,
        }}
      >
        <Virtuoso
          ref={virtuosoRef}
          data={renderableMessages}
          data-testid="builder-chat-message-list"
          className="builder-chat-scroll"
          style={{ height: "100%", width: "100%" }}
          alignToBottom
          initialTopMostItemIndex={{
            index: Math.max(0, renderableMessages.length - 1),
            align: "end",
          }}
          followOutput={followLatestOutput}
          atBottomStateChange={setIsAtBottom}
          computeItemKey={(index) => index}
          itemContent={renderMessage}
        />
        {!isAtBottom && renderableMessages.length > 0 ? (
          <button
            type="button"
            data-testid="builder-chat-return-to-latest"
            aria-label="Return to latest"
            title="Return to latest"
            onClick={returnToLatest}
            style={{
              position: "absolute",
              right: 16,
              bottom: 10,
              zIndex: 3,
              width: 32,
              height: 32,
              display: "grid",
              placeItems: "center",
              borderRadius: "50%",
              border: `1px solid ${colors.border}`,
              background: colors.panel,
              color: colors.text,
              boxShadow: "0 7px 18px rgba(0,0,0,0.28)",
              cursor: "pointer",
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
      <div className="px-4 pb-4">
        {error || voiceError ? (
          <div
            data-testid="builder-chat-error"
            role="status"
            style={{
              color: "#FF9B9B",
              fontSize: 12,
              lineHeight: 1.35,
              padding: "0 6px 8px",
              overflowWrap: "anywhere",
            }}
          >
            {safeText(error || voiceError)}
          </div>
        ) : null}
        <div
          className="flex items-center gap-2"
          style={{
            position: "relative",
            borderRadius: 15,
            background: colors.panel,
            border: `1px solid ${colors.border}`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
            padding: "5px 6px 5px 7px",
          }}
        >
          <UploadAttachment
            knowledgeProjectId={knowledgeProjectId}
            disabled={!knowledgeProjectId}
            appearance="chat-inline"
          />
          <input
            data-testid="builder-chat-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={interactionDisabled}
            onKeyDown={(e) => {
              if (e.key === "Tab" && addressSuggestions.length > 0) {
                e.preventDefault();
                completeAddress();
                return;
              }
              if (e.key === "ArrowDown" && addressSuggestions.length > 1) {
                e.preventDefault();
                setSelectedAddressIndex((current) => (current + 1) % addressSuggestions.length);
                return;
              }
              if (e.key === "ArrowUp" && addressSuggestions.length > 1) {
                e.preventDefault();
                setSelectedAddressIndex((current) => (
                  (current - 1 + addressSuggestions.length) % addressSuggestions.length
                ));
                return;
              }
              if (e.key === "Enter") send();
            }}
            placeholder="Type a message…"
            className="flex-1"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              padding: "10px 7px",
              color: colors.text,
              fontSize: 14,
              lineHeight: 1.25,
            }}
          />
          {addressSuggestions.length > 0 ? (
            <div
              data-testid="builder-chat-address-suggestions"
              role="listbox"
              aria-label="Available agents"
              style={{
                position: "absolute",
                left: 48,
                right: 52,
                bottom: "calc(100% + 7px)",
                zIndex: 20,
                padding: 5,
                borderRadius: 11,
                background: "rgba(20,22,26,0.98)",
                border: `1px solid ${colors.border}`,
                boxShadow: "0 12px 32px rgba(0,0,0,0.42)",
              }}
            >
              {addressSuggestions.map((agent, index) => (
                <button
                  key={agent.cardId}
                  type="button"
                  role="option"
                  aria-selected={index === boundedAddressIndex}
                  data-testid={`builder-chat-address-${agent.address}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    completeAddress(index);
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "8px 10px",
                    border: 0,
                    borderRadius: 8,
                    background: index === boundedAddressIndex
                      ? "rgba(79,162,173,0.18)" : "transparent",
                    color: colors.text,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>@{agent.address}</span>
                  <span style={{ color: colors.neutral, fontSize: 11 }}>{agent.title}</span>
                </button>
              ))}
            </div>
          ) : null}
          {busy || connecting ? (
            <span
              data-testid="builder-chat-active-indicator"
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: colors.primary,
                animation: "builder-chat-active-pulse 1.1s ease-in-out infinite",
              }}
            />
          ) : null}
          {queuedCount > 0 ? (
            <span
              data-testid="builder-chat-queued-count"
              role="status"
              style={{ color: colors.neutral, fontSize: 11, whiteSpace: "nowrap" }}
            >
              {queuedCount} queued
            </span>
          ) : null}
          {busy && onStop ? (
            <button type="button" data-testid="builder-chat-stop" onClick={onStop}>
              Stop
            </button>
          ) : null}
          {onVoiceStart && onVoiceStop ? (
            <button
              type="button"
              data-testid="builder-chat-voice"
              aria-label={voicePhase === "idle" || voicePhase === "error"
                ? "Start voice"
                : voicePhase === "listening"
                  ? "Stop and transcribe voice"
                  : "Stop voice"}
              title={voicePhase === "idle" || voicePhase === "error"
                ? "Start voice"
                : voicePhase === "listening"
                  ? "Listening"
                  : voicePhase === "processing"
                    ? "Processing voice"
                    : "Speaking"}
              onClick={voicePhase === "idle" || voicePhase === "error"
                ? onVoiceStart
                : onVoiceStop}
              disabled={interactionDisabled}
              className="rounded-full flex items-center justify-center"
              style={{
                width: 34,
                height: 34,
                flex: "0 0 auto",
                border: voicePhase === "listening"
                  ? "1px solid rgba(255,130,130,0.72)"
                  : `1px solid ${colors.border}`,
                background: voicePhase === "idle"
                  ? "transparent"
                  : voicePhase === "error"
                    ? "rgba(255,105,105,0.10)"
                    : "rgba(79,162,173,0.14)",
                color: voicePhase === "listening" ? "#FF9B9B" : colors.text,
                cursor: interactionDisabled ? "not-allowed" : "pointer",
                opacity: interactionDisabled ? 0.45 : 1,
                boxShadow: voicePhase === "listening"
                  ? "0 0 0 4px rgba(255,130,130,0.08)"
                  : "none",
              }}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
                <path d="M12 18v3" />
                <path d="M9 21h6" />
              </svg>
            </button>
          ) : null}
          <button
            onClick={send}
            disabled={interactionDisabled}
            aria-label="Send"
            className="rounded-full flex items-center justify-center"
            style={{
              width: 40,
              height: 40,
              background: interactionDisabled ? colors.neutral : colors.primary,
              border: "1px solid rgba(79,162,173,0.36)",
              boxShadow: "0 8px 18px rgba(79,162,173,0.10), inset 0 1px 0 rgba(255,255,255,0.14)",
              cursor: interactionDisabled ? "not-allowed" : "pointer",
            }}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
