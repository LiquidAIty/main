import { useEffect, useRef, useState } from "react";

import UploadAttachment from "../knowledge/UploadAttachment";

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
  onSend,
  knowledgeProjectId,
  colors,
  busy = false,
  connecting = false,
  historyLoading = false,
  onStop,
  draft,
  onDraftChange,
}: {
  messages: { role: "assistant" | "user"; text: string }[];
  onSend: (t: string) => void;
  knowledgeProjectId: string;
  colors: BuilderChatColors;
  /** The real SSE turn is still open; prevent a second send and state it plainly. */
  busy?: boolean;
  /** The send request is opening; no native Hermes turn has been announced yet. */
  connecting?: boolean;
  /** Native conversation history is rejoining; prevent a send that could be overwritten by readback. */
  historyLoading?: boolean;
  onStop?: () => void;
  draft?: string;
  onDraftChange?: (value: string) => void;
}) {
  const [localDraft, setLocalDraft] = useState("");
  const interactionDisabled = busy || connecting || historyLoading;
  const value = draft === undefined ? localDraft : draft;
  const setValue = (next: string) => {
    if (draft === undefined) setLocalDraft(next);
    onDraftChange?.(next);
  };
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as native assistant text streams in.
  const lastTextLen = messages.length ? messages[messages.length - 1]?.text?.length ?? 0 : 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastTextLen]);

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
        <div
          className="flex items-center gap-2"
          style={{
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
