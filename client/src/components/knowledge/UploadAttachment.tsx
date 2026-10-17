/**
 * Entity: KnowGraph
 * Relationship: Validates one selected PDF and Project, submits authenticated KnowGraph ingestion, clears the picker, and renders bounded success or provider-specific failure feedback.
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";

type UploadAttachmentProps = {
  knowledgeProjectId: string;
  disabled?: boolean;
};

function buildDocumentId(file: File): string {
  const base = file.name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return `pdf:${base || "attachment"}`;
}

function isPdfFile(file: File): boolean {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  return name.endsWith(".pdf") || type.includes("pdf");
}

async function readJsonSafely(res: Response): Promise<any | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function postKnowgraphIngest(file: File, projectId: string): Promise<{
  response: Response;
  payload: any | null;
}> {
  const formData = new FormData();
  const documentId = buildDocumentId(file);
  formData.append("file", file);
  formData.append("project_id", projectId);
  formData.append("document_id", documentId);

  const response = await fetch("/api/knowgraph/ingest", {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  const payload = await readJsonSafely(response);
  return { response, payload };
}

function formatUploadError(endpoint: string, status: number, body: string): string {
  const compact = String(body || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return `${endpoint} | ${status} | ${compact || "no response body"}`;
}

function normalizeIngestErrorMessage(payload: any, status: number): string {
  if (status === 413) {
    return "Upload too large: the server rejected the PDF request body before KnowGraph ingest could start.";
  }
  if (status === 401) {
    return "Your Project session is not authorized to import knowledge. Sign in again before retrying.";
  }
  const raw = String(
    payload?.error?.message ||
      payload?.message ||
      payload?.error ||
      "",
  ).trim();
  if (!raw) {
    return formatUploadError("/api/knowgraph/ingest", status, "");
  }
  const lower = raw.toLowerCase();
  if (
    lower.includes("ratelimiterror") ||
    lower.includes("rate limit") ||
    lower.includes("insufficient_quota") ||
    lower.includes("quota")
  ) {
    return "KnowGraph ingest failed: configured provider/model is rate limited or out of quota. No provider fallback was used.";
  }
  return raw;
}

export default function UploadAttachment({
  knowledgeProjectId,
  disabled = false,
}: UploadAttachmentProps) {
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"ok" | "error">("ok");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openPicker = () => {
    if (disabled || uploading) return;
    inputRef.current?.click();
  };

  const clearInput = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isPdfFile(file)) {
      setToastType("error");
      setToast("Only PDF files are supported for knowledge import.");
      clearInput();
      return;
    }

    if (!knowledgeProjectId) {
      setToastType("error");
      setToast("Select a project before importing knowledge.");
      clearInput();
      return;
    }

    setUploading(true);
    try {
      const { response, payload } = await postKnowgraphIngest(
        file,
        knowledgeProjectId,
      );

      if (!response.ok) {
        const message = normalizeIngestErrorMessage(payload, response.status);
        setToastType("error");
        setToast(message);
        return;
      }

      setToastType("ok");
      const sectionCount = Number(payload?.section_count || 0);
      setToast(sectionCount > 1 ? `Knowledge imported (${sectionCount} sections)` : "Knowledge imported");
    } catch (error: any) {
      setToastType("error");
      setToast(formatUploadError("/api/knowgraph/ingest", 0, error?.message || "Failed to fetch"));
    } finally {
      setUploading(false);
      clearInput();
    }
  };

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled || uploading}
        aria-label={uploading ? "Attaching knowledge PDF" : "Attach knowledge PDF"}
        title={uploading ? "Attaching knowledge PDF" : "Attach knowledge PDF"}
        data-no-surface-promote="true"
        style={{
          width: 36,
          height: 36,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: 10,
          background: uploading ? "rgba(79,162,173,0.16)" : "rgba(255,255,255,0.02)",
          color: "rgba(224,222,213,0.9)",
          boxShadow: "none",
          opacity: disabled || uploading ? 0.65 : 1,
          transition: "background 120ms ease, border-color 120ms ease",
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
          <path d="M5 12h14" />
        </svg>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: "none" }}
        onChange={handleFileSelected}
      />
      {toast && (
        <div
          role="status"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            background: toastType === "ok" ? "#183122" : "#3A1B1B",
            border: toastType === "ok" ? "1px solid #2F8F6A" : "1px solid #A95656",
            borderRadius: 8,
            color: toastType === "ok" ? "#D7FFE8" : "#FFE3E3",
            fontSize: 12,
            padding: "6px 8px",
            whiteSpace: "nowrap",
            zIndex: 10,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
