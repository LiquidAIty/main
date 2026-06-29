import { useEffect, useRef, useState, type ReactNode } from "react";

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
  disabled = false,
  colors,
  activeWork,
}: {
  messages: { role: "assistant" | "user"; text: string }[];
  onSend: (t: string) => void;
  knowledgeProjectId: string;
  disabled?: boolean;
  colors: BuilderChatColors;
  /** Compact inline work for the active turn, shown beneath the latest message. */
  activeWork?: ReactNode;
}) {
  const [v, setV] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the latest message (and the active turn's inline work) in view — scroll
  // on new messages and as the active assistant reply streams in.
  const lastTextLen = messages.length ? messages[messages.length - 1]?.text?.length ?? 0 : 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastTextLen]);

  const send = () => {
    const trimmed = v.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setV("");
  };

  return (
    <div className="h-full flex flex-col" style={{ gap: 12 }}>
      <div
        ref={listRef}
        className="flex-1"
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
        {/* Inline per-turn work flows with the conversation, beneath the active
            assistant reply — not a pinned panel that squeezes the message list. */}
        {activeWork ? (
          <div style={{ justifySelf: "start", maxWidth: "min(92%, 640px)", width: "100%" }}>
            {activeWork}
          </div>
        ) : null}
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
            value={v}
            onChange={(e) => setV(e.target.value)}
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
          <button
            onClick={send}
            aria-label="Send"
            className="rounded-full flex items-center justify-center"
            style={{
              width: 40,
              height: 40,
              background: colors.primary,
              border: "1px solid rgba(79,162,173,0.36)",
              boxShadow: "0 8px 18px rgba(79,162,173,0.10), inset 0 1px 0 rgba(255,255,255,0.14)",
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
