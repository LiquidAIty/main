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
  coderCardId,
}: {
  messages: { role: "assistant" | "user"; text: string }[];
  onSend: (t: string) => void;
  knowledgeProjectId: string;
  colors: BuilderChatColors;
  /** The real SSE turn is still open; prevent a second send and state it plainly. */
  busy?: boolean;
  coderCardId?: string | null;
}) {
  const [v, setV] = useState("");
  const [showCoderReview, setShowCoderReview] = useState(false);
  const [coderJobText, setCoderJobText] = useState("");
  const [coderIdf, setCoderIdf] = useState<any>(null);
  const [coderBusy, setCoderBusy] = useState(false);
  const [coderError, setCoderError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const coderRequest = async (path: string, body: Record<string, unknown>) => {
    setCoderBusy(true);
    setCoderError("");
    try {
      const response = await fetch(`/api/coder${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || `coder_request_failed_${response.status}`));
      }
      return payload;
    } catch (error) {
      setCoderError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setCoderBusy(false);
    }
  };

  const prepareCoderDraft = async () => {
    const objective = v.trim();
    if (!objective || !coderCardId) return;
    const jobContext = {
      objective,
      planExcerpt: objective,
      contextSummary: "Use the current LiquidAIty checkout and saved Coder Card authority.",
      codeAnchors: [],
      cbmQueries: ["Resolve the requested structural slice with canonical Codebase Memory first."],
      guardrails: ["Preserve unrelated changes.", "Do not commit or push."],
      allowedFiles: ["Only files required by the approved objective."],
      forbiddenWork: ["No unrelated cleanup.", "No hidden provider fallback."],
      proofRequired: ["Run focused tests and typecheck the touched production boundary."],
      reportFormat: "LiquidAIty CoderReport",
      stopConditions: ["Stop if an irreversible product decision is required."],
      writeMode: "edit",
    };
    const payload = await coderRequest("/idf/coder/drafts", {
      projectId: knowledgeProjectId,
      cardId: coderCardId,
      conversationId: "builder-coder-review",
      jobContext,
    });
    if (payload?.idf) {
      setCoderIdf(payload.idf);
      setCoderJobText(JSON.stringify(payload.idf.jobContext, null, 2));
      setShowCoderReview(true);
    }
  };

  const reviseCoderDraft = async () => {
    if (!coderIdf) return;
    let jobContext: Record<string, unknown>;
    try {
      jobContext = JSON.parse(coderJobText);
    } catch {
      setCoderError("Coder job fields must be valid JSON.");
      return;
    }
    const payload = await coderRequest(`/idf/coder/${encodeURIComponent(coderIdf.idfId)}/revisions`, {
      projectId: knowledgeProjectId,
      expectedVersion: coderIdf.version,
      expectedSha256: coderIdf.contentSha256,
      jobContext,
    });
    if (payload?.idf) {
      setCoderIdf(payload.idf);
      setCoderJobText(JSON.stringify(payload.idf.jobContext, null, 2));
    }
  };

  const approveCoderDraft = async () => {
    if (!coderIdf) return;
    const payload = await coderRequest(`/idf/coder/${encodeURIComponent(coderIdf.idfId)}/approve`, {
      projectId: knowledgeProjectId,
      expectedVersion: coderIdf.version,
      expectedSha256: coderIdf.contentSha256,
    });
    if (payload?.idf) setCoderIdf(payload.idf);
  };

  const runApprovedCoderDraft = async () => {
    if (!coderIdf || coderIdf.approvalStatus !== "approved") return;
    const payload = await coderRequest("/localcoder/run", {
      projectId: knowledgeProjectId,
      idfId: coderIdf.idfId,
      version: coderIdf.version,
      contentSha256: coderIdf.contentSha256,
    });
    if (payload?.report) {
      onSend(`Coder result (${coderIdf.idfId} v${coderIdf.version}):\n${JSON.stringify(payload.report, null, 2)}`);
      setShowCoderReview(false);
      setCoderIdf(null);
    }
  };

  // Keep the latest message (and the active turn's inline work) in view — scroll
  // on new messages and as the active assistant reply streams in.
  const lastTextLen = messages.length ? messages[messages.length - 1]?.text?.length ?? 0 : 0;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastTextLen]);

  const send = () => {
    const trimmed = v.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setV("");
  };

  return (
    <div className="h-full flex flex-col" style={{ gap: 12 }}>
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
        {showCoderReview && coderIdf ? (
          <div
            data-testid="coder-idf-review"
            style={{
              marginBottom: 8,
              padding: 10,
              borderRadius: 12,
              background: colors.panel,
              border: `1px solid ${colors.border}`,
              color: colors.text,
              fontSize: 12,
            }}
          >
            <div style={{ marginBottom: 6 }}>
              Coder IDF v{coderIdf.version} · {coderIdf.approvalStatus} · sha256 {String(coderIdf.contentSha256).slice(0, 16)}…
            </div>
            <div style={{ marginBottom: 6, color: colors.neutral }}>
              Card {coderIdf.cardContext?.cardId} · {coderIdf.cardContext?.provider}/{coderIdf.cardContext?.providerModelId} · {coderIdf.cardContext?.accessMode}
            </div>
            <textarea
              aria-label="Coder job fields"
              value={coderJobText}
              disabled={coderBusy || coderIdf.approvalStatus === "approved"}
              onChange={(event) => setCoderJobText(event.target.value)}
              style={{ width: "100%", minHeight: 150, resize: "vertical", background: colors.bg, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 8, fontFamily: "monospace", fontSize: 11 }}
            />
            {coderError ? <div role="alert" style={{ color: "#FFA2A2", marginTop: 6 }}>{coderError}</div> : null}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {coderIdf.approvalStatus === "draft" ? (
                <>
                  <button disabled={coderBusy} onClick={reviseCoderDraft}>Save revision</button>
                  <button disabled={coderBusy} onClick={approveCoderDraft}>Approve exact hash</button>
                </>
              ) : (
                <button disabled={coderBusy} onClick={runApprovedCoderDraft}>Run approved Coder</button>
              )}
              <button disabled={coderBusy} onClick={() => setShowCoderReview(false)}>Close</button>
            </div>
          </div>
        ) : null}
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
          <button
            type="button"
            disabled={busy || coderBusy || !coderCardId || !v.trim()}
            onClick={prepareCoderDraft}
            title="Prepare an immutable Coder IDF for review"
            style={{ color: colors.text, background: "transparent", border: `1px solid ${colors.border}`, borderRadius: 8, padding: "6px 8px", fontSize: 11 }}
          >
            Coder job
          </button>
          <input
            value={v}
            onChange={(e) => setV(e.target.value)}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder={busy ? "Chat is working…" : "Type a message…"}
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
              data-testid="builder-chat-working"
              role="status"
              aria-live="polite"
              style={{
                color: colors.neutral,
                fontSize: 12,
                padding: "0 4px",
                whiteSpace: "nowrap",
              }}
            >
              Working…
            </span>
          ) : null}
          <button
            onClick={send}
            disabled={busy}
            aria-label={busy ? "Chat is working" : "Send"}
            className="rounded-full flex items-center justify-center"
            style={{
              width: 40,
              height: 40,
              background: busy ? colors.neutral : colors.primary,
              border: "1px solid rgba(79,162,173,0.36)",
              boxShadow: "0 8px 18px rgba(79,162,173,0.10), inset 0 1px 0 rgba(255,255,255,0.14)",
              cursor: busy ? "not-allowed" : "pointer",
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
