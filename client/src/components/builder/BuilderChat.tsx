import { useEffect, useLayoutEffect, useRef, useState } from "react";

import UploadAttachment from "../knowledge/UploadAttachment";
import useChatImageAttachments, {
  CHAT_IMAGE_TYPES,
  type ChatImageAttachment,
} from "./useChatImageAttachments";

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

export default function BuilderChat({
  messages,
  mainCardId,
  addressableAgents = [],
  onSend,
  knowledgeProjectId,
  colors,
  busy = false,
  connecting = false,
  historyLoading = false,
  error = null,
  onStop,
  voiceError = null,
  voicePhase = "idle",
  onVoiceStart,
  onVoiceStop,
  draft,
  onDraftChange,
}: {
  messages: {
    role: "assistant" | "user";
    text: string;
    speaker: { kind: "user" | "card"; label: string; cardId?: string; profile?: string; address?: string };
    target?: { kind: "user" | "card"; label: string; cardId?: string; profile?: string; address?: string };
    status?: "pending" | "complete" | "error";
  }[];
  /** Main is the ambient voice of this chat; only directly addressed non-Main Cards need a label. */
  mainCardId?: string;
  addressableAgents?: {
    cardId: string;
    profile: string;
    title: string;
    address: string;
    aliases: string[];
  }[];
  onSend: (t: string, images?: ChatImageAttachment[]) => void;
  knowledgeProjectId: string;
  colors: BuilderChatColors;
  /** The real SSE turn is still open; prevent a second send and state it plainly. */
  busy?: boolean;
  /** The send request is opening; no native Hermes turn has been announced yet. */
  connecting?: boolean;
  /** Native conversation history is rejoining; prevent a send that could be overwritten by readback. */
  historyLoading?: boolean;
  /** Visible transport/configuration failure; never represented as assistant speech. */
  error?: string | null;
  onStop?: () => void;
  voiceError?: string | null;
  voicePhase?: "idle" | "listening" | "processing" | "speaking" | "error";
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
  draft?: string;
  onDraftChange?: (value: string) => void;
}) {
  const [localDraft, setLocalDraft] = useState("");
  const [selectedAddressIndex, setSelectedAddressIndex] = useState(0);
  const interactionDisabled = busy || connecting || historyLoading;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const value = draft === undefined ? localDraft : draft;
  const setValue = (next: string) => {
    if (draft === undefined) setLocalDraft(next);
    onDraftChange?.(next);
  };
  const addressMatch = /^@([a-z0-9_-]*)$/i.exec(value);
  const addressPrefix = addressMatch?.[1]?.toLowerCase() ?? null;
  const addressSuggestions = addressPrefix === null
    ? []
    : addressableAgents.filter((agent) => (
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
    if (!agent) return;
    setValue(`@${agent.address} `);
    setSelectedAddressIndex(0);
  };
  const listRef = useRef<HTMLDivElement>(null);
  const {
    clearImages,
    imageError,
    imageInputRef,
    images,
    pasteFiles,
    readingImages,
    removeImage,
    selectFiles,
  } = useChatImageAttachments({
    disabled: historyLoading,
    resetKey: knowledgeProjectId,
  });

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    const maximum = Math.max(40, Math.min(240, window.innerHeight * 0.35));
    const height = Math.min(maximum, Math.max(40, input.scrollHeight));
    input.style.height = `${height}px`;
    input.style.overflowY = input.scrollHeight > height ? "auto" : "hidden";
  }, [value]);

  // Keep the latest message in view as native assistant text streams in.
  const lastTextLen = messages.length ? messages[messages.length - 1]?.text?.length ?? 0 : 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastTextLen]);

  const send = () => {
    if (!value.trim() || interactionDisabled) return;
    if (images.length) onSend(value, images);
    else onSend(value);
    clearImages();
    setValue("");
  };

  const resolvedVoicePhase = voicePhase || "idle";
  const voiceIdle = resolvedVoicePhase === "idle" || resolvedVoicePhase === "error";
  const visibleError = imageError || error || voiceError;

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
        ref={listRef}
        className="flex-1 builder-chat-scroll"
        style={{
          flex: "1 1 0",
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "16px 20px 18px",
        }}
      >
        <div
          style={{
            minHeight: "100%",
            display: "grid",
            alignContent: "end",
            gap: 14,
          }}
        >
        {messages.map((m, i) => {
          const isUser = m.role !== "assistant";
          const showSpeaker = !isUser
            && Boolean(m.speaker.cardId)
            && m.speaker.cardId !== mainCardId;
          // Never render an empty/whitespace assistant bubble — only real assistant
          // text appears as a bubble. (Real user messages always render.)
          if (!isUser && !safeText(m.text).trim()) return null;
          return (
            <div
              key={i}
              style={{
                justifySelf: isUser ? "end" : "start",
                maxWidth: isUser ? "min(82%, 560px)" : "min(92%, 640px)",
                width: "fit-content",
              }}
            >
              {showSpeaker ? (
                <div
                  data-testid="builder-chat-speaker"
                  style={{
                    color: m.status === "error" ? "#FF9B9B" : colors.neutral,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    margin: "0 6px 5px",
                    textTransform: "uppercase",
                    textAlign: "left",
                  }}
                >
                  {m.speaker.label}
                </div>
              ) : null}
              <div
                style={{
                  padding: isUser ? "11px 15px 12px 15px" : "11px 16px 12px 16px",
                  color: colors.text,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
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
                    : `1px solid rgba(255,255,255,0.06)`,
                  boxShadow: isUser
                    ? "inset 0 1px 0 rgba(255,255,255,0.07), 0 1px 0 rgba(0,0,0,0.35), 0 10px 28px rgba(0,0,0,0.22), 0 0 0 1px rgba(79,162,173,0.06)"
                    : "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.18), 0 4px 18px rgba(0,0,0,0.14)",
                }}
              >
                {safeText(m.text)}
              </div>
            </div>
          );
        })}
        </div>
      </div>
      <div className="px-4 pb-4">
        {visibleError ? (
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
            {safeText(visibleError)}
          </div>
        ) : null}
        {images.length ? (
          <div
            data-testid="builder-chat-images"
            style={{
              display: "flex", flexWrap: "wrap", gap: 8, padding: "5px 5px 8px",
              maxHeight: 144, overflowY: "auto",
            }}
          >
            {images.map((image, index) => (
              <div key={`${image.name}:${index}`} style={{ position: "relative", width: 64, height: 64 }}>
                <img
                  src={image.dataUrl}
                  alt={image.name}
                  style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 9 }}
                />
                <button
                  type="button"
                  aria-label={`Remove ${image.name}`}
                  disabled={historyLoading}
                  onClick={() => removeImage(index)}
                  style={{
                    position: "absolute", top: -5, right: -5, width: 22, height: 22,
                    borderRadius: "50%", background: colors.panel,
                    border: `1px solid ${colors.border}`, color: colors.text,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div
          className="flex items-end gap-2"
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
            ref={imageInputRef}
            data-testid="builder-chat-image-input"
            type="file"
            multiple
            accept={CHAT_IMAGE_TYPES.join(",")}
            aria-label="Image files"
            style={{ display: "none" }}
            onChange={selectFiles}
          />
          <button
            type="button"
            data-testid="builder-chat-attach-images"
            aria-label="Attach images"
            title="Attach images"
            disabled={historyLoading || readingImages}
            onClick={() => imageInputRef.current?.click()}
            style={{
              width: 30, height: 40, flex: "0 0 auto", border: 0,
              background: "transparent", color: colors.text,
              opacity: readingImages ? 0.5 : 1,
              cursor: historyLoading ? "not-allowed" : "pointer",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8" cy="8" r="1.5" />
              <path d="m3 16 5-5 4 4 4-5 5 6" />
            </svg>
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            data-testid="builder-chat-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={pasteFiles}
            disabled={historyLoading}
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
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Type a message…"
            className="flex-1"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              minWidth: 0,
              minHeight: 40,
              resize: "none",
              overflowX: "hidden",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
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
          {busy ? (
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
          {busy && onStop ? (
            <button type="button" data-testid="builder-chat-stop" onClick={onStop}>
              Stop
            </button>
          ) : null}
          {onVoiceStart && onVoiceStop ? (
            <button
              type="button"
              data-testid="builder-chat-voice"
              aria-label={voiceIdle
                ? "Start voice"
                : resolvedVoicePhase === "listening" ? "Stop and transcribe voice" : "Stop voice"}
              title={voiceIdle
                ? "Start voice"
                : resolvedVoicePhase === "listening"
                  ? "Listening"
                  : resolvedVoicePhase === "processing" ? "Processing voice" : "Speaking"}
              onClick={voiceIdle ? onVoiceStart : onVoiceStop}
              disabled={interactionDisabled}
              className="rounded-full flex items-center justify-center"
              style={{
                width: 34, height: 34, flex: "0 0 auto",
                border: resolvedVoicePhase === "listening"
                  ? "1px solid rgba(255,130,130,0.72)"
                  : `1px solid ${colors.border}`,
                background: resolvedVoicePhase === "idle"
                  ? "transparent"
                  : resolvedVoicePhase === "error"
                    ? "rgba(255,105,105,0.10)" : "rgba(79,162,173,0.14)",
                color: resolvedVoicePhase === "listening" ? "#FF9B9B" : colors.text,
                cursor: interactionDisabled ? "not-allowed" : "pointer",
                opacity: interactionDisabled ? 0.45 : 1,
                boxShadow: resolvedVoicePhase === "listening"
                  ? "0 0 0 4px rgba(255,130,130,0.08)" : "none",
              }}
            >
              <svg
                width="17" height="17" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"
                strokeLinejoin="round" aria-hidden="true"
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
            disabled={interactionDisabled || readingImages}
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
