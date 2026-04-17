import React, { useEffect, useRef, useState } from "react";

type UploadAttachmentProps = {
  knowledgeProjectId: string;
  disabled?: boolean;
  onUploaded?: () => void;
};

function buildDocumentId(file: File): string {
  const base = file.name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const stamp = Date.now().toString(36);
  return `${base || "attachment"}-${stamp}`;
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

async function postKnowgraphIngest(file: File, projectId: string): Promise<{ response: Response; payload: any | null }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("project_id", projectId);
  // Backend currently expects document_id; derive one from filename.
  formData.append("document_id", buildDocumentId(file));

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

async function ensureAnonymousSession(): Promise<void> {
  const response = await fetch("/api/auth/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to start session (${response.status})`);
  }
}

export default function UploadAttachment({
  knowledgeProjectId,
  disabled = false,
  onUploaded,
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

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
      let { response, payload } = await postKnowgraphIngest(file, knowledgeProjectId);

      if (response.status === 401) {
        await ensureAnonymousSession();
        ({ response, payload } = await postKnowgraphIngest(file, knowledgeProjectId));
      }

      if (!response.ok) {
        if (response.status === 401 && import.meta.env.DEV) {
          setToastType("error");
          setToast("Unauthorized: missing auth header/cookie");
          return;
        }
        const message = normalizeIngestErrorMessage(payload, response.status);
        setToastType("error");
        setToast(message);
        return;
      }

      setToastType("ok");
      setToast("Knowledge imported");
      window.dispatchEvent(new CustomEvent("knowledge:refresh"));
      onUploaded?.();
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
        aria-label={uploading ? "Importing knowledge PDF" : "Import knowledge PDF"}
        title={uploading ? "Importing knowledge PDF" : "Import knowledge PDF"}
        data-no-surface-promote="true"
        style={{
          width: 42,
          height: 42,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid #3A3A3A",
          borderRadius: 12,
          background: uploading ? "rgba(79,162,173,0.18)" : "#202020",
          color: "#FFFFFF",
          boxShadow: uploading ? "0 0 0 1px rgba(79,162,173,0.22) inset" : "none",
          opacity: disabled || uploading ? 0.65 : 1,
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
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
