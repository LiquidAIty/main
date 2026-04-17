const LABEL_COLORS: Record<string, string> = {
  Project: "#d78c5a",
  Package: "#d78c5a",
  Module: "#c57b4f",
  Folder: "#5f8d8d",
  File: "#4fa2ad",
  Class: "#8c74cd",
  Interface: "#8c74cd",
  Function: "#63c7d1",
  Method: "#63c7d1",
  Route: "#d6b15d",
  Variable: "#70818d",
};

const DEFAULT_COLOR = "#94a3b8";

export function colorForCodeGraphLabel(label: string): string {
  return LABEL_COLORS[label] ?? DEFAULT_COLOR;
}

export function colorForCodeGraphEdgeType(type: string): string {
  const normalized = String(type || "").trim().toUpperCase();
  if (normalized === "CALLS") return "#4fa2ad";
  if (normalized === "IMPORTS") return "#5fb9c6";
  if (normalized === "DEFINES") return "#8c74cd";
  if (normalized === "DEFINES_METHOD") return "#8c74cd";
  if (normalized === "CONTAINS_FILE") return "#6f8a92";
  if (normalized === "CONTAINS_FOLDER") return "#6f8a92";
  if (normalized === "HANDLES") return "#d6b15d";
  if (normalized === "IMPLEMENTS") return "#d78c5a";
  if (normalized === "HTTP_CALLS") return "#d96f6f";
  if (normalized === "ASYNC_CALLS") return "#9f85d8";
  return "#4a9298";
}
