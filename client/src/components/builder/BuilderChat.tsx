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
  projectId,
  disabled = false,
  colors,
}: {
  messages: { role: "assistant" | "user"; text: string }[];
  onSend: (t: string) => void;
  projectId: string;
  disabled?: boolean;
  colors: BuilderChatColors;
}) {
  const [v, setV] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
  }, [messages.length]);

  const send = () => {
    if (disabled) return;
    const trimmed = v.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setV("");
  };

  return (
    <div className="h-full flex flex-col" style={{ gap: 12 }}>
      <div
        ref={listRef}
        className="flex-1 overflow-auto"
        style={{
          padding: "14px 18px",
          display: "grid",
          gap: 10,
          alignContent: "start",
        }}
      >
        {messages.map((m, i) => {
          const right = m.role !== "assistant";
          const bg = m.role === "user" ? colors.panel : colors.bg;
          return (
            <div
              key={i}
              style={{ justifySelf: right ? "end" : "start", maxWidth: "86%" }}
            >
              <div
                style={{ fontSize: 11, color: colors.neutral, marginBottom: 4 }}
              >
                {m.role === "assistant" ? "Assistant" : "You"}
              </div>
              <div
                style={{
                  background: bg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 12,
                  padding: "10px 12px",
                  color: colors.text,
                  whiteSpace: "pre-wrap",
                }}
              >
                {safeText(m.text)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-4 pb-4 flex items-center gap-2">
        <UploadAttachment
          projectId={projectId}
          disabled={disabled || !projectId}
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
            background: colors.panel,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            padding: "12px 14px",
            color: colors.text,
          }}
          disabled={disabled}
        />
        <button
          onClick={send}
          aria-label="Send"
          className="rounded-full flex items-center justify-center"
          style={{
            width: 42,
            height: 42,
            background: colors.primary,
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
          }}
          disabled={disabled}
        >
          <svg
            width="20"
            height="20"
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
  );
}
