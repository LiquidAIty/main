const LABEL_COLORS: Record<string, string> = {
  Project: "#e11d48",
  Package: "#f97316",
  Module: "#f97316",
  Folder: "#22c55e",
  File: "#3b82f6",
  Class: "#a855f7",
  Interface: "#a855f7",
  Function: "#06b6d4",
  Method: "#06b6d4",
  Route: "#eab308",
  Variable: "#64748b",
};

const DEFAULT_COLOR = "#94a3b8";

export function colorForCodeGraphLabel(label: string): string {
  return LABEL_COLORS[label] ?? DEFAULT_COLOR;
}

export function colorForCodeGraphEdgeType(type: string): string {
  const normalized = String(type || "").trim().toUpperCase();
  if (normalized === "CALLS") return "#1DA27E";
  if (normalized === "IMPORTS") return "#3b82f6";
  if (normalized === "DEFINES") return "#a855f7";
  if (normalized === "DEFINES_METHOD") return "#a855f7";
  if (normalized === "CONTAINS_FILE") return "#22c55e";
  if (normalized === "CONTAINS_FOLDER") return "#22c55e";
  if (normalized === "HANDLES") return "#eab308";
  if (normalized === "IMPLEMENTS") return "#f97316";
  if (normalized === "HTTP_CALLS") return "#e11d48";
  if (normalized === "ASYNC_CALLS") return "#ec4899";
  return "#1C8585";
}
